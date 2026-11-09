/**
 * The broker's catalogue: what tools an agent may search, describe and execute.
 *
 * It reads the **connection records**, not the registry rows. Those two differ
 * exactly when shadow stubs are in play: the registry holds the stub (empty
 * parameters, one-line description) while the record still holds the real
 * `tools/list` entry, which is what `mcp_describe_tool` and the settings page
 * must answer with.
 *
 * Visibility still comes from the registry: `tools.schemas(agent)` is the set
 * the agent can actually call, so a workspace `exclude` mask or a code agent's
 * narrower view is honoured without re-deriving the rules here.
 */

import { convParams } from '../mcp/schema.js'
import { publicName } from '../mcp/naming.js'
import { brokerIdentity } from './definitions.js'
import type { Runtime } from '../runtime.js'
import type { BrokerCatalogEntry } from './definitions.js'
import type { AgentLike, ToolsRegistry } from '../types.js'

/** The two collaborators a catalogue needs. */
export interface BrokerCatalogDeps {
  runtime: Runtime
  tools: ToolsRegistry
}

/**
 * Build the catalogue reader.
 *
 * @param deps - runtime (live/workspace records) and the root registry (names).
 * @returns a function that answers with the full description and schema of
 *   every MCP tool visible to that agent.
 */
export function createBrokerCatalog(
  deps: BrokerCatalogDeps,
): (agent: AgentLike, registry?: ToolsRegistry) => BrokerCatalogEntry[] {
  const { runtime, tools } = deps
  return (agent, registry = tools) => {
    const visible = new Set(
      registry
        .schemas(agent)
        .filter((schema) => schema.name.startsWith('mcp__'))
        .map((schema) => schema.name),
    )
    const rows = new Map<string, BrokerCatalogEntry>()

    const wsPath = runtime.agentScopeState.get(agent as object)?.wsPath
    const workspace = wsPath === undefined ? undefined : runtime.workspaces.get(wsPath)
    for (const conn of workspace?.servers.values() ?? []) {
      for (const info of conn.tools) {
        const name = publicName(conn.server.name, info.name)
        if (!visible.has(name) || rows.has(name)) continue
        rows.set(name, {
          schema: {
            name,
            description: String(info.description ?? ''),
            parameters: convParams(info.inputSchema),
          },
          server: conn.server.name,
          tool: info.name,
        })
      }
    }

    for (const conn of runtime.live.values()) {
      for (const entry of conn.tools.values()) {
        const name = entry.definition.name
        if (!visible.has(name) || rows.has(name)) continue
        rows.set(name, {
          schema: {
            name,
            description: String(entry.info.description ?? ''),
            parameters: convParams(entry.info.inputSchema),
          },
          server: entry.definition.mcpServerName ?? '',
          tool: entry.definition.mcpRawName ?? '',
        })
      }
    }

    // Anything visible that no connection owns (another plugin's `mcp__` tool,
    // or a harness with no live connections) still answers from the registry.
    for (const schema of registry.schemas(agent)) {
      if (!schema.name.startsWith('mcp__') || rows.has(schema.name)) continue
      rows.set(schema.name, { schema, ...brokerIdentity(registry, schema, agent) })
    }
    return [...rows.values()]
  }
}
