/**
 * The right-click menu this plugin draws on the shell's file tree.
 *
 * Today it holds the two creating rows and the two "copy path" rows; this is
 * the file every later row (rename / delete) is added to, so they share one
 * listener, one menu host and one open/close lifecycle.
 *
 * Ported from `dsh-better-sidebar` (`src/client/FileTree.tsx`), where the rows
 * sit in that plugin's own explorer menu:
 *
 * - right-clicking a row opens one menu at the cursor, portalled so the tree's
 *   overflow clip cannot crop it;
 * - a DIRECTORY row leads with "new folder" and "new file" (the shell's menu
 *   cannot create anything by itself; see `create.ts` for the inline editor);
 * - the two copy rows are "copy relative path" and "copy absolute path", in
 *   that order, each with the same copy glyph, and every row carries them;
 * - the relative row copies the path projected against the tree's root
 *   (`relativeTo`), the absolute row copies the row's own path;
 * - a successful write replaces the row's trailing `@` chip with a "copied"
 *   label for 1.2 s; a refused write shows nothing at all;
 * - the menu closes on selection, outside press and Escape.
 *
 * ## Why the shell's own `Menu` is rendered here
 *
 * The source menu is the host's `Menu` primitive — its card, hover fill, row
 * height, icon slot, submenu-free height cap, keyboard walk, focus return and
 * viewport flipping are all that component's. Re-drawing it with this plugin's
 * own DOM would be a look-alike at best, so this feature mounts the REAL
 * component in a small React root of its own (the shell exposes
 * `react-dom/client` and `@deepseek-ai/dsh-client-ui-primitives` in its
 * platform table). If either is missing the feature simply does not appear, and
 * the row keeps the host's default right-click behaviour.
 *
 * ## What the shell has, and has not
 *
 * The shell's file tree publishes no context menu of its own
 * (`ui-sidebar-files` renders none), so this feature is event-driven rather
 * than a decoration: one capture-phase `contextmenu` listener over the
 * document, no observers, and nothing added to the DOM until a menu is opened.
 * The menu's rows are this plugin's own contributions — the copy rows today,
 * the creating/renaming/deleting rows as they are ported — never a re-draw of
 * the shell's absent menu.
 *
 * ## Only one of us is ever active
 *
 * While `dsh-better-sidebar` owns the `files` page its explorer already offers
 * both rows, so this feature stands down — the same probe the `@` chip uses
 * (`file-reference/watch.ts`), asked at every right-click.
 */

import type { ClientContext, ClientDeps, Translator } from '../../platform/types'
import type { IconSpec } from '../../platform/icons/Icon'
import { COPY_ICON } from './icons/CopyIcon'
import { NEW_FILE_ICON } from './icons/NewFileIcon'
import { PLUS_ICON } from './icons/PlusIcon'
import { openCreateEditor, type CreateEditorHandle } from './create'
import { relativeTo } from './paths'

/** One tree row, and the tree's root anchor (which carries the cwd). */
const ROW = 'li[data-files-entry]'
const TREE = '[data-files-state="tree"]'

/** This feature's markers: the transient label, and the row that carries it. */
const LABEL = 'data-smkit-explorer-label'
const COPIED = 'data-smkit-explorer-copied'
/** The label's namespaced class (see `style/label.css`). */
const LABEL_CLASS = 'smkit-explorer-label'

/** How long the row's "copied" label stays after a successful write, in ms. */
const COPIED_MS = 1200

/** The React factory the client bundle threads in as `h`. */
type ElementFactory = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown

/** The host modules this feature cannot work without. */
interface MenuRuntime {
  /** The shell's menu card/rows/keyboard, exactly as the source uses it. */
  Menu: (props: Record<string, unknown>) => unknown
  /** The shell's clipboard write (async API, `execCommand` fallback). */
  writeClipboard: (text: string) => Promise<boolean>
  /** React root for the (single) menu host. */
  createRoot: (container: Element) => { render(node: unknown): void; unmount(): void }
  /**
   * The shell's per-extension glyph and classifier — optional, because an older
   * shell may not seed them; the editor then keeps its own generic glyph.
   */
  FileTypeIcon?: (props: { kind: string; size: number }) => unknown
  classifyFileType?: (name: string) => string
}

/** What the row behind the menu is, as the shell published it. */
type RowKind = 'file' | 'directory' | 'other'

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

/** The slice of `dsh-better-sidebar`'s client service this feature reads. */
interface BetterSidebarFace {
  /** Whether one of that plugin's tab types is enabled in its settings. */
  isTabEnabled?(id: string): boolean
}

