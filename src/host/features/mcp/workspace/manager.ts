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
import { hasToken, missingCredentialError } from '../auth/credentials.js'
import { closeHandleQuietly } from '../mcp/handle.js'
import { workspaceServerId, workspaceTokenKey } from '../mcp/naming.js'
import { listAllTools } from '../mcp/tools.js'
import { dropWorkspaceToken, effectiveToolCallTimeoutMs, saveState } from '../state.js'
import { serviceOf } from '../../../platform/util/services.js'
import { errorText, isRecord, toErrorMessage } from '../../../platform/util/text.js'
import { applyTransportFields, toolViews } from '../view.js'
import { canonicalize, readWorkspaceConfig, sameServerConfig, wsConfigPath } from './config.js'
import type { Transports } from '../mcp/transports.js'
import type { Runtime } from '../runtime.js'
import type { Supervisor } from '../supervisor.js'
import type { WorkspaceScope } from './scope.js'
import type {
  AgentLike,
  LoggerLike,
  McpHandle,
  McpToolInfo,
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
  supervisor: Supervisor
  scope: WorkspaceScope
}

export interface FoundServer {
  server: ServerConfig
  wsPath: string | null
  wsConn: WorkspaceConnection | null
}

export interface WorkspaceManager {
  ensureWorkspace(wsPath: string, rawPath: string): WorkspaceRuntime
  rescanWorkspace(wsPath: string, opts?: { awaitConnect?: boolean }): Promise<void>
  releaseWorkspace(wsPath: string, agent: AgentLike): void
  knownWorkspacePath(path: string): string | null
  listWorkspaces(): WorkspaceView[]
  /**
   * Tear down everything one workspace owns and forget its runtime record.
   * Returns whether anything was actually released.
   */
  forgetWorkspace(wsPath: string): boolean
  /**
   * Release every live workspace the DSH registry no longer lists. Cheap enough
   * to run on the settings page's poll; a no-op when no registry is reachable.
   */
  pruneRemovedWorkspaces(): void
  closeWorkspaceServer(conn: WorkspaceConnection): void
  /** Runtime-only restart of one live workspace server; false when not live. */
  restartWorkspaceServer(wsPath: string, name: string): Promise<boolean>
  /** Re-open in place for the supervisor's retry; keeps the retry entry alive. */
  recoverWorkspaceServer(wsPath: string, name: string): Promise<void>
  /** Runtime-only stop: drop the transport, keep the row; false when not live. */
  stopWorkspaceServer(wsPath: string, name: string): boolean
  closeWorkspaceWatchers(ws: WorkspaceRuntime): void
  /** The global tier's own rule; see the implementation's note. */
  serverNameTaken(name: string): boolean
  /**
   * The workspace tier's own rule: whether a **global** server already uses
   * `name`. Another workspace's server of the same name is deliberately not a
   * conflict — see the implementation's note.
   */
  globalNameTaken(name: string): boolean
  findServerById(id: string): FoundServer | null
}

