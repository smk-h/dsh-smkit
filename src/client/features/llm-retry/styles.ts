/**
 * The retry feature's stylesheet, as the text `entry.ts` injects.
 *
 * One file is enough here: the page is a route list and one form, and the
 * shared pieces it wears (`mm_btn` buttons, `mm_err` error lines, the dialog
 * tokens) come from the platform layer, whose stylesheet is injected first.
 */

import retryCss from './style/retry.css'

/** The feature's own rules. */
export const RETRY_CSS = retryCss
