/**
 * The clear button inside the settings pages' filter boxes.
 *
 * Glyph ported verbatim from lucide's `x`, stroked on the 24 grid so it stays
 * legible at the 12 px the button rounds it down to.
 *
 * Shared for the same reason the magnifier beside it is: more than one section
 * renders a filter box (`Icon.tsx` owns that convention).
 */

import { createIcon, type IconFactory } from './Icon'
import type { ClientDeps } from '../types'

/** Lucide's line-art defaults: stroked in `currentColor`, never filled. */
const STROKE: Record<string, string | number> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function createClearIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, {
    size: 12,
    viewBox: '0 0 24 24',
    // One path, two subpaths: lucide draws the cross as two lines, and a
    // single `d` is the same glyph with one node to render.
    nodes: [{ tag: 'path', attrs: { d: 'M18 6 6 18M6 6l12 12', ...STROKE } }],
  })
}
