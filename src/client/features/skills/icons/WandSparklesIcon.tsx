/**
 * Skills: the glyph that marks this section's row in DSH's settings nav.
 *
 * Glyph ported verbatim from lucide's `wand-sparkles` (ISC, © Lucide
 * Contributors 2022, portions © 2013-2022 Cole Bemis, MIT) —
 * https://lucide.nodejs.cn/icons/wand-sparkles — so the section draws the
 * wand-with-sparks the ecosystem draws for "a capability that is applied",
 * without taking a runtime dependency on the package: the paths are inlined
 * here the way every other glyph in this plugin is (`icons/Icon.tsx`).
 *
 * Lucide draws line art rather than fills: every element strokes in the colour
 * of the element wrapping it and fills nothing, which `STROKE` carries once for
 * all eight paths — `createIcon`'s `<svg>` shell stays glyph-agnostic. The same
 * spec also feeds the nav row's CSS mask (`styles.ts`), so the drawn icon and
 * the mask cannot drift.
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

/** The `wand-sparkles` glyph: a wand and four sparks, on lucide's 24px grid. */
export const WAND_SPARKLES_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'm21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72', ...STROKE } },
    { tag: 'path', attrs: { d: 'm14 7 3 3', ...STROKE } },
    { tag: 'path', attrs: { d: 'M5 6v4', ...STROKE } },
    { tag: 'path', attrs: { d: 'M19 14v4', ...STROKE } },
    { tag: 'path', attrs: { d: 'M10 2v2', ...STROKE } },
    { tag: 'path', attrs: { d: 'M7 8H3', ...STROKE } },
    { tag: 'path', attrs: { d: 'M21 16h-4', ...STROKE } },
    { tag: 'path', attrs: { d: 'M11 3H9', ...STROKE } },
  ],
}

export function createWandSparklesIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, WAND_SPARKLES_SPEC)
}
