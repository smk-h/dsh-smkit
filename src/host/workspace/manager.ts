/**
 * Workspace lifecycle: config discovery, live connections, file watching and
 * teardown.
 *
 * A workspace becomes "live" only when an agent actually opens it (its
 * `session.header.cwd` is resolved during `agents.create/resume`), at which
 * point its config is read and its servers connected. The Settings page can
 * additionally enumerate discovered workspaces without connecting, and an
 * `mcp.json` edit is picked up by a 300 ms-debounced `watchFile` poll.
 */

import { realpathSync, unwatchFile, watchFile } from 'node:fs'
import type { Stats } from 'node:fs'
import { isAbsolute } from 'node:path'
import { LOG_PREFIX, MAX_ERROR_LENGTH } from '../constants.js'
import { hasToken } from '../credentials.js'
import { workspaceServerId, workspaceTokenKey } from '../mcp/naming.js'
import { listAllTools } from '../mcp/tools.js'
import { saveState } from '../state.js'
import { serviceOf } from '../util/services.js'
import { errorText, isRecord, toErrorMessage } from '../util/text.js'
import { canonicalize, readWorkspaceConfig, sameServerConfig, wsConfigPath } from './config.js'
import type { Transports } from '../mcp/transports.js'
import type { Runtime } from '../runtime.js'
import type { WorkspaceScope } from './scope.js'
import type {
  AgentLike,
  LoggerLike,
  McpHandle,
  ServerConfig,
  ServiceAccessor,
  WorkspaceConnection,
  WorkspaceRuntime,
  WorkspaceServerView,
  WorkspaceView,
} from '../types.js'

const WATCH_DEBOUNCE_MS = 300
const WATCH_INTERVAL_MS = 250

export interface WorkspaceManagerDeps {
  runtime: Runtime
  logger: LoggerLike
  services: ServiceAccessor | null | undefined
  transports: Transports
  scope: WorkspaceScope
}

export interface FoundServer {
  server: ServerConfig
  wsPath: string | null
  wsConn: WorkspaceConnection | null
}

export interface WorkspaceManager {
  ensureWorkspace(wsPath: string, rawPath: string): WorkspaceRuntime
  rescanWorkspace(wsPath: string): Promise<void>
  releaseWorkspace(wsPath: string, agent: AgentLike): void
  knownWorkspacePath(path: string): string | null
  listWorkspaces(): WorkspaceView[]
  openWorkspaceServer(server: ServerConfig): Promise<WorkspaceConnection>
  closeWorkspaceServer(conn: WorkspaceConnection): void
  closeWorkspaceWatchers(ws: WorkspaceRuntime): void
  serverNameTaken(name: string, exceptWsPath?: string): boolean
  findServerById(id: string): FoundServer | null
}

