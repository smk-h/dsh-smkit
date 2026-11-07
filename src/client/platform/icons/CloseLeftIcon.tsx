/**
 * "Close all to the left": the mark the tab menu's one batch row wears.
 *
 * Glyph ported verbatim from lucide v0.261.0 (`arrow-left-to-line`) — ISC,
 * © Lucide Contributors — https://lucide.dev — and inlined here the same way as
 * the glyphs beside it, without taking a runtime dependency on the package.
 *
 * The direction matters: the menu row closes everything left of the clicked
 * tab, so the arrow runs into the bar rather than away from it. The shell's own
 * rows carry glyphs too, and a row without one would break the menu's icon
 * column.
 */

import { createIcon, type IconFactory, type IconSpec } from './Icon'
import type { ClientDeps } from '../types'

/** Lucide's line-art defaults: stroked in `currentColor`, never filled. */
const STROKE: Record<string, string | number> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

/** The `arrow-left-to-line` glyph: a shaft, a head, and the bar it stops at. */
export const CLOSE_LEFT_SPEC: IconSpec = {
  size: 16,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M3 19V5', ...STROKE } },
    { tag: 'path', attrs: { d: 'm13 6-6 6 6 6', ...STROKE } },
    { tag: 'path', attrs: { d: 'M7 12h14', ...STROKE } },
  ],
}

export function createCloseLeftIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, CLOSE_LEFT_SPEC)
}