/**
 * Whether `dsh-better-sidebar` is the one drawing the `files` page right now.
 *
 * Its service being published is not enough: that plugin registers the `files`
 * takeover only while its `editor` type is enabled, and hands the page back to
 * the shell when the user switches that type off. Its explorer's menu already
 * carries both copy rows, so this feature must not offer a second menu on rows
 * that are not the shell's — the same probe, and the same reason, as
 * `file-reference/watch.ts`.
 */
function betterSidebarOwnsExplorer(ctx: ClientContext): boolean {
  try {
    const service = ctx.reflect?.get('betterSidebar') as BetterSidebarFace | undefined
    if (service === undefined) return false
    if (typeof service.isTabEnabled !== 'function') return true
    return service.isTabEnabled('editor') !== false
  } catch {
    // A service that answers by throwing must not cost the feature: if it does
    // own the page, its rows are not the host's, so no menu is shown either way.
    return false
  }
}

/** The host modules, resolved once; undefined makes the feature a no-op. */
function loadRuntime(h: ElementFactory | undefined): MenuRuntime | undefined {
  if (typeof h !== 'function') return undefined
  try {
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives') as {
      Menu?: unknown
      writeClipboard?: unknown
      FileTypeIcon?: unknown
      classifyFileType?: unknown
    }
    const client = require('react-dom/client') as { createRoot?: unknown }
    if (typeof primitives.Menu !== 'function') return undefined
    if (typeof primitives.writeClipboard !== 'function') return undefined
    if (typeof client.createRoot !== 'function') return undefined
    return {
      Menu: primitives.Menu as MenuRuntime['Menu'],
      writeClipboard: primitives.writeClipboard as MenuRuntime['writeClipboard'],
      createRoot: client.createRoot as MenuRuntime['createRoot'],
      FileTypeIcon: typeof primitives.FileTypeIcon === 'function'
        ? primitives.FileTypeIcon as MenuRuntime['FileTypeIcon']
        : undefined,
      classifyFileType: typeof primitives.classifyFileType === 'function'
        ? primitives.classifyFileType as MenuRuntime['classifyFileType']
        : undefined,
    }
  } catch {
    // An older shell may not seed one of them; the tree then keeps the host's
    // default right-click behaviour instead of this feature failing the bundle.
    return undefined
  }
}

/** One menu row's icon, built from the shared spec as a React element. */
function iconElement(h: ElementFactory, spec: IconSpec): unknown {
  return h(
    'svg',
    {
      width: spec.size ?? 16,
      height: spec.size ?? 16,
      viewBox: spec.viewBox,
      fill: 'none',
      strokeWidth: 1,
      'aria-hidden': 'true',
    },
    spec.nodes.map((node, index) => h(node.tag, { key: index, ...node.attrs })),
  )
}

/**
 * Watch the shell's file tree for right-clicks and offer the two copy rows.
 *
 * @param ctx - the client context (the neighbour probe goes through reflection).
 * @param deps - the client deps; only `h` is used (to build the menu's elements).
 * @param t - the copy lookup bound to this feature's namespace.
 * @returns the effect's disposer, which closes the menu and unmounts its root.
 */
