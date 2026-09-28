/**
 * What applying a theme of the center is: one token-override layer stacked over
 * whatever the shell has active, plus one preference write that pins the half
 * the theme is drawn for.
 *
 * The first revision painted themes itself — one `<style>` element swapped with
 * a sheet, one `data-smkit-theme` attribute on the body, and its own day/night
 * switch writing the shell's `data-ds-dark-theme`. Every one of those three had
 * to be kept in step with the shell by hand, and every one of them could drift:
 * a sheet that named fewer tokens than the shell defined left the shell's light
 * half showing through a dark theme (the reason this revision exists), and the
 * switch and the shell's own appearance setting both wrote the same attribute.
 *
 * The second revision registered each theme with the shell's registry
 * (`ctx.theme.register`) and drove it with `setTheme`. That is the shape the
 * registry appears to ask for, and it is the shape it cannot hold: `setTheme`
 * persists a *built-in* preference (`light`/`dark`/`system`) and keeps every
 * other id in memory alone, so the next thing to touch the settings scope takes
 * the choice with it. `ThemeRuntime.adopt` is that next thing — the registry
 * subscribes to the durable scope and rewrites its own `preference` from that
 * scope on every update, the one that lands when the scope finishes loading at
 * boot included. A registered theme therefore survived exactly until the page
 * was reloaded (or until any setting was written), and the shell settled back
 * on its own palette; the row would then still show the theme as selected,
 * because the choice *is* remembered here, while the screen said otherwise.
 *
 * So the two halves are drawn where each of them can live:
 *
 * - the *colors* are a layer of alias overrides (`ctx.theme.overrideTokens`),
 *   which the registry composes over the active definition and which no
 *   preference bookkeeping touches;
 * - the *half* is the shell's own preference, written to the theme's
 *   `colorScheme` and therefore persisted the way the shell persists its own
 *   choice — so `data-ds-dark-theme`, `color-scheme` and every token the table
 *   does not name come from the shell, and they survive a reload.
 *
 * Both sides of a pair carry the table's one value, because a theme here is one
 * palette (see `tokens/one-dark-pro.ts`): the layer says the same thing
 * whichever half the shell is on, which is what a fixed-scheme theme is.
 *
 * What is left for this module is the two things neither half can know: which
 * of *our* ids was chosen (`smkit:theme` — the shell's storage accepts only
 * `light`/`dark`/`system`, and it drops a registered id on its own), and the
 * body attribute the structural sheet is scoped on.
 *
 * The attribute survives because the shell has no way to attach rules to a
 * theme: a theme is a token table, not a stylesheet. Anything that is a *rule*
 * rather than a colour — zcode's tool-call cards — stays a sheet of ours,
 * scoped on the attribute this module writes, and the attribute is therefore
 * retracted the moment the active theme is not one of ours.
 *
 * The mode switch is gone with the same stroke: a theme declares its half
 * (`colorScheme`), so "which half" is not a second question the user answers.
 * ZCode's day and night are two entries rather than one sheet with two blocks.
 *
 * Everything else is unchanged from the first revision: the state lives at
 * module level behind a pub/sub so the settings row and the palette panel read
 * the same truth, and the programmatic API (`window.smkitTheme`, the
 * `smkitTheme` service) drives that state rather than a copy of it.
 */

import { THEMES, type ThemeDef } from './themes.data'
import type { ClientContext, HostThemeRuntimeLike, HostThemeSnapshotLike } from '../../platform/types'

/** The row's programmatic face, without the token tables. */
export interface ThemeInfo {
  id: string
  name: string
  nameZh: string
  desc: string
  descZh: string
  tags: readonly string[]
}

/** The programmatic face of the center, published on `window.smkitTheme`. */
export interface ThemeCenterApi {
  /** Every theme of the center, in card order. */
  list(): ThemeInfo[]
  /** The applied theme, or null under the shell's own palettes. */
  get(): { id: string; name: string; nameZh: string } | null
  /** Apply one theme by id; an id the center does not ship throws. */
  set(id: string): void
  /** Back to the shell's own palette preference. */
  reset(): void
  /** Advance to the next theme, wrapping. */
  cycle(): void
}

/**
 * The body attribute the structural sheet (`style/zcode-cards.css`) is scoped
 * on, exported because three other places have to name it and must not disagree
 * about it: this module's own writers, the `MutationObserver` the settings row
 * hangs on the body, and the palette panel's anchor watcher.
 *
 * It no longer selects a *palette* — the shell does that — only the rules that
 * ride a theme without being one.
 */
export const THEME_ATTR = 'data-smkit-theme'

