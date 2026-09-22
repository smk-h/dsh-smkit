/**
 * The disclosure caret on the model mini-cards' expand button.
 *
 * Glyph ported verbatim from the host's `ModelListEditor` row
 * (`IconChevron`, ui-settings-models): a right-pointing chevron that the card
 * turns 90° clockwise into a down-pointing one while its body is open.
 */

import { createIcon, type IconFactory } from './Icon'
import type { ClientDeps } from '../types'

export function createChevronRightIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, {
    size: 14,
    viewBox: '0 0 16 16',
    nodes: [
      { tag: 'path', attrs: { d: 'M6 3.5L10.5 8L6 12.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } }
    ],
  })
}
