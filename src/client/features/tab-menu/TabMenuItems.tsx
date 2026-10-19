/**
 * The batch-close rows this plugin appends to the right sidebar's tab menu.
 *
 * `ui-dockkit` opens one menu per tab chip and gives it a single row — "close"
 * — plus one extension seat for content-level actions:
 * `sidebar.right.tab.menu.item` is a `list` slot whose contributions render
 * after that row, inside the same portalled card. So this is a slot entry, not
 * a decoration: the shell owns the menu, its dismissal, its keyboard and its
 * placement, and the feature only supplies rows.
 *
 * The rows answer what a busy strip makes obvious: the kit offers one tab at a
 * time, so a column full of unrelated tabs is a chore to clear. Each row closes
 * a set the strip itself defines — every other tab, the tabs to the left of the
 * one whose menu is open, the ones to its right, or all of them.
 *
 * ## Where the siblings come from
 *
 * The seat hands over the tab record and the dismiss callback, nothing more:
 * `ctx.sidebarRight` exposes operations, not a layout snapshot. The strip is
 * therefore read from the anchors the kit publishes on its own markup —
 * `[data-dockkit-strip-tabs]` for the strip, `[data-dockkit-tab]` per chip,
 * `[data-dockkit-tab-close]` per close control — the same attribute-anchor
 * route the explorer features take. Chips are counted within the strip that
 * holds the clicked chip, so a second pane's tabs stay untouched.
 *
 * A chip carries a close control exactly when the shell considers that tab
 * closable (`canCloseTab`), so the control's presence is the shell's own
 * answer to "may this one go?" — the batch rows never offer to close the guide
 * or another tab the kit is holding open.
 *
 * ## How a close lands
 *
 * The rows call `ctx.sidebarRight.close(tabId)`, the column's published
 * controller: it keeps focus on a surviving pane and ignores ids that are no
 * longer open, so closing a whole set needs no bookkeeping here. A host whose
 * column predates that controller still draws the chip's own ×, and pressing
 * it is the same gesture, so that is the fallback.
 */

import type { ClientContext, ClientDeps, Translator } from '../../platform/types'

/** The seat this feature fills, as declared by `ui-sidebar-right`. */
export const TAB_MENU_ITEM = 'sidebar.right.tab.menu.item'

/** The kit's own anchors: one strip, one chip per tab, one × per closable tab. */
const STRIP = '[data-dockkit-strip-tabs]'
const CHIP = '[data-dockkit-tab]'
const CLOSE = '[data-dockkit-tab-close]'

/** One chip in the clicked tab's strip: its id, and whether the kit drew a ×. */
interface Sibling {
  id: string
  closable: boolean
}

/** The seat's owner props, plus the copy this feature's locale supplies. */
interface TabMenuOwnerProps {
  /** The tab whose menu is open. */
  tab: { id: string }
  /** Close the menu; the seat expects a row to call this before it acts. */
  dismiss: () => void
  /** Copy bound to this feature's namespace by the slot framework. */
  t: Translator
}

/** One row this feature can offer for the strip as it stands. */
interface Row {
  id: string
  label: string
  run: () => void
}

/** The chip carrying `id`, searching the whole document: a menu is portalled. */
function chipOf(id: string): Element | null {
  for (const chip of Array.from(document.querySelectorAll(CHIP))) {
    if (chip.getAttribute('data-dockkit-tab') === id) return chip
  }
  return null
}

/**
 * The clicked tab's strip, in strip order.
 *
 * @param id - id of the tab whose menu is open.
 * @returns one entry per chip of that strip; empty when the chip is gone (a
 *   menu whose tab closed meanwhile, e.g. from another window's keystroke).
 */
function siblingsOf(id: string): Sibling[] {
  const chip = chipOf(id)
  const strip = chip?.closest(STRIP)
  if (strip === null || strip === undefined) return []
  return Array.from(strip.querySelectorAll(CHIP)).flatMap((sibling) => {
    const siblingId = sibling.getAttribute('data-dockkit-tab')
    if (siblingId === null || siblingId === '') return []
    return [{ id: siblingId, closable: sibling.querySelector(CLOSE) !== null }]
  })
}

/** The column's published closer, read through reflection (an optional host). */
function closerOf(ctx: ClientContext): ((id: string) => void) | undefined {
  try {
    const sidebar = ctx.reflect?.get('sidebarRight') as { close?: (id: string) => void } | undefined
    return typeof sidebar?.close === 'function' ? sidebar.close.bind(sidebar) : undefined
  } catch {
    // A reflection read that throws resolves nothing: the chip's own × is
    // still there, and it is the same gesture.
    return undefined
  }
}

/**
 * Build the component this feature registers for `sidebar.right.tab.menu.item`.
 *
 * @param deps - the runtime factories (`h` builds the rows).
 * @param ctx - the client context (reflection is how the column is reached).
 * @returns the slot component: the rows that apply to the open tab's strip.
 */
export function createTabMenuItems(
  deps: ClientDeps,
  ctx: ClientContext,
): (props: TabMenuOwnerProps) => JSX.Element[] | null {
  const { h } = deps

  return function TabMenuItems({ tab, dismiss, t }) {
    const siblings = siblingsOf(tab.id)
    const at = siblings.findIndex((sibling) => sibling.id === tab.id)
    if (at < 0) return null

    const closable = siblings.filter((sibling) => sibling.closable)
    const others = closable.filter((sibling) => sibling.id !== tab.id)
    const left = siblings.slice(0, at).filter((sibling) => sibling.closable)
    const right = siblings.slice(at + 1).filter((sibling) => sibling.closable)

    /** Close one set: dismiss first, so the card is gone before the chips are. */
    const close = (targets: readonly Sibling[]): void => {
      dismiss()
      const closeTab = closerOf(ctx)
      for (const target of targets) {
        if (closeTab !== undefined) {
          closeTab(target.id)
          continue
        }
        const button = chipOf(target.id)?.querySelector(CLOSE)
        const press = (button as { click?: () => void } | null)?.click
        if (typeof press === 'function') press.call(button)
      }
    }

    const rows: Row[] = []
    if (others.length > 0) {
      rows.push({ id: 'others', label: t('closeOthers'), run: () => { close(others) } })
    }
    if (left.length > 0) {
      rows.push({ id: 'left', label: t('closeLeft'), run: () => { close(left) } })
    }
    if (right.length > 0) {
      rows.push({ id: 'right', label: t('closeRight'), run: () => { close(right) } })
    }
    // "Close all" earns its row only when it says something the others do not:
    // the open tab can close, and some other tab can go with it. Otherwise it
    // would repeat "close" (a lone closable tab) or "close others" (a tab the
    // kit holds open with others around it).
    if (siblings[at].closable && others.length > 0) {
      rows.push({ id: 'all', label: t('closeAll'), run: () => { close(closable) } })
    }
    if (rows.length === 0) return null

    const items: JSX.Element[] = []
    // The kit's "close" row precedes these. A tab it cannot close has no such
    // row, and a hairline above the first row would then lead the menu.
    if (siblings[at].closable) {
      items.push(<div key="smkit-tab-menu-separator" className="smkit-tab-menu-separator" role="separator" />)
    }
    for (const row of rows) {
      items.push(
        <button
          key={row.id}
          type="button"
          role="menuitem"
          className="smkit-tab-menu-item"
          onClick={() => { row.run() }}
        >
          {row.label}
        </button>,
      )
    }
    return items
  }
}
