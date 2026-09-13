/**
 * The single prefix route mounted on the DSH GUI webserver.
 *
 * It knows two things: the path it serves, and that every handler a feature
 * contributed is tried in registration order until one claims the request.
 * Which handlers exist, and in what order they must run, is decided by the
 * composition root and the features themselves (`src/index.ts`, each
 * `features/<id>/host.ts`).
 *
 * The browser-facing origin is derived **per request** from the `Host` header,
 * so OAuth redirect URIs follow whatever address the GUI is actually served on.
 */

import { sendJson } from './util/http.js'
import { errorText, isRecord, toErrorMessage } from './util/text.js'
import type { LoggerLike, RequestLike, ResponseLike, RouteDefinition } from './types.js'

/** Per-request facts computed once by the dispatcher. */
export interface RequestFacts {
  url: URL
  /** Path with the API prefix removed. */
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
) => Promise<boolean> | boolean

/** Everything the prefix route is built from. */
export interface PrefixRouteOptions {
  /** Prefix the webserver mounts (`ROUTE_PATH`). */
  path: string
  /** JSON API base inside it (`API_PREFIX`). */
  apiPrefix: string
  /**
   * Handlers for paths **outside** the API prefix — the OAuth callback is one,
   * and it must see the raw path — tried in registration order first.
   */
  outsideApi: ApiHandler[]
  /** Handlers inside the API prefix, tried in registration order. */
  handlers: ApiHandler[]
  logger: LoggerLike
}

/** `/servers/<id>` or `/servers/<id>/<action>`. */
const ID_ROUTE_RE = /^\/servers\/([A-Za-z0-9_-]+)(\/[a-z]+)?$/

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
 * Build the one prefix route: give the `outsideApi` handlers the raw path
 * first, then require the API prefix and try `handlers` in order.
 * @param options - prefixes, the contributed handlers, and the logger.
 * @returns the route definition the webserver mounts.
 */
export function createPrefixRoute(options: PrefixRouteOptions): RouteDefinition {
  return {
    kind: 'prefix',
    path: options.path,
    async handler(req, res) {
      const url = new URL(String(req.url ?? '/'), 'http://localhost')
      const origin = originOf(req)
      try {
        const facts: RequestFacts = { url, rest: '', origin, idMatch: null }
        for (const handle of options.outsideApi) {
          if (await handle(req, res, facts)) return
        }

        const path = url.pathname
        if (!path.startsWith(options.apiPrefix)) {
          res.writeHead(404)
          res.end()
          return
        }
        const rest = path.slice(options.apiPrefix.length)
        facts.rest = rest
        facts.idMatch = rest.match(ID_ROUTE_RE)

        for (const handle of options.handlers) {
          if (await handle(req, res, facts)) return
        }

        res.writeHead(404)
        res.end()
      } catch (error) {
        const detail = isRecord(error) && typeof error.stack === 'string' ? error.stack : errorText(error)
        options.logger.error(`mcp-manager api: ${detail}`)
        sendJson(res, 500, { error: toErrorMessage(error) })
      }
    },
  }
}
