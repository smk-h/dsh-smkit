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
import { STATE_PATH } from './constants.js'
import { workspaceTokenKey } from './mcp/naming.js'
import { b64url, isRecord, normalizeEnvPairs } from './util/text.js'
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
