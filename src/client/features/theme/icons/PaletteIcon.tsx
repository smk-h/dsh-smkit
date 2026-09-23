/**
 * The theme tab: a painter's palette — the tab names what the page offers
 * (colour to put on the whole interface), not the act of applying one.
 *
 * Glyph ported verbatim from lucide (`palette`) — ISC, © Lucide Contributors
 * 2022 (portions © 2013-2022 Cole Bemis, MIT), https://lucide.dev/icons/palette
 * — the way the other ported glyphs are (see
 * `features/local-cache/icons/NotebookTextIcon.tsx`): paths inlined, no runtime
 * dependency. The four paint wells are filled dots; the palm is line art.
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

/** The `palette` glyph: four paint wells and the palm with the thumb hole. */
export const PALETTE_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'circle', attrs: { cx: '13.5', cy: '6.5', r: '.5', fill: 'currentColor' } },
    { tag: 'circle', attrs: { cx: '17.5', cy: '10.5', r: '.5', fill: 'currentColor' } },
    { tag: 'circle', attrs: { cx: '8.5', cy: '7.5', r: '.5', fill: 'currentColor' } },
    { tag: 'circle', attrs: { cx: '6.5', cy: '12.5', r: '.5', fill: 'currentColor' } },
    {
      tag: 'path',
      attrs: {
        d: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z',
        ...STROKE,
      },
    },
  ],
}

export function createPaletteIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, PALETTE_SPEC)
}
