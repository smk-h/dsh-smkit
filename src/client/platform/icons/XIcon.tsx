/**
 * The cross: the glyph a corner button draws to dismiss or to empty something.
 *
 * Glyph ported verbatim from lucide (`x`) — ISC, © Lucide Contributors 2022
 * (portions © 2013-2022 Cole Bemis, MIT), https://lucide.dev/icons/x — the way
 * the other ported glyphs are: one path inlined, no runtime dependency. Stroked
 * on the 24 grid so it stays legible at the 12 px the filter boxes round it
 * down to.
 *
 * Shared for the same reason the magnifier is (`Icon.tsx` owns that convention):
 * more than one section draws it, and it means the same thing in each — the
 * filter boxes' clear button, a dialog's close button, the palette panel's.
 * Naming it for the glyph rather than for one of those acts is what lets one
 * file serve all of them.
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

export function createXIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, {
    size: 12,
    viewBox: '0 0 24 24',
    // One path, two subpaths: lucide draws the cross as two lines, and a
    // single `d` is the same glyph with one node to render.
    nodes: [{ tag: 'path', attrs: { d: 'M18 6 6 18M6 6l12 12', ...STROKE } }],
  })
}
