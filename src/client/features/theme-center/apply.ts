/**
 * What applying a theme of the center is: one body attribute and one
 * stylesheet swap.
 *
 * Every theme's rules are scoped on `body[data-smkit-theme="<id>"]` (its dark
 * variant on the same scope plus the shell's own `data-ds-dark-theme`), so
 * the applier's job is to keep exactly the chosen theme's attribute on the
 * body and its CSS in a dedicated `<style>` element — swapped by
 * `id="smkit-theme-active-style"`, reused across hot re-applies so a reload
 * can never stack copies. The element stays apart from every feature's own
 * stylesheets: no theme change, however violent, can wipe the settings
 * chrome that paints itself.
 *
 * The choice and the display mode persist under the plugin's own `smkit:`
 * prefix — the same namespace the skins used and the one the local-cache tab
 * promises to leave alone — taking over the keys of every earlier revision
 * once on first read: `smkit:skin` from the retired skin feature, whose values
 * are this center's ids. The mode is the row's own day/night
 * override: light and dark drive the shell's dark attribute directly, `system`
 * leaves it to the built-in appearance setting — which is also why restoring
 * writes the attribute only for the two explicit modes.
 *
 * Nothing outside `smkit:` is ever removed, and every name a coexisting
 * `dsh-theme` install still uses is out of reach — see `LS_LEGACY_*` and
 * `LEGACY_STYLE_ID` for the two places that used to reach in.
 *
 * The whole state lives at module level behind a tiny pub/sub, because the
 * API is meant to outlive the settings row: `window.smkitTheme` and the
 * `smkitTheme` service drive the same state the cards paint, and a
 * programmatic switch moves the cards' selection ring with it.
 *
 * Both used to be called `dshTheme`, which is `dsh-theme`'s own name — that
 * plugin calls `ctx.provide('dshTheme', …)` too, and Cordis throws on a second
 * registration of one service name, taking the whole client entry down with it.
 * Publishing under our own name is what lets the two coexist; the service call
 * is additionally wrapped, because a future collision should cost the
 * publication, not the entry.
 */

import { THEMES, type ThemeDef } from './themes.data'
import type { ClientContext } from '../../platform/types'

/** The row's day/night choice; `system` defers to the shell's own setting. */
export type ThemeMode = 'system' | 'light' | 'dark'

/** One theme as the API reports it: the metadata, without the stylesheet. */
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
  /** The applied theme, or null under the shell's default look. */
  get(): { id: string; name: string; nameZh: string } | null
  /** Apply one theme by id; an id the center does not ship throws. */
  set(id: string): void
  /** Back to the shell's default look. */
  reset(): void
  /** Advance to the next theme, wrapping. */
  cycle(): void
  /** Drive the day/night override: light and dark set the shell's own
   * display attribute, system hands it back. */
  setMode(next: ThemeMode): void
  /** The current day/night override. */
  getMode(): ThemeMode
}

/**
 * The body attribute that scopes every theme's rules, exported because three
 * other places have to name it and must not disagree about it: this module's
 * own `setAttribute`, the two `MutationObserver`s that watch for a theme swap
 * (`ThemeCenterRow`, `PalettePanel`), and the data build that rewrites each
 * ported stylesheet onto this attribute (`scripts/build-theme-data.mjs`).
 *
 * It used to be `data-dsh-theme`, inherited from the days when themes were a
 * separate plugin — and shared with it, down to this very attribute.
 */
export const THEME_ATTR = 'data-smkit-theme'
/** The shell's own day/night flag — not ours, so it keeps the host's name. */
export const DARK_ATTR = 'data-ds-dark-theme'
const LS_THEME = 'smkit:theme'
const LS_MODE = 'smkit:theme-mode'
/**
 * The keys the choice and the mode used to live under, newest first. A browser
 * that upgrades with a skin or a theme selected must land on the same look, so
 * every predecessor is read forward into the live key.
 *
 * `smkit:skin` is the retired skin feature's key — its values were this
 * center's ids, which is what the merge of the two features turned on.
 * `dsh-theme-pack:` is the name this lineage carried before the center
 * existed; `dsh-theme` migrates from the very same pair, so it is read and
 * left in place rather than deleted — a coexisting install keeps its own
 * upgrade path.
 *
 * The `dsh-theme:` pair is deliberately **not** on the list. It looks like one
 * more earlier name of ours, but `dsh-theme` declares it as its *live* keys
 * (`LS_THEME` / `LS_MODE`, `src/client.template.js:46`), so reading them away
 * cleared the saved theme and mode of a coexisting install on every boot.
 */
