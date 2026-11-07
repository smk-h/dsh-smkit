/**
 * The fallback right-click menu this plugin draws on the shell's file tree.
 *
 * The shell's shared menu is where these rows belong, and `native.ts` is where
 * they are contributed on a host that has it (0.2.x). This file is the other
 * door: a host whose file tree never opens that menu — every shell before the
 * service existed — still gets the same rows, drawn with the host's own `Menu`
 * component so the card, hover fill, row height, icon slot, keyboard walk and
 * viewport flipping stay the host's.
 *
 * ## Only one door is ever open
 *
 * The host claims the gesture before this listener sees it: the tree's row
 * spreads `getTriggerProps`, whose handler calls `preventDefault()` when the
 * shared menu is about to open. So the listener runs at the bubble phase, after
 * the shell's own handlers, and stands down on `defaultPrevented`. On a host
 * without the service nothing claims it, `defaultPrevented` is false, and this
 * menu opens exactly as it always did.
 *
 * ## What the drawn menu offers
 *
 * - right-clicking a row opens one menu at the cursor, portalled so the tree's
 *   overflow clip cannot crop it;
 * - a DIRECTORY row leads with "new folder" and "new file";
 * - the tree's ROOT is a directory with no row of its own, so the header row
 *   above the listing and the blank space under it answer for it — with the two
 *   creating rows only, because the root has no path of its own to copy, no
 *   sibling to be renamed beside, and no parent to be deleted out of;
 * - the two copy rows are "copy relative path" and "copy absolute path", each
 *   with the same copy glyph, and every row carries them;
 * - a successful write replaces the row's trailing `@` chip with a "copied"
 *   label for 1.2 s; a refused write shows nothing at all;
 * - the menu closes on selection, outside press and Escape;
 * - while it is open the row it was opened on keeps the shell's hover fill:
 *   the card is portalled away from that row, so the pointer leaving it would
 *   otherwise drop the highlight (see `style/menu-row.css`).
 *
 * What a row does is not here: both doors hand their choice to the dispatcher
 * in `actions.ts`, so the two cannot drift apart.
 */

import type { ClientContext, ClientDeps, Translator } from '../../platform/types'
import { betterSidebarOwnsSurfaces } from '../../platform/neighbour'
import { iconElement } from '../../platform/icons/Icon'
import { CONVERSATION_ICON } from '../../platform/icons/ConversationIcon'
import { COPY_ICON } from '../../platform/icons/CopyIcon'
import { DELETE_ICON } from './icons/DeleteIcon'
import { NEW_FILE_ICON } from './icons/NewFileIcon'
import { PLUS_ICON } from './icons/PlusIcon'
import { RENAME_ICON } from './icons/RenameIcon'
import { EXPLORER_ROWS, type ExplorerActions, type RowKind } from './actions'
import { loadRuntime, type ElementFactory } from './runtime'

/** One tree row, and the tree's root anchor (which carries the cwd). */
const ROW = 'li[data-files-entry]'
const TREE = '[data-files-state="tree"]'
/** The listing's scroll body — the level sits directly inside it. */
const BODY = '[data-files-body]'

/**
 * The row the open menu belongs to. The shell paints `row:hover` on the row's
 * button, so the fill drops out the moment the pointer leaves the row for the
 * portalled menu card; this marker lets `style/menu-row.css` re-apply the same
 * token for as long as the menu is up.
 */
const TARGET = 'data-smkit-explorer-target'

/** One open menu: the row it belongs to, where it opened, and its paths. */
interface MenuTarget {
  row: Element
  /** The row's absolute path, exactly as the tree published it. */
  path: string
  /** The tree's root, for the relative projection ('' when the host hides it). */
  root: string
  /** The row's own kind — the creating rows belong to directories only. */
  kind: RowKind
  x: number
  y: number
}

