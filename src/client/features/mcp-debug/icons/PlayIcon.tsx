/**
 * "Run this" — the glyph on the tool pane's run button.
 *
 * Glyph ported from lucide (`play`) — ISC, © Lucide Contributors 2022 (portions
 * © 2013-2022 Cole Bemis, MIT) — https://lucide.dev. Unlike the line art beside
 * it this one is a solid triangle: the button is the page's one primary action,
 * and a filled glyph reads as "press" at the 14px the row draws it at.
 */

import { createIcon, type IconFactory, type IconSpec } from '../../../platform/icons/Icon'
import type { ClientDeps } from '../../../platform/types'

/** The `play` glyph: one triangle, filled in the colour of the button's ink. */
export const PLAY_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    {
      tag: 'path',
      attrs: {
        d: 'M6 3 20 12 6 21Z',
        fill: 'currentColor',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinejoin: 'round',
      },
    },
  ],
}

export function createPlayIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, PLAY_SPEC)
}
