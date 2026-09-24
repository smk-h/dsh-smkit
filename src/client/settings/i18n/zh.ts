/**
 * Simplified Chinese dictionary for the merged settings section (`smkit`
 * namespace).
 *
 * The shell's own copy only: see `en.ts` for what stays out of here — each
 * tab's page keeps its text in its own namespace.
 *
 * Key set must stay identical to `en.ts`.
 */

import type { LocaleDict } from '../../platform/types'

export const SMKIT_LOCALE_ZH: LocaleDict = {
  sectionLabel: "smkit 配置",
  sectionIntro: "本插件的设置项都收在这一节里，用下面的标签页切换要看的那一页。",
  tabMcp: "MCP",
  tabSkills: "技能",
  tabCustom: "自定义设置",
  tabLocalCache: "本地缓存",
}
