/**
 * English dictionary for the merged settings section (`smkit` namespace).
 *
 * Only the shell's own copy lives here: the nav row's label, the line that
 * introduces the merged page, and the three tab names. What each tab holds is
 * that tab's business — the MCP, skills and custom-settings namespaces still
 * own their panels' copy.
 */

import type { LocaleDict } from '../../platform/types'

export const SMKIT_LOCALE_EN: LocaleDict = {
  sectionLabel: 'smkit Settings',
  sectionIntro:
    "The plugin's settings pages in one place: the tab strip picks which of them the panel below shows.",
  tabMcp: 'MCP',
  tabSkills: 'Skills',
  tabCustom: 'Custom settings',
}
