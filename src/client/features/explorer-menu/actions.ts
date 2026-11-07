/**
 * What one row of the explorer menu does — the half both menus share.
 *
 * The feature has two front doors. On a shell with the shared context menu
 * (`ui-context-menu`, 0.2.x) the rows are data contributions rendered by the
 * host: the file tree opens `file` / `directory` targets itself, and the rows
 * this plugin adds sit in that menu, in its own glyph column and type scale
 * (see `native.ts`). On a shell that predates it there is nothing to extend, so
 * the feature draws the host's menu component itself over the tree's own
 * right-click (`menu.ts`).
 *
 * Both doors must do exactly the same thing when a row is chosen, so the
 * doing lives here: one subject (path, root, kind, row) in, one effect out.
 * Neither caller keeps editor state of its own — the single inline editor and
 * the single confirmation are owned here, so the two doors cannot open two.
 */

import { insertWorkspaceReference } from '../../platform/reference'
import { rowContainerOf } from '../../platform/row'
import { sessionOfRow } from '../../platform/session'
import { baseName, relativeTo } from './paths'
import { openDeleteDialog, type DeleteDialogHandle } from './delete'
import { openRowEditor, type RowEditorHandle } from './row-editor'
import { loadRuntime, type ElementFactory, type ExplorerRuntime } from './runtime'
import type { ClientDeps, ClientContext, Translator } from '../../platform/types'

/** The row behind the menu, as the tree published it. `root` is not a row. */
export type RowKind = 'file' | 'directory' | 'other' | 'root'

/** One chosen entry, and the tree it sits in. */
export interface ExplorerSubject {
  /** Absolute path, as the tree publishes it (the root for `root`). */
  readonly path: string
  /** The tree's root, for the relative projection ('' when unknown). */
  readonly root: string
  readonly kind: RowKind
  /** The row element, when the gesture had one; the root's header stands in. */
  readonly row: Element | null
  /** The session that owns the tree, when the gesture could name it. */
  readonly sessionId?: string
}

/** The stable row ids, shared by both menus. */
export const EXPLORER_ROWS = {
  reference: 'reference',
  newFolder: 'new-folder',
  newFile: 'new-file',
  relative: 'relative',
  absolute: 'absolute',
  rename: 'rename',
  delete: 'delete',
} as const

/** One dispatcher, built once per mount. */
export interface ExplorerActions {
  /**
   * Carry out one row.
   * @param id - one of {@link EXPLORER_ROWS}.
   * @param subject - the entry the menu was opened on.
   */
  run(id: string, subject: ExplorerSubject): void
  /** Close the open editor and confirmation, and drop every transient label. */
  dispose(): void
}

/** What the dispatcher needs from the feature. */
export interface ExplorerActionsOptions {
  ctx: ClientContext
  deps: ClientDeps
  t: Translator
}

/** One tree row, and the tree's root anchor. */
const ROW = 'li[data-files-entry]'
const TREE = '[data-files-state="tree"]'
/** The listing's scroll body — the level sits directly inside it. */
const BODY = '[data-files-body]'
/**
 * The page that owns the tree, from 0.2.x: its header row (the root's path
 * label, the reload control, the directory actions) is a SIBLING of the tree,
 * not a child of it.
 */
const PAGE = '[data-files-page]'

/** This feature's markers: the transient label, and the row that carries it. */
const LABEL = 'data-smkit-explorer-label'
const COPIED = 'data-smkit-explorer-copied'
/** How long the row's "copied" label stays after a successful write, in ms. */
const COPIED_MS = 1200
/** The label's namespaced class (see `style/label.css`). */
const LABEL_CLASS = 'smkit-explorer-label'

/**
 * Build the dispatcher both menus share.
 * @param options - the context, the deps, the copy, and the host runtime.
 * @returns the dispatcher, whose `dispose` the caller runs with the effect.
 */
