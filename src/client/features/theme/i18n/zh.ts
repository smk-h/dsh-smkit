/**
 * Simplified Chinese dictionary for the `theme` locale namespace.
 *
 * The theme tab's own copy: what the page offers, the card's sample strings
 * and the two state badges. The tab label lives in the merged section's
 * dictionary — the strip names its pages, not the pages themselves.
 *
 * Key set must stay identical to `en.ts`.
 */

import type { LocaleDict } from '../../../platform/types'

export const THEME_LOCALE_ZH: LocaleDict = {
  intro:
    "为长时间阅读挑选的低刺激配色：底色低饱和，正文对比度达标（卡片上的徽章为实测值），昼夜间均不用纯黑纯白。点卡片即换肤，昼取浅色、夜取深色，跟随 DSH 自带的显示模式切换。",
  summary: "{count} 款护眼配色",
  restore: "恢复默认",
  applied: "✓ 使用中",
  apply: "应用",
  bubbleSample: "用户消息…",
  nightGrade: "夜间 {grade}",
  skinDragonboatName: "端午 Dragon Boat",
  skinDragonboatTagline: "艾草绿粽叶香，龙舟红漆竞渡忙",
  skinNordName: "Nord",
  skinNordTagline: "Snow Storm 雪原昼色，Frost 冰蓝点缀",
  skinZcodeName: "ZCode",
  skinZcodeTagline: "ZCode 桌面端原味配色：昼浅夜深，黑白主键",
}
