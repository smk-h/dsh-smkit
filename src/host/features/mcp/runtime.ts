/**
 * Per-`apply()` runtime state.
 *
 * The original single-file implementation kept all of this in the `apply()`
 * closure. Splitting the plugin into modules means the shared mutable state
 * needs a home, and a module-level singleton would be wrong: the test suites
 * mount the plugin several times in one process and must not observe each
 * other. So `createRuntime()` produces one container per mount and every
 * subsystem receives it by dependency injection.
 */

import type {
  AgentScopeState,
  LiveConnection,
  PluginState,
  ServerStatus,
  WorkspaceRuntime,
} from './types.js'

/** A pending OAuth authorization-code flow for one server id. */
export interface PendingAuth {
  state: string
  verifier: string
}

export interface Runtime {
  /** The loaded (and migrated) state file contents. */
  state: PluginState
  /** serverId → live connection, global tier. */
  live: Map<string, LiveConnection>
  /** serverId → pending OAuth flow. */
  pending: Map<string, PendingAuth>
  /** globalServerName → currently registered global tool names (for `restrict`). */
  globalToolsByServer: Map<string, Set<string>>
  /** canonical workspace path → runtime record. */
  workspaces: Map<string, WorkspaceRuntime>
  /** agent → scoping state. */
  agentScopeState: Map<object, AgentScopeState>
  /** canonical workspace path → promise serialising rescans. */
  workspaceRescans: Map<string, Promise<void>>
  /** Disposer of the on-demand broker runtime, when installed. */
  brokerRuntimeDispose: (() => void) | null
  /** Monotonic JSON-RPC request id, shared by every transport. */
  nextRpcId(): number
  /** Read-or-create a live connection, applying `patch`. */
  setLive(serverId: string, patch: Partial<LiveConnection>): LiveConnection
}

export function createRuntime(state: PluginState): Runtime {
  let rpcSeq = 1
  const live = new Map<string, LiveConnection>()

  const runtime: Runtime = {
    state,
    live,
    pending: new Map(),
    globalToolsByServer: new Map(),
    workspaces: new Map(),
    agentScopeState: new Map(),
    workspaceRescans: new Map(),
    brokerRuntimeDispose: null,
    nextRpcId: () => rpcSeq++,
    setLive(serverId, patch) {
      const current = live.get(serverId) ?? {
        sessionId: null,
        status: 'disconnected' as ServerStatus,
        error: '',
        toolCount: 0,
        tools: new Map(),
        handle: null,
        transport: null,
      }
      Object.assign(current, patch)
      live.set(serverId, current)
      return current
    },
  }

  return runtime
}
