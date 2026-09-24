/**
 * The toolbar's two-line state, read off the layout.
 *
 * `McpContent`'s row pairs the scope pill with the search cluster, and its two
 * looks are two different sizing rules for the same elements: on one line the
 * pill hugs its name and the search holds the right edge, while once a long
 * workspace name has pushed the search onto a line of its own the pill is meant
 * to take the row it cleared and the search to fill the one it landed on. No
 * stylesheet can choose between them — nothing differs but the line an item
 * ended up on, and a selector cannot see that — so the wrap is observed here,
 * from the boxes' own geometry, and the row is marked `data-smkit-wrapped` for the
 * rules in `style/section.css` to key off.
 *
 * The measurement keeps no state, and neither the mark nor the rules it turns
 * on can change whether the boxes fit: `flex-grow` never moves a hypothetical
 * size, so both layouts break their lines identically and the answer cannot
 * oscillate between them.
 */

/** Slack allowed between the two boxes' edges before the cluster counts as
 * wrapped: sub-pixel layout rounding is not a second line. */
const LINE_TOLERANCE = 1

/** Whether the search cluster starts at or below the scope pill's bottom edge,
 * or `null` when the row is not laid out (a view that is off screen).
 *
 * Siblings on one line are flush — same height, `align-items: center` — so a
 * second line clears the pill by the row's gap; testing against the pill's
 * bottom edge rather than its top keeps that right however the two boxes'
 * heights differ. */
function rowWraps(bar: HTMLElement): boolean | null {
  const scope = bar.querySelector<HTMLElement>('.smkit-ui-picker')
  const cluster = bar.querySelector<HTMLElement>('.smkit-mcp-section-toolbar-actions')
  if (!scope || !cluster) return null
  const pill = scope.getBoundingClientRect()
  const search = cluster.getBoundingClientRect()
  if (pill.height === 0 || search.height === 0) return null
  return search.top >= pill.bottom - LINE_TOLERANCE
}

/**
 * Report the row's wrap state now and whenever the row is resized, until the
 * returned uninstaller runs.
 *
 * The immediate call covers a workspace renamed or added without the row itself
 * resizing; the observer covers the settings panel being dragged narrower,
 * which re-lays the row out with no render to ride. `ResizeObserver` is absent
 * outside a browser, where there is no layout to read either (the same guard
 * `tip.ts` carries for its listeners).
 */
export function watchRowWrap(bar: HTMLElement, onChange: (wrapped: boolean) => void): () => void {
  const measure = (): void => {
    const wrapped = rowWraps(bar)
    if (wrapped !== null) onChange(wrapped)
  }
  measure()
  if (typeof ResizeObserver === 'undefined') return () => {}
  const observer = new ResizeObserver(measure)
  observer.observe(bar)
  return () => observer.disconnect()
}
