/**
 * The palette override layer: the saved color edits, which sit *above* the
 * applied theme rather than being one of them.
 *
 * A theme paints by swapping a stylesheet into the active `<style>` element and
 * one attribute onto the body; an override paints by setting an inline custom
 * property on the body, which wins the cascade over every selector block
 * either of them can write. That is the whole contract: switching a theme, or
 * restoring one on load, never touches these, and an override never has to know
 * which theme it landed on.
 *
 * The edits persist under `smkit:theme-colors`, taking over the older
 * `smkit:skin-colors` key once on first read and deleting it, so a reader who
 * saved a palette before the skins were folded in keeps it. Storage sits behind
 * try/catch because a private-mode browser throws on any access, and edits that
 * cannot persist should still apply for the session.
 *
 * `registerPaletteOverrides` runs at plugin mount, not when the palette panel
 * opens: the panel is one conversation-header control the user visits rarely,
 * while the overrides have to be on the body the whole time.
 */

import type { ClientContext } from '../../platform/types'

/** Where the edits live, under the plugin's own `smkit:` prefix — the same
 * namespace the theme choice uses, and the one the local-cache tab promises to
 * leave alone. */
const OVERRIDES_KEY = 'smkit:theme-colors'

/** The key the edits lived under while the palette rode the retired `theme`
 * feature. */
const OVERRIDES_LEGACY_KEY = 'smkit:skin-colors'

/** The saved edits, or an empty map when nothing is stored (or unparseable).
 * The first read of an upgraded browser carries the old key forward and clears
 * it, so the migration happens exactly once and never leaves a stale key behind
 * to win a later read. A denied storage throws out to the caller's empty map,
 * which is the same session-no-overrides outcome a private-mode browser got
 * before. */
export function loadColorOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY) ?? localStorage.getItem(OVERRIDES_LEGACY_KEY)
    if (raw === null) return {}
    if (localStorage.getItem(OVERRIDES_KEY) === null) localStorage.setItem(OVERRIDES_KEY, raw)
    localStorage.removeItem(OVERRIDES_LEGACY_KEY)
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Record<string, string> = {}
    for (const [token, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && token.startsWith('--')) out[token] = value
    }
    return out
  } catch {
    return {}
  }
}

/** Persist the edits; a denied storage keeps the session's paint. */
export function saveColorOverrides(overrides: Record<string, string>): void {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
    // A save settles the migration: the live key is authoritative from here on.
    localStorage.removeItem(OVERRIDES_LEGACY_KEY)
  } catch {
    // Private-mode browsers throw on any storage access.
  }
}

/** Wipe the saved edits. */
export function clearColorOverrides(): void {
  try {
    localStorage.removeItem(OVERRIDES_KEY)
    localStorage.removeItem(OVERRIDES_LEGACY_KEY)
  } catch {
    // Private-mode browsers throw on any storage access.
  }
}

/** Paint the edits now: one inline custom property per entry, so the cascade
 * puts them above whatever the active theme declares. */
export function applyColorOverrides(overrides: Record<string, string>): void {
  if (typeof document === 'undefined') return
  const body = document.body
  if (!body) return
  for (const [token, value] of Object.entries(overrides)) body.style.setProperty(token, value)
}

/** Take the edits back off the body (used by reset and by plugin unload). */
export function removeColorOverrides(overrides: Record<string, string>): void {
  if (typeof document === 'undefined') return
  const body = document.body
  if (!body) return
  for (const token of Object.keys(overrides)) body.style.removeProperty(token)
}

/** Mount-time half of the layer: restore the saved edits, and take them back
 * off when the plugin unloads, so the hot-reload contract (everything apply()
 * writes, dispose() retracts) holds for the overrides too. It rides its own
 * effect rather than the theme restore's, because the two are independent
 * layers: a theme switch must not retract what the user saved on top of it, and
 * neither must an unload that leaves the theme in place. */
export function registerPaletteOverrides(ctx: ClientContext): void {
  ctx.effect(
    () => {
      const overrides = loadColorOverrides()
      applyColorOverrides(overrides)
      return () => removeColorOverrides(overrides)
    },
    'smkit: theme-center/palette overrides',
  )
}
