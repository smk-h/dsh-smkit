/**
 * The explorer rows as contributions to the shell's own context menu.
 *
 * `ui-context-menu` (0.2.x) is the one menu every surface opens, and the file
 * tree already opens it: a right-click on a row hands the menu a `file` or
 * `directory` target — its absolute path plus the session — and the tree's
 * header row hands it the workspace root as a `directory`. Contributed rows are
 * rendered by the shell through the same entry component as its own, so this
 * feature contributes data and nothing else here: no listener, no menu of its
 * own, no stylesheet.
 *
 * ## Where the rows land
 *
 * - "add to conversation" leads the menu (`order` 10, above the shell's own
 *   rows, which open-in-app registers at 100). It is the row a reader reaches
 *   for far more often than creating or copying beside it.
 * - Everything else is a footer row (`afterContent`): the pinned strip below
 *   the scrolling list, whose own hairline is exactly the separation the drawn
 *   menu used to paint. The shell ignores a `separatorBefore` on a menu's first
 *   row, so the section borders are supplied per group inside the footer.
 * - The lead row's group ends where its glyph says: the menu API cannot place a
 *   separator after a row, so the glyph wears `data-smkit-menu-lead` and
 *   `style/native-lead.css` draws the shell's hairline there.
 *
 * ## When this does nothing
 *
 * A host without the service, or one whose tree does not open the shared menu,
 * simply never calls `resolve`; the drawn menu (`menu.ts`) is still there for
 * those, because it stands down whenever the host has already claimed the
 * gesture.
 *
 * ## Yielding to `dsh-better-sidebar`
 *
 * Entering the shell's menu does not change who owns the tree. That plugin's
 * explorer already carries these rows, so while its `betterSidebar` service is
 * published every `resolve` answers with no rows at all — the same
 * loaded-means-yield policy the drawn door follows (`platform/neighbour`).
 * Asked per opening, not at mount, so loading or unloading it takes effect on
 * the next right-click without a reload.
 */

import { contextMenusOf } from '../../platform/context-menus'
import { betterSidebarOwnsSurfaces } from '../../platform/neighbour'
import { createIcon, type IconSpec } from '../../platform/icons/Icon'
import { CONVERSATION_ICON } from '../../platform/icons/ConversationIcon'
import { COPY_ICON } from '../../platform/icons/CopyIcon'
import { DELETE_ICON } from './icons/DeleteIcon'
import { NEW_FILE_ICON } from './icons/NewFileIcon'
import { PLUS_ICON } from './icons/PlusIcon'
import { RENAME_ICON } from './icons/RenameIcon'
import { EXPLORER_ROWS, type ExplorerActions, type ExplorerSubject, type RowKind } from './actions'
import type {
  ClientContext,
  ClientDeps,
  ContextMenuAction,
  DirectoryMenuTarget,
  FileMenuTarget,
  Translator,
} from '../../platform/types'

/** The slot that turns a glyph key into a row's icon. */
const ICON_SEAT = 'contextMenu.icon'

/** This plugin's namespace on the shared menu, and on the icon seat. */
const PREFIX = 'smkit.explorer'

/** Glyph keys, one per row that wears one (both copy rows share a glyph). */
const KEYS = {
  reference: `${PREFIX}.reference`,
  newFolder: `${PREFIX}.new-folder`,
  newFile: `${PREFIX}.new-file`,
  copy: `${PREFIX}.copy`,
  rename: `${PREFIX}.rename`,
  delete: `${PREFIX}.delete`,
} as const

/**
 * Where this plugin's contribution sits among the shell's own.
 *
 * The shell's directory contribution is `order` 100 (open-in-app) and its file
 * rows are 100 and 200, so 10 puts "add to conversation" above all of them.
 * The footer rows keep one contribution each; their relative order is the order
 * `resolve` returns.
 */
export const EXPLORER_MENU_ORDER = 10

/**
 * The attribute the leading row's glyph carries.
 *
 * The shared menu can only draw a separator BEFORE a row, and hides it on the
 * menu's first row, so the lead row cannot mark where its group ends. The mark
 * lets `style/native-lead.css` draw that hairline from the glyph's box — the
 * shell's item wrapper is already positioned for its own separators.
 */
const LEAD_MARK = 'data-smkit-menu-lead'

