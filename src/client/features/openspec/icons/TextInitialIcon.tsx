/**
 * The letter-initial glyph the panel's initialise button wears.
 *
 * Ported verbatim from lucide's `text-initial` (ISC, © Lucide Contributors
 * 2022) — https://lucide.nodejs.cn/icons/text-initial — an `I` set beside the
 * lines of text it stands for: a store that has to be written before any of
 * this panel has a subject. The button is the panel's one act of creation, so
 * it is the one glyph in the row that carries a colour of its own rather than
 * the panel's ink — amber while there is nothing to create, green once there
 * is, the way the delete button carries the platform's red.
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

/** The `text-initial` glyph on lucide's 24px grid: an A-frame letter and four rules. */
export const TEXT_INITIAL_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M15 5h6', ...STROKE } },
    { tag: 'path', attrs: { d: 'M15 12h6', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3 19h18', ...STROKE } },
    { tag: 'path', attrs: { d: 'm3 12 3.553-7.724a.5.5 0 0 1 .894 0L11 12', ...STROKE } },
    { tag: 'path', attrs: { d: 'M3.92 10h6.16', ...STROKE } },
  ],
}

export function createTextInitialIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, TEXT_INITIAL_SPEC)
}
