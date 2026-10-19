/**
 * The feature's stylesheets, as the text `entry.ts` injects.
 *
 * Three sheets, one per surface: the copy feedback's label, the inline editor
 * the creating rows open, and the row an open menu keeps lit. The menu card
 * itself carries no rules of its own — it is the shell's `Menu` component,
 * drawn with the shell's stylesheet.
 */

import labelCss from './style/label.css'
import menuRowCss from './style/menu-row.css'
import newRowCss from './style/new-row.css'

/** The transient "copied" label. */
export const EXPLORER_MENU_CSS = labelCss

/** The inline "new folder / new file" editor. */
export const EXPLORER_NEW_ROW_CSS = newRowCss

/** The row the open menu belongs to, kept on the shell's hover fill. */
export const EXPLORER_MENU_ROW_CSS = menuRowCss
