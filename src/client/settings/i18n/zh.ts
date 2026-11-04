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
  tabNotify: "通知",
  tabSessions: "会话管理",
  tabPlugins: "常用插件",
  updateCheck: "检查更新",
  updateChecking: "检查中",
  updateTitle: "发现新版本",
  updateBody: "当前 v{current}，最新为 v{latest}。在终端执行下面的命令更新，完成后重启 dsh 生效：",
  updateBodyNoCommand: "当前 v{current}，最新为 v{latest}。当前环境请在这个应用的插件页里更新。",
  updateCopy: "复制命令",
  updateCopied: "已复制",
  updateCopyFailed: "复制失败，请手动选中命令复制",
  updateClose: "关闭",
  updateLatest: "已是最新版本 v{current}",
  updateFailed: "检查更新失败，请检查网络后重试",
}
