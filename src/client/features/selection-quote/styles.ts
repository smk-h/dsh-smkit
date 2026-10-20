/**
 * The selection-quote stylesheet, as the text `entry.ts` injects.
 *
 * One sheet: the copy confirmation the card leaves behind. The card itself is
 * the shell's `Menu` (see `menu.ts`), and everything else the feature does is
 * behaviour (which preview, which payload), not paint.
 */

import quoteCss from './style/action.css'

/** The feature's own rules. */
export const SELECTION_QUOTE_CSS = quoteCss