/**
 * Watch the shell's file tree for right-clicks the host did not claim.
 *
 * @param ctx - the client context (the neighbour probe goes through reflection).
 * @param deps - the client deps; only `h` is used (to build the menu's elements).
 * @param t - the copy lookup bound to this feature's namespace.
 * @param actions - the dispatcher the chosen row is handed to.
 * @returns the effect's disposer, which closes the menu and unmounts its root.
 */
export function watchExplorerMenu(
  ctx: ClientContext,
  deps: ClientDeps,
  t: Translator,
  actions: ExplorerActions,
): () => void {
  // `document` is absent outside a browser (the hook test harness runs the
  // bundle in a bare context) — the same guard the platform watchers carry.
  if (typeof document === 'undefined' || document.body === null || document.body === undefined) return () => {}

  const h = deps.h as unknown as ElementFactory | undefined
  const runtime = loadRuntime(h)
  if (h === undefined || runtime === undefined) return () => {}

  /** The open menu, or null. Rendered on every change. */
  let menu: MenuTarget | null = null

  // The menu host: a zero-size div in the body. The card itself is portalled by
  // the Menu component, so this node only carries the anchor placeholder.
  const container = document.createElement('div')
  container.setAttribute('data-smkit-explorer-menu-root', '')
  container.style.display = 'none'
  document.body.appendChild(container)
  const root = runtime.createRoot(container)

  /** Draw the menu's current state through the host component. */
  const draw = (): void => {
    const conversationIcon = iconElement(h, CONVERSATION_ICON)
    const copyIcon = iconElement(h, COPY_ICON)
    const renameIcon = iconElement(h, RENAME_ICON)
    const deleteIcon = iconElement(h, DELETE_ICON)
    const open = menu
    root.render(
      h(runtime.Menu, {
        open: open !== null,
        anchor: h('span', null),
        items: open === null
          ? []
          : [
              // The most-used row leads the whole menu, alone above a hairline:
              // sending the entry to the conversation is what a reader reaches
              // for far more often than creating or copying beside it. The
              // root's header row is not an entry, so it is left out.
              ...(open.kind === 'root'
                ? []
                : [
                    { id: EXPLORER_ROWS.reference, label: t('addToChat'), icon: conversationIcon },
                    { id: 'reference-sep', type: 'separator' },
                  ]),
              // The creating rows follow, as the source's do, and belong to a
              // directory — the tree's root included, which is a directory the
              // shell draws no row for.
              ...(open.kind === 'directory' || open.kind === 'root'
                ? [
                    { id: EXPLORER_ROWS.newFolder, label: t('newFolder'), icon: iconElement(h, PLUS_ICON) },
                    { id: EXPLORER_ROWS.newFile, label: t('newFile'), icon: iconElement(h, NEW_FILE_ICON) },
                  ]
                : []),
              // Everything below names the entry itself: the root has no path of
              // its own to copy, nothing above it to rename it into, and deleting
              // it would be deleting the workspace, not an entry — its menu stops
              // at the two creating rows.
              ...(open.kind === 'root'
                ? []
                : [
                    { id: EXPLORER_ROWS.relative, label: t('copyRelative'), icon: copyIcon },
                    { id: EXPLORER_ROWS.absolute, label: t('copyAbsolute'), icon: copyIcon },
                    // The mutations close the source's menu as their own group,
                    // after a hairline.
                    { id: 'mutate-sep', type: 'separator' },
                    { id: EXPLORER_ROWS.rename, label: t('rename'), icon: renameIcon },
                    { id: EXPLORER_ROWS.delete, label: t('delete'), icon: deleteIcon, danger: true },
                  ]),
            ],
        onSelect: (id: string) => { select(id) },
        onClose: () => { setMenu(null) },
        portal: true,
        compact: true,
        align: 'start',
        getAnchorRect: () => (menu === null ? null : new DOMRect(menu.x, menu.y, 0, 0)),
      }),
    )
  }

  /**
   * Move the "kept lit" marker to the row of the menu being opened, and take it
   * off every other row. A tree re-render can replace the row element between
   * two menus, so the old marker is cleared by attribute rather than by the
   * element this feature remembers.
   */
  const markTarget = (next: MenuTarget | null): void => {
    const row = next === null ? null : next.row
    for (const marked of Array.from(document.querySelectorAll(`[${TARGET}]`))) {
      if (marked !== row) marked.removeAttribute(TARGET)
    }
    // Only a tree row has a hover fill to keep: the root's target is the header,
    // which paints none — the marker there would name nothing.
    if (row !== null && row.getAttribute('data-files-entry') !== null) row.setAttribute(TARGET, '')
  }

  /** Open or close the menu, keeping its row lit while it is up. */
  const setMenu = (next: MenuTarget | null): void => {
    markTarget(next)
    menu = next
    draw()
  }

  /**
   * One row selected. The menu closes first, as the source does, so the copy
   * feedback lands on a menu-free row; the dispatcher owns whatever follows.
   */
  const select = (id: string): void => {
    const target = menu
    setMenu(null)
    if (target === null) return
    actions.run(id, {
      path: target.path,
      root: target.root,
      kind: target.kind,
      row: target.row,
    })
  }

  /**
   * The row under the pointer: its path is the tree's own absolute spelling,
   * and the tree's `data-files-root` is the base the relative row projects
   * against.
   */
  const rowTarget = (row: Element, event: MouseEvent): MenuTarget | null => {
    const path = row.getAttribute('data-files-path')
    if (path === null || path === '') return null
    const rootPath = row.closest(TREE)?.getAttribute('data-files-root') ?? ''
    const kind = (row.getAttribute('data-files-entry') ?? 'other') as RowKind
    return { row, path, root: rootPath, kind, x: event.clientX, y: event.clientY }
  }

  /**
   * The tree's own root, which the shell gives no row.
   *
   * `ui-sidebar-files` draws a header row above the listing (`/workspace`, the
   * reload control) and rows only for the entries INSIDE the root — so the one
   * directory every session starts in was the one directory this menu could not
   * create in: there was nothing to right-click. The header row, and the blank
   * space the tree leaves under a short listing, stand in for it. Both sit
   * inside `data-files-state="tree"`, and the listing they belong to is named by
   * `data-files-root`.
   */
  const rootTarget = (node: Element, event: MouseEvent): MenuTarget | null => {
    const tree = node.closest(TREE)
    if (tree === null) return null
    const path = tree.getAttribute('data-files-root') ?? ''
    const body = tree.querySelector(BODY)
    const header = body?.previousElementSibling ?? null
    if (path === '' || body === null || header === null) return null
    return { row: header, path, root: path, kind: 'root', x: event.clientX, y: event.clientY }
  }

  /**
   * The one listener, at the bubble phase: a host that opened its shared menu
   * has already called `preventDefault`, and its menu is where these rows now
   * live. A right-click on a row answers that row; anywhere else in the tree
   * answers the root, which has no row to be right-clicked.
   */
  const onContextMenu = (event: MouseEvent): void => {
    if (event.defaultPrevented === true) return
    const node = event.target
    if (!(node instanceof Element)) return
    if (betterSidebarOwnsSurfaces(ctx)) return
    const row = node.closest(ROW)
    const target = row === null ? rootTarget(node, event) : rowTarget(row, event)
    if (target === null) return
    // Only claim the gesture once a menu can actually be shown: the browser's
    // own menu is dropped, and no later listener answers the same right-click.
    event.preventDefault()
    event.stopPropagation()
    setMenu(target)
  }

  document.addEventListener('contextmenu', onContextMenu)

  return () => {
    document.removeEventListener('contextmenu', onContextMenu)
    for (const row of Array.from(document.querySelectorAll(`[${TARGET}]`))) row.removeAttribute(TARGET)
    menu = null
    root.unmount()
    container.remove()
  }
}
