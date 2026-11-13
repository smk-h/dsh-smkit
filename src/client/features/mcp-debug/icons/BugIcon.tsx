/**
 * Debugging: the glyph on this page's launcher in the shell's left rail.
 *
 * Glyph ported verbatim from lucide (`bug`) — ISC, © Lucide Contributors 2022
 * (portions © 2013-2022 Cole Bemis, MIT) — https://lucide.dev, so the rail draws
 * the icon the rest of the ecosystem draws for "inspect something running",
 * without taking a runtime dependency on the package: the paths are inlined here
 * the same way the neighbouring glyphs are (see `platform/icons/Icon.tsx`).
 *
 * Lucide draws line art rather than fills: every element strokes in the colour
 * of the element wrapping it and fills nothing, which `STROKE` carries once for
 * all nine paths — `createIcon`'s `<svg>` shell stays glyph-agnostic.
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

/** The `bug` glyph: antennae, carapace and six legs, on lucide's 24px grid. */
export const BUG_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'm8 2 1.88 1.88', ...STROKE } },
    { tag: 'path', attrs: { d: 'M14.12 3.88 16 2', ...STROKE } },
    { tag: 'path', attrs: { d: 'M9 7.13v-1a3.003 3.003 0 1 1 6 0v1', ...STROKE } },
    {
      tag: 'path',
      attrs: {
        d: 'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6',
        ...STROKE,
      },
    },
    { tag: 'path', attrs: { d: 'M12 20v-9', ...STROKE } },
    { tag: 'path', attrs: { d: 'M6.53 9C4.6 8.8 3 7.1 3 5', ...STROKE } },
    { tag: 'path', attrs: { d: 'M6.53 15C4.6 15.2 3 16.9 3 19', ...STROKE } },
    { tag: 'path', attrs: { d: 'M17.47 9c1.93-.2 3.53-1.9 3.53-4', ...STROKE } },
    { tag: 'path', attrs: { d: 'M17.47 15c1.93.2 3.53 1.9 3.53 4', ...STROKE } },
  ],
}

export function createBugIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, BUG_SPEC)
}
