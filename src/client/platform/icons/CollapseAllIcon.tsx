/**
 * "Collapse all": the mark on the file tree's fold-everything control.
 *
 * Glyph is VSCode's codicon `collapse-all` (`VscCollapseAll` from
 * `react-icons/vsc`, MIT; the artwork itself is Microsoft's codicon set,
 * CC-BY-4.0), so the control wears the very shape the Explorer's
 * "Collapse Folders in Explorer" command wears instead of a second invention
 * for the same act.
 *
 * Two surfaces draw it, in two different ways, so the file exports both halves:
 *
 * - the shell's file-tree header is a slot, and a slot entry is a component —
 *   `createCollapseAllIcon` answers the factory `createIcon` gives every other
 *   icon of this set;
 * - the neighbour's toolbar (`dsh-better-sidebar`) is not a React surface this
 *   plugin may render into, so its button is built with `createElementNS` and
 *   takes the glyph as the `COLLAPSE_ALL_ICON` spec (`iconSvg` reads it), the
 *   same data-not-JSX rule the rest of the set follows.
 */

import { createIcon, type IconFactory, type IconSpec } from './Icon'
import type { ClientDeps } from '../types'

/** The glyph as data: three filled shapes on the 16px grid codicons use. */
export const COLLAPSE_ALL_ICON: IconSpec = {
  size: 15,
  viewBox: '0 0 16 16',
  nodes: [
    // The sheet behind: the stack the front one folds into.
    {
      tag: 'path',
      attrs: {
        d: 'M14 4.27051C14.5999 4.62053 15 5.26009 15 6V11C15 13.21 13.21 15 11 15H6C5.26009 15 4.62053 14.5999 4.27051 14H11C12.65 14 14 12.65 14 11V4.27051Z',
        fill: 'currentColor',
      },
    },
    // The dash: what "collapsed" looks like inside the sheet.
    {
      tag: 'path',
      attrs: {
        d: 'M9.5 7C9.776 7 10 7.224 10 7.5C10 7.776 9.776 8 9.5 8H5.5C5.224 8 5 7.776 5 7.5C5 7.224 5.224 7 5.5 7H9.5Z',
        fill: 'currentColor',
      },
    },
    // The front sheet, as an outline (even-odd, so the interior stays hollow).
    {
      tag: 'path',
      attrs: {
        d: 'M11 2C12.103 2 13 2.897 13 4V11C13 12.103 12.103 13 11 13H4C2.897 13 2 12.103 2 11V4C2 2.897 2.897 2 4 2H11ZM4 3C3.449 3 3 3.449 3 4V11C3 11.552 3.449 12 4 12H11C11.551 12 12 11.552 12 11V4C12 3.449 11.551 3 11 3H4Z',
        fill: 'currentColor',
        fillRule: 'evenodd',
        clipRule: 'evenodd',
      },
    },
  ],
}

export function createCollapseAllIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, COLLAPSE_ALL_ICON)
}
