/**
 * The local-cache tab: a notebook whose pages hold dsh's records for this
 * browser — the tab names what is stored, not the act of clearing it.
 *
 * Glyph ported verbatim from lucide v1.47.0 (`notebook-text`) — ISC, © Lucide
 * Contributors 2022 (portions © 2013-2022 Cole Bemis, MIT),
 * https://lucide.dev/icons/notebook-text — so the tab draws the same shape the
 * rest of the ecosystem draws for "a book of written entries", without a
 * runtime dependency on the package: the paths are inlined here the way the
 * other ported glyphs are (see `features/mcp/icons/CableIcon.tsx`).
 *
 * Lucide draws line art rather than fills: every element strokes in the colour
 * of the element wrapping it and fills nothing, which `STROKE` carries once for
 * all eight nodes — `createIcon`'s `<svg>` shell stays glyph-agnostic.
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

/** The `notebook-text` glyph: spine rings, the book, and three text lines. */
export const NOTEBOOK_TEXT_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M2 6h4', ...STROKE } },
    { tag: 'path', attrs: { d: 'M2 10h4', ...STROKE } },
    { tag: 'path', attrs: { d: 'M2 14h4', ...STROKE } },
    { tag: 'path', attrs: { d: 'M2 18h4', ...STROKE } },
    { tag: 'rect', attrs: { width: 16, height: 20, x: 4, y: 2, rx: 2, ...STROKE } },
    { tag: 'path', attrs: { d: 'M9.5 8h5', ...STROKE } },
    { tag: 'path', attrs: { d: 'M9.5 12H16', ...STROKE } },
    { tag: 'path', attrs: { d: 'M9.5 16H14', ...STROKE } },
  ],
}

export function createNotebookTextIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, NOTEBOOK_TEXT_SPEC)
}