/** The glyph each key answers with, and whether it leads the menu. */
const GLYPHS: Array<readonly [string, IconSpec, boolean?]> = [
  [KEYS.reference, CONVERSATION_ICON, true],
  [KEYS.newFolder, PLUS_ICON],
  [KEYS.newFile, NEW_FILE_ICON],
  [KEYS.copy, COPY_ICON],
  [KEYS.rename, RENAME_ICON],
  [KEYS.delete, DELETE_ICON],
]

/**
 * Build one seated glyph.
 *
 * The lead row's glyph wears an extra wrapper: the row itself is the shell's,
 * and a plugin cannot hand it a class or an attribute, so the one element this
 * plugin owns inside that row is where the mark lives.
 *
 * @param deps - the client deps, for the element factory.
 * @param spec - the glyph's path data.
 * @param leading - whether this glyph's row leads the menu.
 * @returns the component the icon seat renders.
 */
function createMenuIcon(deps: ClientDeps, spec: IconSpec, leading: boolean) {
  const Icon = createIcon(deps, spec)
  if (!leading) return Icon
  return function LeadingMenuIcon(props: { size?: number; className?: string }): JSX.Element {
    return deps.h('span', { [LEAD_MARK]: '' }, deps.h(Icon, props))
  }
}

/** The tree's root and rows, as the DOM spells them. */
const TREE = '[data-files-state="tree"]'

