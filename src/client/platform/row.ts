/**
 * Where a decorated file-tree row keeps its own content.
 *
 * `ui-sidebar-files` draws one row per entry, and the shape of that row changed
 * under the shell's own feet: up to 0.1.x the row button was the `<li>`'s own
 * child, so a plugin parked its content beside the button with a grid on the
 * `<li>`; from 0.2.2 the `<li>` wraps the row in a flex container (a button,
 * then an accessory cell), so the same content belongs inside that container
 * and the shell's own flex line places it.
 *
 * Asking by tag, never by the shell's hashed class names, is what keeps this
 * working across builds — and asking direct children only is what keeps it
 * cheap: an expanded directory's `<li>` owns its children's rows too, so a
 * subtree query per row is O(n²) on a deep tree (which is exactly what made a
 * loading tree crawl).
 *
 * Two features decorate these rows — the explorer menu (its "copied" label and
 * its kept-lit fill) and the reference insertion reachable from that menu — so
 * the shape question lives here rather than in either of them.
 */

/**
 * The element a row's own content is appended to.
 * @param entry - one `li[data-files-entry]`.
 * @returns the row container; the `<li>` itself when it has no wrapper.
 */
export function rowContainerOf(entry: Element): Element {
  const children = Array.from(entry.children)
  for (const child of children) {
    if (child.tagName === 'BUTTON') return entry
  }
  for (const child of children) {
    if (child.tagName === 'DIV') return child
  }
  return entry
}

/**
 * The shell's own row button.
 * @param entry - one `li[data-files-entry]`.
 * @returns the button that opens the entry, or null when the row draws none
 *   (an unopenable file is a `<span>`, not a button).
 */
export function rowButtonOf(entry: Element): Element | null {
  const container = rowContainerOf(entry)
  for (const child of Array.from(container.children)) {
    if (child.tagName === 'BUTTON') return child
  }
  return null
}