export function watchExplorerMenu(
  ctx: ClientContext,
  deps: ClientDeps,
  t: Translator,
): () => void {
  // `document` is absent outside a browser (the hook test harness runs the
  // bundle in a bare context) — the same guard the platform watchers carry.
  if (typeof document === 'undefined' || document.body === null || document.body === undefined) return () => {}

  const h = deps.h as unknown as ElementFactory | undefined
  const runtime = loadRuntime(h)
  if (runtime === undefined || h === undefined) return () => {}

  /** The open menu, or null. Rendered on every change. */
  let menu: MenuTarget | null = null
  /** Pending "copied" labels, one per row, so a second copy restarts the clock. */
  const timers = new Map<Element, number>()
  /** The one inline editor open, if any (the source opens one at a time). */
  let createEditor: CreateEditorHandle | null = null

  /** Dismiss whichever creating editor is open, creating nothing. */
  const closeCreateEditor = (): void => {
    createEditor?.close()
    createEditor = null
  }

  // The menu host: a zero-size div in the body. The card itself is portalled by
  // the Menu component, so this node only carries the anchor placeholder.
  const container = document.createElement('div')
  container.setAttribute('data-smkit-explorer-menu-root', '')
  container.style.display = 'none'
  document.body.appendChild(container)
  const root = runtime.createRoot(container)

  /** The path one row copies: relative against the tree root, or its own path. */
  const textOf = (target: MenuTarget, id: string): string => {
    if (id !== 'relative') return target.path
    // A host that omits `data-files-root` gets the absolute path for the
    // relative row too — the source's `relativeTo(cwd ?? '', …)` would drop a
    // leading separator and invent a path, which is worse than not projecting.
    return target.root === '' ? target.path : relativeTo(target.root, target.path)
  }

  /** Find the row for one path again (a re-render can replace the element). */
  const findRow = (path: string): Element | null => {
    for (const row of Array.from(document.querySelectorAll(ROW))) {
      if (row.getAttribute('data-files-path') === path) return row
    }
    return null
  }

  /**
   * Flash the "copied" label in the row's trailing slot: the reference replaces
   * the `@` button with the label in the same seat, and so does this (the
   * stylesheet hides the chip while the row carries the copied marker).
   */
  const flashCopied = (target: MenuTarget): void => {
    const row = target.row.isConnected ? target.row : findRow(target.path)
    if (row === null) return
    for (const stale of Array.from(row.querySelectorAll(`[${LABEL}]`))) stale.remove()
    const pending = timers.get(row)
    if (pending !== undefined) clearTimeout(pending)
    const label = document.createElement('span')
    label.className = LABEL_CLASS
    label.setAttribute(LABEL, '')
    label.textContent = t('copied')
    row.appendChild(label)
    row.setAttribute(COPIED, '')
    const timer = setTimeout(() => {
      label.remove()
      row.removeAttribute(COPIED)
      timers.delete(row)
    }, COPIED_MS)
    timers.set(row, timer)
  }

  /** Draw the menu's current state through the host component. */
  const draw = (): void => {
    const copyIcon = iconElement(h, COPY_ICON)
    const open = menu
    root.render(
      h(runtime.Menu, {
        open: open !== null,
        anchor: h('span', null),
        items: open === null
          ? []
          : [
              // The creating rows lead, as the source's do, and belong to a
              // directory row only — a file row has nowhere to create in.
              ...(open.kind === 'directory'
                ? [
                    { id: 'new-folder', label: t('newFolder'), icon: iconElement(h, PLUS_ICON) },
                    { id: 'new-file', label: t('newFile'), icon: iconElement(h, NEW_FILE_ICON) },
                  ]
                : []),
              { id: 'relative', label: t('copyRelative'), icon: copyIcon },
              { id: 'absolute', label: t('copyAbsolute'), icon: copyIcon },
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

  /** Open or close the menu. */
  const setMenu = (next: MenuTarget | null): void => {
    menu = next
    draw()
  }

  /**
   * One row selected. The menu closes first, as the source does, so the copy
   * feedback lands on a menu-free row; the label waits for the write to be
   * accepted and shows nothing when it is refused.
   */
  const select = (id: string): void => {
    const target = menu
    setMenu(null)
    if (target === null) return
    if (id === 'new-folder' || id === 'new-file') {
      // One editor at a time: a second "new …" gesture replaces the first.
      closeCreateEditor()
      createEditor = openCreateEditor({
        api: deps.api,
        t,
        kind: id === 'new-file' ? 'file' : 'folder',
        dir: target.path,
        row: target.row,
        // The source draws the typed name's own file glyph in that row
        // (`service.fileIcon(probe, 14)`); this is the shell's twin of it.
        typeIcon: runtime.FileTypeIcon === undefined || runtime.classifyFileType === undefined
          ? undefined
          : {
              h,
              FileTypeIcon: runtime.FileTypeIcon,
              classifyFileType: runtime.classifyFileType,
              createRoot: runtime.createRoot,
            },
      })
      return
    }
    void runtime.writeClipboard(textOf(target, id)).then((ok) => {
      if (ok === true) flashCopied(target)
    })
  }

  /**
   * The one listener. It answers a row right-click and nothing else: the row's
   * path is the tree's own absolute spelling, and the tree's `data-files-root`
   * is the base the relative row projects against.
   */
  const onContextMenu = (event: MouseEvent): void => {
    const node = event.target
    if (!(node instanceof Element)) return
    const row = node.closest(ROW)
    if (row === null) return
    const path = row.getAttribute('data-files-path')
    if (path === null || path === '') return
    if (betterSidebarOwnsExplorer(ctx)) return
    const rootPath = row.closest(TREE)?.getAttribute('data-files-root') ?? ''
    const kind = (row.getAttribute('data-files-entry') ?? 'other') as RowKind
    // Only claim the gesture once a menu can actually be shown.
    event.preventDefault()
    event.stopPropagation()
    setMenu({ row, path, root: rootPath, kind, x: event.clientX, y: event.clientY })
  }

  document.addEventListener('contextmenu', onContextMenu, true)

  return () => {
    document.removeEventListener('contextmenu', onContextMenu, true)
    closeCreateEditor()
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    for (const label of Array.from(document.querySelectorAll(`[${LABEL}]`))) label.remove()
    for (const row of Array.from(document.querySelectorAll(`[${COPIED}]`))) row.removeAttribute(COPIED)
    menu = null
    root.unmount()
    container.remove()
  }
}
