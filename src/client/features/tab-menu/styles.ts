/**
 * The tab-menu feature's stylesheet, as the text `entry.ts` injects.
 *
 * One sheet: rows and the group hairline appended to the shell's tab menu.
 * Everything else the feature does is behaviour (finding the strip, closing a
 * set through the column's controller), not paint.
 */

import tabMenuCss from './style/tab-menu.css'

/** The feature's own rules. */
export const TAB_MENU_CSS = tabMenuCss
