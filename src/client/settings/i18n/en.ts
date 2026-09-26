/**
 * English dictionary for the merged settings section (`smkit` namespace).
 *
 * Only the shell's own copy lives here: the nav row's label, the line that
 * introduces the merged page, and the five tab names. What each tab holds is
 * that tab's business — the MCP, skills, custom-settings and local-cache
 * namespaces still own their panels' copy. Theme has no tab: the theme center
 * is an appearance row on Settings → General, beside the shell's own.
 */

import type { LocaleDict } from '../../platform/types'

export const SMKIT_LOCALE_EN: LocaleDict = {
  sectionLabel: 'smkit Settings',
  sectionIntro:
    "The plugin's settings pages in one place: the tab strip picks which of them the panel below shows.",
  tabMcp: 'MCP',
  tabSkills: 'Skills',
  tabCustom: 'Custom settings',
  tabLocalCache: 'Local cache',
  tabNotify: 'Notifications',
}
