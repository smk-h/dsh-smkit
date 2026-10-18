/**
 * The outline's stylesheet, as the text `entry.ts` injects.
 *
 * One sheet: the bar, its toggle, the popover and the jump flash. Everything
 * else the feature does is behaviour (finding the body, collecting headings,
 * scrolling), not paint.
 */

import tocCss from './style/toc.css'

/** The feature's own rules. */
export const MARKDOWN_OUTLINE_CSS = tocCss
