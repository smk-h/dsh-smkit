/**
 * `GET /ping`, the profile-level feature settings, and the global config open.
 *
 * `GET /settings` intentionally exposes **only** `onDemandToolInjection`: the
 * plugin has no language setting of its own — DSH owns language selection
 * (Settings → General → Language) and the client follows the `mcp` locale
 * namespace. A legacy `language` key in the state file stays untouched and
 * unused, and `POST /settings/language` must 404.
 */

import { existsSync } from 'node:fs'
import { STATE_PATH } from '../constants.js'
import { saveState } from '../state.js'
import { openPath } from '../util/open.js'
import { readBody, sendJson } from '../../../platform/util/http.js'
import type { McpHandler } from './context.js'

export const handleSettings: McpHandler = async (req, res, facts, api) => {
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

  if (req.method === 'POST' && rest === '/open-config') {
    // The open needs a target: materialize the state file when absent. It is
    // the plugin's own store, so writing the in-memory state back is the
    // normal save path, not a special case.
    if (!existsSync(STATE_PATH)) saveState(api.runtime.state)
    openPath(STATE_PATH)
    sendJson(res, 200, { file: STATE_PATH })
    return true
  }

  return false
}
