/**
 * Persistence of `~/.dsh/mcp-manager.json`.
 *
 * The file holds server configs **and** OAuth client registrations/tokens, so
 * it is a secret: never log its contents, never write token values anywhere
 * else. Legacy shapes from older plugin versions are migrated once, in
 * `apply()`, via `migrateLoadedState`.
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  DEFAULT_AUTO_RECONNECT,
  DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  DEFAULT_RECONNECT_MAX_ATTEMPTS,
  DEFAULT_RECONNECT_MAX_DELAY_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  MAX_HEALTH_CHECK_INTERVAL_MS,
  MAX_RECONNECT_MAX_ATTEMPTS,
  MAX_RECONNECT_MAX_DELAY_MS,
  MAX_TOOL_CALL_TIMEOUT_MS,
  MIN_HEALTH_CHECK_INTERVAL_MS,
  MIN_RECONNECT_MAX_ATTEMPTS,
  MIN_RECONNECT_MAX_DELAY_MS,
  MIN_TOOL_CALL_TIMEOUT_MS,
  STATE_PATH,
} from './constants.js'
import { workspaceTokenKey } from './mcp/naming.js'
import { b64url, isRecord, normalizeEnvPairs } from '../../platform/util/text.js'
import type { PluginState, ServerConfig } from './types.js'

/** Read the state file, falling back to an empty store on any failure. */
export function loadState(): PluginState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    if (!isRecord(parsed)) throw new Error('root must be a JSON object')
    const state = parsed as PluginState
    if (!Array.isArray(state.servers)) state.servers = []
    return state
  } catch {
    return { servers: [], workspaceTokens: {}, onDemandToolInjection: false }
  }
}

/** Write the state file, creating `~/.dsh` when needed. */
export function saveState(state: PluginState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

/**
 * Validate one `tools/call` timeout, as the state file or the settings route
 * hands it over. Out-of-range values are dropped rather than clamped: the page
 * must show what is actually in force, and "60000" is a better answer than a
 * silently rewritten number.
 * @returns the value when it is a whole number inside the bounds, else `undefined`.
 */
export function normalizeToolCallTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  if (value < MIN_TOOL_CALL_TIMEOUT_MS || value > MAX_TOOL_CALL_TIMEOUT_MS) return undefined
  return value
}

/**
 * The timeout a `tools/call` request runs under: the stored setting, or the
 * built-in default. Read per call, so a saved change reaches the next tool call
 * without reconnecting the server.
 */
export function effectiveToolCallTimeoutMs(state: PluginState): number {
  return normalizeToolCallTimeoutMs(state.toolCallTimeoutMs) ?? DEFAULT_TOOL_CALL_TIMEOUT_MS
}

/** A whole number inside `[min, max]`, else `undefined` (never clamped). */
function normalizeBoundedInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  if (value < min || value > max) return undefined
  return value
}

/** Retry attempts before giving up; 0 means "keep trying". */
export function normalizeReconnectMaxAttempts(value: unknown): number | undefined {
  return normalizeBoundedInt(value, MIN_RECONNECT_MAX_ATTEMPTS, MAX_RECONNECT_MAX_ATTEMPTS)
}

export function effectiveReconnectMaxAttempts(state: PluginState): number {
  return normalizeReconnectMaxAttempts(state.reconnectMaxAttempts) ?? DEFAULT_RECONNECT_MAX_ATTEMPTS
}

/** Ceiling of the exponential backoff between retries. */
export function normalizeReconnectMaxDelayMs(value: unknown): number | undefined {
  return normalizeBoundedInt(value, MIN_RECONNECT_MAX_DELAY_MS, MAX_RECONNECT_MAX_DELAY_MS)
}

export function effectiveReconnectMaxDelayMs(state: PluginState): number {
  return normalizeReconnectMaxDelayMs(state.reconnectMaxDelayMs) ?? DEFAULT_RECONNECT_MAX_DELAY_MS
}

/**
 * Liveness-probe period. `0` is a valid, meaningful value — it turns the probe
 * off — so unlike the others it is not "outside the bounds", and the range
 * check only applies to the non-zero values.
 */
export function normalizeHealthCheckIntervalMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  if (value === 0) return 0
  return normalizeBoundedInt(value, MIN_HEALTH_CHECK_INTERVAL_MS, MAX_HEALTH_CHECK_INTERVAL_MS)
}

export function effectiveHealthCheckIntervalMs(state: PluginState): number {
  return normalizeHealthCheckIntervalMs(state.healthCheckIntervalMs) ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS
}

/** Whether a dropped transport is rebuilt automatically. Defaults to on. */
export function isAutoReconnectEnabled(state: PluginState): boolean {
  return typeof state.autoReconnect === 'boolean' ? state.autoReconnect : DEFAULT_AUTO_RECONNECT
}

/**
 * One-time migration for a state file written by an older plugin version.
 *
 * - `id`: every runtime lookup (live status, `/servers/:id/*` routes) is keyed
 *   by it. Configs from ≤0.1.x have no `id` at all, so all servers share one
 *   live-status slot (errors cross over) and every id-addressed API 404s.
 * - `env`/`headers`/`headerEnv`: legacy `[{ name, value }]` arrays were spread
 *   into the child environment as numeric keys, silently losing every value.
 *
 * @returns whether anything changed (the caller then persists the state).
 */
export function migrateLoadedState(state: unknown, makeId: () => string = () => b64url(randomBytes(8))): boolean {
  let changed = false
  const servers = isRecord(state) && Array.isArray(state.servers) ? state.servers : []
  const ids = new Set<string>()
  for (const server of servers) {
    if (!isRecord(server)) continue
    if (typeof server.id !== 'string' || !server.id || ids.has(server.id)) {
      server.id = makeId()
      changed = true
    }
    ids.add(server.id as string)
    for (const key of ['env', 'headers', 'headerEnv']) {
      if (Array.isArray(server[key])) {
        server[key] = normalizeEnvPairs(server[key])
        changed = true
      }
    }
  }
  return changed
}

/**
 * Persist OAuth client registration + tokens for one server, routing to the
 * global state or the per-workspace token slot depending on where it lives.
 * Always writes the file, so plain config edits are saved by the same path.
 */
export function persistServer(state: PluginState, server: ServerConfig): void {
  if (server.wsPath) {
    const key = workspaceTokenKey(server.wsPath, server.name)
    if (server.oauth) state.workspaceTokens[key] = { oauth: server.oauth }
    else delete state.workspaceTokens[key]
  }
  saveState(state)
}

/**
 * Drop the OAuth slot of one workspace server. Returns whether it existed, so
 * callers persist only when something actually changed.
 */
export function dropWorkspaceToken(state: PluginState, key: string): boolean {
  const tokens = state.workspaceTokens
  if (!tokens || !(key in tokens)) return false
  delete tokens[key]
  return true
}