/**
 * The color layer's identity in the shell's registry: one layer per source, so
 * switching themes replaces this plugin's whole color layer instead of stacking
 * a second one on top of the first.
 */
const LAYER_SOURCE = 'smkit:theme'

/** Where the chosen theme lives, under the plugin's own `smkit:` prefix. */
const LS_THEME = 'smkit:theme'

/**
 * The keys the choice used to live under, newest first. A browser that upgrades
 * with a theme selected must land on the same look, so every predecessor is read
 * forward into the live key.
 *
 * `smkit:skin` is the retired skin feature's key — its values were this center's
 * ids. `dsh-theme-pack:` is the name this lineage carried before the center
 * existed; `dsh-theme` migrates from the very same pair, so it is read and left
 * in place rather than deleted. The `dsh-theme:` pair is deliberately **not** on
 * the list: those are a coexisting plugin's *live* keys.
 */
const LS_LEGACY_THEME = ['smkit:skin', 'dsh-theme-pack:theme']

/** The one prefix a predecessor may be deleted under. */
const LS_OWN = 'smkit:'

/**
 * What "no theme of ours" writes to the shell: back to the built-in preference
 * that follows the OS, which is the state a browser that never picked a theme
 * is in. The center does not remember what the preference was before it
 * borrowed it — the shell's own appearance row owns that answer, and anyone who
 * wants a particular half can say so there.
 */
const PREFERENCE_FALLBACK = 'system'

/**
 * The shell's registry, or null on a composition without one (see
 * `ClientContext.theme`). Read once at mount rather than per call: a service
 * that appeared later would mean the shell re-composed underneath us, which is
 * the composition's business, not this module's.
 */
let runtime: HostThemeRuntimeLike | null = null

/**
 * The center's id for the theme in force, or null under the shell's own
 * palettes. Held here rather than read off the registry's snapshot: what the
 * registry reports as active is the shell's *preference*, and a theme of ours is
 * a layer over it, not an id the shell can hold (see the module doc).
 */
let activeId: string | null = null

/** The stacked color layer's disposer, or null when nothing is stacked. */
let layerDispose: (() => void) | null = null

const listeners = new Set<() => void>()

/**
 * The layers that have to sit *above* the theme's own colors, restacked whenever
 * this one moves — the palette edits, in practice (`overrides.ts`).
 *
 * The registry orders its layers by a monotonic sequence handed out per stack
 * call, so replacing the color layer gives it the newest sequence, and the next
 * composition would paint it over the user's saved edits — the theme would
 * quietly overwrite the very colors that were tuned on top of it. Letting the
 * layers above stack again, *after* this one, restores the order they are meant
 * to have. One subscriber throwing must not cost the others, hence the guard.
 */
const aboveLayers = new Set<() => void>()

/** Watch for the color layer moving; the return value unsubscribes. */
export function onThemeLayerRestacked(fn: () => void): () => void {
  aboveLayers.add(fn)
  return () => aboveLayers.delete(fn)
}

function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch {
      // One bad listener must not stop the rest.
    }
  }
}

/** Watch the shared state; the return value unsubscribes. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Whether the shell's registry answered at mount. The row reads this to disable
 * its cards rather than offering a switch that cannot move: a host old enough to
 * lack the registry still gets the rest of the plugin, and a row that says so is
 * better than one that silently does nothing.
 */
export function themeAvailable(): boolean {
  return runtime !== null
}

/**
 * The theme in force, or null under the shell's own palettes. Split out so the
 * row and the palette panel read one shape, and so the id cannot fall out of
 * step with the table it names.
 */
export function activeTheme(): ThemeDef | null {
  if (activeId === null) return null
  return THEMES.find((theme) => theme.id === activeId) ?? null
}

/**
 * The center's id for the applied theme, or null under the shell's own palettes.
 * Read from this module's own state: the shell's registry cannot answer it (see
 * `activeId`).
 */
export function activeThemeId(): string | null {
  return activeTheme() === null ? null : activeId
}

/** Write or retract the attribute the structural sheet is scoped on. */
function syncAttr(): void {
  if (typeof document === 'undefined') return
  const body = document.body
  if (!body || typeof body.setAttribute !== 'function') return
  const id = activeThemeId()
  if (id === null) body.removeAttribute(THEME_ATTR)
  else body.setAttribute(THEME_ATTR, id)
}

/**
 * Repaint the attribute the structural sheet rides, and tell the row. The shell
 * answers a preference write with a `theme/change` of its own, and this is the
 * path that does not wait for one: a registry that stayed silent, or one that
 * refused the write, still leaves the body and the row saying what is true.
 */
function refresh(): void {
  syncAttr()
  notify()
}

