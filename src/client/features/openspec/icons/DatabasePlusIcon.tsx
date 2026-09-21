/**
 * The database-plus glyph the panel's ignore button wears.
 *
 * Ported verbatim from lucide's `database-plus` (ISC, © Lucide Contributors
 * 2022, portions © 2013-2022 Cole Bemis, MIT) —
 * https://lucide.nodejs.cn/icons/database-plus — the deliberate twin of the
 * `database-minus` beside it: the same store, the same break in its lower
 * right, only the sign reversed — entries leaving the index and going into
 * git's ignore list. The two glyphs read as one pair at 14px, which is what
 * the footer's reversible-actions row is: one action and its undo.
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

/** The `database-plus` glyph: a cut-open database and its plus, on lucide's 24px grid. */
export const DATABASE_PLUS_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M19 16v6', ...STROKE } },
    { tag: 'path', attrs: { d: 'M21 12.536V5', ...STROKE } },
    { tag: 'path', attrs: { d: 'M22 19h-6', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3 12A9 3 0 0 0 15.1824 14.8061', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3 5V19A9 3 0 0 0 13.318 21.968', ...STROKE } },
    { tag: 'ellipse', attrs: { cx: 12, cy: 5, rx: 9, ry: 3, ...STROKE } },
  ],
}

export function createDatabasePlusIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, DATABASE_PLUS_SPEC)
}
