/**
 * Spinner: the arc that marks a connection in transition.
 *
 * Glyph ported verbatim from lucide v0.261.0 (`loader-2` — later lucide
 * releases rename it to `loader-circle`) — ISC, © Lucide Contributors 2022
 * (portions © 2013-2022 Cole Bemis, MIT) — https://lucide.dev — inlined here
 * the same way as `CableIcon.tsx`, without taking a runtime dependency on the
 * package.
 *
 * `StatusPill` renders it in the status-dot slot while the server reports a
 * transient status; `style/pill.css` rotates it (`mm_statusSpin`) and tints it
 * with the same status colour the dot would have had.
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

/** The `loader-2` glyph: one open arc on lucide's 24px grid. */
export const LOADER_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [{ tag: 'path', attrs: { d: 'M21 12a9 9 0 1 1-6.219-8.56', ...STROKE } }],
}

export function createLoaderIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, LOADER_SPEC)
}
