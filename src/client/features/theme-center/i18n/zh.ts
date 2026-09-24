/**
 * Simplified Chinese dictionary for the `theme-center` locale namespace.
 *
 * Everything the feature says, in two blocks. The first is the settings row:
 * its chrome copy (title, mode buttons, hint, reset), the sample strings the
 * card previews paint, and one name plus one description per theme, keyed
 * `name_<id>` / `desc_<id>` against the ids in `themes.data.json`. The card
 * tooltip is not here: it always shows both language names, which ride with the
 * data.
 *
 * The second is the palette panel — the header control that tunes the colors of
 * the theme in force. Its chrome keys carry the `palette` prefix because the
 * panel and the row are one dictionary now: `reset` is the row's (back to the
 * shell's default look) and `paletteReset` is the panel's (throw the color
 * edits away), and the prefix is what keeps the two from collapsing into each
 * other. The slider, group and item keys need no prefix — nothing else uses
 * them.
 *
 * The three skins the plugin used to ship as a separate settings page are
 * entries here now, so their names and taglines moved in from the retired
 * `theme` namespace rather than being rewritten — the words a reader sees are
 * the ones that page published. Its palette copy moved in the same way.
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
  bubbleSample: "用户消息…",
  lineSample: "正文示例，预览该配色的阅读观感",
  nightGrade: "夜间 {grade}",
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
  "name_festival-dragonboat": "端午",
  name_nord: "Nord",
  name_zcode: "ZCode",
  desc_ocean: "清凉的蓝，安静而深邃。",
  desc_midnight: "深夜藏蓝，缀以电光蓝。",
  desc_aurora: "紫罗兰与青碧交融的夜空。",
  desc_forest: "松绿与柔软的苔藓。",
  desc_graphite: "柔和的暖灰，护眼耐看。",
  desc_ink: "纯粹的黑与白，至简。",
  desc_mint: "清新的青绿，脆爽清凉。",
  desc_terminal: "CRT 黑底上的磷光绿。",
  desc_steel: "冷冽的蓝灰，工业般的沉静。",
  desc_autumn: "丰收午后，满地金黄。",
  desc_matcha: "苔绿间透着茶香。",
  desc_charcoal: "诚实的灰，不打扰你的专注。",
  desc_mono: "严格单色，极致专注。",
  "desc_festival-dragonboat": "艾草绿粽叶香，龙舟红漆竞渡忙",
  desc_nord: "Snow Storm 雪原昼色，Frost 冰蓝点缀",
  desc_zcode: "ZCode 桌面端原味配色：昼浅夜深，黑白主键",
  paletteOpen: "调色板",
  paletteTitle: "调色板",
  paletteClose: "关闭",
  paletteSave: "保存",
  paletteReset: "重置",
  paletteSavedHint: "✓ 已保存，覆盖当前配色",
  sliderHue: "色相",
  sliderSat: "饱和",
  sliderLight: "明度",
  groupTheme: "主题主色",
  groupLeftSidebar: "左侧边栏",
  groupConversation: "会话区域",
  groupToolCalls: "工具调用",
  groupRightPanel: "右侧栏 / 面板",
  itemPrimaryFill: "主按钮",
  itemSendFill: "发送键",
  itemBrand: "品牌强调",
  itemInk: "正文墨色",
  itemSidebarFill: "侧栏底色",
  itemNavActive: "选中项",
  itemNavHover: "悬停项",
  itemNavAccent: "选中标记",
  itemCanvas: "会话画布",
  itemBubble: "用户气泡",
  itemBubbleHighlight: "气泡高亮",
  itemInput: "输入框",
  itemToolCardBg: "工具卡背景",
  itemToolCardBorder: "工具卡边框",
  itemCodeBlock: "代码块背景",
  itemPanel1: "面板一层",
  itemPanel2: "面板二层",
  itemPanel3: "面板三层",
}
