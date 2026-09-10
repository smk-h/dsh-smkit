/**
 * Credential + header resolution for one server config.
 *
 * Static bearer tokens are never stored: only the **name** of the environment
 * variable holding them (`tokenEnv`). Treat every value produced here as a
 * secret — nothing in this module may be logged.
 */

import type { EnvMap, ServerConfig } from './types.js'

/**
 * The bearer token to present for this server.
 *
 * - `static`: read `process.env[tokenEnv]`; fall back to the legacy plaintext
 *   `staticToken` written by ≤0.3.0 so existing configs keep working until they
 *   are re-saved with an env var name (the PUT handler then drops the field).
 * - `oauth`: the stored access token (may be stale; callers refresh on 401).
 */
export function accessToken(server: ServerConfig): string {
  if (server.authMode === 'static') {
    const envName = server.tokenEnv
    if (envName) return process.env[envName] ?? ''
    return server.staticToken ?? ''
  }
  return server.oauth?.tokens?.access_token ?? ''
}

/**
 * Merge user-defined HTTP headers: direct values plus values read from
 * environment variables (Codex-style, so secrets never persist in the config).
 */
export function resolveHeaders(server: ServerConfig): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(server.headers ?? ({} as EnvMap))) {
    headers[key] = String(value)
  }
  for (const [key, envName] of Object.entries(server.headerEnv ?? ({} as EnvMap))) {
    const value = envName ? process.env[envName] : undefined
    if (value !== undefined) headers[key] = String(value)
  }
  return headers
}

/** Authorization + custom headers + MCP session id, for every HTTP request. */
export function authHeaders(
  server: ServerConfig,
  conn?: { sessionId?: string | null } | null,
): Record<string, string> {
  const headers = resolveHeaders(server)
  const token = accessToken(server)
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (conn?.sessionId) headers['Mcp-Session-Id'] = conn.sessionId
  return headers
}

/** Whether this server currently has usable credentials to attempt connecting. */
export function hasToken(server: ServerConfig): boolean {
  if (server.authMode === 'static') return accessToken(server) !== ''
  return !!server.oauth?.tokens
}
