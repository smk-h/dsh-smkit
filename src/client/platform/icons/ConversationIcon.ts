/**
 * "Put this in the conversation": a message bubble with a plus.
 *
 * Glyph ported verbatim from [lucide](https://lucide.nodejs.cn/icons/message-square-plus)'s
 * `message-square-plus` (lucide-static v0.536.0 — the version that icon page
 * last changed at — ISC, © Lucide Contributors), on its own 24-unit grid. The
 * three `path` elements are the upstream ones; only the stroke differs, and only
 * in where it is declared: the menu rows draw the mark at 14px, where lucide's
 * 2px stroke lands at ~1.2px while the copy mark beside it strokes at ~0.9px, so
 * it is declared per node at 1.6 (with lucide's round joins, which is what keeps
 * the small plus legible) to put both rows' marks at the same visual weight.
 *
 * It lives in the platform layer because two features draw it: the selection
 * card's "add to conversation" row and the explorer menu's "send this file to
 * the conversation" row. A feature may not import another feature, and a second
 * verbatim port is exactly the copy the architecture guard exists to catch.
 */

import type { IconSpec } from './Icon'

/** The stroke every node of this outline glyph carries (see the header). */
const STROKE = {
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const CONVERSATION_ICON: IconSpec = {
  size: 14,
  viewBox: '0 0 24 24',
  nodes: [
    {
      tag: 'path',
      attrs: {
        d: 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z',
        ...STROKE,
      },
    },
    { tag: 'path', attrs: { d: 'M12 8v6', ...STROKE } },
    { tag: 'path', attrs: { d: 'M9 11h6', ...STROKE } },
  ],
}
