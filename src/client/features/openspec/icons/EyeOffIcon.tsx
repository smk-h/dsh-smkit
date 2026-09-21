/**
 * The eye-off glyph the panel's ignore button wears.
 *
 * Ported verbatim from lucide's `eye-off` (ISC, © Lucide Contributors 2022) —
 * https://lucide.nodejs.cn/icons/eye-off — the exact metaphor of writing a
 * path into .gitignore: git stops looking at it, so the eye is struck out.
 * Paired with `eye`, the two buttons read as hide and un-hide — one action
 * and its undo — which is precisely what the footer row is.
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

/** The `eye-off` glyph on lucide's 24px grid: a struck-out eye, three arc fragments and the slash. */
export const EYE_OFF_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    {
      tag: 'path',
      attrs: {
        d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
        ...STROKE,
      },
    },
    { tag: 'path', attrs: { d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242', ...STROKE } },
    {
      tag: 'path',
      attrs: {
        d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
        ...STROKE,
      },
    },
    { tag: 'path', attrs: { d: 'm2 2 20 20', ...STROKE } },
  ],
}

export function createEyeOffIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, EYE_OFF_SPEC)
}
