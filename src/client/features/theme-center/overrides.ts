/**
 * The palette override layer: the saved color edits, which sit *above* the
 * applied theme rather than being one of them.
 *
 * The layer is still one custom property per edited token, and it still wins
 * over whatever the theme declares — but it is now the shell's own layer
 * (`ctx.theme.overrideTokens`) rather than a pile of inline properties this
 * plugin writes onto the body. The shell folds override layers into the active
 * definition in sequence order and picks the value for the active palette, so
 * an edit lands on top of the theme without either side knowing about the
 * other, the layer is restacked rather than duplicated when the panel saves
 * again, and unloading the plugin retracts exactly what it stacked.
 *
 * Every pair carries the same value on both sides, the way the theme's own layer
 * does: a theme here is one palette, so an edit made under it is that edit on
 * either half, and the other side repeats it rather than guessing a second
 * colour — which is what the shell's validator demands anyway (a bare string
 * throws there deliberately). The edit therefore keeps painting if the user
 * later switches to one of the shell's own palettes — the same reach the
 * inline-injecting revision had, and the reason the layer is described as
 * "above the theme" at all.
 *
 * Staying above it takes one subscription. The registry hands out layer sequence
 * numbers per stack call, so a theme restacking its own colors takes the newest
 * one and would compose *after* this layer — painting over the very edits made
 * on top of it. `onThemeLayerRestacked` is the signal to stack again.
 *
 * The edits persist under `smkit:theme-colors`, taking over the older
 * `smkit:skin-colors` key once on first read and deleting it, so a reader who
 * saved a palette before the skins were folded in keeps it. Storage sits behind
 * try/catch because a private-mode browser throws on any access, and edits that
 * cannot persist should still apply for the session.
 *
 * `registerPaletteOverrides` runs at plugin mount, not when the palette panel
 * opens: the panel is one conversation-header control the user visits rarely,
 * while the overrides have to be on the layer the whole time.
 */

import { onThemeLayerRestacked, overrideTokens } from './apply'
import type { ClientContext } from '../../platform/types'

/** Where the edits live, under the plugin's own `smkit:` prefix — the same
 * namespace the theme choice uses, and the one the local-cache tab promises to
 * leave alone. */
const OVERRIDES_KEY = 'smkit:theme-colors'

/** The key the edits lived under while the palette rode the retired `theme`
 * feature. */
const OVERRIDES_LEGACY_KEY = 'smkit:skin-colors'

/**
 * The layer's identity in the shell's registry: one layer per source, so
 * stacking again replaces this plugin's whole layer instead of adding a second
 * one on top of it.
 */
const LAYER_SOURCE = 'smkit:palette'

/** The layer currently stacked, or null when nothing is. */
let layerDispose: (() => void) | null = null

/**
 * What the stacked layer says, token by token. Kept here rather than in the
 * panel's own state because a slider drag outruns React's renders: the panel
 * merges one edit at a time and the layer has to see every one of them, so the
 * authoritative copy of a live edit is the one this module stacks, and the
 * panel's map is its picture of it.
 */
let liveEdits: Record<string, string> = {}

/** One edit, as the shell's layer wants it: both palette halves carry the same
 * value, the same shape the theme's own layer uses (see the module doc). */
function toPair(value: string): { light: string; dark: string } {
  return { light: value, dark: value }
}

/** Re-stack the layer from `liveEdits`, or take it off when nothing is left. */
function stackLayer(): void {
  const pairs: Record<string, { light: string; dark: string }> = {}
  for (const [token, value] of Object.entries(liveEdits)) pairs[token] = toPair(value)
  if (Object.keys(pairs).length === 0) {
    layerDispose?.()
    layerDispose = null
    return
  }
  // The shell replaces a source's whole layer when it is stacked again, so an
  // edit that arrives while one is up restacks rather than accumulating.
  layerDispose = overrideTokens(LAYER_SOURCE, pairs)
}

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

/** Paint the edits now: one layer stacked over whatever theme is active, in the
 * shell's own sequence order, so it beats every one of them. */
export function applyColorOverrides(overrides: Record<string, string>): void {
  liveEdits = { ...overrides }
  stackLayer()
}

/** Move one token to a live-but-unsaved value, restacking the layer. The
 * panel's slider drag calls this per change: the edit paints immediately and
 * storage only hears about it on Save. */
export function patchColorOverride(token: string, value: string): void {
  liveEdits = { ...liveEdits, [token]: value }
  stackLayer()
}

/** Drop one token from the live layer — the "back on the theme's own value"
 * branch of a slider reset, where the override has nothing left to say. */
export function dropColorOverride(token: string): void {
  const next = { ...liveEdits }
  delete next[token]
  liveEdits = next
  stackLayer()
}

/**
 * Read something with the layer lifted, then put it back exactly as it was.
 *
 * The panel needs this for the one question the layer is in the way of: "what
 * does the theme paint here on its own?". The layer is folded into the shell's
 * own inline properties before they reach the body, so a probe would answer
 * with the edit rather than with the theme — the same reason the previous
 * revision removed the token from the body's inline style before sampling, done
 * one level up now that the shell owns the write.
 */
export function readWithoutOverrides<T>(read: () => T): T {
  const saved = liveEdits
  const restore = layerDispose
  layerDispose?.()
  layerDispose = null
  liveEdits = {}
  try {
    return read()
  } finally {
    liveEdits = saved
    if (restore === null) stackLayer()
    else layerDispose = restore
  }
}

/** Take the edits back off (used by reset and by plugin unload). */
export function removeColorOverrides(): void {
  layerDispose?.()
  layerDispose = null
  liveEdits = {}
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
      // A theme restacking its colors takes the newest sequence number with it;
      // stacking again here puts the edits back on top where they belong.
      const off = onThemeLayerRestacked(() => stackLayer())
      return () => {
        off()
        removeColorOverrides()
      }
    },
    'smkit: theme-center/palette overrides',
  )
}
