/**
 * Pure text/argument helpers shared by the host half.
 *
 * Nothing here touches `ctx` or the filesystem, so every function is unit
 * testable in isolation (`test/legacy-config-migration.test.mjs`).
 */

import { MAX_ERROR_LENGTH } from '../constants.js'

/** URL-safe base64 without padding (OAuth `state`, `code_verifier`, ids). */
export function b64url(buf: { toString(encoding: 'base64'): string }): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

/** Narrow a value to a non-array, non-null object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** How many messages the `cause` chain may contribute before it is cut off. */
const MAX_ERROR_CHAIN = 3

/**
 * Render any thrown value as a message, unbounded.
 *
 * The `cause` chain is appended in parentheses because the outermost error is
 * usually useless on its own: `fetch()` throws a bare `TypeError: fetch failed`
 * and keeps the real reason — `connect ECONNREFUSED 127.0.0.1:8793` — in
 * `cause`. An `AggregateError` (undici tries every address a host resolves to)
 * puts it in `errors` instead, and its own message is just "aggregate error",
 * so that message is dropped in favour of the first entry. Repeated and
 * self-referencing causes are ignored, so this cannot loop.
 */
export function errorText(error: unknown): string {
  const seen = new Set<unknown>()
  const parts: string[] = []
  let current: unknown = error
  while (parts.length < MAX_ERROR_CHAIN && current != null && !seen.has(current)) {
    seen.add(current)
    const record = isRecord(current) ? current : null
    const nested = record && Array.isArray(record.errors) && record.errors.length > 0 ? record.errors[0] : undefined
    if (nested === undefined) {
      const message = record && 'message' in record ? String(record.message) : String(current)
      if (message && message !== parts[parts.length - 1]) parts.push(message)
    }
    current = nested ?? record?.cause
  }
  if (parts.length === 0) return String(error)
  return parts.length === 1 ? parts[0] : `${parts[0]} (${parts.slice(1).join(' → ')})`
}

/** Render any thrown value as a bounded, user-safe message. */
export function toErrorMessage(error: unknown, max = MAX_ERROR_LENGTH): string {
  return errorText(error).slice(0, max)
}

/**
 * Normalize an env/header payload into a flat string→string map.
 *
 * Accepts the current object form (returned **by identity**, callers rely on
 * that) plus the legacy `[{ name, value }]` and `[{ key, value }]` lists older
 * plugin versions wrote. Entries without a usable name are dropped; values are
 * coerced to strings.
 */
export function normalizeEnvPairs(value: unknown): Record<string, string> {
  if (Array.isArray(value)) {
    const out: Record<string, string> = {}
    for (const entry of value) {
      if (!isRecord(entry)) continue
      const name = entry.name ?? entry.key
      if (typeof name !== 'string' || !name) continue
      out[name] = String(entry.value ?? '')
    }
    return out
  }
  if (isRecord(value)) return value as Record<string, string>
  return {}
}

/**
 * Quote one command-line token for the `cmd.exe /d /s /c` line Node builds when
 * `spawn(..., { shell: true })` runs on Windows. Node joins the command and its
 * args with plain spaces and adds no quoting, so cmd.exe truncates any token
 * containing whitespace (`C:\Program Files\...` → `C:\Program`). Idempotent: a
 * token the user already quoted is left untouched.
 */
export function quoteWindowsToken(token: unknown): string {
  const text = String(token)
  if (text === '') return '""'
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"') && !text.slice(1, -1).includes('"')) {
    return text
  }
  if (!/[\s"]/.test(text)) return text
  return `"${text.replace(/"/g, '\\"')}"`
}

/** Tokenize a command-line args string, respecting double/single quotes. */
export function parseArgs(args: unknown): string[] {
  if (Array.isArray(args)) return args.filter((a): a is string => typeof a === 'string')
  if (typeof args === 'string') {
    const out: string[] = []
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g
    let match: RegExpExecArray | null
    while ((match = re.exec(args))) out.push(match[1] ?? match[2] ?? match[3] ?? '')
    return out
  }
  return []
}

/**
 * Normalize an env payload — object, legacy `[{ name, value }]` list, or a JSON
 * string — into a flat string→string map.
 */
export function parseEnv(env: unknown): Record<string, string> {
  if (Array.isArray(env)) return parseEnv(normalizeEnvPairs(env))
  if (isRecord(env)) {
    const out: Record<string, string> = {}
    for (const key of Object.keys(env)) out[key] = String(env[key] ?? '')
    return out
  }
  if (typeof env === 'string' && env.trim()) {
    try {
      const parsed: unknown = JSON.parse(env)
      if (isRecord(parsed)) return parseEnv(parsed)
    } catch {
      // Not JSON: fall through to the empty map.
    }
  }
  return {}
}

/** Whether a value is an absolute http(s) URL — the only scheme MCP accepts. */
export function isHttpUrl(value: unknown): boolean {
  return /^https?:\/\//.test(String(value ?? '').trim())
}
