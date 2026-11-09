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
    // Visibility is a union: the root registry resolves the agent's scope on
    // most hosts, the agent's own table is authoritative on all of them. A
    // session opened before a mid-session toggle can end up in a state where
    // only one of the two answers, and an empty answer used to make the whole
    // catalogue empty.
    const visible = new Set<string>()
    for (const table of [registry, (agent as { ctx?: { tools?: ToolsRegistry } }).ctx?.tools]) {
      if (table === undefined || typeof table.schemas !== 'function') continue
      for (const schema of table.schemas(agent)) {
        if (schema.name.startsWith('mcp__')) visible.add(schema.name)
      }
    }
    const rows = new Map<string, BrokerCatalogEntry>()

    // The workspace this agent belongs to. `agentScopeState` is the fast path;
    // `ws.agents` is the record the manager itself keeps, and it still answers
    // when the agent object never made it into the state map (a resumed session
    // or a rebuild race).
    const wsPath = runtime.agentScopeState.get(agent as object)?.wsPath
    const workspace = wsPath !== undefined
      ? runtime.workspaces.get(wsPath)
      : [...runtime.workspaces.values()].find((candidate) => candidate.agents.has(agent))
    // A workspace server's tools belong to that workspace and are registered in
    // its agents' own tables, so they need no visibility gate: the only mask
    // this plugin applies (`exclude`) covers the **global** tier.
    for (const conn of workspace?.servers.values() ?? []) {
      for (const info of conn.tools) {
        const name = publicName(conn.server.name, info.name)
        if (rows.has(name)) continue
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
