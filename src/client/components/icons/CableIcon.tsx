/**
 * Connections: the glyph that marks this section's row in DSH's settings nav.
 *
 * Glyph ported verbatim from lucide v0.261.0 (`cable`) — ISC, © Lucide
 * Contributors 2022 (portions © 2013-2022 Cole Bemis, MIT) —
 * https://lucide.dev — so the section draws the plug-and-cord icon the rest of
 * the ecosystem draws for "a link between two ends", without taking a runtime
 * dependency on the package: the paths are inlined here the same way the DSH
 * glyphs beside this file are (see `FolderIcon.tsx`).
 *
 * Lucide draws line art rather than fills: every element strokes in the colour
 * of the element wrapping it and fills nothing, which `STROKE` carries once for
 * all seven paths — `createIcon`'s `<svg>` shell stays glyph-agnostic.
 */

import { createIcon, type IconFactory, type IconSpec } from './Icon'
import type { ClientDeps } from '../../runtime/types'

/** Lucide's line-art defaults: stroked in `currentColor`, never filled. */
const STROKE: Record<string, string | number> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

/** The `cable` glyph: two plugs joined by one cord, on lucide's 24px grid. */
export const CABLE_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z', ...STROKE } },
    { tag: 'path', attrs: { d: 'M17 21v-2', ...STROKE } },
    { tag: 'path', attrs: { d: 'M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10', ...STROKE } },
    { tag: 'path', attrs: { d: 'M21 21v-2', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3 5V3', ...STROKE } },
    { tag: 'path', attrs: { d: 'M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2z', ...STROKE } },
    { tag: 'path', attrs: { d: 'M7 5V3', ...STROKE } },
  ],
}

export function createCableIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, CABLE_SPEC)
}
