/**
 * `GET /ping` and the profile-level feature settings.
 *
 * `GET /settings` intentionally exposes **only** `onDemandToolInjection`: the
 * plugin has no language setting of its own — DSH owns language selection
 * (Settings → General → Language) and the client follows the `mcp` locale
 * namespace. A legacy `language` key in the state file stays untouched and
 * unused, and `POST /settings/language` must 404.
 */

import { readBody, sendJson } from '../util/http.js'
import type { ApiHandler } from './context.js'

export const handleSettings: ApiHandler = async (req, res, facts, api) => {
  const { rest } = facts

  if (req.method === 'GET' && rest === '/ping') {
    sendJson(res, 200, { ok: true, version: 4, stdio: true, workspace: true, onDemandTools: true })
    return true
  }

  if (req.method === 'GET' && rest === '/settings') {
    sendJson(res, 200, { onDemandToolInjection: api.runtime.state.onDemandToolInjection })
    return true
  }

  if (req.method === 'POST' && rest === '/settings/on-demand') {
    const body = await readBody(req)
    if (typeof body.enabled !== 'boolean') {
      sendJson(res, 400, { error: 'enabled must be a boolean' })
      return true
    }
    api.setOnDemandToolInjection(body.enabled)
    sendJson(res, 200, { onDemandToolInjection: api.runtime.state.onDemandToolInjection })
    return true
  }

  return false
}
