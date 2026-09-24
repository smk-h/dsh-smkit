/**
 * What applying a theme of the center is: one body attribute and one
 * stylesheet swap.
 *
 * Every theme's rules are scoped on `body[data-dsh-theme="<id>"]` (its dark
 * variant on the same scope plus the shell's own `data-ds-dark-theme`), so
 * the applier's job is to keep exactly the chosen theme's attribute on the
 * body and its CSS in a dedicated `<style>` element — swapped by
 * `id="dsh-theme-active-style"`, reused across hot re-applies so a reload
 * can never stack copies. The element stays apart from every feature's own
 * stylesheets: no theme change, however violent, can wipe the settings
 * chrome that paints itself.
 *
 * The choice and the display mode persist under the `dsh-theme:` storage
 * keys, taking over the older `dsh-theme-pack:` keys once on first read and
 * deleting them. The mode is the row's own day/night override: light and
 * dark drive the shell's dark attribute directly, `system` leaves it to the
 * built-in appearance setting — which is also why restoring writes the
 * attribute only for the two explicit modes.
 *
 * The whole state lives at module level behind a tiny pub/sub, because the
 * API is meant to outlive the settings row: `window.dshTheme` and the
 * `dshTheme` service drive the same state the cards paint, and a programmatic
 * switch moves the cards' selection ring with it.
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

/** The programmatic face of the center, published on `window.dshTheme`. */
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

const THEME_ATTR = 'data-dsh-theme'
const DARK_ATTR = 'data-ds-dark-theme'
const LS_THEME = 'dsh-theme:theme'
const LS_MODE = 'dsh-theme:mode'
const LS_LEGACY_THEME = 'dsh-theme-pack:theme'
const LS_LEGACY_MODE = 'dsh-theme-pack:mode'
const ACTIVE_STYLE_ID = 'dsh-theme-active-style'

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

/** The persisted choice, with the older keys migrated forward on read. */
function getSaved(): { theme: string | null; mode: string | null } {
  try {
    const theme = localStorage.getItem(LS_THEME) ?? localStorage.getItem(LS_LEGACY_THEME)
    const m = localStorage.getItem(LS_MODE) ?? localStorage.getItem(LS_LEGACY_MODE)
    if (localStorage.getItem(LS_LEGACY_THEME) !== null && localStorage.getItem(LS_THEME) === null && theme) {
      localStorage.setItem(LS_THEME, theme)
    }
    if (localStorage.getItem(LS_LEGACY_MODE) !== null && localStorage.getItem(LS_MODE) === null && m) {
      localStorage.setItem(LS_MODE, m)
    }
    localStorage.removeItem(LS_LEGACY_THEME)
    localStorage.removeItem(LS_LEGACY_MODE)
    return { theme, mode: m }
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

/** The `window.dshTheme` surface, typed onto the window only where it is set. */
function exposeApi(api: ThemeCenterApi): void {
  const target = window as unknown as { dshTheme: ThemeCenterApi; dshThemeCenter: ThemeCenterApi }
  target.dshTheme = api
  // The feature's own name as a second handle; both drive the same state.
  target.dshThemeCenter = api
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
      ctx.provide?.('dshTheme', api)
      return () => {
        themeStyleEl?.remove()
        themeStyleEl = null
        listeners.clear()
      }
    },
    'dsh-mcp-manager: theme-center/restore',
  )
}
