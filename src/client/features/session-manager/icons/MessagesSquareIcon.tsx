/**
 * The session-manager tab: two overlapping conversation bubbles.
 *
 * Glyph ported verbatim from lucide v1.47.0 (`messages-square`) — ISC,
 * © Lucide Contributors 2022 (portions © 2013-2022 Cole Bemis, MIT),
 * https://lucide.dev/icons/messages-square — the shape the ecosystem draws
 * for "a set of conversations", which is what the page lists. The paths are
 * inlined here the way the other ported glyphs are (see
 * `features/local-cache/icons/NotebookTextIcon.tsx`); no runtime dependency.
 *
 * Lucide draws line art rather than fills: every element strokes in the
 * colour of the element wrapping it and fills nothing, which `STROKE` carries
 * once for both nodes — `createIcon`'s `<svg>` shell stays glyph-agnostic.
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

/** The `messages-square` glyph: one bubble answered by a second. */
export const MESSAGES_SQUARE_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z', ...STROKE } },
    { tag: 'path', attrs: { d: 'M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1', ...STROKE } },
  ],
}

export function createMessagesSquareIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, MESSAGES_SQUARE_SPEC)
}
