/**
 * Sliders: the settings glyph this plugin draws in two places.
 *
 * Glyph ported verbatim from lucide v0.261.0 (`settings-2`) — ISC, © Lucide
 * Contributors — https://lucide.dev — inlined here the same way as the glyphs
 * beside it, without taking a runtime dependency on the package.
 *
 * It lives in the platform layer rather than in either section that draws it:
 * the MCP section puts it on its "open config file" button, and the
 * custom-settings section paints it on its settings-nav row. A feature may not
 * import another feature and a second verbatim port would be the copy the
 * architecture guard exists to catch, so a glyph two sections share is platform
 * material — like the `<svg>` shell it is drawn with.
 */

import { createIcon, type IconFactory, type IconSpec } from './Icon'
import type { ClientDeps } from '../types'

/** Lucide's line-art defaults: stroked in `currentColor`, never filled. */
const STROKE: Record<string, string | number> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

/** The `settings-2` glyph: two horizontal sliders on lucide's 24px grid. */
export const SETTINGS2_SPEC: IconSpec = {
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
