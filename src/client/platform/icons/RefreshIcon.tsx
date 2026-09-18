/**
 * The circular-arrow glyph the shared refresh button draws.
 *
 * Glyph ported verbatim from lucide's `refresh-ccw`
 * (https://lucide.nodejs.cn/icons/refresh-ccw) — ISC, © Lucide Contributors
 * 2022 (portions © 2013-2022 Cole Bemis, MIT) — and inlined the same way as
 * `LoaderIcon.tsx`, without taking a runtime dependency on the package.
 *
 * Four elements, exactly as upstream draws it: two arcs around the grid's
 * centre, plus the two corner brackets that stand in for arrowheads — upper
 * left for the counter-clockwise half, lower right for the other. It stays
 * legible at the 14px the button rounds it down to, which is why the port is
 * verbatim rather than simplified.
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

/** The `refresh-ccw` glyph, element for element: two arcs, two arrowheads. */
const REFRESH_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3 3v5h5', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16', ...STROKE } },
    { tag: 'path', attrs: { d: 'M16 16h5v5', ...STROKE } },
  ],
}

export function createRefreshIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, REFRESH_SPEC)
}
