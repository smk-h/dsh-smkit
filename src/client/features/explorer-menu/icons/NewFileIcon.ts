/**
 * The "new file" row's glyph: the `#` the reference menu wears on it.
 *
 * `dsh-better-sidebar` uses `IconCodeOutlineRegular` there, which draws a hash
 * on the 16-grid; this is the same four strokes, at the same 14px menu size.
 */

import type { IconSpec } from '../../../platform/icons/Icon'

export const NEW_FILE_ICON: IconSpec = {
  size: 14,
  viewBox: '0 0 16 16',
  nodes: [
    { tag: 'path', attrs: { d: 'M6.2 2.5V13.5', stroke: 'currentColor', strokeLinecap: 'round' } },
    { tag: 'path', attrs: { d: 'M9.8 2.5V13.5', stroke: 'currentColor', strokeLinecap: 'round' } },
    { tag: 'path', attrs: { d: 'M2.7 6.1H13.3', stroke: 'currentColor', strokeLinecap: 'round' } },
    { tag: 'path', attrs: { d: 'M2.7 9.9H13.3', stroke: 'currentColor', strokeLinecap: 'round' } },
  ],
}
