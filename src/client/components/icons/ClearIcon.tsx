/**
 * The clear button inside the server search field.
 *
 * Glyph ported verbatim from lucide's `x`, drawn as two stroked lines on the
 * 24 grid, so it stays legible at the 12 px the button rounds it down to.
 */

import { createIcon, type IconFactory } from './Icon'
import type { ClientDeps } from '../../runtime/types'

export function createClearIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, {
    size: 12,
    viewBox: '0 0 24 24',
    nodes: [
      {
        tag: 'path',
        attrs: {
          d: 'M18 6 6 18',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
      },
      {
        tag: 'path',
        attrs: {
          d: 'm6 6 12 12',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
      },
    ],
  })
}
