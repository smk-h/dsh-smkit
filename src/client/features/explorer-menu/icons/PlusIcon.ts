/**
 * The "new folder" row's glyph: a plus, drawn on the same 16-grid and at the
 * same 14px menu size as the copy rows' sheet.
 *
 * Ported from `@deepseek-ai/dsh-client-ui-primitives` (`IconPlusOutlineRegular`,
 * MIT, © 2026 DeepSeek) — the glyph `dsh-better-sidebar` puts on that row.
 */

import type { IconSpec } from '../../../platform/icons/Icon'

export const PLUS_ICON: IconSpec = {
  size: 14,
  viewBox: '0 0 16 16',
  nodes: [
    { tag: 'path', attrs: { d: 'M8 2.5V13.5', stroke: 'currentColor', strokeLinecap: 'round' } },
    { tag: 'path', attrs: { d: 'M2.5 8H13.5', stroke: 'currentColor', strokeLinecap: 'round' } },
  ],
}
