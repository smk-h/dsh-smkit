/**
 * The fold-everything control on `dsh-better-sidebar`'s file window.
 *
 * That plugin owns the `files` page whenever it is loaded, and the shell's own
 * seat (`sidebar.right.tab.files.actions`) goes with the native tree: its tab
 * body is not mounted at all. Its file window does have a toolbar of its own —
 * the search box, reload, row order, upload — and no fold-everything control,
 * so this decorates that row the way the `@` chip decorates the shell's rows:
 * by finding it in the rendered document and adding one button, never by
 * taking the surface over.
 *
 * ## How the row is found
 *
 * The neighbour builds its toolbar from a CSS module, so its class names carry
 * a per-build hash (`nArs4W_editorSearchInput`); only the name at the end of
 * that hash is stable. The search box is therefore matched on the suffix —
 * `input[class*="editorSearchInput"]` — and the button goes immediately after
 * it, ahead of the view controls it belongs with. Nothing else in that panel is
 * named: an added button is keyed by this plugin's own marker, so a re-scan can
 * tell its own work from the neighbour's.
 *
 * ## When it re-scans
 *
 * The neighbour's window mounts, unmounts and re-renders on its own schedule
 * (a tab switch, a session switch, a re-open), and a React render can drop a
 * node this plugin inserted beside its own. One document observer catches the
 * arrivals that can matter — anything inside the right column, or inside the
 * neighbour's own host — and coalesces them into one scan per frame, the same
 * shape the `@` chip's watcher uses. Conversation streaming never enters the
 * loop: those mutations are outside both boxes and are skipped by one `closest`
 * check per added element.
 *
 * The control stands down when the neighbour does: its button lives inside the
 * neighbour's row, so an unloaded neighbour takes it away with it, and a scan
 * while that service is absent removes anything a survivor left behind.
 */

import { betterSidebarOwnsSurfaces } from '../../platform/neighbour'
import { iconSvg, type IconSpec } from '../../platform/icons/Icon'
import { COLLAPSE_ALL_ICON } from '../../platform/icons/CollapseAllIcon'
import { collapseNeighbourTree } from './collapse'
import type { ClientContext, Translator } from '../../platform/types'

/**
 * The neighbour's search box: the one anchor its toolbar publishes. The hash in
 * front of the name changes per build, so only the suffix is matched.
 */
const SEARCH_INPUT = 'input[class*="editorSearchInput"]'
/** The right column's session owner: every panel inside it hangs off this. */
const SIDEBAR = '[data-sidebar-right-session]'
/** The neighbour's own mount host, for the surfaces it docks outside the column. */
const NEIGHBOUR_HOST = '[data-dsh-better-sidebar]'
/** This plugin's marker on an injected button. */
const ATTACHED = 'data-smkit-collapse-all'
/** The button's classes (see `style/button.css`). */
const BUTTON_CLASS = 'smkit-collapse-button'
const NEIGHBOUR_CLASS = 'smkit-collapse-button-neighbour'

/** The glyph, built once per mount and cloned per button. */
function glyph(): SVGSVGElement {
  return iconSvg(COLLAPSE_ALL_ICON as IconSpec)
}

/** One button, wired to the tree panel it was inserted into. */
function createButton(label: string, row: Element): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `${BUTTON_CLASS} ${NEIGHBOUR_CLASS}`
  button.setAttribute(ATTACHED, '')
  button.setAttribute('aria-label', label)
  button.title = label
  button.appendChild(glyph())
  // The panel is the row's own parent: the button acts on the tree it sits
  // above, so two panes open at once stay independent.
  button.addEventListener('click', () => {
    collapseNeighbourTree(row.parentElement)
  })
  return button
}

/** Keep one existing button's copy in step with the active locale. */
function refreshLabel(button: Element, label: string): void {
  if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label)
  if (button.getAttribute('title') !== label) button.setAttribute('title', label)
}

/**
 * Watch for the neighbour's file windows and hang the control on each toolbar.
 *
 * @param ctx - the client context (the neighbour probe is a reflection read).
 * @param t - the copy lookup bound to this feature's namespace.
 * @returns the effect's disposer, which removes every button it added.
 */
export function watchNeighbourToolbars(ctx: ClientContext, t: Translator): () => void {
  // `document`/`MutationObserver` are absent outside a browser (the hook test
  // harness runs the bundle in a bare context) — the guard the platform
  // watchers carry.
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const root = document.documentElement
  if (root === null || root === undefined) return () => {}

  /** Whether a scan is already queued for the next frame. */
  let scheduled = false
  /** The frame (or timeout) a queued scan rides. */
  let frame: number | null = null

  /** Take back every button this mount added (a stand-down, or teardown). */
  const removeButtons = (): void => {
    for (const button of Array.from(document.querySelectorAll(`[${ATTACHED}]`))) button.remove()
  }

  /** Put a button beside every search box that has none, and refresh the rest. */
  const scan = (): void => {
    scheduled = false
    frame = null
    if (!betterSidebarOwnsSurfaces(ctx)) {
      removeButtons()
      return
    }
    const label = t('collapseAll')
    for (const input of Array.from(document.querySelectorAll(SEARCH_INPUT))) {
      const row = input.parentElement
      if (row === null) continue
      const existing = row.querySelector(`:scope > [${ATTACHED}]`)
      if (existing !== null) {
        refreshLabel(existing, label)
        continue
      }
      const button = createButton(label, row)
      // Immediately after the search box: the neighbour's view controls
      // (reload, row order, upload) keep their order, and the fold sits with
      // them rather than at the far end of the row.
      row.insertBefore(button, input.nextElementSibling)
    }
  }

  /** Queue one scan for the next frame (coalesced: a panel arrives in batches). */
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(scan)
    else frame = setTimeout(scan, 0) as unknown as number
  }

  /**
   * The document observer answers one question: did something arrive or leave
   * where a file window can be? Conversation streaming is skipped by the same
   * two `closest` checks the `@` chip's watcher makes.
   */
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type !== 'childList') continue
      const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)]
      for (const node of nodes) {
        if (!(node instanceof Element)) continue
        if (node.closest(SIDEBAR) !== null || node.closest(NEIGHBOUR_HOST) !== null) {
          schedule()
          return
        }
      }
    }
  })
  observer.observe(root, { childList: true, subtree: true })
  scan()

  return () => {
    observer.disconnect()
    if (frame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      else clearTimeout(frame)
    }
    removeButtons()
  }
}
