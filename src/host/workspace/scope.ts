/**
 * Per-agent workspace scoping.
 *
 * A workspace server's tools are registered into the **agent's** own tool
 * registry (not the global one), so they are visible only in that workspace's
 * sessions. `exclude` masking works the other way round: it denies specific
 * global tool names for agents in that workspace, via `tools.restrict`, which
 * accepts only names that are currently registered.
 */

import { LOG_PREFIX } from '../constants.js'
import { disposeRegistrations, syncToolRegistrations } from '../mcp/tools.js'
import { errorText } from '../util/text.js'
import type { Runtime } from '../runtime.js'
import type {
  AgentLike,
  AgentScopeState,
  LoggerLike,
  RegisteredTool,
  ServerConfig,
  WorkspaceConnection,
  WorkspaceRuntime,
} from '../types.js'

export interface WorkspaceScopeDeps {
  runtime: Runtime
  logger: LoggerLike
}

export interface WorkspaceScope {
  rebuildAgentWorkspace(agent: AgentLike, wsPath: string): void
  reconcileRestrictions(serverName?: string): void
  disposeAgentScope(state: AgentScopeState): void
  registerWorkspaceTools(
    agent: AgentLike,
    wsPath: string,
    server: ServerConfig,
    conn: WorkspaceConnection,
    registrations: Map<string, RegisteredTool>,
  ): void
}

export function createWorkspaceScope(deps: WorkspaceScopeDeps): WorkspaceScope {
  const { runtime, logger } = deps

  function registerWorkspaceTools(
    agent: AgentLike,
    wsPath: string,
    server: ServerConfig,
    conn: WorkspaceConnection,
    registrations: Map<string, RegisteredTool>,
  ): void {
    const call = (name: string, args: unknown) => {
      const current = runtime.workspaces.get(wsPath)?.servers.get(server.name)
      if (!current || current.status !== 'connected') {
        return Promise.reject(new Error(`workspace MCP server "${server.name}" is not connected`))
      }
      return current.call(name, args)
    }
    const registry = agent.ctx?.tools
    if (!registry) throw new TypeError("cannot read properties of undefined (reading 'tools')")
    syncToolRegistrations(registry, null, server, registrations, conn.tools, call)
  }

  function disposeAgentScope(state: AgentScopeState): void {
    for (const registrations of state.disposers.values()) disposeRegistrations(registrations)
    state.disposers.clear()
    if (state.restrictDisposer) {
      try {
        state.restrictDisposer()
      } catch {
        // Already released.
      }
      state.restrictDisposer = undefined
    }
    state.restrictKey = undefined
  }

  function reconcileRestrictForAgent(agent: AgentLike, ws: WorkspaceRuntime, state: AgentScopeState): void {
    const deny: string[] = []
    for (const serverName of ws.exclude ?? []) {
      const names = runtime.globalToolsByServer.get(serverName)
      if (names) for (const name of names) deny.push(name)
    }
    deny.sort()
    const restrictKey = JSON.stringify(deny)
    if (state.restrictKey === restrictKey) return
    if (state.restrictDisposer) {
      try {
        state.restrictDisposer()
      } catch {
        // Already released.
      }
      state.restrictDisposer = undefined
    }
    state.restrictKey = restrictKey
    if (deny.length === 0) return
    const registry = agent.ctx?.tools
    if (!registry) return
    try {
      state.restrictDisposer = registry.restrict({ deny })
    } catch (error) {
      logger.warn(`${LOG_PREFIX}: restrict(${deny.join(', ')}) failed: ${errorText(error)}`)
    }
  }

  /**
   * Re-evaluate every live agent's mask after a global tool-set change or an
   * `exclude` edit. The argument names which global server changed (log only).
   */
  function reconcileRestrictions(_serverName?: string): void {
    for (const [agent, state] of runtime.agentScopeState) {
      const ws = runtime.workspaces.get(state.wsPath)
      if (!ws) continue
      reconcileRestrictForAgent(agent as AgentLike, ws, state)
    }
  }

  function rebuildAgentWorkspace(agent: AgentLike, wsPath: string): void {
    const ws = runtime.workspaces.get(wsPath)
    let state = runtime.agentScopeState.get(agent)
    if (state && state.wsPath !== wsPath) {
      disposeAgentScope(state)
      runtime.agentScopeState.delete(agent)
      state = undefined
    }
    if (!ws) {
      if (state) {
        disposeAgentScope(state)
        runtime.agentScopeState.delete(agent)
      }
      return
    }
    if (!state) {
      state = { wsPath, disposers: new Map(), restrictDisposer: undefined, restrictKey: undefined }
      runtime.agentScopeState.set(agent, state)
    }
    const connected = new Set(
      [...ws.servers].filter(([, conn]) => conn.status === 'connected').map(([name]) => name),
    )
    for (const [name, registrations] of state.disposers) {
      if (connected.has(name)) continue
      disposeRegistrations(registrations)
      state.disposers.delete(name)
    }
    for (const [name, conn] of ws.servers) {
      if (conn.status !== 'connected') continue
      try {
        let registrations = state.disposers.get(name)
        if (!registrations) {
          registrations = new Map()
          state.disposers.set(name, registrations)
        }
        registerWorkspaceTools(agent, wsPath, conn.server, conn, registrations)
      } catch (error) {
        logger.warn(
          `${LOG_PREFIX}: registering workspace server "${name}" tools failed: ${errorText(error)}`,
        )
      }
    }
    reconcileRestrictForAgent(agent, ws, state)
  }

  return { rebuildAgentWorkspace, reconcileRestrictions, disposeAgentScope, registerWorkspaceTools }
}
