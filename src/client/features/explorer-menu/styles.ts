/**
 * The copy feedback's stylesheet, as the text `entry.ts` injects.
 *
 * One sheet: the "copied" label and the one row it parks in. The menu itself
 * carries no rules of its own — it is the shell's `Menu` component, drawn with
 * the shell's stylesheet.
 */

import labelCss from './style/label.css'

/** The feature's own rules. */
export const EXPLORER_MENU_CSS = labelCss
