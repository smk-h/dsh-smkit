/**
 * The three on-demand broker tools.
 *
 * When broker mode is on, the model no longer sees one tool per MCP tool; it
 * sees `mcp_search_tools` → `mcp_describe_tool` → `mcp_execute_tool`. Nested
 * execution goes back through the DSH tool pipeline (so guards, tracing and
 * `finalizeContent` still apply), and `approvedParents` is what lets that
 * nested call through the guard that hides direct MCP tools.
 */

import { renderBrokerExecuteResult } from '../mcp/content.js'
import {
  BROKER_DESCRIBE_RESULT_SCHEMA,
  BROKER_EXECUTE_RESULT_SCHEMA,
  BROKER_SEARCH_RESULT_SCHEMA,
} from '../mcp/schema.js'
import { searchToolEntries } from './search.js'
import type {
  AgentLike,
  ContentBlock,
  ToolCatalogEntry,
  ToolDefinition,
  ToolSchemaView,
  ToolsRegistry,
} from '../types.js'

/** One catalog row: the registered schema plus its MCP identity. */
export interface BrokerCatalogEntry {
  schema: ToolSchemaView
  server: string
  tool: string
}

export function isMcpToolName(name: unknown): boolean {
  return typeof name === 'string' && name.startsWith('mcp__')
}

/**
 * Recover which server/raw name a registered tool came from. The registered
 * definition is authoritative; the public-name split is the fallback for
 * MCP-ish tools that did not come from this plugin.
 */
export function brokerIdentity(
  tools: ToolsRegistry,
  schema: ToolSchemaView,
  agent: AgentLike,
): { server: string; tool: string } {
  const definition = tools.get(schema.name, agent)
  if (
    typeof definition?.mcpServerName === 'string' &&
    typeof definition?.mcpRawName === 'string'
  ) {
    return { server: definition.mcpServerName, tool: definition.mcpRawName }
  }
  const rest = schema.name.slice('mcp__'.length)
  const split = rest.indexOf('__')
  if (split < 0) return { server: '', tool: rest }
  return { server: rest.slice(0, split), tool: rest.slice(split + 2) }
}

/** The MCP tools visible to one agent, as search rows. */
export function brokerCatalog(tools: ToolsRegistry, agent: AgentLike): BrokerCatalogEntry[] {
  return tools
    .schemas(agent)
    .filter((schema) => isMcpToolName(schema.name))
    .map((schema) => ({ schema, ...brokerIdentity(tools, schema, agent) }))
}

function brokerJsonRender(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

export function makeBrokerDefinitions(
  tools: ToolsRegistry,
  approvedParents: Set<unknown>,
): ToolDefinition[] {
  let nestedSeq = 1

  return [
    {
      name: 'mcp_search_tools',
      description:
        'Search MCP tools visible in the current session. Use the exact returned name with mcp_describe_tool or mcp_execute_tool. Omit query to list the catalog.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: {
            type: 'string',
            description:
              'Keywords describing the needed capability. Omit or leave empty to list the catalog instead.',
          },
          server: { type: 'string', description: 'Optional exact MCP server name.' },
          limit: { type: 'integer', description: 'Optional result count, clamped to 1-50 (default 10).' },
        },
      },
      output: { schema: BROKER_SEARCH_RESULT_SCHEMA, render: brokerJsonRender },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const input = (args ?? {}) as { query?: unknown; server?: unknown; limit?: unknown }
        const catalog: ToolCatalogEntry[] = brokerCatalog(tools, exec.agent).map((entry) => ({
          name: entry.schema.name,
          server: entry.server,
          tool: entry.tool,
          description: String(entry.schema.description ?? ''),
        }))
        return searchToolEntries(catalog, {
          query: input.query,
          server: input.server,
          limit: input.limit,
        })
      },
    },
    {
      name: 'mcp_describe_tool',
      description:
        'Return the complete description and exact input schema for one MCP tool visible in the current session.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: {
            type: 'string',
            description: 'Exact mcp__<server>__<tool> name returned by mcp_search_tools.',
          },
        },
        required: ['name'],
      },
      output: { schema: BROKER_DESCRIBE_RESULT_SCHEMA, render: brokerJsonRender },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const name = String(((args ?? {}) as { name?: unknown }).name ?? '').trim()
        const entry = brokerCatalog(tools, exec.agent).find((candidate) => candidate.schema.name === name)
        if (!entry) throw new Error(`MCP tool "${name}" is not visible in this session`)
        return {
          name: entry.schema.name,
          server: entry.server,
          tool: entry.tool,
          description: String(entry.schema.description ?? ''),
          inputSchema: entry.schema.parameters,
        }
      },
    },
    {
      name: 'mcp_execute_tool',
      description: 'Execute one MCP tool visible in the current session by its exact name and arguments.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Exact mcp__<server>__<tool> name.' },
          arguments: {
            type: 'object',
            additionalProperties: true,
            description: 'Arguments matching the tool input schema.',
          },
        },
        required: ['name', 'arguments'],
      },
      output: { schema: BROKER_EXECUTE_RESULT_SCHEMA, render: renderBrokerExecuteResult },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const input = (args ?? {}) as { name?: unknown; arguments?: unknown }
        const name = String(input.name ?? '').trim()
        if (!brokerCatalog(tools, exec.agent).some((candidate) => candidate.schema.name === name)) {
          throw new Error(`MCP tool "${name}" is not visible in this session`)
        }
        approvedParents.add(exec.token)
        try {
          const result = await tools.execute({
            callId: `${exec.callId}:mcp:${nestedSeq++}`,
            rootCallId: exec.rootCallId,
            name,
            arguments: input.arguments ?? {},
            agent: exec.agent,
            parent: exec.token,
            signal: exec.signal,
          })
          if (result.isError) throw new Error(result.error?.message ?? 'MCP tool execution failed')
          return { content: renderBrokerExecuteResult(args, { content: result.content }) }
        } finally {
          approvedParents.delete(exec.token)
        }
      },
    },
  ]
}
