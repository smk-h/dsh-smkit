/**
 * The feature's stylesheets, as the text `entry.ts` injects.
 *
 * Two sheets, one per surface: the copy feedback's label, and the inline editor
 * the creating rows open. The menu itself carries no rules of its own — it is
 * the shell's `Menu` component, drawn with the shell's stylesheet.
 */

import labelCss from './style/label.css'
import newRowCss from './style/new-row.css'

/** The transient "copied" label. */
export const EXPLORER_MENU_CSS = labelCss

/** The inline "new folder / new file" editor. */
export const EXPLORER_NEW_ROW_CSS = newRowCss
