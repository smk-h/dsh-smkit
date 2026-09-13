/**
 * The session-delete feature's stylesheet, as the text `entry.ts` injects.
 *
 * One file is enough here: it covers the header control and the fact block its
 * dialog shows. The dialog's backdrop, card and error line come from the
 * platform layer's stylesheet, which is injected before this one.
 */

import sessionDeleteCss from './style/session-delete.css'

/** The feature's own rules. */
export const SESSION_DELETE_CSS = sessionDeleteCss
