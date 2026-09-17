/**
 * `GET /ping`, the profile-level feature settings, and the global config open.
 *
 * `GET /settings` intentionally exposes **only** settings this plugin owns: the
 * on-demand broker switch and the global `tools/call` timeout. It has no
 * language setting of its own — DSH owns language selection (Settings → General
 * → Language) and the client follows the `mcp` locale namespace. A legacy
 * `language` key in the state file stays untouched and unused, and
 * `POST /settings/language` must 404.
 *
 * The timeout write answers with the effective value, so the page can show what
 * a following `tools/call` runs under without re-deriving "absent = default".
 */

import { existsSync } from 'node:fs'
import { STATE_PATH, TOOL_CALL_TIMEOUT_ERROR } from '../constants.js'
import { effectiveToolCallTimeoutMs, normalizeToolCallTimeoutMs, saveState } from '../state.js'
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
    sendJson(res, 200, {
      onDemandToolInjection: api.runtime.state.onDemandToolInjection,
      toolCallTimeoutMs: effectiveToolCallTimeoutMs(api.runtime.state),
    })
    return true
  }

  if (req.method === 'POST' && rest === '/settings/tool-timeout') {
    const body = await readBody(req)
    const requested = body.timeoutMs
    const previous = api.runtime.state.toolCallTimeoutMs
    if (requested === null) {
      // Removing the stored value restores the built-in default. Only an explicit
      // `null` clears: an absent field is a malformed body, not a reset.
      delete api.runtime.state.toolCallTimeoutMs
    } else {
      const timeoutMs = normalizeToolCallTimeoutMs(requested)
      if (timeoutMs === undefined) {
        sendJson(res, 400, { error: TOOL_CALL_TIMEOUT_ERROR })
        return true
      }
      api.runtime.state.toolCallTimeoutMs = timeoutMs
    }
    try {
      saveState(api.runtime.state)
    } catch (error) {
      // Roll the in-memory value back before rethrowing: the dispatcher answers
      // 500 for an unwritable state file, and the next tool call must keep using
      // the timeout that is still on disk.
      if (previous === undefined) delete api.runtime.state.toolCallTimeoutMs
      else api.runtime.state.toolCallTimeoutMs = previous
      throw error
    }
    sendJson(res, 200, { toolCallTimeoutMs: effectiveToolCallTimeoutMs(api.runtime.state) })
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
