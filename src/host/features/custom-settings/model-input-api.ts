/**
 * The model-input tab's routes: `GET /model-input/providers`,
 * `POST /model-input/modalities` and `POST /model-input/discover`.
 *
 * Like the retry routes next to them, these are thin transports over
 * {@link ModelInputAdmin}: this module owns the path matching and the HTTP
 * mapping and nothing else — in particular it does not decide where a
 * declaration is stored or how an endpoint is interrogated, so the same
 * operations stay callable from a test without a webserver.
 */

import { readBody, sendJson } from '../../platform/util/http.js'
import type { ApiHandler } from '../../platform/routes.js'
import type { ModelInputAdmin } from './model-input.js'

/** Path inside the plugin's API prefix that lists every route and its models. */
export const MODEL_INPUT_PROVIDERS_PATH = '/model-input/providers'

/** Path inside the plugin's API prefix that writes one model's modalities. */
export const MODEL_INPUT_SAVE_PATH = '/model-input/modalities'

/** Path inside the plugin's API prefix that asks one route's endpoint about one model. */
export const MODEL_INPUT_DISCOVER_PATH = '/model-input/discover'

/**
 * The feature's handlers.
 * @param admin - the read, write and probe operations the feature built.
 * @returns the handler list the composition root mounts.
 */
export function createModelInputHandlers(admin: ModelInputAdmin): ApiHandler[] {
  return [
    async (req, res, facts) => {
      if (facts.rest === MODEL_INPUT_PROVIDERS_PATH && req.method === 'GET') {
        sendJson(res, 200, await admin.listProviders())
        return true
      }

      if (facts.rest === MODEL_INPUT_DISCOVER_PATH && req.method === 'POST') {
        const body = await readBody(req)
        const outcome = await admin.discover({
          provider: typeof body['provider'] === 'string' ? body['provider'] : '',
          model: typeof body['model'] === 'string' ? body['model'] : '',
        })
        if (outcome.ok) {
          sendJson(res, 200, { modalities: outcome.modalities })
          return true
        }
        sendJson(res, outcome.status, { error: outcome.message, code: outcome.code })
        return true
      }

      if (facts.rest === MODEL_INPUT_SAVE_PATH && req.method === 'POST') {
        const body = await readBody(req)
        const revision = body['revision']
        const outcome = await admin.save({
          provider: typeof body['provider'] === 'string' ? body['provider'] : '',
          model: typeof body['model'] === 'string' ? body['model'] : '',
          modalities: body['modalities'],
          ...typeof revision === 'number' ? { revision } : {},
        })
        if (outcome.ok) {
          sendJson(res, 200, { provider: outcome.provider })
          return true
        }
        sendJson(res, outcome.status, { error: outcome.message, code: outcome.code })
        return true
      }

      return false
    },
  ]
}
