/**
 * The gallery tab: one puzzle piece, the shape the whole ecosystem draws for
 * "a plugin" — the tab names what the page holds, a shelf of other people's
 * pieces rather than anything this plugin does itself.
 *
 * Glyph ported verbatim from lucide v1.47.0 (`puzzle`) — ISC, © Lucide
 * Contributors 2022 (portions © 2013-2022 Cole Bemis, MIT),
 * https://lucide.dev/icons/puzzle — so the tab draws the same shape the rest
 * of the ecosystem draws, without a runtime dependency on the package: the
 * paths are inlined here the way the other ported glyphs are (see
 * `features/mcp/icons/CableIcon.tsx`).
 *
 * Lucide draws line art rather than fills: the one element strokes in the
 * colour of the element wrapping it and fills nothing, which `STROKE` carries
 * — `createIcon`'s `<svg>` shell stays glyph-agnostic.
 */

import { createIcon, type IconFactory, type IconSpec } from '../../../platform/icons/Icon'
import type { ClientDeps } from '../../../platform/types'

/** Lucide's line-art defaults: stroked in `currentColor`, never filled. */
const STROKE: Record<string, string | number> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

/** The `puzzle` glyph: one contour, four knobs, drawn as a single path. */
export const PUZZLE_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    {
      tag: 'path',
      attrs: {
        d: 'M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z',
        ...STROKE,
      },
    },
  ],
}

export function createPuzzleIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, PUZZLE_SPEC)
}
