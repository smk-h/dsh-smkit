/**
 * Folding every folder of a file tree, in both trees this plugin meets.
 *
 * Neither tree publishes a "collapse all" operation, so this is a press-driven
 * walk: collapse one open directory at a time through the control the tree
 * itself draws for that directory. That keeps the tree's own state — not a copy
 * of it — authoritative, which is the only way the two stay in step when a
 * directory is expanded by something else (a search hit, a "show in folder"
 * reveal, a create that expanded the target).
 *
 * Two shapes, one walk:
 *
 * - **The shell's tree** (`ui-sidebar-files`) draws one `li[data-files-entry]`
 *   per row and an expanded directory's control is `<button aria-expanded>`
 *   carrying `true`, with its children in a nested `ul`. Pressing that button
 *   is the same call the row makes, so nothing is guessed.
 * - **`dsh-better-sidebar`'s tree** draws flat `div[role="button"]` rows,
 *   indented with an inline `padding-left` (`depth * 22 + 6`), and a directory
 *   row is followed by its children while it is open — that adjacency is the
 *   whole of its expansion state in the DOM. Its own "compact folders" chains
 *   still behave: pressing the row's tail toggles every link of the chain at
 *   once, which is exactly closed.
 *
 * ## Deepest first
 *
 * A directory's children leave the document the moment it collapses, so a
 * top-down walk would press only the outermost rows and leave the inner ones
 * open in the tree's state (visible again the next time the parent opens).
 * Walking deepest first closes every open row while it is still on screen.
 *
 * One case stays out of reach in the neighbour's tree, and it is worth naming:
 * a directory can be open inside a parent that is already closed, so it has no
 * row to press. Its state entry survives, and re-opening the parent shows it
 * open. The shell's tree has no such case — its `expanded` list only ever holds
 * paths whose row is rendered.
 */

/** The shell's tree, tagged once a listing has arrived (`ui-sidebar-files`). */
const SHELL_TREE = '[data-files-state="tree"]'
/** One open directory of that tree: its row's own control, marked by ARIA. */
const SHELL_OPEN = 'li[data-files-entry="directory"] button[aria-expanded="true"]'
/** The neighbour's rows: every file and directory row is one `role="button"` div. */
const NEIGHBOUR_ROW = 'div[role="button"]'

/**
 * How deeply one element nests inside the tree, in levels.
 *
 * For the shell the levels are `ul`s; the neighbour indents instead, so its
 * depth is read off the inline padding its rows carry. Both are facts the tree
 * published for its own layout, not a private class name.
 */
function shellDepth(element: Element, root: Element): number {
  let depth = 0
  for (let node = element.parentElement; node !== null && node !== root; node = node.parentElement) {
    if (node.tagName === 'UL') depth += 1
  }
  return depth
}

/** The neighbour's depth: the row's own inline indent, in levels. */
function neighbourDepth(element: Element): number {
  const style = (element as HTMLElement).style
  const indent = Number.parseFloat(style?.paddingLeft ?? '')
  if (!Number.isFinite(indent)) return 0
  return Math.max(0, Math.round((indent - 6) / 22))
}

/** Press one row's control, if it is still in the document. */
function press(element: Element | null | undefined): boolean {
  const target = element as { click?: () => void; isConnected?: boolean } | null | undefined
  if (target === null || target === undefined) return false
  // A detached row is one an earlier press already took out: pressing it would
  // reach no listener, and its own state was closed by the parent's press.
  if (target.isConnected === false) return false
  if (typeof target.click !== 'function') return false
  target.click()
  return true
}

/** Sort by depth, deepest first, keeping document order within one level. */
function deepestFirst(entries: Array<{ element: Element; depth: number }>): Array<{ element: Element; depth: number }> {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => right.entry.depth - left.entry.depth || left.index - right.index)
    .map(({ entry }) => entry)
}

/**
 * The shell file tree to act on: the one showing `absolutePath` when it names a
 * root, else the first tree in the document (the right column keeps one per
 * pane, and the seat's owner prop names exactly one of them).
 *
 * @param absolutePath - the directory the seat's owner reports, or undefined.
 * @returns the tree element, or null when no listing is on screen.
 */
export function shellTree(absolutePath?: string): Element | null {
  if (typeof document === 'undefined') return null
  const trees = Array.from(document.querySelectorAll(SHELL_TREE))
  if (trees.length === 0) return null
  if (absolutePath !== undefined && absolutePath !== '') {
    const own = trees.find((tree) => tree.getAttribute('data-files-root') === absolutePath)
    if (own !== undefined) return own
  }
  return trees[0]
}

/**
 * Collapse every open directory of the shell's file tree.
 *
 * @param root - the tree (see {@link shellTree}).
 * @returns how many directory controls were pressed.
 */
export function collapseShellTree(root: Element | null): number {
  if (root === null) return 0
  const open = Array.from(root.querySelectorAll(SHELL_OPEN)).map((element) => ({
    element,
    depth: shellDepth(element, root),
  }))
  let pressed = 0
  for (const entry of deepestFirst(open)) {
    if (press(entry.element)) pressed += 1
  }
  return pressed
}

/**
 * Collapse every open directory of `dsh-better-sidebar`'s file tree.
 *
 * A row is open exactly when the next row in document order nests one level
 * deeper — the tree renders a level inside its directory row's wrapper, so the
 * adjacency is the state. File rows never have children, so they never qualify.
 *
 * @param panel - the neighbour's tree panel (the row's own parent element).
 * @returns how many directory rows were pressed.
 */
export function collapseNeighbourTree(panel: Element | null): number {
  if (panel === null) return 0
  const rows = Array.from(panel.querySelectorAll(NEIGHBOUR_ROW)).map((element) => ({
    element,
    depth: neighbourDepth(element),
  }))
  const open = rows.filter((row, index) => {
    const next = rows[index + 1]
    return next !== undefined && next.depth > row.depth
  })
  let pressed = 0
  for (const entry of deepestFirst(open)) {
    if (press(entry.element)) pressed += 1
  }
  return pressed
}
