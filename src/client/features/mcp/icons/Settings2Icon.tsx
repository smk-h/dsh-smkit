/**
 * Sliders: the "open config file" affordance beside the scope picker.
 *
 * Glyph ported verbatim from lucide v0.261.0 (`settings-2`) — ISC,
 * © Lucide Contributors — https://lucide.dev — inlined here the same way as
 * `LoaderIcon.tsx`, without taking a runtime dependency on the package.
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

/** The `settings-2` glyph: two horizontal sliders on lucide's 24px grid. */
const SETTINGS2_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M20 7h-9', ...STROKE } },
    { tag: 'path', attrs: { d: 'M14 17H5', ...STROKE } },
    { tag: 'circle', attrs: { cx: 17, cy: 17, r: 3, ...STROKE } },
    { tag: 'circle', attrs: { cx: 7, cy: 7, r: 3, ...STROKE } },
  ],
}

export function createSettings2Icon(deps: ClientDeps): IconFactory {
  return createIcon(deps, SETTINGS2_SPEC)
}