export function createWorkspaceManager(deps: WorkspaceManagerDeps): WorkspaceManager {
  const { runtime, logger, services, transports, scope } = deps

  function workspaceTokens(): Record<string, { oauth?: unknown }> {
    return (runtime.state.workspaceTokens ?? {}) as Record<string, { oauth?: unknown }>
  }

  /** A server name is globally unique across the global tier and every workspace. */
  function serverNameTaken(name: string, exceptWsPath?: string): boolean {
    if (runtime.state.servers.some((server) => server.name === name)) return true
    for (const [path, other] of runtime.workspaces) {
      if (path === exceptWsPath) continue
      for (const otherName of other.servers.keys()) if (otherName === name) return true
    }
    return false
  }

  function ensureWorkspace(wsPath: string, rawPath: string): WorkspaceRuntime {
    const existing = runtime.workspaces.get(wsPath)
    if (existing) return existing
    const ws: WorkspaceRuntime = {
      path: wsPath,
      rawPath,
      servers: new Map(),
      agents: new Set(),
      exclude: [],
      watchStop: null,
      watchTimer: null,
      error: '',
    }
    runtime.workspaces.set(wsPath, ws)
    return ws
  }

  function closeWorkspaceServer(conn: WorkspaceConnection): void {
    try {
      conn.handle?.close?.()
    } catch {
      // Nothing left to reap.
    }
    conn.handle = null
    conn.call = () => Promise.reject(new Error('not connected'))
  }

  function closeWorkspaceWatchers(ws: WorkspaceRuntime): void {
    if (!ws.watchStop) return
    try {
      ws.watchStop()
    } catch {
      // Watcher already gone.
    }
    ws.watchStop = null
  }

  async function openWorkspaceServerInner(
    server: ServerConfig,
    conn: WorkspaceConnection,
  ): Promise<WorkspaceConnection> {
    const wsPath = String(server.wsPath)
    try {
      const handle: McpHandle = await transports.openServer(server)
      conn.handle = handle
      conn.tools = handle.tools ?? []
      conn.toolCount = conn.tools.length
      conn.status = 'connected'
      conn.error = ''
      conn.call = (name: string, args: unknown) => handle.call(name, args)
      transports.bindToolsChanged(server, handle, async () => {
        const list = await listAllTools(handle)
        if (conn.handle !== handle || handle.closed) return
        conn.tools = list
        conn.toolCount = conn.tools.length
        const ws = runtime.workspaces.get(wsPath)
        if (ws?.servers.get(server.name) !== conn) return
        for (const agent of ws.agents) scope.rebuildAgentWorkspace(agent, wsPath)
      })
    } catch (error) {
      conn.status = 'error'
      conn.error = toErrorMessage(error, MAX_ERROR_LENGTH)
      logger.warn(`${LOG_PREFIX}: workspace server ${server.name} ${conn.status}: ${conn.error}`)
    }
    return conn
  }

  function openWorkspaceServer(server: ServerConfig): Promise<WorkspaceConnection> {
    const conn: WorkspaceConnection = {
      server,
      handle: null,
      status: 'connecting',
      error: '',
      toolCount: 0,
      tools: [],
      call: () => Promise.reject(new Error('not connected')),
    }
    if ((server.type ?? 'http') !== 'stdio' && !hasToken(server)) {
      conn.status = 'needs-auth'
      conn.error = server.authMode === 'static' ? 'missing token (set the env var)' : ''
      return Promise.resolve(conn)
    }
    return openWorkspaceServerInner(server, conn)
  }

  async function doRescan(wsPath: string): Promise<void> {
    const ws = runtime.workspaces.get(wsPath)
    if (!ws) return
    ensureWorkspaceWatchers(wsPath, ws)
    const config = readWorkspaceConfig(ws.rawPath ?? ws.path)
    if (config.error) {
      ws.error = config.error
      return
    }
    for (const server of config.servers) {
      server.id = workspaceServerId(wsPath, server.name)
      server.wsPath = wsPath
      const oauth = workspaceTokens()[workspaceTokenKey(wsPath, server.name)]?.oauth
      if (oauth) server.oauth = oauth as ServerConfig['oauth']
    }
    const errorChanged = ws.error !== ''
    ws.error = ''
    const excludeChanged =
      JSON.stringify([...(ws.exclude ?? [])].sort()) !== JSON.stringify([...(config.exclude ?? [])].sort())
    ws.exclude = config.exclude
    let changed = excludeChanged || errorChanged
    const desired = new Map<string, { conflict: boolean; server: ServerConfig }>()
    for (const server of config.servers) {
      desired.set(server.name, { conflict: serverNameTaken(server.name, wsPath), server })
    }
    let tokensDropped = false
    for (const [name, conn] of ws.servers) {
      if (!desired.has(name)) {
        closeWorkspaceServer(conn)
        ws.servers.delete(name)
        const key = workspaceTokenKey(wsPath, name)
        if (workspaceTokens()[key]) {
          delete workspaceTokens()[key]
          tokensDropped = true
        }
        changed = true
      }
    }
    if (tokensDropped) saveState(runtime.state)
    for (const [name, entry] of desired) {
      const existing = ws.servers.get(name)
      if (entry.conflict) {
        if (!existing || existing.status !== 'conflict') {
          if (existing) closeWorkspaceServer(existing)
          ws.servers.set(name, {
            server: entry.server,
            handle: null,
            status: 'conflict',
            error: `server name "${name}" is already used by another source`,
            toolCount: 0,
            tools: [],
            call: () => Promise.reject(new Error('conflict')),
          })
          changed = true
        }
        continue
      }
      if (existing && existing.status !== 'conflict' && sameServerConfig(existing.server, entry.server)) {
        continue
      }
      if (existing) closeWorkspaceServer(existing)
      const conn = await openWorkspaceServer(entry.server)
      ws.servers.set(name, conn)
      changed = true
    }
    if (changed) {
      for (const agent of ws.agents) scope.rebuildAgentWorkspace(agent, wsPath)
      scope.reconcileRestrictions()
    }
  }

  function rescanWorkspace(wsPath: string): Promise<void> {
    const previous = runtime.workspaceRescans.get(wsPath) ?? Promise.resolve()
    const next = previous.then(
      () => doRescan(wsPath),
      () => doRescan(wsPath),
    )
    runtime.workspaceRescans.set(
      wsPath,
      next.then(
        () => {},
        () => {},
      ),
    )
    return next
  }

  function ensureWorkspaceWatchers(wsPath: string, ws: WorkspaceRuntime): void {
    if (ws.watchStop) return
    const root = ws.rawPath ?? ws.path
    const configPath = wsConfigPath(root)
    const onChange = (current: Stats, previous: Stats): void => {
      if (
        current.mtimeMs === previous.mtimeMs &&
        current.ctimeMs === previous.ctimeMs &&
        current.size === previous.size
      ) {
        return
      }
      if (ws.watchTimer) clearTimeout(ws.watchTimer)
      ws.watchTimer = setTimeout(() => {
        ws.watchTimer = null
        void rescanWorkspace(wsPath).catch((error) => {
          logger.warn(`${LOG_PREFIX}: workspace rescan failed for ${root}: ${errorText(error)}`)
        })
      }, WATCH_DEBOUNCE_MS)
    }
    try {
      watchFile(configPath, { interval: WATCH_INTERVAL_MS }, onChange)
      ws.watchStop = () => unwatchFile(configPath, onChange)
    } catch (error) {
      logger.warn(`${LOG_PREFIX}: cannot watch workspace config ${configPath}: ${errorText(error)}`)
    }
  }

  function releaseWorkspace(wsPath: string, agent: AgentLike): void {
    const state = runtime.agentScopeState.get(agent)
    if (state) {
      scope.disposeAgentScope(state)
      runtime.agentScopeState.delete(agent)
    }
    const ws = runtime.workspaces.get(wsPath)
    if (!ws) return
    ws.agents.delete(agent)
    if (ws.agents.size === 0) {
      for (const conn of ws.servers.values()) closeWorkspaceServer(conn)
      ws.servers.clear()
      closeWorkspaceWatchers(ws)
      if (ws.watchTimer) clearTimeout(ws.watchTimer)
      ws.watchTimer = null
      runtime.workspaces.delete(wsPath)
      runtime.workspaceRescans.delete(wsPath)
    }
  }

  function knownWorkspacePath(path: string): string | null {
    if (!isAbsolute(path)) return null
    let canonical: string
    try {
      canonical = realpathSync(path)
    } catch {
      return null
    }
    if (runtime.workspaces.has(canonical)) return canonical
    const registry = serviceOf(services, 'workspaceRegistry')
    if (!isRecord(registry) || typeof registry.list !== 'function') return null
    const list = (registry.list as () => unknown)()
    if (!Array.isArray(list)) return null
    return list.some(
      (ws) => isRecord(ws) && typeof ws.path === 'string' && canonicalize(ws.path) === canonical,
    )
      ? canonical
      : null
  }

  /** Project one workspace server into the shape the settings UI needs. */
  function workspaceServerView(
    server: ServerConfig,
    status: WorkspaceServerView['status'],
    toolCount: number,
    error: string,
  ): WorkspaceServerView {
    const view: WorkspaceServerView = {
      id: server.id,
      name: server.name,
      type: server.type ?? 'http',
      authMode: server.authMode ?? '',
      source: 'workspace',
      status,
      toolCount,
      error,
    }
    if (view.type === 'stdio') {
      view.command = server.command
      view.args = server.args ?? []
      view.env = server.env ?? {}
      view.cwd = server.cwd ?? ''
    } else {
      view.url = server.url
      view.headers = server.headers ?? {}
      view.headerEnv = server.headerEnv ?? {}
      if (view.authMode === 'static') view.tokenEnv = server.tokenEnv ?? ''
    }
    return view
  }

  function workspaceView(ws: WorkspaceRuntime): WorkspaceView {
    return {
      path: ws.rawPath ?? ws.path,
      servers: [...ws.servers.values()].map((conn) =>
        workspaceServerView(conn.server, conn.status, conn.toolCount, conn.error),
      ),
      exclude: ws.exclude ?? [],
      error: ws.error ?? '',
    }
  }

  /**
   * Enumerate discovered workspaces for the settings UI: every registered
   * workspace (web) plus every directory an agent has actually opened.
   */
  function listWorkspaces(): WorkspaceView[] {
    const discovered: WorkspaceView[] = []
    const seen = new Set<string>([...runtime.workspaces.values()].map((ws) => ws.rawPath ?? ws.path))
    const registry = serviceOf(services, 'workspaceRegistry')
    if (isRecord(registry) && typeof registry.list === 'function') {
      const list = (registry.list as () => unknown)()
      if (Array.isArray(list)) {
        for (const ws of list) {
          const path = isRecord(ws) ? ws.path : undefined
          if (typeof path === 'string' && path.length > 0) seen.add(path)
        }
      }
    }
    for (const path of seen) {
      const canonical = canonicalize(path)
      const existing = runtime.workspaces.get(canonical)
      if (existing) {
        discovered.push(workspaceView(existing))
      } else {
        // Not yet loaded: reflect the on-disk config without connecting.
        const config = readWorkspaceConfig(path)
        discovered.push({
          path,
          servers: config.servers.map((server) => workspaceServerView(server, 'configured', 0, '')),
          exclude: config.exclude,
          error: config.error,
        })
      }
    }
    return discovered
  }

  /** Resolve a server by its (globally unique) id across both tiers. */
  function findServerById(id: string): FoundServer | null {
    const global = runtime.state.servers.find((server) => server.id === id)
    if (global) return { server: global, wsPath: null, wsConn: null }
    for (const [wsPath, ws] of runtime.workspaces) {
      for (const conn of ws.servers.values()) {
        if (conn.server.id === id) return { server: conn.server, wsPath, wsConn: conn }
      }
    }
    return null
  }

  return {
    ensureWorkspace,
    rescanWorkspace,
    releaseWorkspace,
    knownWorkspacePath,
    listWorkspaces,
    openWorkspaceServer,
    closeWorkspaceServer,
    closeWorkspaceWatchers,
    serverNameTaken,
    findServerById,
  }
}
