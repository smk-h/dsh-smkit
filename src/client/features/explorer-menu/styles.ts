/**
 * The feature's stylesheets, as the text `entry.ts` injects.
 *
 * Four sheets, one per surface: the copy feedback's label, the inline editor
 * the creating rows open, the row an open menu keeps lit, and the hairline the
 * shared menu cannot place for itself. The menu card itself carries no rules of
 * its own — it is the shell's `Menu` component, drawn with the shell's
 * stylesheet; the last sheet draws one line with the shell's own token, nothing
 * else.
 */

import labelCss from './style/label.css'
import menuRowCss from './style/menu-row.css'
import nativeLeadCss from './style/native-lead.css'
import newRowCss from './style/new-row.css'

/** The transient "copied" label. */
export const EXPLORER_MENU_CSS = labelCss

/** The inline "new folder / new file" editor. */
export const EXPLORER_NEW_ROW_CSS = newRowCss

/** The row the open menu belongs to, kept on the shell's hover fill. */
export const EXPLORER_MENU_ROW_CSS = menuRowCss

/** The hairline after the shared menu's leading row. */
export const EXPLORER_NATIVE_LEAD_CSS = nativeLeadCss
