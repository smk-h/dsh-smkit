/**
 * Name/id derivation rules.
 *
 * The public tool-name convention is byte-for-byte the built-in
 * `@deepseek-ai/dsh-mcp-client` one: `mcp__<server>__<raw>` with every
 * non-`[A-Za-z0-9_-]` character replaced by `_`, capped at 64 chars with a
 * sha256 suffix on overflow. Anything that diverges here breaks callers that
 * map a public name back to a server.
 */

import { createHash, randomBytes } from 'node:crypto'
import { MAX_TOOL_NAME_LENGTH } from '../constants.js'
import { b64url } from '../util/text.js'

/** `mcp__<server>__<raw>`, normalized and length-capped. */
export function publicName(serverName: string, raw: string): string {
  const joined = `mcp__${serverName}__${raw}`
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_')
  if (normalized.length <= MAX_TOOL_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${raw}`).digest('hex').slice(0, 12)
  return `${normalized.slice(0, MAX_TOOL_NAME_LENGTH - 13)}_${hash}`
}

/** Fresh opaque id for a global-tier server. */
export function newServerId(): string {
  return b64url(randomBytes(8))
}

/** Fresh opaque id for a workspace-tier server (pre-rescan placeholder). */
export function newWorkspaceServerId(): string {
  return `ws-${b64url(randomBytes(8))}`
}

/**
 * Stable, deterministic id derived from (canonical workspace, name) so an OAuth
 * callback can re-locate the server across config rescans.
 */
export function workspaceServerId(wsPath: string, name: string): string {
  return `ws-${createHash('sha256').update(`${wsPath}\n${name}`).digest('hex').slice(0, 20)}`
}

/** Key of the per-workspace OAuth slot inside the sensitive state file. */
export function workspaceTokenKey(wsPath: string, name: string): string {
  return `${wsPath}\n${name}`
}
