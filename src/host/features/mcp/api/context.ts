/**
 * The dependency bundle every MCP API sub-handler receives.
 *
 * Route handling is split per resource family (settings, servers, workspaces,
 * OAuth callback) but they share one object, which the feature builds once
 * inside `mount` and closes over. The session delete's routes have their own,
 * much smaller bundle (`features/session-delete/api.ts`) — the two features no
 * longer meet in a shared context object.
 */

import { sendJson } from '../../../platform/util/http.js'
import type { RequestFacts } from '../../../platform/routes.js'
import type { OAuthService } from '../auth/oauth.js'
import type { Registry } from '../registry.js'
import type { Runtime } from '../runtime.js'
import type { WorkspaceManager } from '../workspace/manager.js'
import type { WorkspaceScope } from '../workspace/scope.js'
import type {
  LoggerLike,
  RequestLike,
  ResponseLike,
  ServerConfig,
  ServerStatus,
  ServiceAccessor,
} from '../types.js'

/** Re-exported for the platform's own route table, which passes no deps. */
export type { ApiHandler } from '../../../platform/routes.js'

/**
 * A handler of this feature: the platform's handler shape plus this feature's
 * deps, so the handler files here keep their four-argument signature and the
 * feature's `mount` adapts them to what the route expects.
 */
export type McpHandler = (
  req: RequestLike,
  res: ResponseLike,
  facts: RequestFacts,
  deps: McpApiDeps,
) => Promise<boolean> | boolean

export interface McpApiDeps {
  runtime: Runtime
  logger: LoggerLike
  services: ServiceAccessor | null | undefined
  registry: Registry
  workspaces: WorkspaceManager
  scope: WorkspaceScope
  oauth: OAuthService
  /** Toggle broker mode; throws when the new setting cannot be persisted. */
  setOnDemandToolInjection(enabled: boolean): void
  setServerAuthStatus(server: ServerConfig, status: ServerStatus, error?: string): void
}

/**
 * Resolve a `path` field to a canonical workspace, answering 403 when the path
 * is not a registered or active workspace. Returns null once it has answered.
 */
export function resolveWorkspace(deps: McpApiDeps, res: ResponseLike, path: string): string | null {
  const canonical = deps.workspaces.knownWorkspacePath(path)
  if (!canonical) {
    sendJson(res, 403, { error: 'path is not a registered or active DSH workspace' })
    return null
  }
  return canonical
}
