/**
 * The code outline toggle's glyph: a list, with the branches it belongs to.
 *
 * Glyph ported verbatim from Lucide's `list-tree` (ISC, © Lucide Contributors),
 * https://lucide.nodejs.cn/icons/list-tree — the outline lists the symbols a
 * file holds, one entry per declaration, which is what this mark draws: three
 * leaf rows hanging off one bracket. The grid is Lucide's own (24) and the
 * element is drawn at 16px, so the 2-unit stroke lands at 1.33px and the
 * drawing keeps the weight Lucide tuned for it.
 *
 * Deliberately data, not a component factory: the toggle is DOM decoration hung
 * on the host's preview header and on an editor tab (`watch.ts`), so it is
 * built with `createElementNS` (`iconSvg` in `platform/icons/Icon.tsx`) rather
 * than handed to `createIcon` — the same rule `markdown-outline`'s toggle
 * follows. Attributes are spelled as React names, as everywhere in the icon
 * set; `iconSvg` converts them to SVG's own spelling on the way into the DOM.
 */

import type { IconSpec } from '../../../platform/icons/Icon'

/** Lucide's stroke settings, on each path: the shell only adds `fill: none`. */
const STROKE = {
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export const LIST_TREE_ICON: IconSpec = {
  size: 16,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M21 12h-8', ...STROKE } },
    { tag: 'path', attrs: { d: 'M21 6H8', ...STROKE } },
    { tag: 'path', attrs: { d: 'M21 18h-8', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3 6v4c0 1.1.9 2 2 2h3', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3 10v6c0 1.1.9 2 2 2h3', ...STROKE } },
  ],
}
