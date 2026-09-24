/**
 * Where the palette panel hangs: the conversation column's right edge, not the
 * window's.
 *
 * The panel is portaled to the body, and its stylesheet pins it to the
 * viewport's top-right corner — right until the shell's own right Sidebar
 * opens, when the panel is left floating over that Sidebar instead of sitting
 * under the header it dropped from. The conversation column is the panel's real
 * corner: the header is the element the toggle is seated in, its border box is
 * the width that column has left once the right Sidebar's track is taken out
 * of it (and the left Sidebar's, too), and its right edge is therefore exactly
 * where the toggle travels to. Aligning the panel's right edge to the header's
 * — at the same 12px inset the stylesheet gives it against the window — puts
 * the panel back under its own toggle, and takes it left with that toggle
 * whenever either Sidebar changes width.
 *
 * Measured rather than computed: the frame solves its three columns in JS and
 * publishes no width to a plugin (`ctx.layout` is actions only). The header's
 * own box is the resolved answer, and a `ResizeObserver` on it delivers an
 * observation per frame of the frame's own column transition — and per frame of
 * a dragged divider — so there is no event to ride and nothing to poll.
 */

/**
 * The stylesheet's inset from the window's corner, reused against the column's:
 * the two cases have to read as the same panel, in the same corner.
 * (`style/palette.css` declares the same 12px; the two have to agree.)
 */
const CORNER_INSET = 12

/** The offset the anchor's box asks for, or `null` for an anchor that has no
 * box to measure (the shell hides the header, or has not laid it out yet). */
function insetFrom(anchor: Element): string | null {
  const box = anchor.getBoundingClientRect()
  if (box.width === 0) return null
  const column = window.innerWidth - box.right
  return `${Math.max(CORNER_INSET, column + CORNER_INSET)}px`
}

/**
 * Pin the panel's right edge to the anchor's and keep it there while the anchor
 * moves, until the returned uninstaller runs.
 *
 * An anchor with no box hands the panel back to the stylesheet — the window's
 * corner is a panel that still works, which beats a measurement of nothing.
 * `ResizeObserver` is absent outside a browser, where there is no layout to
 * read either (the same guard `mcp/ui/rowWrap.ts` and `platform/ui/tip.ts`
 * carry): the one placement still happens, nothing follows it.
 */
export function watchPanelAnchor(panel: HTMLElement, anchor: Element): () => void {
  const place = (): void => {
    const inset = insetFrom(anchor)
    panel.style.right = inset ?? ''
  }
  place()
  if (typeof ResizeObserver === 'undefined') return () => {}
  const observer = new ResizeObserver(place)
  observer.observe(anchor)
  return () => observer.disconnect()
}
