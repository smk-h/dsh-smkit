/**
 * OpenSpec: the glyph the conversation header's OpenSpec control wears.
 *
 * Glyph ported verbatim from lucide's `atom` (ISC, © Lucide Contributors 2022,
 * portions © 2013-2022 Cole Bemis, MIT) —
 * https://lucide.nodejs.cn/icons/atom — the shape the OpenSpec project itself
 * leads with, and the one the ecosystem reads as "spec-driven workflow": a
 * nucleus with two crossing orbits.
 *
 * Lucide draws line art rather than fills: every element strokes in the colour
 * of the element wrapping it and fills nothing, which `STROKE` carries once for
 * all three paths — `createIcon`'s `<svg>` shell stays glyph-agnostic. The
 * nucleus is a `circle` rather than a filled dot, so it grows with the stroke
 * the same way the orbits do at any size.
 *
 * It lives in this feature's own `icons/` rather than beside `Icon.tsx` because
 * only this control draws it (the convention `platform/icons/Icon.tsx`
 * states).
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

/** The `atom` glyph: a nucleus and two orbits, on lucide's 24px grid. */
export const ATOM_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 1, ...STROKE } },
    { tag: 'path', attrs: { d: 'M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z', ...STROKE } },
    { tag: 'path', attrs: { d: 'M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z', ...STROKE } },
  ],
}

export function createAtomIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, ATOM_SPEC)
}