const LS_LEGACY_THEME = ['smkit:skin', 'dsh-theme-pack:theme']
const LS_LEGACY_MODE = ['dsh-theme-pack:mode']
/** The one prefix a predecessor may be deleted under. */
const LS_OWN = 'smkit:'
const ACTIVE_STYLE_ID = 'smkit-theme-active-style'
/**
 * The `<style>` id this feature used before the rename — and the id `dsh-theme`
 * still uses (`src/client.template.js:231`), which is why sharing it was never
 * safe: both plugins looked it up, reused whatever they found and wrote their
 * own sheet into it, so whichever activated last owned the element. It is only
 * read now, and only to retire an element that is demonstrably ours.
 */
const LEGACY_STYLE_ID = 'dsh-theme-active-style'

/** The element the applied theme's CSS rides in; null when no document (tests). */
let themeStyleEl: HTMLStyleElement | null = null
let active: ThemeDef | null = null
let mode: ThemeMode = 'system'
const listeners = new Set<() => void>()

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

/** The applied theme's id, or null when none is on. */
export function activeThemeId(): string | null {
  return active !== null ? active.id : null
}

/** The row's day/night override. */
export function currentMode(): ThemeMode {
  return mode
}

/**
 * One live key's value, carried forward from its predecessors on the first read
 * that finds it empty. The first predecessor to carry a value wins; the rest
 * are only read. Only a predecessor under this plugin's own prefix is cleared:
 * a browser that already carries the live key still gets its own old key
 * retired, so the migration happens exactly once — while a key another plugin
 * also migrates from survives for it to find. A denied storage throws out to
 * `getSaved`, which is the same session-unthemed outcome a private-mode browser
 * got before.
 */
function readForward(live: string, legacy: readonly string[]): string | null {
  const current = localStorage.getItem(live)
  let carried: string | null = current
  for (const key of legacy) {
    const value = localStorage.getItem(key)
    if (carried === null && value !== null) {
      carried = value
      localStorage.setItem(live, value)
    }
    if (key.startsWith(LS_OWN)) localStorage.removeItem(key)
  }
  return carried
}

/** The persisted choice, with the older keys migrated forward on read. */
function getSaved(): { theme: string | null; mode: string | null } {
  try {
    return {
      theme: readForward(LS_THEME, LS_LEGACY_THEME),
      mode: readForward(LS_MODE, LS_LEGACY_MODE),
    }
  } catch {
    // A private-mode browser throws on any access; a theme that cannot
    // persist should still apply for the session.
    return { theme: null, mode: null }
  }
}

/** Apply one theme by id, or take every theme off with null. Unknown ids
 * clear rather than throw: this is the path the persisted value walks back
 * in, and a stale stored id must not strand the body in a half state. */
export function applyTheme(id: string | null): void {
  active = id !== null ? THEMES.find((theme) => theme.id === id) ?? null : null
  if (typeof document !== 'undefined') {
    if (active !== null) {
      document.body.setAttribute(THEME_ATTR, active.id)
      if (themeStyleEl !== null) themeStyleEl.textContent = active.css
      try {
        localStorage.setItem(LS_THEME, active.id)
      } catch {
        // Private-mode browsers throw; the session keeps the paint.
      }
    } else {
      document.body.removeAttribute(THEME_ATTR)
      if (themeStyleEl !== null) themeStyleEl.textContent = ''
      try {
        localStorage.removeItem(LS_THEME)
      } catch {
        // Same: the session's clear stands.
      }
    }
  }
  notify()
}

