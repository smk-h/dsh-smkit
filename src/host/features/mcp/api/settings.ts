/**
 * `GET /ping`, the profile-level feature settings, and the global config open.
 *
 * `GET /settings` intentionally exposes **only** settings this plugin owns: the
 * on-demand broker switch, the global `tools/call` timeout and the reconnection
 * knobs. It has no language setting of its own — DSH owns language selection
 * (Settings → General → Language) and the client follows the `mcp` locale
 * namespace. A legacy `language` key in the state file stays untouched and
 * unused, and `POST /settings/language` must 404.
 *
 * Every write answers with the effective values, so the page can show what is
 * truly in force without re-deriving "absent = default". Writes validate the
 * whole body first: one unusable field means nothing is written.
 */

import { existsSync } from 'node:fs'
import {
  HEALTH_CHECK_ERROR,
  RECONNECT_ATTEMPTS_ERROR,
  RECONNECT_DELAY_ERROR,
  STATE_PATH,
  TOOL_CALL_TIMEOUT_ERROR,
} from '../constants.js'
import {
  effectiveHealthCheckIntervalMs,
  effectiveReconnectMaxAttempts,
  effectiveReconnectMaxDelayMs,
  effectiveToolCallTimeoutMs,
  isAutoReconnectEnabled,
  normalizeHealthCheckIntervalMs,
  normalizeReconnectMaxAttempts,
  normalizeReconnectMaxDelayMs,
  normalizeToolCallTimeoutMs,
  saveState,
} from '../state.js'
import { openPath } from '../util/open.js'
import { readBody, sendJson } from '../../../platform/util/http.js'
import type { McpHandler } from './context.js'
import type { PluginState, ReconnectSettings } from '../types.js'

type ReconnectKey = keyof ReconnectSettings

/** The reconnection knobs as the page reads them, defaults included. */
function reconnectSettings(state: PluginState): ReconnectSettings {
  return {
    autoReconnect: isAutoReconnectEnabled(state),
    reconnectMaxAttempts: effectiveReconnectMaxAttempts(state),
    reconnectMaxDelayMs: effectiveReconnectMaxDelayMs(state),
    healthCheckIntervalMs: effectiveHealthCheckIntervalMs(state),
  }
}

/** One validated field: a value, or "restore the default" when it is absent. */
interface ReconnectWrite {
  value?: boolean | number
}

/**
 * Validate one `POST /settings/reconnect` body.
 *
 * Every field is optional — absent leaves it alone — and `null` restores that
 * field's built-in default. Nothing is applied until the whole body has been
 * read, so a request carrying one bad field changes nothing at all.
 * @returns the writes to apply, or the refusal message to answer with.
 */
function readReconnectWrites(body: Record<string, unknown>): Map<ReconnectKey, ReconnectWrite> | string {
  const writes = new Map<ReconnectKey, ReconnectWrite>()
  if ('autoReconnect' in body) {
    const raw = body.autoReconnect
    if (raw === null) writes.set('autoReconnect', {})
    else if (typeof raw === 'boolean') writes.set('autoReconnect', { value: raw })
    else return 'autoReconnect must be a boolean, or null to restore the default'
  }
  const bounded: Array<[ReconnectKey, (value: unknown) => number | undefined, string]> = [
    ['reconnectMaxAttempts', normalizeReconnectMaxAttempts, RECONNECT_ATTEMPTS_ERROR],
    ['reconnectMaxDelayMs', normalizeReconnectMaxDelayMs, RECONNECT_DELAY_ERROR],
    ['healthCheckIntervalMs', normalizeHealthCheckIntervalMs, HEALTH_CHECK_ERROR],
  ]
  for (const [key, normalize, message] of bounded) {
    if (!(key in body)) continue
    const raw = body[key]
    if (raw === null) {
      writes.set(key, {})
      continue
    }
    const value = normalize(raw)
    if (value === undefined) return message
    writes.set(key, { value })
  }
  return writes
}

/**
 * Write — or clear, for `undefined` — one reconnection setting by name. The
 * explicit switch is what keeps `state[key]` from being a union-keyed write.
 */
function setReconnectSetting(state: PluginState, key: ReconnectKey, value: boolean | number | undefined): void {
  switch (key) {
    case 'autoReconnect':
      if (typeof value === 'boolean') state.autoReconnect = value
      else delete state.autoReconnect
      break
    case 'reconnectMaxAttempts':
      if (typeof value === 'number') state.reconnectMaxAttempts = value
      else delete state.reconnectMaxAttempts
      break
    case 'reconnectMaxDelayMs':
      if (typeof value === 'number') state.reconnectMaxDelayMs = value
      else delete state.reconnectMaxDelayMs
      break
    case 'healthCheckIntervalMs':
      if (typeof value === 'number') state.healthCheckIntervalMs = value
      else delete state.healthCheckIntervalMs
      break
  }
}

export const handleSettings: McpHandler = async (req, res, facts, api) => {
  const { rest } = facts

  if (req.method === 'GET' && rest === '/ping') {
    sendJson(res, 200, {
      ok: true,
      version: 5,
      stdio: true,
      workspace: true,
      onDemandTools: true,
      autoReconnect: true,
    })
    return true
  }

  if (req.method === 'GET' && rest === '/settings') {
    sendJson(res, 200, {
      onDemandToolInjection: api.runtime.state.onDemandToolInjection,
      toolCallTimeoutMs: effectiveToolCallTimeoutMs(api.runtime.state),
      ...reconnectSettings(api.runtime.state),
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

  if (req.method === 'POST' && rest === '/settings/reconnect') {
    const body = await readBody(req)
    const writes = readReconnectWrites(body)
    if (typeof writes === 'string') {
      sendJson(res, 400, { error: writes })
      return true
    }
    const state = api.runtime.state
    const before = new Map<ReconnectKey, boolean | number | undefined>(
      [...writes.keys()].map((key) => [key, state[key]]),
    )
    for (const [key, write] of writes) setReconnectSetting(state, key, write.value)
    try {
      saveState(state)
    } catch (error) {
      // Roll the in-memory values back before rethrowing: the dispatcher answers
      // 500 for an unwritable state file, and the retry that is about to happen
      // must use the settings that are still on disk.
      for (const [key, value] of before) setReconnectSetting(state, key, value)
      throw error
    }
    sendJson(res, 200, reconnectSettings(state))
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