export function createExplorerActions(options: ExplorerActionsOptions): ExplorerActions {
  const { ctx, deps, t } = options
  const h = deps.h as unknown as ElementFactory
  /** Resolved on the first row that needs one, so a bare harness stays cheap. */
  let resolved: ExplorerRuntime | undefined
  let loaded = false
  const runtimeOf = (): ExplorerRuntime | undefined => {
    if (!loaded) {
      resolved = loadRuntime(h)
      loaded = true
    }
    return resolved
  }
  /** Pending "copied" labels, one per row, so a second copy restarts the clock. */
  const timers = new Map<Element, number>()
  /** The one inline editor open, if any (the source opens one at a time). */
  let rowEditor: RowEditorHandle | null = null
  /** The one delete confirmation open, if any. */
  let deleteDialog: DeleteDialogHandle | null = null

  /** Dismiss whichever inline editor is open, committing nothing. */
  const closeRowEditor = (): void => {
    rowEditor?.close()
    rowEditor = null
  }

  /** Dismiss whichever delete confirmation is open, deleting nothing. */
  const closeDeleteDialog = (): void => {
    deleteDialog?.close()
    deleteDialog = null
  }

  /** Find the row for one path again (a re-render can replace the element). */
  const findRow = (path: string): Element | null => {
    if (typeof document === 'undefined') return null
    for (const row of Array.from(document.querySelectorAll(ROW))) {
      if (row.getAttribute('data-files-path') === path) return row
    }
    return null
  }

  /** The tree whose root is `root`, found by the root the gesture named. */
  const treeOf = (root: string): Element | null => {
    if (typeof document === 'undefined' || root === '') return null
    for (const tree of Array.from(document.querySelectorAll(TREE))) {
      if (tree.getAttribute('data-files-root') === root) return tree
    }
    return null
  }

  /**
   * The tree's root anchor: the header row above the listing (the root has no
   * row of its own) and the listing's top level the create borrows.
   *
   * Where that header lives changed with the shell: up to 0.1.x it was the
   * scroll body's previous sibling, inside the tree. From 0.2.x the tree is an
   * `<aside>` inside a page whose header — the root's `PathLabel`, the reload
   * control and the directory actions — sits OUTSIDE that `<aside>`, so the
   * body has no header sibling at all; the root's own menu would find nothing
   * to anchor to and every create at the root silently did nothing. The page
   * is the stable anchor there (`data-files-page`), and its first child is
   * that header row.
   */
  const rootParts = (root: string): { header: Element | null; level: Element | null } => {
    const tree = treeOf(root)
    const body = tree?.querySelector(BODY) ?? null
    const page = tree?.closest(PAGE) ?? null
    return {
      header: page?.children[0] ?? body?.previousElementSibling ?? null,
      // The first `ul` in the body is the root level, at whatever depth the
      // shell wraps it: there is nothing above it but the header.
      level: body?.querySelector('ul') ?? null,
    }
  }

  /**
   * Flash the "copied" label in the row's trailing slot, the seat the source
   * fills with its own confirmation after a copy.
   */
  const flashCopied = (subject: ExplorerSubject): void => {
    const row = subject.row !== null && subject.row.isConnected ? subject.row : findRow(subject.path)
    if (row === null || row === undefined) return
    const seat = rowContainerOf(row)
    for (const stale of Array.from(seat.querySelectorAll(`[${LABEL}]`))) stale.remove()
    const pending = timers.get(row)
    if (pending !== undefined) clearTimeout(pending)
    const label = document.createElement('span')
    label.className = LABEL_CLASS
    label.setAttribute(LABEL, '')
    label.textContent = t('copied')
    seat.appendChild(label)
    row.setAttribute(COPIED, '')
    const timer = setTimeout(() => {
      label.remove()
      row.removeAttribute(COPIED)
      timers.delete(row)
    }, COPIED_MS)
    timers.set(row, timer)
  }

  /** The path one row copies: relative against the tree root, or its own path. */
  const textOf = (subject: ExplorerSubject, id: string): string => {
    if (id !== EXPLORER_ROWS.relative) return subject.path
    // A host that omits the root gets the absolute path for the relative row
    // too — projecting against '' would drop a leading separator and invent a
    // path, which is worse than not projecting.
    return subject.root === '' ? subject.path : relativeTo(subject.root, subject.path)
  }

  /** Open the inline editor for a create or a rename. */
  const edit = (subject: ExplorerSubject, id: string): void => {
    const runtime = runtimeOf()
    if (runtime === undefined) return
    const creating = id !== EXPLORER_ROWS.rename
    const root = subject.kind === 'root'
    const header = root ? rootParts(subject.root).header : null
    const row = root ? header : (subject.row ?? findRow(subject.path))
    // A row the tree has already replaced and a root without its header leave
    // nothing to align the editor to: the gesture becomes a no-op rather than
    // an editor floating in the wrong place.
    if (row === null || row === undefined) return
    closeRowEditor()
    rowEditor = openRowEditor({
      api: deps.api,
      t,
      mode: creating ? 'create' : 'rename',
      kind: creating
        ? (id === EXPLORER_ROWS.newFolder ? 'folder' : 'file')
        : (subject.kind === 'directory' ? 'folder' : 'file'),
      path: subject.path,
      name: baseName(subject.path),
      row,
      // The root has no directory row to hang the editor under: it takes the
      // header row's box instead, and borrows the listing's top level for the
      // one row of height the create needs.
      anchor: root ? (header ?? undefined) : undefined,
      list: root ? () => rootParts(subject.root).level : undefined,
      // The source draws the name's own file glyph in that row; this is the
      // shell's twin of it.
      typeIcon: runtime.FileTypeIcon === undefined || runtime.classifyFileType === undefined
        ? undefined
        : {
            h,
            FileTypeIcon: runtime.FileTypeIcon,
            classifyFileType: runtime.classifyFileType,
            createRoot: runtime.createRoot,
          },
    })
  }

  /** Ask, then remove. */
  const remove = (subject: ExplorerSubject): void => {
    const runtime = runtimeOf()
    if (runtime === undefined) return
    if (subject.kind === 'root' || subject.kind === 'other') return
    closeRowEditor()
    closeDeleteDialog()
    deleteDialog = openDeleteDialog({
      deps,
      createRoot: runtime.createRoot,
      t,
      path: subject.path,
      name: baseName(subject.path),
      isDir: subject.kind === 'directory',
    })
  }

  /** Reference the entry in the session's conversation draft. */
  const reference = (subject: ExplorerSubject): void => {
    const sessionId = subject.sessionId
      ?? (subject.row === null ? undefined : sessionOfRow(ctx, subject.row))
    // Without a session there is no draft to write into, so the gesture is a
    // no-op rather than a guess at "the current session".
    if (sessionId === undefined) return
    insertWorkspaceReference(ctx, sessionId, subject.path, subject.kind === 'directory')
  }

  return {
    run(id: string, subject: ExplorerSubject): void {
      if (id === EXPLORER_ROWS.newFolder || id === EXPLORER_ROWS.newFile || id === EXPLORER_ROWS.rename) {
        edit(subject, id)
        return
      }
      if (id === EXPLORER_ROWS.delete) {
        remove(subject)
        return
      }
      if (id === EXPLORER_ROWS.reference) {
        reference(subject)
        return
      }
      const runtime = runtimeOf()
      if (runtime === undefined) return
      void runtime.writeClipboard(textOf(subject, id)).then((ok) => {
        if (ok === true) flashCopied(subject)
      })
    },
    dispose(): void {
      closeRowEditor()
      closeDeleteDialog()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      if (typeof document === 'undefined') return
      for (const label of Array.from(document.querySelectorAll(`[${LABEL}]`))) label.remove()
      for (const row of Array.from(document.querySelectorAll(`[${COPIED}]`))) row.removeAttribute(COPIED)
    },
  }
}
