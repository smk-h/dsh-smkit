/**
 * The eye glyph the panel's un-ignore button wears.
 *
 * Ported verbatim from lucide's `eye` (ISC, © Lucide Contributors 2022) —
 * https://lucide.nodejs.cn/icons/eye — paired with `eye-off` beside it:
 * taking entries out of .gitignore makes them visible to git again, so this
 * is the button that undoes hiding. The pair reads as one action and its
 * undo at 14px without either sign needing a legend.
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

/** The `eye` glyph on lucide's 24px grid: the outline and its pupil. */
export const EYE_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    {
      tag: 'path',
      attrs: {
        d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
        ...STROKE,
      },
    },
    { tag: 'circle', attrs: { cx: 12, cy: 12, r: 3, ...STROKE } },
  ],
}

export function createEyeIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, EYE_SPEC)
}
