/**
 * The "delete" row's glyph: a trash can, on the 16-grid at the same 14px menu
 * size.
 *
 * `dsh-better-sidebar` uses `IconTrashOutlineRegular` there; this is the same
 * shape — lid, body, two ribs — and the row paints it in the danger ink.
 */

import type { IconSpec } from '../../../platform/icons/Icon'

export const DELETE_ICON: IconSpec = {
  size: 14,
  viewBox: '0 0 16 16',
  nodes: [
    { tag: 'path', attrs: { d: 'M2.8 4.4h10.4', stroke: 'currentColor', strokeLinecap: 'round' } },
    { tag: 'path', attrs: { d: 'M6.2 4.4V3.2c0-.4.3-.7.7-.7h2.2c.4 0 .7.3.7.7v1.2', stroke: 'currentColor', strokeLinecap: 'round' } },
    { tag: 'path', attrs: { d: 'M4 4.4l.6 8.2c0 .5.4.9.9.9h5c.5 0 .9-.4.9-.9L12 4.4', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } },
    { tag: 'path', attrs: { d: 'M6.7 7v4', stroke: 'currentColor', strokeLinecap: 'round' } },
    { tag: 'path', attrs: { d: 'M9.3 7v4', stroke: 'currentColor', strokeLinecap: 'round' } },
  ],
}