/**
 * Stack one token override layer through the shell's registry — the palette
 * panel's edits, and the colors of the theme itself. Answers a no-op disposer on
 * a composition without a registry, so callers need no null check: the edits
 * then simply do not paint, which is the same outcome as a theme that cannot be
 * switched.
 */
export function overrideTokens(
  source: string,
  tokens: Readonly<Record<string, { light: string; dark: string }>>,
): () => void {
  if (runtime === null || typeof runtime.overrideTokens !== 'function') return () => {}
  try {
    return runtime.overrideTokens(source, tokens)
  } catch {
    // A registry that refuses the layer (a malformed pair, an older shell)
    // costs the edits, not the client entry.
    return () => {}
  }
}

/**
 * Stack the active theme's colors, or take the layer off when there is no theme
 * of ours. Every pair repeats the table's single value: a theme of this center
 * is one palette, so the layer means the same thing on either half — which is
 * exactly what keeps a fixed-scheme theme from following the OS.
 *
 * A theme whose table is missing stacks nothing and paints the shell's palette
 * through the attribute alone, the same lenient landing `THEMES` describes.
 */
function stackThemeLayer(): void {
  layerDispose?.()
  layerDispose = null
  const theme = activeTheme()
  if (theme === null) return
  const pairs: Record<string, { light: string; dark: string }> = {}
  for (const [token, value] of Object.entries(theme.tokens)) pairs[token] = { light: value, dark: value }
  if (Object.keys(pairs).length === 0) return
  layerDispose = overrideTokens(LAYER_SOURCE, pairs)
  // The layer above (the palette edits) has just been outranked in sequence
  // order; let it stack again so it keeps the position it is meant to hold.
  for (const fn of [...aboveLayers]) {
    try {
      fn()
    } catch {
      // A layer that cannot restack loses its place, not the theme.
    }
  }
}

/**
 * The persisted choice, carried forward from the older keys on the first read
 * that finds the live one empty. An id the center no longer ships answers null —
 * the same "no theme of ours" a fresh browser gets, rather than a half state
 * the row could not render. A theme that is retired therefore lands the browser
 * on the shell's own palettes; the choice is still in storage, so re-adding the
 * theme brings it back.
 */
function readSaved(): string | null {
  try {
    const current = localStorage.getItem(LS_THEME)
    let carried = current
    for (const key of LS_LEGACY_THEME) {
      const value = localStorage.getItem(key)
      if (carried === null && value !== null) {
        carried = value
        localStorage.setItem(LS_THEME, value)
      }
      if (key.startsWith(LS_OWN)) localStorage.removeItem(key)
    }
    if (carried === null) return null
    return THEMES.some((theme) => theme.id === carried) ? carried : null
  } catch {
    // A private-mode browser throws on any access; an unremembered theme
    // should still apply for the session, so the caller treats this as none.
    return null
  }
}

/**
 * Apply one theme by id, or hand the preference back to the shell with null.
 * Unknown ids clear rather than throw: this is the path a persisted value walks
 * back in, and a stale stored id must not strand the body in a half state.
 *
 * The preference write is the half that has to land for the theme to look like
 * itself after a reload — it is what the shell persists, and what decides
 * `data-ds-dark-theme` and every token the table leaves to the shell. A write
 * the shell refuses (an older registry without that preference) leaves the
 * colors stacked and the choice stored: the session paints, the next boot tries
 * again, and the row shows the truth either way.
 */
export function applyTheme(id: string | null): void {
  const theme: ThemeDef | null = id === null ? null : THEMES.find((entry) => entry.id === id) ?? null
  activeId = theme === null ? null : theme.id
  if (runtime !== null) {
    try {
      runtime.setTheme(theme === null ? PREFERENCE_FALLBACK : theme.colorScheme)
    } catch {
      // A shell that refuses the preference (an older registry) still gets the
      // colors and the attribute below; the next boot tries the write again.
    }
  }
  stackThemeLayer()
  try {
    if (theme === null) localStorage.removeItem(LS_THEME)
    else localStorage.setItem(LS_THEME, theme.id)
  } catch {
    // Private-mode browsers throw; the session keeps the paint.
  }
  refresh()
}

/** Name the API publishes itself under — both as a service and a `window` handle. */
const SERVICE_NAME = 'smkitTheme'

/**
 * The `window.smkitTheme` surface. The handle is the plugin's own name:
 * `window.dshTheme` belongs to `dsh-theme`, and writing it here would silently
 * replace that plugin's object.
 */
function exposeApi(api: ThemeCenterApi): void {
  const target = window as unknown as {
    smkitTheme: ThemeCenterApi
    smkitThemeCenter: ThemeCenterApi
  }
  target.smkitTheme = api
  // The feature's own name as a second handle; both drive the same state.
  target.smkitThemeCenter = api
}

