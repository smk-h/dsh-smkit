/**
 * The composition point: `apply()`.
 *
 * This is the only module that knows how the subsystems fit together. It runs
 * in a fixed order that matters:
 *
 * 1. load + migrate the state file (id backfill must persist before any
 *    id-addressed API can be reached),
 * 2. build the per-mount runtime container,
 * 3. wire the subsystems in dependency order (credentials → oauth →
 *    transports → registry/workspace → broker → routes),
 * 4. mount the GUI route and the agent decorators **lazily**, because a
 *    headless/TUI profile has no webserver and the agent registry may appear
 *    after this plugin,
 * 5. install teardown, then auto-connect every enabled server.
 *
 * Steps 4 and 5 are why the plugin never declares `webServer`/`agents` as hard
 * dependencies: an installed entry that never activates fails the whole boot on
 * newer harness builds.
 */

import { LOG_PREFIX } from './constants.js'
import { hasToken } from './credentials.js'
import { createRoute } from './api/route.js'
import { createBrokerRuntime } from './broker/runtime.js'
import { createOAuth } from './oauth.js'
import { createRegistry, setServerAuthStatus } from './registry.js'
import { createRuntime } from './runtime.js'
import { loadState, migrateLoadedState, saveState } from './state.js'
import { toErrorMessage } from './util/text.js'
import { createAgentDecorators } from './workspace/agents.js'
import { createWorkspaceManager } from './workspace/manager.js'
import { createWorkspaceScope } from './workspace/scope.js'
import { createTransports } from './mcp/transports.js'
import type { ApiContext } from './api/context.js'
import type { BrokerRuntime, PromptAssembleContext, PromptAssembly } from './broker/runtime.js'
import type { WorkspaceManager } from './workspace/manager.js'
import type { WorkspaceScope } from './workspace/scope.js'
import type { LoggerLike, ServiceAccessor, ToolsRegistry, WebServerLike } from './types.js'

/** Display metadata for loader diagnostics. */
export const name = 'mcp-manager'

/** Host-side hard dependency: every tier registers tools through `ctx.tools`. */
export const inject = ['tools']

/**
 * Structural view of the Cordis context. Kept local so the plugin needs no
 * import from `@deepseek-ai/cordis` and stays mountable on the stub contexts in
 * `test/`.
 */
export interface PluginContext {
  logger: LoggerLike
  tools: ToolsRegistry
  webServer?: WebServerLike
  get?(name: string): unknown
  on(
    event: string,
    handler: (
      assembly: PromptAssembly,
      context: PromptAssembleContext,
      next: () => Promise<PromptAssembly>,
    ) => Promise<PromptAssembly>,
    options?: { prepend?: boolean; global?: boolean },
  ): () => void
  inject(names: string[], callback: (childCtx: PluginContext) => void): { dispose(): void }
  effect(callback: () => void | (() => void), label?: string): unknown
  [key: string]: unknown
}

