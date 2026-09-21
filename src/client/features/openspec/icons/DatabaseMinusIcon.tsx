/**
 * The database-minus glyph the panel's un-ignore button wears.
 *
 * Ported verbatim from lucide's `database-minus` (ISC, © Lucide Contributors
 * 2022, portions © 2013-2022 Cole Bemis, MIT) —
 * https://lucide.nodejs.cn/icons/database-minus — which reads at a glance as
 * what the button does: the store (lucide's database, top ellipse and two
 * belly curves), opened on its lower right by a minus — entries leaving the
 * ignored set and coming back to the index. The break is in the glyph itself:
 * the right edge stops at `M21 15V5` and the lower arc stops at 13.318, both
 * leaving room for `M22 19h-6`, so the minus is carved out of the database
 * rather than laid on top of it. Like the `atom` this file sits beside, it
 * lives in the feature's own `icons/` because only this control draws it.
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

/** The `database-minus` glyph: a cut-open database and its minus, on lucide's 24px grid. */
export const DATABASE_MINUS_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M21 15V5', ...STROKE } },
    { tag: 'path', attrs: { d: 'M22 19h-6', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3 12A9 3 0 0 0 21 12', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3 5V19A9 3 0 0 0 13.318 21.968', ...STROKE } },
    { tag: 'ellipse', attrs: { cx: 12, cy: 5, rx: 9, ry: 3, ...STROKE } },
  ],
}

export function createDatabaseMinusIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, DATABASE_MINUS_SPEC)
}
