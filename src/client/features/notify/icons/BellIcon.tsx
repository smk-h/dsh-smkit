/**
 * The notify tab's glyph: a bell — the tab names what rings when dsh needs
 * the user who is not looking at it.
 *
 * Glyph ported verbatim from lucide v1.47.0 (`bell`) — ISC, © Lucide
 * Contributors 2022 (portions © 2013-2022 Cole Bemis, MIT),
 * https://lucide.dev/icons/bell — the way the other ported glyphs are
 * (see `features/local-cache/icons/NotebookTextIcon.tsx`).
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

/** The `bell` glyph: the bell body, its clapper, and the shoulder line. */
export const BELL_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M10.268 21a2 2 0 0 0 3.464 0', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326', ...STROKE } },
  ],
}

export function createBellIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, BELL_SPEC)
}