/** Normalize a path for comparison: either separator, no trailing ones. */
function normalized(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Whether two spellings name the same entry (case-insensitive on Windows). */
function samePath(left: string, right: string): boolean {
  const a = normalized(left)
  const b = normalized(right)
  if (a === b) return true
  return /^[A-Za-z]:\//.test(a) && a.toLowerCase() === b.toLowerCase()
}

/**
 * The session's working directory — the tree's root.
 *
 * Read from the session list first (the field the shell's own file surfaces
 * compare against), then from the workspace catalog, which also answers for a
 * host whose session rows do not carry `cwd`.
 */
export function workspaceRootOf(ctx: ClientContext, sessionId: string): string | undefined {
  try {
    const cwd = ctx.sessions?.list?.getSnapshot()?.byId?.[sessionId]?.cwd
    if (typeof cwd === 'string' && cwd !== '') return cwd
  } catch {
    // A throwing read falls through to the catalog rather than costing the menu.
  }
  try {
    const workspaces = ctx.reflect?.get('workspaces') as {
      list?: { getSnapshot(): { phase?: string; state?: string; items?: readonly { path: string; sessionIds: readonly string[] }[] } | undefined }
    } | undefined
    const snapshot = workspaces?.list?.getSnapshot()
    if (snapshot?.phase === 'ready' && snapshot.state === 'idle') {
      return snapshot.items?.find((workspace) => workspace.sessionIds.includes(sessionId))?.path
    }
  } catch {
    // Same as above: no root, no relative projection — the gesture survives.
  }
  return undefined
}

/** Whether the target is the tree's own root, which the shell draws no row for. */
function isRootPath(root: string | undefined, path: string): boolean {
  if (root !== undefined && root !== '') return samePath(root, path)
  // No session root: the tree's own `data-files-root` still names it.
  if (typeof document === 'undefined') return false
  for (const tree of Array.from(document.querySelectorAll(TREE))) {
    if (samePath(tree.getAttribute('data-files-root') ?? '', path)) return true
  }
  return false
}

/**
 * The rows for one target.
 *
 * The root's own menu carries the two creating rows only: it has no path of its
 * own to copy, no sibling to be renamed beside, and deleting it would delete
 * the workspace rather than an entry.
 */
function rowsFor(
  kind: 'file' | 'directory',
  target: { sessionId: string; path: string },
  options: { ctx: ClientContext; actions: ExplorerActions; t: Translator; root: string | undefined },
): ContextMenuAction[] {
  const { ctx, actions, t, root } = options
  // The neighbour's explorer already carries these rows: asked at every opening,
  // the same probe the drawn menu uses, so the two cannot both answer one tree.
  if (betterSidebarOwnsSurfaces(ctx)) return []
  const isRoot = kind === 'directory' && isRootPath(root, target.path)
  const subject: ExplorerSubject = {
    path: target.path,
    root: root ?? '',
    kind: (isRoot ? 'root' : kind) as RowKind,
    row: null,
    sessionId: target.sessionId,
  }
  const rows: ContextMenuAction[] = []
  const footer: ContextMenuAction[] = []

  if (!isRoot) {
    rows.push({
      id: `${PREFIX}.reference`,
      label: t('addToChat'),
      icon: { key: KEYS.reference },
      run: () => { actions.run(EXPLORER_ROWS.reference, subject) },
    })
  }

  /** Append one footer row, opening a new section above it when asked. */
  const push = (row: ContextMenuAction, opensSection: boolean): void => {
    const first = footer.length === 0
    footer.push({ ...row, afterContent: true, ...(first || !opensSection ? {} : { separatorBefore: true }) })
  }

  if (kind === 'directory') {
    push({
      id: `${PREFIX}.new-folder`,
      label: t('newFolder'),
      icon: { key: KEYS.newFolder },
      run: () => { actions.run(EXPLORER_ROWS.newFolder, subject) },
    }, true)
    push({
      id: `${PREFIX}.new-file`,
      label: t('newFile'),
      icon: { key: KEYS.newFile },
      run: () => { actions.run(EXPLORER_ROWS.newFile, subject) },
    }, false)
  }

  if (!isRoot) {
    push({
      id: `${PREFIX}.copy-relative`,
      label: t('copyRelative'),
      icon: { key: KEYS.copy },
      run: () => { actions.run(EXPLORER_ROWS.relative, subject) },
    }, true)
    push({
      id: `${PREFIX}.copy-absolute`,
      label: t('copyAbsolute'),
      icon: { key: KEYS.copy },
      run: () => { actions.run(EXPLORER_ROWS.absolute, subject) },
    }, false)
    push({
      id: `${PREFIX}.rename`,
      label: t('rename'),
      icon: { key: KEYS.rename },
      run: () => { actions.run(EXPLORER_ROWS.rename, subject) },
    }, true)
    push({
      id: `${PREFIX}.delete`,
      label: t('delete'),
      icon: { key: KEYS.delete },
      danger: true,
      run: () => { actions.run(EXPLORER_ROWS.delete, subject) },
    }, false)
  }

  return [...rows, ...footer]
}

/**
 * Contribute the explorer's rows to the shell's shared menu.
 *
 * @param ctx - the client context (the menu service is read through it).
 * @param deps - the client deps, for the tick that builds each glyph.
 * @param actions - the dispatcher both menus share.
 * @param t - the copy lookup bound to the `explorer` namespace.
 */
export function registerExplorerMenu(
  ctx: ClientContext,
  deps: ClientDeps,
  actions: ExplorerActions,
  t: Translator,
): void {
  const menus = contextMenusOf(ctx)
  if (menus !== undefined) {
    const register = (contribution: Parameters<typeof menus.register>[0]): void => {
      ctx.effect(() => {
        try {
          return menus.register(contribution)
        } catch {
          // A shell that takes the service but not this family keeps the drawn
          // menu: it only stands down when the host claims the gesture itself.
          return () => {}
        }
      }, `explorer-menu: ${contribution.target} rows`)
    }
    register({
      id: `${PREFIX}.directory`,
      target: 'directory',
      order: EXPLORER_MENU_ORDER,
      resolve: (target: DirectoryMenuTarget) => rowsFor('directory', target, {
        ctx,
        actions,
        t,
        root: workspaceRootOf(ctx, target.sessionId),
      }),
    })
    register({
      id: `${PREFIX}.file`,
      target: 'file',
      order: EXPLORER_MENU_ORDER,
      resolve: (target: FileMenuTarget) => rowsFor('file', target, {
        ctx,
        actions,
        t,
        root: workspaceRootOf(ctx, target.sessionId),
      }),
    })
    // The shell's own rows each wear a glyph; a row without one would break the
    // icon column, so every key the rows name is answered here. Asked only on a
    // host that renders these rows: on an older shell the drawn menu paints its
    // own glyphs and there is no keyed seat to answer.
    for (const [key, spec, leading] of GLYPHS) {
      ctx.slots.inject(ICON_SEAT, () => ctx.slots.register(
        { name: ICON_SEAT, key },
        createMenuIcon(deps, spec, leading === true),
      ))
    }
  }
}
