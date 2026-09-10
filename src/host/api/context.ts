/**
 * The dependency bundle every API sub-handler receives.
 *
 * Route handling is split per resource family (settings, servers, workspaces,
 * OAuth callback) but they all share one context object, which keeps the
 * `apply()` composition point the only place that wires subsystems together.
 */

import type { OAuthService } from '../oauth.js'
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

export interface ApiContext {
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

/** The `path` field of a JSON body, trimmed. */
export function requiredPath(body: Record<string, unknown>): string {
  return String(body.path ?? '').trim()
}
