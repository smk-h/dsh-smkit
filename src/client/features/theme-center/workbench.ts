/**
 * The workbench board: the opt-in card skin over the shell's frame.
 *
 * A theme repaints the host's *tokens* from one stylesheet; this is the other
 * axis of the same idea — a skin over the host's *skeleton*. The web shell's
 * frame is a three-column grid (`@deepseek-ai/dsh-client-ui-layout`), and the
 * rules in `style/workbench.css`, scoped on the body attribute this module
 * writes, turn those columns into separated rounded boards the way the modern
 * VS Code window separates its panes.
 *
 * The switch is one body attribute and nothing else, exactly like a theme's:
 * `data-smkit-workbench="card"` makes the sheet's selectors match, and removing
 * it leaves the host's own layout untouched — which is what makes "off" restore
 * the original look rather than paint a second set of overrides.
 *
 * The choice persists under the plugin's own `smkit:` prefix
 * (`smkit:workbench`), beside the theme and the display mode. A browser that
 * cannot store it still gets the session's paint, the same trade `apply.ts`
 * makes for its two keys.
 *
 * The sheet itself is authored against the host's *data* anchors rather than
 * its class names — see its own docblock for which two and why — so nothing in
 * this module has to know the frame's DOM. It writes one attribute, reads one
 * storage key, and publishes the pair through a tiny pub/sub for the settings
 * row to render: the row holds no state of its own over either.
 */

import type { ClientContext } from '../../platform/types'

/** The board the skin draws. `card` is the only one shipped; the attribute
 * value is spelled rather than assembled because a browser reads it. */
export type WorkbenchBoard = 'card'

/** The body attribute the workbench stylesheet is scoped on. */
export const WORKBENCH_ATTR = 'data-smkit-workbench'

/** Where the choice lives, under this plugin's own prefix — the same namespace
 * the theme choice uses, and the one the local-cache tab promises to leave
 * alone. */
const LS_WORKBENCH = 'smkit:workbench'

let board: WorkbenchBoard | null = null
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
export function subscribeWorkbench(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The board in force, or null under the host's own layout. */
export function currentBoard(): WorkbenchBoard | null {
  return board
}

/** Whether the card skin is on, as the settings row's checkbox reads it. */
export function cardBoardOn(): boolean {
  return board === 'card'
}

/**
 * The body the skin writes its one attribute to, or null where the document
 * is not a browser's — a test harness's partial `document`, or one with no
 * body yet. Both writes are asked about rather than only `setAttribute`,
 * because a stub that carries one may lack the other, and a switch that threw
 * on mount would cost the whole client entry rather than one attribute.
 */
function attrHost(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const body = document.body
  if (!body || typeof body.setAttribute !== 'function' || typeof body.removeAttribute !== 'function') {
    return null
  }
  return body
}

/** Apply one board, or take the skin off with null — an unknown value clears
 * rather than throws, the same path `applyTheme` takes for a stale stored id. */
export function applyBoard(next: string | null): void {
  board = next === 'card' ? 'card' : null
  const body = attrHost()
  if (body !== null) {
    if (board !== null) body.setAttribute(WORKBENCH_ATTR, board)
    else body.removeAttribute(WORKBENCH_ATTR)
  }
  try {
    if (board === null) localStorage.removeItem(LS_WORKBENCH)
    else localStorage.setItem(LS_WORKBENCH, board)
  } catch {
    // Private-mode browsers throw; the session keeps the paint.
  }
  notify()
}

/** The persisted choice, or null when nothing is stored. A denied storage
 * answers null, which is the same unskinned session a private-mode browser got
 * before the key existed. */
function getSaved(): string | null {
  try {
    return localStorage.getItem(LS_WORKBENCH)
  } catch {
    return null
  }
}

/**
 * Mount-time half of the feature: the saved board goes on the body before the
 * settings row is ever opened — the skin has to be up the whole time, not only
 * while someone is looking at the switch that turns it on. Disposal takes the
 * attribute back and drops the listeners; the stored choice stays, exactly as
 * the theme restore leaves its own two keys alone.
 */
export function registerWorkbench(ctx: ClientContext): void {
  ctx.effect(
    () => {
      applyBoard(getSaved())
      return () => {
        listeners.clear()
        attrHost()?.removeAttribute(WORKBENCH_ATTR)
      }
    },
    'smkit: theme-center/workbench',
  )
}