/** Set the day/night override; `system` writes no attribute of its own. */
export function applyMode(next: string | null): void {
  mode = next === 'light' || next === 'dark' ? next : 'system'
  if (typeof document !== 'undefined') {
    if (mode === 'light') document.body.removeAttribute(DARK_ATTR)
    else if (mode === 'dark') document.body.setAttribute(DARK_ATTR, '')
    // system: leave the attribute to the built-in appearance setting.
  }
  try {
    if (mode === 'system') localStorage.removeItem(LS_MODE)
    else localStorage.setItem(LS_MODE, mode)
  } catch {
    // Private-mode browsers throw; the session's mode stands.
  }
  notify()
}

/**
 * Name the API publishes itself under — both as a Cordis service and as the
 * `window` handle. It is the plugin's own name, not `dsh-theme`'s.
 */
const SERVICE_NAME = 'smkitTheme'

/**
 * The `window.smkitTheme` surface, typed onto the window only where it is
 * set. The handle is the plugin's own name: `window.dshTheme` belongs to
 * `dsh-theme`, and writing it here would silently replace that plugin's object.
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

/** The programmatic API, over the same module state the cards drive. */
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
    get: () => (active !== null ? { id: active.id, name: active.name, nameZh: active.nameZh } : null),
    set: (id: string) => {
      if (THEMES.some((theme) => theme.id === id)) applyTheme(id)
      else throw new Error(`unknown theme id: ${id}`)
    },
    reset: () => applyTheme(null),
    cycle: () => {
      const ids = THEMES.map((theme) => theme.id)
      const idx = active !== null ? ids.indexOf(active.id) : -1
      applyTheme(ids[(idx + 1) % ids.length])
    },
    setMode: (next: ThemeMode) => applyMode(next),
    getMode: () => mode,
  }
}

/**
 * Mount-time half of the feature: the swap element goes in, the saved mode
 * and theme are restored, and the API is published — all before the settings
 * row is ever opened, because the theme has to be on the body the whole time.
 * Disposal takes the swap element and the listeners back; what the theme
 * painted on the body goes with it, the same contract every other one-off
 * side effect of this plugin keeps.
 */
export function registerThemeCenter(ctx: ClientContext): void {
  ctx.effect(
    () => {
      // A test harness's partial `document` has no element lookup; the swap
      // element is the first thing this path touches, and every real browser
      // has it. Every effect answers with a disposer, so the bail-out does too.
      if (typeof document === 'undefined' || typeof document.getElementById !== 'function') {
        return () => {}
      }
      // Retire the swap element earlier revisions wrote into, so an upgrade
      // does not leave a second copy of the same sheet behind. Only ours goes:
      // the id is shared with `dsh-theme`, and the disposer below removes
      // whatever it finds by id — deleting the host of another plugin's rules
      // would be the same reach-in this rename exists to undo.
      const legacy = document.getElementById(LEGACY_STYLE_ID)
      if (legacy !== null && (legacy.textContent ?? '').includes(THEME_ATTR)) legacy.remove()
      // Reuse an existing swap element so a hot re-apply never stacks copies.
      themeStyleEl = document.getElementById(ACTIVE_STYLE_ID) as HTMLStyleElement | null
      if (themeStyleEl === null) {
        const style = document.createElement('style')
        style.id = ACTIVE_STYLE_ID
        document.head.appendChild(style)
        themeStyleEl = style
      }
      const saved = getSaved()
      applyMode(saved.mode)
      applyTheme(saved.theme)
      const api = createThemeCenterApi()
      exposeApi(api)
      try {
        ctx.provide?.(SERVICE_NAME, api)
      } catch {
        // Cordis throws when the name is already registered. Going without the
        // service costs other plugins the handle; letting it throw costs the
        // whole client entry, so the publication is the thing that gives.
      }
      return () => {
        themeStyleEl?.remove()
        themeStyleEl = null
        listeners.clear()
      }
    },
    'smkit: theme-center/restore',
  )
}
