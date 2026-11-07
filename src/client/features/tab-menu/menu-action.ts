/**
 * "Close all to the left" as one native row of the tab menu.
 *
 * The menu belongs to `ui-context-menu`. The right column registers the rows it
 * owns there — "close", "close others", "close right" — and the shell renders
 * every row as the same menu entry: same glyph column, type scale, padding,
 * shortcut slot. A plugin that wants a row of its own therefore contributes an
 * action, never markup; this feature contributes exactly one, which is why it
 * needs no DOM capture and no stylesheet.
 *
 * ## Why this row
 *
 * The shell closes the tab at hand, the others, and the ones to its right.
 * Clearing everything to the *left* is the gesture a reader makes after opening
 * a new file at the far right of a busy strip, and it is the one the shell does
 * not offer.
 *
 * ## Where the siblings come from
 *
 * The target carries the session, the pane and the tab record. The column's
 * controller answers `menuTabs(session, pane, tab)` with the closable ids of
 * that pane — `all` (everything but the clicked tab) and `right` — so the left
 * set is `all` minus `right`, computed without touching the DOM. A host whose
 * controller predates that read falls back to the strip anchors the kit
 * publishes (`[data-dockkit-strip-tabs]`, `[data-dockkit-tab]`,
 * `[data-dockkit-tab-close]`), the route this feature used while the menu was
 * still the kit's own.
 *
 * ## How a close lands
 *
 * `controller.closeIn(session, id)` keeps focus on a surviving pane and ignores
 * ids that are no longer open, so closing a whole set needs no bookkeeping
 * here. A host without it presses the chip's own ×, which is the same gesture.
 */

import type {
  ClientContext,
  ContextMenusLike,
  TabMenuAction,
  TabMenuTarget,
  Translator,
} from '../../platform/types'

/** The action id, unique within the `tab` target family. */
export const TAB_MENU_ACTION_ID = 'smkit.close-left'

/** The glyph key this action asks the `contextMenu.icon` seat to render. */
export const TAB_MENU_ICON_KEY = 'smkit.close-left'

/** After the shell's own rows (the right column registers at order 100). */
export const TAB_MENU_ORDER = 110

/** The kit's own anchors, read only by the DOM fallback. */
const STRIP = '[data-dockkit-strip-tabs]'
const CHIP = '[data-dockkit-tab]'
const CLOSE = '[data-dockkit-tab-close]'

/** The slice of the column's controller this action reads and drives. */
interface SidebarRightLike {
  /**
   * Closable ids of the clicked pane, in display order.
   * @returns `all` minus the clicked tab, the subset to its right, and whether
   *   the clicked tab itself can close.
   */
  menuTabs?(
    sessionId: string,
    paneId: string,
    tabId: string,
  ): { all: readonly string[]; right: readonly string[]; close: boolean }
  /** Close one tab of a session through the column's own controller. */
  closeIn?(sessionId: string, id: string): void
  /** Older controller: close by id, session implied. */
  close?(id: string): void
}

/** The shell's menu service, read through reflection (an optional host). */
export function contextMenusOf(ctx: ClientContext): ContextMenusLike | undefined {
  try {
    const menus = ctx.reflect?.get('contextMenus') as ContextMenusLike | undefined
    return typeof menus?.register === 'function' ? menus : undefined
  } catch {
    // A reflection read that throws resolves nothing: the feature stands down
    // and the menu keeps the rows the shell itself provides.
    return undefined
  }
}

/** The column's controller, read through reflection (an optional host). */
function sidebarOf(ctx: ClientContext): SidebarRightLike | undefined {
  try {
    const sidebar = ctx.reflect?.get('sidebarRight') as SidebarRightLike | undefined
    return sidebar ?? undefined
  } catch {
    return undefined
  }
}

/** The chip carrying `id`, searching the whole document: a menu is portalled. */
function chipOf(id: string): Element | null {
  for (const chip of Array.from(document.querySelectorAll(CHIP))) {
    if (chip.getAttribute('data-dockkit-tab') === id) return chip
  }
  return null
}

/**
 * The closable tabs left of `id`, read off the strip's own anchors.
 *
 * The fallback for a controller without `menuTabs`: the × on a chip is the
 * shell's answer to "may this one go?", so its absence keeps the guide and any
 * other held tab out of the set.
 *
 * @param id - id of the tab whose menu is open.
 * @returns ids in strip order; empty when the chip has left the strip.
 */
function leftFromDom(id: string): string[] {
  const chip = chipOf(id)
  const strip = chip?.closest(STRIP)
  if (strip === null || strip === undefined) return []
  const chips = Array.from(strip.querySelectorAll(CHIP))
  const at = chips.findIndex((sibling) => sibling.getAttribute('data-dockkit-tab') === id)
  if (at < 0) return []
  return chips.slice(0, at).flatMap((sibling) => {
    const siblingId = sibling.getAttribute('data-dockkit-tab')
    if (siblingId === null || siblingId === '' || sibling.querySelector(CLOSE) === null) return []
    return [siblingId]
  })
}

/** Close one set: the session-aware controller first, the chip's × last. */
function closeLeft(sidebar: SidebarRightLike | undefined, sessionId: string, ids: readonly string[]): void {
  for (const id of ids) {
    if (typeof sidebar?.closeIn === 'function') {
      sidebar.closeIn(sessionId, id)
      continue
    }
    if (typeof sidebar?.close === 'function') {
      sidebar.close(id)
      continue
    }
    const button = chipOf(id)?.querySelector(CLOSE)
    const press = (button as { click?: () => void } | null)?.click
    if (typeof press === 'function') press.call(button)
  }
}

/**
 * Build the resolver this feature registers for the `tab` menu target.
 *
 * @param ctx - the client context (reflection is how the column is reached).
 * @param t - the feature's own copy.
 * @returns the resolver: the action when something to the left can close,
 *   otherwise none, which is how the shell's row list stays as it was.
 */
export function closeLeftAction(
  ctx: ClientContext,
  t: Translator,
): (target: TabMenuTarget) => TabMenuAction[] {
  return (target) => {
    const sidebar = sidebarOf(ctx)
    const tabs = sidebar?.menuTabs?.(target.sessionId, target.paneId, target.tab.id)
    // `all` already excludes the clicked tab; `right` is its right-hand subset,
    // so what remains is exactly the closable tabs to its left.
    const left = tabs === undefined
      ? leftFromDom(target.tab.id)
      : tabs.all.filter((id) => !tabs.right.includes(id))
    if (left.length === 0) return []
    return [{
      id: TAB_MENU_ACTION_ID,
      label: t('closeLeft'),
      icon: { key: TAB_MENU_ICON_KEY },
      run: () => { closeLeft(sidebar, target.sessionId, left) },
    }]
  }
}
