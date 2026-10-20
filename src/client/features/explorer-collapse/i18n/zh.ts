/**
 * Simplified Chinese dictionary for the `explorer-collapse` locale namespace.
 *
 * One key, and it names the act rather than the tree: 「全部折叠」 is what
 * VSCode's own explorer calls "Collapse Folders in Explorer", in the same two
 * characters `dsh-better-sidebar` uses for its tasks tree (收起全部), shortened
 * so the bubble reads as a command on the row it sits beside.
 */

import type { LocaleDict } from '../../../platform/types'

export const EXPLORER_COLLAPSE_LOCALE_ZH: LocaleDict = {
  "collapseAll": "全部折叠",
}
