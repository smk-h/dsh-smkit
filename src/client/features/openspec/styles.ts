/**
 * The OpenSpec feature's stylesheet, as the text `entry.ts` injects.
 *
 * One file is enough here: it covers the header control, the hover panel it
 * opens and the fact block its confirmation shows. The dialog's backdrop, card
 * and error line come from the platform layer's stylesheet, which is injected
 * before this one.
 */

import openSpecCss from './style/openspec.css'

/** The feature's own rules. */
export const OPENSPEC_CSS = openSpecCss
