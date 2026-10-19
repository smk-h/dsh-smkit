/**
 * The "rename" row's glyph: a pencil, on the same 16-grid and at the same 14px
 * menu size as the other rows.
 *
 * `dsh-better-sidebar` uses `IconEditOutlineRegular` there; this is the same
 * pencil, drawn here so the plugin carries no icon dependency.
 */

import type { IconSpec } from '../../../platform/icons/Icon'

export const RENAME_ICON: IconSpec = {
  size: 14,
  viewBox: '0 0 16 16',
  nodes: [
    {
      tag: 'path',
      attrs: {
        d: 'M2.6 13.4l.7-2.9 7.3-7.3a1.5 1.5 0 0 1 2.2 2.2l-7.3 7.3-2.9.7z',
        stroke: 'currentColor',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
    },
    { tag: 'path', attrs: { d: 'M9.6 4.4l2 2', stroke: 'currentColor', strokeLinecap: 'round' } },
  ],
}
