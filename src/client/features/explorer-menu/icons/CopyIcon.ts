/**
 * The two context-menu rows' glyph: two stacked sheets (the copy mark).
 *
 * Glyph ported verbatim from @deepseek-ai/dsh-client-ui-primitives 0.2.1-rc.2
 * (MIT, © 2026 DeepSeek) (`IconCopyOutlineRegular`, 1px stroke, 14px in a
 * menu row), so the rows carry the very artwork
 * `dsh-better-sidebar` puts on them without taking a runtime dependency on that
 * package's icon set — the same rule the rest of this plugin's icons follow
 * (`platform/icons/Icon.tsx`).
 *
 * Data, not a component factory: the menu is rendered through the host's `Menu`
 * component with this plugin's `h`, so `watch.ts` turns the spec into a React
 * element (`iconElement`) instead of handing it to `createIcon`.
 */

import type { IconSpec } from '../../../platform/icons/Icon'

export const COPY_ICON: IconSpec = {
  size: 14,
  viewBox: '0 0 16 16',
  nodes: [
    { tag: 'rect', attrs: { x: '1.52075', y: '4.07373', width: '10.3932', height: '10.3932', rx: '2', stroke: 'currentColor' } },
    {
      tag: 'path',
      attrs: {
        d: 'M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z',
        fill: 'currentColor',
      },
    },
  ],
}
