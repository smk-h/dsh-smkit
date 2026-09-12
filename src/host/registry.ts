/**
 * Global (profile-level) server registry.
 *
 * One live connection per global server, keyed by `server.id`. Connect reaps any
 * previous transport before opening a new one (a stale stdio child would
 * otherwise keep publishing `tools/list_changed` into a dead handle), and tool
 * registration goes through `syncToolRegistrations` so a
 * `notifications/tools/list_changed` burst never transiently removes unrelated
 * tools from the model-facing prompt.
 */

import { MAX_ERROR_LENGTH } from './constants.js'
import { needsAuth } from './auth/credentials.js'
import { closeHandleQuietly } from './mcp/handle.js'
import { disposeRegistrations, listAllTools, syncToolRegistrations } from './mcp/tools.js'
import { toErrorMessage } from './util/text.js'
import { applyTransportFields } from './view.js'
import type { Transports } from './mcp/transports.js'
import type { Runtime } from './runtime.js'
import type {
  LiveConnection,
  LoggerLike,
  McpCallResult,
  McpToolInfo,
  ServerConfig,
  ServerStatus,
  ServerView,
  ServiceAccessor,
  ToolsRegistry,
} from './types.js'

export interface RegistryDeps {
  runtime: Runtime
  logger: LoggerLike
  services: ServiceAccessor | null | undefined
  tools: ToolsRegistry
  transports: Transports
  /** Workspace-tier hook: re-apply `exclude` masks after a tool set changes. */
  reconcileRestrictions(serverName?: string): void
}

export interface Registry {
  connect(server: ServerConfig): Promise<LiveConnection>
  disconnect(serverId: string): void
  serverView(server: ServerConfig): ServerView
  setGlobalTools(serverName: string, names: string[]): void
  clearGlobalTools(serverName: string): void
}

/** Set a server's auth/connection status in whichever tier it belongs to. */
export function setServerAuthStatus(
  runtime: Runtime,
  server: ServerConfig,
  status: ServerStatus,
  error = '',
): void {
  if (server.wsPath) {
    const ws = runtime.workspaces.get(server.wsPath)
    const conn = ws?.servers.get(server.name)
    if (conn) {
      conn.status = status
      conn.error = error
    }
  } else {
    runtime.setLive(server.id, { status, error })
  }
}

export function createRegistry(deps: RegistryDeps): Registry {
  const { runtime, logger, services, tools, transports } = deps

  /** serverId → in-flight connect. Saves answer before the connection settles,
   * so a second connect for the same server (auth callback, restart, enable)
   * can arrive mid-open: it queues behind the first instead of racing a second
   * transport open. */
  const connecting = new Map<string, Promise<LiveConnection>>()

  /**
   * Track the exact global tool names owned by one global server so workspace
   * `exclude` masking can deny them (`restrict()` accepts only known names).
   */
  function setGlobalTools(serverName: string, names: string[]): void {
    const set = new Set(names)
    const previous = runtime.globalToolsByServer.get(serverName)
    if (previous && previous.size === set.size && [...set].every((name) => previous.has(name))) return
    if (set.size > 0) runtime.globalToolsByServer.set(serverName, set)
    else runtime.globalToolsByServer.delete(serverName)
    deps.reconcileRestrictions(serverName)
  }

  function clearGlobalTools(serverName: string): void {
    if (!runtime.globalToolsByServer.has(serverName)) return
    runtime.globalToolsByServer.delete(serverName)
    deps.reconcileRestrictions(serverName)
  }

  /** Register a connected server's tools into the GLOBAL registry. */
  function registerToolsGlobal(server: ServerConfig, conn: LiveConnection, list: McpToolInfo[]): void {
    const call = (name: string, args: unknown): Promise<McpCallResult> => {
      if (!conn.handle) return Promise.reject(new Error(`MCP server "${server.name}" is not connected`))
      return conn.handle.call(name, args)
    }
    const names = syncToolRegistrations(tools, services, server, conn.tools, list, call)
    conn.toolCount = list.length
    conn.status = 'connected'
    conn.error = ''
    setGlobalTools(server.name, names)
    logger.info(`mcp-manager: ${server.name} connected, ${list.length} tools`)
  }

  async function connectOnce(server: ServerConfig): Promise<LiveConnection> {
    const conn = runtime.setLive(server.id, { status: 'connecting', error: '' })
    conn.name = server.name
    try {
      // Reap any previous transport (a prior stdio child) before respawning.
      closeHandleQuietly(conn.handle)
      const handle = await transports.openServer(server)
      if (runtime.live.get(server.id) !== conn) {
        // Superseded while opening (disabled, deleted, edited, restarted): the
        // id belongs to a newer connection record now, so drop this transport
        // instead of registering tools on top of — and leaking — it.
        closeHandleQuietly(handle)
        return conn
      }
      conn.handle = handle
      conn.sessionId = handle.sessionId
      conn.transport = handle.transport
      registerToolsGlobal(server, conn, handle.tools)
      transports.bindToolsChanged(server, handle, async () => {
        const list = await listAllTools(handle)
        if (conn.handle !== handle || handle.closed) return
        handle.tools = list
        registerToolsGlobal(server, conn, handle.tools)
      })
    } catch (error) {
      disposeRegistrations(conn.tools)
      conn.toolCount = 0
      closeHandleQuietly(conn.handle)
      conn.handle = null
      conn.transport = null
      clearGlobalTools(server.name)
      conn.status = needsAuth(server) ? 'needs-auth' : 'error'
      conn.error = toErrorMessage(error, MAX_ERROR_LENGTH)
      logger.warn(`mcp-manager: ${server.name} ${conn.status}: ${conn.error}`)
    }
    return conn
  }

  function connect(server: ServerConfig): Promise<LiveConnection> {
    const previous = connecting.get(server.id)
    const task = previous
      ? previous.then(() => connectOnce(server), () => connectOnce(server))
      : connectOnce(server)
    connecting.set(server.id, task)
    const settle = (): void => {
      if (connecting.get(server.id) === task) connecting.delete(server.id)
    }
    void task.then(settle, settle)
    return task
  }

  function disconnect(serverId: string): void {
    const conn = runtime.live.get(serverId)
    if (!conn) return
    disposeRegistrations(conn.tools)
    closeHandleQuietly(conn.handle)
    runtime.live.delete(serverId)
    if (conn.name) clearGlobalTools(conn.name)
  }

  function serverView(server: ServerConfig): ServerView {
    const conn = runtime.live.get(server.id)
    const type = server.type ?? 'http'
    const enabled = server.enabled !== false
    const view: ServerView = {
      id: server.id,
      name: server.name,
      type,
      enabled,
      status: !enabled
        ? 'disabled'
        : (conn?.status ?? (needsAuth(server) ? 'needs-auth' : 'disconnected')),
      toolCount: conn?.toolCount ?? 0,
      error: conn?.error ?? '',
      authMode: type === 'stdio' ? undefined : server.authMode,
    }
    applyTransportFields(view, server)
    return view
  }

  return { connect, disconnect, serverView, setGlobalTools, clearGlobalTools }
}