/** The programmatic API, over the shared state the cards drive. */
export function createThemeCenterApi(): ThemeCenterApi {
  const info = (theme: ThemeDef): ThemeInfo => ({
    id: theme.id,
    name: theme.name,
    nameZh: theme.nameZh,
    desc: theme.desc,
    descZh: theme.descZh,
    tags: theme.tags,
  })
  return {
    list: () => THEMES.map(info),
    get: () => {
      const theme = activeTheme()
      return theme === null ? null : { id: theme.id, name: theme.name, nameZh: theme.nameZh }
    },
    set: (id: string) => {
      if (THEMES.some((theme) => theme.id === id)) applyTheme(id)
      else throw new Error(`unknown theme id: ${id}`)
    },
    reset: () => applyTheme(null),
    cycle: () => {
      const ids = THEMES.map((theme) => theme.id)
      const current = activeThemeId()
      const idx = current !== null ? ids.indexOf(current) : -1
      applyTheme(ids[(idx + 1) % ids.length])
    },
  }
}

/**
 * Read the shell's registry off the context.
 *
 * A service the bundle declares in its `inject` list (see `entry.ts`) is a
 * property on the context by the time `apply` runs — the same way `ui-layout`
 * reaches this one (`ctx.theme.getTheme()`) — so this is a plain read. It is
 * wrapped anyway, because a composition whose shell answers by throwing must
 * cost the theme center rather than the client entry.
 *
 * There is deliberately no `ctx.get`/`ctx.reflect` fallback here: an undeclared
 * read is exactly what took the whole entry down the first time this shipped
 * (`web boot: 1 entry did not activate`), and a declared service needs no
 * second route to itself.
 */
function readRegistry(ctx: ClientContext): HostThemeRuntimeLike | null {
  try {
    return ctx.theme ?? null
  } catch {
    return null
  }
}

/**
 * Mount-time half of the feature: the saved choice is restored, its colors are
 * stacked, and the API is published — all before the settings row is ever
 * opened, because the theme has to be in force the whole time.
 *
 * Disposal takes the layer and the attribute back. The preference is left where
 * the last `applyTheme` put it: it is the shell's own field, and the shell
 * resets it on its own if the value ever stops resolving.
 *
 * The `theme/change` handler carries one piece of judgement the registry cannot
 * make: whether the preference moving means *this plugin* moved it. It only ever
 * writes the half our theme declares, so a preference arriving with any other
 * value came from somewhere else — the shell's own appearance row, in practice —
 * and that is a user choosing to leave this theme. The row and the attribute
 * follow that choice instead of fighting it: the colors come off, the stored id
 * goes with them, and the shell's palette is left in charge.
 */
export function registerThemeCenter(ctx: ClientContext): void {
  ctx.effect(
    () => {
      const registry = readRegistry(ctx)
      if (registry === null || typeof registry.overrideTokens !== 'function') return () => {}
      const disposers: Array<() => void> = []
      /** Retract everything this mount stacked; safe to call twice. */
      const teardown = (): void => {
        for (const dispose of disposers.splice(0)) {
          try {
            dispose()
          } catch {
            // A registry tearing down its own layers has nothing to fix here.
          }
        }
        layerDispose?.()
        layerDispose = null
        aboveLayers.clear()
        runtime = null
        activeId = null
        listeners.clear()
        if (typeof document !== 'undefined' && document.body) {
          document.body.removeAttribute(THEME_ATTR)
        }
      }
      try {
        runtime = registry
        const off = ctx.on?.('theme/change', (next: HostThemeSnapshotLike) => {
          const current = activeTheme()
          if (current !== null && next.preference !== current.colorScheme) {
            // Someone else moved the preference off the half this theme pins:
            // the user's own appearance setting, choosing the shell's palette
            // back. Stand down rather than write it again on the next boot.
            applyTheme(null)
            return
          }
          syncAttr()
          notify()
        })
        if (typeof off === 'function') disposers.push(off)
        const saved = readSaved()
        if (saved !== null) applyTheme(saved)
        else refresh()
        const api = createThemeCenterApi()
        exposeApi(api)
        try {
          ctx.provide?.(SERVICE_NAME, api)
        } catch {
          // Cordis throws when the name is already registered. Going without the
          // service costs other plugins the handle; letting it throw costs the
          // whole client entry, so the publication is the thing that gives.
        }
      } catch {
        // Whatever the registry or the shell tripped over above costs the theme
        // center: retract the half that landed and leave this plugin's other
        // four features untouched.
        teardown()
      }
      return teardown
    },
    'smkit: theme-center/restore',
  )
}
