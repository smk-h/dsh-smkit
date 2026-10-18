/**
 * The reference feature's stylesheet, as the text `entry.ts` injects.
 *
 * One sheet: the hover chip's seat and its two states. Everything else the
 * feature does is behaviour (finding the tree, spelling the mention, handing
 * it to the composer), not paint.
 */

import refCss from './style/ref.css'

/** The feature's own rules. */
export const FILE_REFERENCE_CSS = refCss
