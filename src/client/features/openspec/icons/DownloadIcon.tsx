/**
 * The download glyph the panel's upgrade button wears.
 *
 * Ported verbatim from lucide's `download` (ISC, © Lucide Contributors 2022) —
 * https://lucide.nodejs.cn/icons/download — an arrow into a tray: the thing
 * that arrives comes from further away than the one the reload glyph brings.
 * The button runs `npm install -g @fission-ai/openspec@latest` before
 * `openspec update`, so a newer tool is fetched rather than the current one run
 * again, which is what keeps this sign apart from the read-again button beside
 * it.
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

/** The `download` glyph on lucide's 24px grid: the shaft, its head, the tray. */
export const DOWNLOAD_SPEC: IconSpec = {
  size: 24,
  viewBox: '0 0 24 24',
  nodes: [
    { tag: 'path', attrs: { d: 'M12 15V3', ...STROKE } },
    { tag: 'path', attrs: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', ...STROKE } },
    { tag: 'path', attrs: { d: 'm7 10 5 5 5-5', ...STROKE } },
  ],
}

export function createDownloadIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, DOWNLOAD_SPEC)
}
