/**
 * The left-pointing chevron the tab strip's overflow buttons wear (see
 * `platform/ui/Tabs`).
 *
 * The mirror of `ChevronRightIcon`, drawn on the same grid in the same stroke,
 * so the pair beside a strip reads as one control whichever way it points.
 */

import { createIcon, type IconFactory } from './Icon'
import type { ClientDeps } from '../types'

export function createChevronLeftIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, {
    size: 14,
    viewBox: '0 0 16 16',
    nodes: [
      { tag: 'path', attrs: { d: 'M10 3.5L5.5 8L10 12.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } }
    ],
  })
}
