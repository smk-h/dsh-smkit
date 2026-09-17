/**
 * Translation between one route's resolved retry policy and the flat shape the
 * model-retry tab edits, plus the tab's own input check.
 *
 * The adapter's schema and its `resolveRetryPolicy` stay authoritative: this
 * module exists so the form can open on the values actually in force and can
 * answer a typo before the write is attempted. The ranges below mirror
 * `packages/llm/llm/src/retry-policy.ts` in the harness, and a value that slips
 * past them is still refused by the settings write itself.
 */

import type { RetryPolicyFields } from '../../../shared/custom-settings/retry.js'
import type { ResolvedRetryPolicyLike } from './types.js'

/** Largest delay Node schedules without clamping (the adapter's `MAX_TIMER_DELAY_MS`). */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** The adapter's default bounded-retry count, used to seed the form. */
export const DEFAULT_MAX_RETRIES = 5

/**
 * One route's stored `retryPolicy`, in the adapters' own shape: the flat form
 * fields gathered back into `backoff`.
 *
 * The shape is not a preference. `resolveRetryPolicy` validates the stored
 * object's keys against exactly these four and reads its delays from
 * `backoff`, so a flat object is refused with `unknown key "initialDelayMs"`
 * and never reaches a route.
 */
export interface StoredRetryPolicy {
  mode: 'normal' | 'always'
  maxRetries?: number
  retryableCodes?: string[]
  backoff: {
    initialDelayMs: number
    maxDelayMs: number
    jitterRatio: number
  }
}

/** One accepted policy, or the message naming what is wrong with it. */
export type PolicyParseResult =
  | { ok: true; value: StoredRetryPolicy }
  | { ok: false; error: string }

/** A finite number in the inclusive range, or `undefined`. */
function numberInRange(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined
}

/**
 * Project one resolved policy into the shape the page edits.
 * @param resolved - the policy the owning adapter captured for the route.
 * @returns the flat fields, with `retryableCodes` reporting the set in force.
 */
export function normalizePolicy(resolved: ResolvedRetryPolicyLike): RetryPolicyFields {
  const backoff = {
    initialDelayMs: resolved.initialDelayMs,
    maxDelayMs: resolved.maxDelayMs,
    jitterRatio: resolved.jitterRatio,
  }
  if (resolved.mode === 'always') return { mode: 'always', ...backoff }
  return {
    mode: 'normal',
    maxRetries: resolved.maxRetries ?? DEFAULT_MAX_RETRIES,
    ...resolved.retryableCodes === undefined ? {} : { retryableCodes: [...resolved.retryableCodes] },
    ...backoff,
  }
}

/**
 * Check one submitted policy and reduce it to the object the write stores: the
 * flat form fields with `backoff` gathered back around the three delays.
 *
 * `retryableCodes` is ignored on purpose: the page does not edit the eligible
 * code set, and the host preserves whatever the route already stores, so a
 * client that echoed the resolved list back could not change behaviour — it
 * could only pin a route that inherited the default set to an explicit copy of
 * it.
 * @param input - the untrusted `policy` member of the request body, in the flat wire shape.
 * @returns the stored policy, or the message the refusal reports.
 */
export function parsePolicyFields(input: unknown): PolicyParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'policy must be an object or null' }
  }
  const raw = input as Record<string, unknown>
  const mode = raw['mode']
  if (mode !== 'normal' && mode !== 'always') {
    return { ok: false, error: 'policy.mode must be "normal" or "always"' }
  }
  const initialDelayMs = numberInRange(raw['initialDelayMs'], Number.MIN_VALUE, MAX_TIMER_DELAY_MS)
  if (initialDelayMs === undefined) {
    return { ok: false, error: `policy.initialDelayMs must be a positive number no greater than ${MAX_TIMER_DELAY_MS}` }
  }
  const maxDelayMs = numberInRange(raw['maxDelayMs'], Number.MIN_VALUE, MAX_TIMER_DELAY_MS)
  if (maxDelayMs === undefined) {
    return { ok: false, error: `policy.maxDelayMs must be a positive number no greater than ${MAX_TIMER_DELAY_MS}` }
  }
  if (initialDelayMs > maxDelayMs) {
    return { ok: false, error: 'policy.initialDelayMs must be less than or equal to policy.maxDelayMs' }
  }
  const jitterRatio = numberInRange(raw['jitterRatio'], 0, 1)
  if (jitterRatio === undefined) {
    return { ok: false, error: 'policy.jitterRatio must be between 0 and 1' }
  }
  const backoff = { initialDelayMs, maxDelayMs, jitterRatio }
  // Gathered back into `backoff` here, at the one boundary between the flat
  // wire shape the form edits and the nested shape the adapters store.
  if (mode === 'always') return { ok: true, value: { mode, backoff } }

  const maxRetries = raw['maxRetries']
  if (typeof maxRetries !== 'number' || !Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    return { ok: false, error: 'policy.maxRetries must be a non-negative integer' }
  }
  return { ok: true, value: { mode, maxRetries, backoff } }
}

/**
 * Read one stored value by its path inside a raw user section.
 * @param root - the raw section, or `undefined` when none is stored.
 * @param path - segments from the section root; `[]` names the root itself.
 * @returns the value at that path, or `undefined` when any segment is missing.
 */
export function readAtPath(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * The eligible-code list a route already stores, when it stores one.
 *
 * Carried through every save because the write replaces the whole
 * `retryPolicy` object: without this, editing the delay of a route whose codes
 * were hand-written would silently widen it back to the adapter's default set.
 * @param stored - the route's stored `retryPolicy`, if any.
 * @returns the stored list as a copy, or `undefined` when the route keeps defaults.
 */
export function storedRetryableCodes(stored: unknown): string[] | undefined {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return undefined
  const codes = (stored as Record<string, unknown>)['retryableCodes']
  if (!Array.isArray(codes)) return undefined
  const list = codes.filter((code): code is string => typeof code === 'string' && code.length > 0)
  return list.length === codes.length ? list : undefined
}
