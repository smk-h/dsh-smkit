/**
 * Simplified Chinese dictionary for the `theme-center` locale namespace.
 *
 * The row's own chrome copy (title, mode buttons, hint, reset) and the theme
 * display names, keyed `name_<id>` against the ids in
 * `themes.data.json`. The card tooltip is not here: it always shows both
 * language names, which ride with the data.
 *
 * Key set must stay identical to `en.ts`.
 */

import type { LocaleDict } from '../../../platform/types'

export const THEME_CENTER_LOCALE_ZH: LocaleDict = {
  title: "主题中心",
  themeCount: "{count} 款",
  modeAuto: "自动",
  modeLight: "浅色",
  modeDark: "深色",
  hint: "选择即保存",
  reset: "恢复默认",
  name_ocean: "海洋",
  name_midnight: "午夜",
  name_aurora: "极光",
  name_forest: "森林",
  name_graphite: "石墨",
  name_ink: "墨黑",
  name_mint: "薄荷",
  name_terminal: "终端",
  name_steel: "钢铁",
  name_autumn: "秋日",
  name_matcha: "抹茶",
  name_charcoal: "煤灰",
  name_mono: "极简",
}