export function apply(ctx: PluginContext): void {
  const logger = ctx.logger
  const state = loadState()
  // Per-workspace OAuth client registrations + tokens live in the same
  // sensitive state file as the global servers, never in the declarative
  // mcp.json.
  if (!state.workspaceTokens) state.workspaceTokens = {}
  if (state.onDemandToolInjection !== true) state.onDemandToolInjection = false

  // One-time migration for configs written by older plugin versions: assign the
  // missing per-server `id` (otherwise every id-addressed API 404s and all
  // live status/errors share one key) and normalize legacy env/header arrays.
  // Persist immediately so the ids stay stable across restarts.
  if (migrateLoadedState(state)) {
    logger.warn(
      `${LOG_PREFIX}: migrated legacy state file (assigned missing server ids and/or normalized env/header pairs)`,
    )
    try {
      saveState(state)
    } catch (error) {
      logger.error(`${LOG_PREFIX}: could not persist the migrated state file: ${toErrorMessage(error)}`)
    }
  }

  // One-time migration (≤0.3.0 → 0.4.0): static-token servers used to store the
  // plaintext bearer token at `staticToken`. The new model reads the token from
  // the environment variable named by `tokenEnv`. `accessToken` keeps the legacy
  // value as a fallback so existing configs keep working with no user action;
  // it is dropped once the server is re-saved with an env var name (see the PUT
  // handler). Warn so the user knows to migrate. Never log the value itself.
  for (const server of state.servers ?? []) {
    if (
      server.authMode === 'static' &&
      !server.tokenEnv &&
      typeof server.staticToken === 'string' &&
      server.staticToken
    ) {
      logger.warn(
        `${LOG_PREFIX}: ${server.name} uses a legacy plaintext static token; re-save it with an env var name in Settings → MCP (it keeps working until then)`,
      )
    }
  }

  const runtime = createRuntime(state)
  const services = ctx as unknown as ServiceAccessor
  const scope: WorkspaceScope = createWorkspaceScope({ runtime, logger })
  const oauth = createOAuth(runtime, {
    setServerAuthStatus: (server, status, error) => setServerAuthStatus(runtime, server, status, error),
  })
  const transports = createTransports({
    runtime,
    logger,
    refreshTokens: (server) => oauth.refreshTokens(server),
  })
  const registry = createRegistry({
    runtime,
    logger,
    services,
    tools: ctx.tools,
    transports,
    reconcileRestrictions: (serverName) => scope.reconcileRestrictions(serverName),
  })
  const manager: WorkspaceManager = createWorkspaceManager({
    runtime,
    logger,
    services,
    transports,
    scope,
  })
  const broker: BrokerRuntime = createBrokerRuntime({
    runtime,
    logger,
    tools: ctx.tools,
    on: (event, handler, options) => ctx.on(event, handler, options),
  })

  const api: ApiContext = {
    runtime,
    logger,
    services,
    registry,
    workspaces: manager,
    scope,
    oauth,
    setOnDemandToolInjection: (enabled: boolean) => broker.setOnDemandToolInjection(enabled),
    setServerAuthStatus: (server, status, error) =>
      setServerAuthStatus(runtime, server, status, error),
  }

  if (state.onDemandToolInjection) runtime.brokerRuntimeDispose = broker.install()

  // The Settings → MCP UI needs the GUI webserver, but the agent-side tiers do
  // not. Mount the route when (and if) a webserver appears instead of declaring
  // a hard dependency.
  ctx.effect(() =>
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => webCtx.webServer?.register(createRoute(api)))
    }).dispose,
  )

  // Decorate agents.create/resume so every agent gets workspace-scoped MCP.
  // Injected lazily: the agent registry may appear after this plugin in some
  // compositions. If it never appears, workspace isolation stays off while the
  // global tier keeps working.
  ctx.effect(() =>
    ctx.inject(['agents'], (childCtx) => {
      const agents = childCtx.agents as
        | { create?: unknown; resume?: unknown }
        | undefined
      if (!agents || typeof agents.create !== 'function' || typeof agents.resume !== 'function') {
        logger.warn(`${LOG_PREFIX}: agents registry lacks create/resume; workspace isolation disabled`)
        return
      }
      const decorators = createAgentDecorators({ runtime, logger, manager, scope })
      childCtx.effect(() => decorators.installAgentDecorators(agents), 'mcp-agent-decorators')
    }).dispose,
  )

  // On unload/reload, kill every live global + workspace stdio child process and
  // stop every workspace config watcher.
  ctx.effect(() => () => {
    runtime.brokerRuntimeDispose?.()
    runtime.brokerRuntimeDispose = null
    for (const agentState of runtime.agentScopeState.values()) scope.disposeAgentScope(agentState)
    for (const conn of runtime.live.values()) {
      try {
        conn.handle?.close?.()
      } catch {
        // Nothing left to reap.
      }
    }
    for (const ws of runtime.workspaces.values()) {
      for (const conn of ws.servers.values()) manager.closeWorkspaceServer(conn)
      manager.closeWorkspaceWatchers(ws)
      if (ws.watchTimer) clearTimeout(ws.watchTimer)
    }
    runtime.workspaces.clear()
    runtime.agentScopeState.clear()
    runtime.workspaceRescans.clear()
    runtime.globalToolsByServer.clear()
  })

  // Startup: auto-connect stdio servers and HTTP servers that have credentials.
  for (const server of state.servers ?? []) {
    if (server.enabled === false) continue // disabled servers stay dormant
    if ((server.type ?? 'http') === 'stdio' || hasToken(server)) {
      void registry.connect(server)
    } else {
      runtime.setLive(server.id, { status: 'needs-auth', error: '' })
    }
  }
}
