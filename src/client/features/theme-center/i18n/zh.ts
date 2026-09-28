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
  workbenchCard: "卡片工作台",
  workbenchCardHint: "把每一列画成独立卡片，还原 VS Code 现代界面的分区感",
  bubbleSample: "用户消息…",
  lineSample: "正文示例，预览该配色的阅读观感",
  nightGrade: "夜间 {grade}",
  name_zcode: "ZCode",
  "name_one-dark-pro": "One Dark Pro",
  desc_zcode: "ZCode 桌面端原味配色：昼浅夜深，黑白主键",
  "desc_one-dark-pro": "Atom One Dark 经典暗色原样移植：#282c34 画布，#abb2bf 墨色。",
  paletteOpen: "调色板",
  paletteTitle: "调色板",
  paletteClose: "关闭",
  paletteSave: "保存",
  paletteReset: "重置",
  paletteSavedHint: "✓ 已保存",
  sliderHue: "色相",
  sliderSat: "饱和",
  sliderLight: "明度",
  sliderResetHint: "双击把这一根拨回当前主题的原值",
  groupTheme: "主题主色",
  groupText: "文字颜色",
  groupBorders: "边框",
  groupLeftSidebar: "左侧边栏",
  groupConversation: "会话区域",
  groupMarkdown: "正文排版",
  groupToolCalls: "工具调用",
  groupStates: "状态色",
  groupScrollbars: "滚动条",
  groupInteractive: "交互态",
  groupOverlays: "浮层与提示",
  groupSurfaces: "其他表面",
  groupRightPanel: "右侧栏 / 面板",
  itemPrimaryFill: "主按钮",
  itemPrimaryHover: "主按钮悬停",
  itemPrimaryDimmed: "主按钮弱化",
  itemSendFill: "发送键",
  itemSendHover: "发送键悬停",
  itemContrastFill: "对比按钮",
  itemElevatedFill: "浮起按钮",
  itemFloatingFill: "浮动按钮",
  itemFloatingHover: "浮动按钮悬停",
  itemGhostFill: "幽灵按钮填充",
  itemGhostHover: "幽灵按钮悬停",
  itemGhostBorder: "幽灵按钮边框",
  itemToolBarFill: "工具栏按钮",
  itemToolBarInvisible: "工具栏静默底",
  itemToolBarHover: "工具栏悬停",
  itemBrand: "品牌强调",
  itemBrandInvert: "品牌反色",
  itemBrandText: "品牌文字",
  itemInk: "正文墨色",
  itemLabelSecondary: "次级文字",
  itemLabelTertiary: "三级文字",
  itemLabelCaption: "说明文字",
  itemLabelDimmed: "弱化文字",
  itemLabelPrimaryDimmed: "墨色弱化",
  itemLabelBluish: "偏蓝墨色",
  itemLabelForeground: "主色上文字",
  itemLabelInverted: "反白文字",
  itemBorderL1: "一级边框",
  itemBorderL2: "二级边框",
  itemBorderL3: "三级边框",
  itemBorderL4: "四级边框",
  itemBorderThinDark: "深色细边框",
  itemBorderInverted: "反色边框",
  itemBorderInverted2: "反色边框二",
  itemSidebarFill: "侧栏底色",
  itemNavActive: "选中项",
  itemNavHover: "悬停项",
  itemNavAccent: "选中标记",
  itemCanvas: "会话画布",
  itemBubble: "用户气泡",
  itemBubbleHighlight: "气泡高亮",
  itemInput: "输入框",
  itemCodeBlock: "代码块背景",
  itemInlineCode: "行内代码",
  itemCitation: "引用角标",
  itemTag: "标签",
  itemPlaceholder: "占位符",
  itemCodeBanner: "代码块标题条",
  itemCodeSelected: "选中代码段",
  itemCodeUnselected: "未选中代码段",
  itemToolCardBg: "工具卡背景",
  itemToolCardBorder: "工具卡边框",
  itemSuccessPrimary: "成功主色",
  itemSuccessSecondary: "成功次色",
  itemSuccessTertiary: "成功弱色",
  itemWarnPrimary: "警告主色",
  itemWarnSecondary: "警告次色",
  itemWarnTertiary: "警告弱色",
  itemWarnLabel: "警告文字",
  itemErrorPrimary: "错误主色",
  itemErrorSecondary: "错误次色",
  itemBusinessPrimary: "业务主色",
  itemBusinessTertiary: "业务弱色",
  itemScrollbarL1: "滚动条一层",
  itemScrollbarHoverL1: "悬停一层",
  itemScrollbarL2: "滚动条二层",
  itemScrollbarHoverL2: "悬停二层",
  itemHoverWash: "通用悬停",
  itemActiveWash: "按下底色",
  itemHoverAccent: "强调悬停",
  itemHoverDanger: "危险悬停",
  itemHoverSolid: "实底悬停",
  itemOverlay: "遮罩",
  itemMenu: "菜单",
  itemSelector: "下拉选择器",
  itemTip: "提示气泡",
  itemToast: "Toast 底色",
  itemTooltip: "Tooltip 底色",
  itemLoginInput: "登录输入框",
  itemModulePlatform: "模块平台底色",
  itemMultiSelect: "多选底色",
  itemSkeleton: "骨架屏",
  itemPanel1: "面板一层",
  itemPanel2: "面板二层",
  itemPanel3: "面板三层",
}
