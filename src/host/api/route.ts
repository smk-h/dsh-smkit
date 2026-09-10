/**
 * The single prefix route mounted on the DSH GUI webserver.
 *
 * Order matters and mirrors the reference implementation: the OAuth callback is
 * a browser navigation answered with HTML, then `/ping` + `/settings`, then the
 * workspace routes (so `/workspaces/servers/delete` wins over the
 * `/servers/:id` pattern), then the global server routes.
 *
 * The browser-facing origin is derived **per request** from the `Host` header,
 * so OAuth redirect URIs follow whatever address the GUI is actually served on.
 */

import { API_PREFIX, ROUTE_PATH } from '../constants.js'
import { sendJson } from '../util/http.js'
import { errorText, isRecord, toErrorMessage } from '../util/text.js'
import { handleCallback } from './callback.js'
import { originOf } from './context.js'
import { handleServers } from './servers.js'
import { handleSettings } from './settings.js'
import { handleWorkspaces } from './workspaces.js'
import type { ApiContext, RequestFacts } from './context.js'
import type { RouteDefinition } from '../types.js'

const ID_ROUTE_RE = /^\/servers\/([A-Za-z0-9_-]+)(\/[a-z]+)?$/

export function createRoute(api: ApiContext): RouteDefinition {
  return {
    kind: 'prefix',
    path: ROUTE_PATH,
    async handler(req, res) {
      const url = new URL(String(req.url ?? '/'), 'http://localhost')
      const path = url.pathname
      const origin = originOf(req)
      try {
        const facts: RequestFacts = { url, rest: '', origin, idMatch: null }
        if (await handleCallback(req, res, facts, api)) return

        if (!path.startsWith(API_PREFIX)) {
          res.writeHead(404)
          res.end()
          return
        }
        const rest = path.slice(API_PREFIX.length)
        facts.rest = rest
        facts.idMatch = rest.match(ID_ROUTE_RE)

        if (await handleSettings(req, res, facts, api)) return
        if (await handleWorkspaces(req, res, facts, api)) return
        if (await handleServers(req, res, facts, api)) return

        res.writeHead(404)
        res.end()
      } catch (error) {
        const detail = isRecord(error) && typeof error.stack === 'string' ? error.stack : errorText(error)
        api.logger.error(`mcp-manager api: ${detail}`)
        sendJson(res, 500, { error: toErrorMessage(error) })
      }
    },
  }
}