export function createWorkspaceManager(deps: WorkspaceManagerDeps): WorkspaceManager {
  const { runtime, logger, services, transports, scope } = deps

  function workspaceTokens(): Record<string, { oauth?: unknown }> {
    return (runtime.state.workspaceTokens ?? {}) as Record<string, { oauth?: unknown }>
  }

  /**
   * The **global tier's** own rule: a name is taken once another global server
   * holds it, or once a live workspace does.
   *
   * It carries the workspace half of the rule because a global server's tools
   * are registered into the shared root registry — every agent sees them — so a
   * live workspace already answering to `name` would put two `mcp__<name>__*`
   * surfaces in front of that workspace's agents at once.
   */
  function serverNameTaken(name: string): boolean {
    if (runtime.state.servers.some((server) => server.name === name)) return true
    for (const other of runtime.workspaces.values()) {
      for (const otherName of other.servers.keys()) if (otherName === name) return true
    }
    return false
  }

  /**
   * The **workspace tier's** only rule: a workspace server may not reuse a
   * **global** server's name.
   *
   * That is the whole of it. A name another workspace already uses is not a
   * conflict, and deliberately so: a workspace server's tools are registered
   * into *its own* agents' tool registries (`WorkspaceScope`), while the global
   * tier's live in the shared root registry. Two workspaces may therefore both
   * declare `foo` and run two isolated connections, because no agent ever sees
   * both surfaces.
   */
  function globalNameTaken(name: string): boolean {
    return runtime.state.servers.some((server) => server.name === name)
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
    // First, before the transport is torn down: this path covers stop, delete,
    // rescan-replacement and workspace release, and none of them may be undone
    // by a retry that was already scheduled.
    deps.supervisor.cancelWorkspace(String(conn.server.wsPath), conn.server.name)
    closeHandleQuietly(conn.handle)
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

  /**
   * Reap one live workspace server's transport and open a fresh one from the
   * same config — config, tokens, the row itself and its registration in the
   * server map are untouched, so a following rescan still sees an unchanged
   * server and keeps our connection. The agent rebuilds mirror doRescan's
   * `changed` tail.
   */
  async function restartWorkspaceServer(wsPath: string, name: string): Promise<boolean> {
    const ws = runtime.workspaces.get(wsPath)
    const existing = ws?.servers.get(name)
    if (!ws || !existing || existing.status === 'conflict') return false
    closeWorkspaceServer(existing)
    existing.tools = []
    existing.toolCount = 0
    // `closeWorkspaceServer` drops the transport but touches no status, so
    // without this the settings page would keep reporting the old green
    // "connected" for the whole reopen — which is seconds to a minute when a
    // stdio server has to be respawned (`npx` re-resolves its package first).
    // The global tier gets the same effect from `registry.connect`, which enters
    // through `runtime.setLive(..., 'connecting')`.
    await connectWorkspaceConn(existing.server, existing)
    for (const agent of ws.agents) scope.rebuildAgentWorkspace(agent, wsPath)
    scope.reconcileRestrictions()
    return true
  }

  /**
   * Re-open one live row **in place**, for the supervisor's retry.
   *
   * The difference from `restartWorkspaceServer` is the one thing that matters
   * here: this does **not** go through `closeWorkspaceServer`, and so does not
   * cancel the supervisor's own entry. That cancel is exactly what makes a
   * user's stop win over a scheduled retry, so it has to keep living where the
   * user's actions land; a retry that cancelled its own entry would lose the
   * next attempt whenever the re-open failed, which is the common case (a
   * bridge that is still down).
   */
  async function recoverWorkspaceServer(wsPath: string, name: string): Promise<void> {
    const ws = runtime.workspaces.get(wsPath)
    const conn = ws?.servers.get(name)
    // `handle === null` means the row was dropped (stopped, released, replaced
    // by a rescan): whatever owns it now decides what happens, not this retry.
    if (!ws || !conn || conn.status === 'conflict' || !conn.handle) return
    conn.tools = []
    conn.toolCount = 0
    await connectWorkspaceConn(conn.server, conn)
    for (const agent of ws.agents) scope.rebuildAgentWorkspace(agent, wsPath)
    scope.reconcileRestrictions()
  }

  function stopWorkspaceServer(wsPath: string, name: string): boolean {
    const ws = runtime.workspaces.get(wsPath)
    const conn = ws?.servers.get(name)
    if (!ws || !conn || conn.status === 'conflict') return false
    closeWorkspaceServer(conn)
    conn.tools = []
    conn.toolCount = 0
    conn.status = 'disconnected'
    conn.error = ''
    for (const agent of ws.agents) scope.rebuildAgentWorkspace(agent, wsPath)
    scope.reconcileRestrictions()
    return true
  }

  async function openWorkspaceServerInner(
    server: ServerConfig,
    conn: WorkspaceConnection,
  ): Promise<WorkspaceConnection> {
    const wsPath = String(server.wsPath)
    try {
      const handle: McpHandle = await transports.openServer(server)
      const owner = runtime.workspaces.get(wsPath)
      if (owner?.servers.get(server.name) !== conn) {
        // Superseded mid-open (a rescan replaced or removed the row while the
        // transport was opening): drop the fresh handle instead of leaking a
        // connection the map no longer owns.
        closeHandleQuietly(handle)
        return conn
      }
      conn.handle = handle
      conn.tools = handle.tools ?? []
      conn.toolCount = conn.tools.length
      conn.status = 'connected'
      conn.error = ''
      // Same per-call read as the global tier: the workspace transport is not
      // reopened when the timeout changes.
      conn.call = (name: string, args: unknown) =>
        handle.call(name, args, effectiveToolCallTimeoutMs(runtime.state))
      transports.bindToolsChanged(server, handle, async () => {
        const list = await listAllTools(handle)
        if (conn.handle !== handle || handle.closed) return
        conn.tools = list
        conn.toolCount = conn.tools.length
        const ws = runtime.workspaces.get(wsPath)
        if (ws?.servers.get(server.name) !== conn) return
        for (const agent of ws.agents) scope.rebuildAgentWorkspace(agent, wsPath)
      })
      // Only a row that came up is watched; see the registry's note on why the
      // watch lives at the end of the successful path (and nowhere else).
      deps.supervisor.watch({ tier: 'workspace', wsPath, name: server.name }, handle)
    } catch (error) {
      conn.status = 'error'
      conn.error = toErrorMessage(error, MAX_ERROR_LENGTH)
      logger.warn(`${LOG_PREFIX}: workspace server ${server.name} ${conn.status}: ${conn.error}`)
    }
    return conn
  }

  /** A fresh, not-yet-opened connection record for one workspace server. */
  function freshWorkspaceConn(server: ServerConfig): WorkspaceConnection {
    return {
      server,
      handle: null,
      status: 'connecting',
      error: '',
      toolCount: 0,
      tools: [],
      call: () => Promise.reject(new Error('not connected')),
    }
  }

  /**
   * Open `conn`'s transport and mutate it in place. `conn` must already be the
   * registered record for `server.name` in its workspace's server map — that
   * registration is what lets a rescan landing mid-open supersede the loser
   * (see the guard in `openWorkspaceServerInner`) instead of racing it.
   */
  function connectWorkspaceConn(
    server: ServerConfig,
    conn: WorkspaceConnection,
  ): Promise<WorkspaceConnection> {
    if ((server.type ?? 'http') !== 'stdio' && !hasToken(server)) {
      conn.status = 'needs-auth'
      conn.error = missingCredentialError(server)
      return Promise.resolve(conn)
    }
    conn.status = 'connecting'
    conn.error = ''
    return openWorkspaceServerInner(server, conn)
  }

  async function doRescan(wsPath: string, awaitConnect: boolean): Promise<void> {
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
      desired.set(server.name, { conflict: globalNameTaken(server.name), server })
    }
    let tokensDropped = false
    for (const [name, conn] of ws.servers) {
      if (!desired.has(name)) {
        closeWorkspaceServer(conn)
        ws.servers.delete(name)
        if (dropWorkspaceToken(runtime.state, workspaceTokenKey(wsPath, name))) tokensDropped = true
        changed = true
      }
    }
    if (tokensDropped) saveState(runtime.state)
    // New/changed transports all open concurrently: every row is registered up
    // front (so the settings page shows the whole set at once, each in
    // `connecting` state) and no server waits for its neighbour to settle.
    const opening: Promise<unknown>[] = []
    for (const [name, entry] of desired) {
      const existing = ws.servers.get(name)
      if (entry.conflict) {
        if (!existing || existing.status !== 'conflict') {
          if (existing) closeWorkspaceServer(existing)
          ws.servers.set(name, {
            server: entry.server,
            handle: null,
            status: 'conflict',
            error: `server name "${name}" is already used by a global server`,
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
      const conn = freshWorkspaceConn(entry.server)
      // Register before connecting: the mid-open supersede guard keys off this
      // registration.
      ws.servers.set(name, conn)
      changed = true
      if (awaitConnect) {
        opening.push(connectWorkspaceConn(entry.server, conn))
      } else {
        // Fire-and-forget: the save route answers with the row in `connecting`
        // state; this settle callback re-projects the agent scopes once the
        // tools actually arrive.
        void connectWorkspaceConn(entry.server, conn)
          .then(() => {
            const live = runtime.workspaces.get(wsPath)
            if (!live) return
            for (const agent of live.agents) scope.rebuildAgentWorkspace(agent, wsPath)
            scope.reconcileRestrictions()
          })
          .catch((error) => {
            logger.warn(
              `${LOG_PREFIX}: workspace reconnect settle failed for ${wsPath}: ${errorText(error)}`,
            )
          })
      }
    }
    // Agent setup awaits this scan, so it still resolves only once every new
    // transport has settled — just all of them in parallel now. Background
    // scans (settings saves) have nothing queued here and resolve at once.
    if (opening.length > 0) await Promise.all(opening)
    if (changed) {
      for (const agent of ws.agents) scope.rebuildAgentWorkspace(agent, wsPath)
      scope.reconcileRestrictions()
    }
  }

  /**
   * Apply the workspace's on-disk config to the live map. With `awaitConnect`
   * (the default, used by agent setup) the scan resolves only once every new
   * server's transport has settled; the settings-page save routes pass
   * `awaitConnect: false` so the response returns as soon as the rows are
   * registered, with the transports opening in the background.
   */
  function rescanWorkspace(
    wsPath: string,
    opts?: { awaitConnect?: boolean },
  ): Promise<void> {
    const awaitConnect = opts?.awaitConnect !== false
    const previous = runtime.workspaceRescans.get(wsPath) ?? Promise.resolve()
    const next = previous.then(
      () => doRescan(wsPath, awaitConnect),
      () => doRescan(wsPath, awaitConnect),
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

  /**
   * Release everything one workspace owns: live connections, the config
   * watcher, its agents' tool registrations, its OAuth slots and the runtime
   * record itself. Unlike `releaseWorkspace` this is not a session ending — the
   * workspace is gone — so the tokens go too: they are keyed by the workspace
   * path and the `mcp.json` that earned them went with the directory.
   *
   * The on-disk config is deliberately not touched (there is nothing to write
   * to once the directory is gone); should the same path be registered again,
   * the next scan reads whatever is there.
   */
  function forgetWorkspace(wsPath: string): boolean {
    let changed = false
    for (const [agent, agentState] of [...runtime.agentScopeState]) {
      if (agentState.wsPath !== wsPath) continue
      scope.disposeAgentScope(agentState)
      runtime.agentScopeState.delete(agent)
      changed = true
    }
    const ws = runtime.workspaces.get(wsPath)
    if (ws) {
      for (const conn of ws.servers.values()) closeWorkspaceServer(conn)
      ws.servers.clear()
      closeWorkspaceWatchers(ws)
      if (ws.watchTimer) clearTimeout(ws.watchTimer)
      ws.watchTimer = null
      runtime.workspaces.delete(wsPath)
      runtime.workspaceRescans.delete(wsPath)
      changed = true
    }
    let droppedToken = false
    for (const key of Object.keys(workspaceTokens())) {
      if (!key.startsWith(`${wsPath}\n`)) continue
      if (dropWorkspaceToken(runtime.state, key)) droppedToken = true
    }
    if (droppedToken) saveState(runtime.state)
    if (changed) scope.reconcileRestrictions()
    return changed || droppedToken
  }

  /**
   * The paths the registry currently lists, canonicalized, or `null` when no
   * registry is reachable. `null` means "unknown" — never "none" — so callers
   * must not prune on it (a headless/TUI composition has no registry and its
   * agent-opened directories must survive).
   */
  function registeredWorkspacePaths(): Set<string> | null {
    const registry = serviceOf(services, 'workspaceRegistry')
    if (!isRecord(registry) || typeof registry.list !== 'function') return null
    let listed: unknown
    try {
      listed = (registry.list as () => unknown)()
    } catch {
      return null
    }
    if (!Array.isArray(listed)) return null
    const paths = new Set<string>()
    for (const entry of listed) {
      const path = isRecord(entry) ? entry.path : undefined
      if (typeof path === 'string' && path.length > 0) paths.add(canonicalize(path))
    }
    return paths
  }

  /**
   * Release the live workspaces the DSH registry no longer lists.
   *
   * The plugin never sees a "workspace removed" event, so its poll (and the
   * settings page's, which lands here) is where the two views of the world
   * meet: with a registry reachable, every live workspace comes from a session
   * whose directory the user registered, so one that is absent from the
   * registry has been removed — and its connections, watcher, per-agent tools
   * and tokens must go with it, even while the old session is still attached.
   * Without a registry (headless/TUI) nothing is pruned: those directories are
   * the sessions' own and there is no list to reconcile against.
   */
  function pruneRemovedWorkspaces(): void {
    const registered = registeredWorkspacePaths()
    if (!registered) return
    for (const wsPath of [...runtime.workspaces.keys()]) {
      if (!registered.has(wsPath)) forgetWorkspace(wsPath)
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
    tools: McpToolInfo[],
  ): WorkspaceServerView {
    const view: WorkspaceServerView = {
      id: server.id,
      name: server.name,
      type: server.type ?? 'http',
      authMode: server.authMode ?? '',
      source: 'workspace',
      status,
      toolCount,
      tools: toolViews(tools),
      error,
    }
    applyTransportFields(view, server)
    return view
  }

  function workspaceView(ws: WorkspaceRuntime): WorkspaceView {
    return {
      path: ws.rawPath ?? ws.path,
      servers: [...ws.servers.values()].map((conn) =>
        workspaceServerView(conn.server, conn.status, conn.toolCount, conn.error, conn.tools),
      ),
      exclude: ws.exclude ?? [],
      error: ws.error ?? '',
    }
  }

  /**
   * Enumerate discovered workspaces for the settings UI: every registered
   * workspace (web) plus every directory an agent has actually opened.
   *
   * Reconciliation happens here because this is the only place the registry and
   * the live map are read together — and the settings page polls it every few
   * seconds, so a workspace removed from the DSH sidebar stops being listed (and
   * stops running) without waiting for its session to end.
   */
  function listWorkspaces(): WorkspaceView[] {
    pruneRemovedWorkspaces()
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
          // Never opened in this process, so nothing is registered yet: the row
          // reports the config and an empty tool list.
          servers: config.servers.map((server) => workspaceServerView(server, 'configured', 0, '', [])),
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
    forgetWorkspace,
    pruneRemovedWorkspaces,
    closeWorkspaceServer,
    restartWorkspaceServer,
    recoverWorkspaceServer,
    stopWorkspaceServer,
    closeWorkspaceWatchers,
    serverNameTaken,
    globalNameTaken,
    findServerById,
  }
}
