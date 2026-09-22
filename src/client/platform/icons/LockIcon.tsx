/**
 * The lock on a choice that is fixed on.
 *
 * Glyph taken from lucide's `lock`, stroked on the 24 grid like the other
 * line-art here, so it reads at the small end of a control label without going
 * muddy.
 *
 * It lives beside this file's other shared glyphs because the shared check chip
 * (`platform/ui/CheckChip`) draws it: the mark belongs to that control, not to
 * whichever section happens to wear it.
 */

import { createIcon, type IconFactory } from './Icon'
import type { ClientDeps } from '../types'

/** Lucide's line-art defaults: stroked in `currentColor`, never filled. */
const STROKE: Record<string, string | number> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function createLockIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, {
    size: 11,
    viewBox: '0 0 24 24',
    nodes: [
      { tag: 'rect', attrs: { x: 3, y: 11, width: 18, height: 11, rx: 2, ry: 2, ...STROKE } },
      { tag: 'path', attrs: { d: 'M7 11V7a5 5 0 0 1 10 0v4', ...STROKE } },
    ],
  })
}
