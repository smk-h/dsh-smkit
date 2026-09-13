/**
 * The dependency bundle every API sub-handler receives.
 *
 * Route handling is split per resource family (settings, servers, workspaces,
 * OAuth callback) but they all share one context object, which keeps the
 * `apply()` composition point the only place that wires subsystems together.
 */

import { sendJson } from '../util/http.js'
import type { OAuthService } from '../auth/oauth.js'
import type { Registry } from '../registry.js'
import type { Runtime } from '../runtime.js'
import type { SessionDeleter, SessionPreviewer } from '../session-delete.js'
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

export interface ApiContext {
  runtime: Runtime
  logger: LoggerLike
  services: ServiceAccessor | null | undefined
  registry: Registry
  workspaces: WorkspaceManager
  scope: WorkspaceScope
  oauth: OAuthService
  /**
   * Delete one session's durable data and hide it from every listing surface;
   * the implementation owns all DSH service access (see `../session-delete`).
   */
  deleteSession: SessionDeleter
  /**
   * Dry-run the same preconditions and measure what the delete would remove, so
   * the browser can show it before the user confirms.
   */
  previewSession: SessionPreviewer
  /** Toggle broker mode; throws when the new setting cannot be persisted. */
  setOnDemandToolInjection(enabled: boolean): void
  setServerAuthStatus(server: ServerConfig, status: ServerStatus, error?: string): void
}

/** Per-request facts computed once by the dispatcher. */
export interface RequestFacts {
  url: URL
  /** Path with the `/mcp-manager/api` prefix removed. */
  rest: string
  /** Browser-facing origin, derived from the request's own `Host` header. */
  origin: string
  /** `/servers/<id>` or `/servers/<id>/<action>`. */
  idMatch: RegExpMatchArray | null
}

/** A sub-handler returns whether it claimed the request. */
export type ApiHandler = (
  req: RequestLike,
  res: ResponseLike,
  facts: RequestFacts,
  api: ApiContext,
) => Promise<boolean> | boolean

/** First value of a possibly-repeated inbound header. */
export function headerValue(req: RequestLike, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** The browser-facing origin: the request's own `Host`, never hardcoded. */
export function originOf(req: RequestLike): string {
  return `http://${headerValue(req, 'host') ?? '127.0.0.1'}`
}

/**
 * Resolve a `path` field to a canonical workspace, answering 403 when the path
 * is not a registered or active workspace. Returns null once it has answered.
 */
export function resolveWorkspace(api: ApiContext, res: ResponseLike, path: string): string | null {
  const canonical = api.workspaces.knownWorkspacePath(path)
  if (!canonical) {
    sendJson(res, 403, { error: 'path is not a registered or active DSH workspace' })
    return null
  }
  return canonical
}
