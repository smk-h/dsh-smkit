/**
 * MCP → DSH tool registration.
 *
 * Shared by the global (profile) tier and the per-workspace (scoped) tier.
 * `syncToolRegistrations` preserves registrations whose model-facing schema did
 * not change: besides keeping prompt caches stable, that avoids transiently
 * removing unrelated tools when a server emits
 * `notifications/tools/list_changed`.
 */

import { MAX_DESCRIPTION_LENGTH } from '../constants.js'
import { renderMcpResult } from './content.js'
import { mcpImageProjectionHandlers } from './image.js'
import { publicName } from './naming.js'
import { convParams, MCP_RESULT_SCHEMA } from './schema.js'
import type { ImageProjectionHandlers } from './image.js'
import type {
  McpCallResult,
  McpHandle,
  McpToolInfo,
  RegisteredTool,
  ServerConfig,
  ServiceAccessor,
  ToolDefinition,
  ToolsRegistry,
} from '../types.js'

/** Build one tool definition from a `tools/list` entry. */
export function makeToolDefinition(
  server: ServerConfig,
  tool: McpToolInfo,
  callFn: (name: string, args: unknown) => Promise<McpCallResult>,
  images: ImageProjectionHandlers,
): ToolDefinition {
  return {
    name: publicName(server.name, tool.name),
    mcpServerName: server.name,
    mcpRawName: tool.name,
    description: `${tool.description ?? ''} [${server.name} MCP]`.slice(0, MAX_DESCRIPTION_LENGTH),
    parameters: convParams(tool.inputSchema),
    output: { schema: MCP_RESULT_SCHEMA, render: renderMcpResult },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const payload = (args ?? {}) as Record<string, unknown>
      const result = await callFn(tool.name, payload)
      const content = Array.isArray(result?.content) ? result.content : []
      const text = content
        .filter((item) => item?.type === 'text')
        .map((item) => item.text)
        .join('\n')
      if (result?.isError === true) throw new Error(text || `MCP tool "${tool.name}" failed`)
      const value = { text, content, isError: false }
      await images.prepare(value, exec, args)
      return value
    },
    finalizeContent: images.finalizeContent,
  }
}

/** The model-facing surface of a definition, used to detect real changes. */
export function registrationSignature(definition: ToolDefinition): string {
  return JSON.stringify({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  })
}

export function disposeRegistrations(registrations: Map<string, RegisteredTool>): void {
  for (const entry of registrations.values()) {
    try {
      entry.dispose()
    } catch {
      // A registry that already dropped the definition is fine.
    }
  }
  registrations.clear()
}

/**
 * Reconcile one server's registrations with a fresh `tools/list` snapshot.
 * Returns the public names now registered.
 */
export function syncToolRegistrations(
  registry: ToolsRegistry,
  services: ServiceAccessor | null | undefined,
  server: ServerConfig,
  registrations: Map<string, RegisteredTool>,
  tools: McpToolInfo[],
  callFn: (name: string, args: unknown) => Promise<McpCallResult>,
): string[] {
  const desired = new Map<string, { definition: ToolDefinition; info: McpToolInfo; signature: string }>()
  const publicNames = new Set<string>()
  for (const tool of tools) {
    if (!tool || typeof tool.name !== 'string' || !tool.name) {
      throw new Error(`MCP server "${server.name}" returned a tool without a name`)
    }
    if (desired.has(tool.name)) {
      throw new Error(`MCP server "${server.name}" returned duplicate tool "${tool.name}"`)
    }
    const definition = makeToolDefinition(
      server,
      tool,
      callFn,
      mcpImageProjectionHandlers(services, tool.name),
    )
    if (publicNames.has(definition.name)) {
      throw new Error(
        `MCP server "${server.name}" returned tools that normalize to duplicate name "${definition.name}"`,
      )
    }
    publicNames.add(definition.name)
    desired.set(tool.name, { definition, info: tool, signature: registrationSignature(definition) })
  }

  const previous = new Map<string, RegisteredTool>()
  for (const [rawName, current] of registrations) {
    const next = desired.get(rawName)
    if (next && next.signature === current.signature) {
      // Not a model-facing change: keep the registration (and with it the
      // model's prompt cache) but refresh the raw entry, so a description the
      // cap truncated — or one that only differs past the cap — still reaches
      // the settings page.
      current.info = next.info
      continue
    }
    previous.set(rawName, current)
    try {
      current.dispose()
    } catch {
      // Nothing left to dispose.
    }
    registrations.delete(rawName)
  }

  const added: string[] = []
  try {
    for (const [rawName, next] of desired) {
      if (registrations.has(rawName)) continue
      const entry: RegisteredTool = {
        definition: next.definition,
        info: next.info,
        signature: next.signature,
        dispose: registry.register(next.definition),
      }
      registrations.set(rawName, entry)
      added.push(rawName)
    }
  } catch (error) {
    for (const rawName of added) {
      const entry = registrations.get(rawName)
      try {
        entry?.dispose()
      } catch {
        // Best effort: the registry is already in a failing state.
      }
      registrations.delete(rawName)
    }
    const restoreFailures: string[] = []
    for (const [rawName, entry] of previous) {
      try {
        entry.dispose = registry.register(entry.definition)
        registrations.set(rawName, entry)
      } catch (restoreError) {
        restoreFailures.push(
          `${rawName}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
        )
      }
    }
    if (restoreFailures.length > 0) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; rollback failed for ${restoreFailures.join(', ')}`,
      )
    }
    throw error
  }
  return [...desired.values()].map((entry) => entry.definition.name)
}

/** Page through `tools/list`, refusing a repeated cursor. */
export async function listAllTools(handle: McpHandle): Promise<McpToolInfo[]> {
  const tools: McpToolInfo[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  do {
    const listed = await handle.listTools(cursor)
    if (!Array.isArray(listed?.tools)) throw new Error('MCP tools/list returned no tools array')
    tools.push(...listed.tools)
    const next = typeof listed.nextCursor === 'string' && listed.nextCursor ? listed.nextCursor : undefined
    if (next && seenCursors.has(next)) throw new Error(`MCP tools/list repeated cursor "${next}"`)
    if (next) seenCursors.add(next)
    cursor = next
  } while (cursor !== undefined)
  return tools
}
