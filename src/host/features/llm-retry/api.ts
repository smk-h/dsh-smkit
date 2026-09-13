/**
 * The retry routes: `GET /llm-retry/routes` and `POST /llm-retry/policy`.
 *
 * Both are thin transports over {@link RetryAdmin}: this module owns the path
 * matching and the HTTP mapping and nothing else — in particular it does not
 * decide what a policy means, so the same operations stay callable from a test
 * without a webserver.
 */

import { readBody, sendJson } from '../../platform/util/http.js'
import type { ApiHandler } from '../../platform/routes.js'
import type { RetryAdmin } from './service.js'

/** Path inside the plugin's API prefix that lists every route. */
export const RETRY_ROUTES_PATH = '/llm-retry/routes'

/** Path inside the plugin's API prefix that writes one route's policy. */
export const RETRY_POLICY_PATH = '/llm-retry/policy'

/**
 * The feature's handler.
 * @param admin - the read and write operations the feature built.
 * @returns the handler list the composition root mounts.
 */
export function createRetryHandlers(admin: RetryAdmin): ApiHandler[] {
  return [
    async (req, res, facts) => {
      if (facts.rest === RETRY_ROUTES_PATH && req.method === 'GET') {
        sendJson(res, 200, admin.listRoutes())
        return true
      }

      if (facts.rest === RETRY_POLICY_PATH && req.method === 'POST') {
        const body = await readBody(req)
        const revision = body['revision']
        const outcome = await admin.savePolicy({
          provider: typeof body['provider'] === 'string' ? body['provider'] : '',
          policy: body['policy'],
          ...typeof revision === 'number' ? { revision } : {},
        })
        if (outcome.ok) {
          sendJson(res, 200, { route: outcome.route })
          return true
        }
        sendJson(res, outcome.status, { error: outcome.message, code: outcome.code })
        return true
      }

      return false
    },
  ]
}
