/**
 * Auto-clamping for the `.smkit-ui-tip` hover bubbles.
 *
 * The bubble is a `::after` pseudo-element centered above its element (the
 * rules live in `platform/style/tip.css`, so every page that marks an element
 * with the class gets the same bubble), which means an element near a clipping
 * edge — the panel's `overflow`, or the window itself — pushes half of the
 * bubble past the boundary and gets it cut. Rather than hand-tagging edge
 * elements with alignment variants, the bubble's horizontal shift is a CSS
 * variable: one delegated `pointerover` measures the rendered pseudo-element,
 * walks the element's ancestors for real clip boundaries, and writes the
 * smallest shift that keeps the bubble inside them into `--smkit-ui-tip-shift`
 * (consumed by `.smkit-ui-tip::after`'s transform). Removing the variable on leave
 * resets for the next hover; `focusin` covers the keyboard path, whose tooltip
 * shows without any pointer event.
 *
 * Measuring works while the bubble is still invisible: it is hidden with
 * `opacity` only, so its layout — and therefore its width — exists from the
 * start, and the shift is in place before the hover fade-in begins.
 *
 * `clipBounds` is exported because a page may place a floating card of its own
 * from the same boundaries: the MCP tool list's hover card is such a box, and
 * one parented outside the panel would be clipped there exactly like a bubble.
 *
 * It sits in the platform layer rather than in a feature because both settings
 * pages render bubbles — the MCP page's toolbar buttons and scope picker, the
 * Skills page's scope picker — and one delegated listener set serves a whole
 * document.
 */

/** Horizontal breathing room kept between the bubble and a clip edge. */
const GUTTER = 4

/** The rectangle a floating box has to fit inside, in viewport coordinates. */
export interface ClipBounds {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * The area an element's floating box may span: the clip ancestors between the
 * anchor and its fixed-positioned root, narrowed to the window itself, with
 * `gutter` kept clear inside every edge.
 *
 * The walk must stop at the fixed root. A floating panel (DSH's settings
 * dialog, a modal overlay) is `position: fixed` and escapes plain `overflow`
 * clipping, yet its mount point often sits in the DOM under an unrelated
 * hidden-overflow column — DSH nests it under the 280px sidebar column, and
 * counting that column once shifted every bubble half a screen away. Within
 * the fixed subtree the clips are real: the dialog's own scroll area and
 * panel bounds are exactly what cuts a bubble on the right edge.
 */
export function clipBounds(anchor: HTMLElement, gutter = 0): ClipBounds {
  let left = 0
  let right = window.innerWidth
  let top = 0
  let bottom = window.innerHeight
  let ceiling: HTMLElement | null = null
  for (let node = anchor.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).position === 'fixed') ceiling = node
  }
  for (let node = anchor.parentElement; node && node !== ceiling; node = node.parentElement) {
    const style = getComputedStyle(node)
    const clips =
      /(hidden|clip|auto|scroll)/.test(style.overflowX) ||
      /(hidden|clip|auto|scroll)/.test(style.overflowY) ||
      /paint|strict|content/.test(style.contain)
    if (!clips) continue
    const box = node.getBoundingClientRect()
    const edge = (side: 'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom'): number => {
      const value = Number.parseFloat(style[side])
      return Number.isFinite(value) ? value : 0
    }
    left = Math.max(left, box.left + edge('paddingLeft'))
    right = Math.min(right, box.right - edge('paddingRight'))
    top = Math.max(top, box.top + edge('paddingTop'))
    bottom = Math.min(bottom, box.bottom - edge('paddingBottom'))
  }
  return { left: left + gutter, right: right - gutter, top: top + gutter, bottom: bottom - gutter }
}

/** Write the shift keeping a centered bubble of `width` inside the bounds. */
function clampTip(button: HTMLElement): void {
  const width = parseFloat(getComputedStyle(button, '::after').width)
  if (!width || !Number.isFinite(width)) return
  const box = button.getBoundingClientRect()
  const center = box.left + box.width / 2
  const { left, right } = clipBounds(button, GUTTER)
  let shift = 0
  if (center - width / 2 < left) shift = left - (center - width / 2)
  else if (center + width / 2 > right) shift = right - (center + width / 2)
  button.style.setProperty('--smkit-ui-tip-shift', `${shift}px`)
}

/**
 * Install the document-level listeners; returns the uninstaller for the
 * caller's effect cleanup. Delegation means one listener set serves every
 * `.smkit-ui-tip` on the page, present and future, and no element opts in beyond
 * carrying the class and its `data-smkit-tip` label.
 */
export function watchTipBoundaries(): () => void {
  // `document` is absent outside a browser (the hook test harness runs the
  // bundle in a bare context) — the same guard the pickers carry.
  if (typeof document === 'undefined') return () => {}
  // Targets are matched as `Element`, not `HTMLElement`: the pointer usually
  // sits on the element's inner `<svg>`, which is an SVGElement — rejecting
  // non-HTML targets would skip exactly the hover this exists for.
  const over = (event: PointerEvent): void => {
    const target = event.target
    if (target instanceof Element) {
      const button = target.closest<HTMLElement>('.smkit-ui-tip')
      if (button) clampTip(button)
    }
  }
  const out = (event: PointerEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLElement>('.smkit-ui-tip')
    if (!button) return
    // Moving between the element's own children fires `pointerout` too; only a
    // leave that no longer lands inside it clears the shift.
    const related = event.relatedTarget
    if (related instanceof Node && button.contains(related)) return
    button.style.removeProperty('--smkit-ui-tip-shift')
  }
  const focusin = (event: FocusEvent): void => {
    const target = event.target
    if (target instanceof Element && target.matches('.smkit-ui-tip')) clampTip(target as HTMLElement)
  }
  document.addEventListener('pointerover', over)
  document.addEventListener('pointerout', out)
  document.addEventListener('focusin', focusin)
  return () => {
    document.removeEventListener('pointerover', over)
    document.removeEventListener('pointerout', out)
    document.removeEventListener('focusin', focusin)
  }
}
