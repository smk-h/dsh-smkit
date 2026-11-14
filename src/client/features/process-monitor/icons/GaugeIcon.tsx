/**
 * Resource use: the glyph on this page's launcher in the shell's left rail.
 *
 * Glyph ported verbatim from lucide (`activity`) — ISC, © Lucide Contributors
 * 2022 (portions © 2013-2022 Cole Bemis, MIT) — https://lucide.dev, the
 * heartbeat line the ecosystem draws for "something is running and being
 * measured". Ported by inlining the paths the same way the neighbouring
 * glyphs are (see `platform/icons/Icon.tsx`): no runtime dependency, and the
 * rail keeps drawing line art that matches its other icons.
 *
 * Lucide draws line art rather than fills: the single path strokes in the
 * colour of the element wrapping it and fills nothing, which `STROKE` carries
 * once — `createIcon`'s `<svg>` shell stays glyph-agnostic.
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

/** The `activity` glyph: one heartbeat pulse across a 24px grid. */
export const GAUGE_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    {
      tag: 'path',
      attrs: {
        d: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.04 3.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.28 13H2',
        ...STROKE,
      },
    },
  ],
}

export function createGaugeIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, GAUGE_SPEC)
}
