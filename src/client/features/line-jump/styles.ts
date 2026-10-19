/**
 * The go-to-line stylesheet, as the text `entry.ts` injects.
 *
 * One sheet: the box, its field and hint, and the flash on the landed-on line.
 * Everything else the feature does is behaviour (which preview, which line,
 * paging), not paint.
 */

import jumpCss from './style/jump.css'

/** The feature's own rules. */
export const LINE_JUMP_CSS = jumpCss
