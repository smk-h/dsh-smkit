/**
 * Simplified Chinese dictionary for the `outline` locale namespace.
 *
 * One label per kind, plus the four states the panel can be in. The names
 * themselves come from the file, never from here.
 */

import type { LocaleDict } from '../../../platform/types'

export const OUTLINE_LOCALE_ZH: LocaleDict = {
  toggle: '大纲',
  loading: '读取中…',
  empty: '没有可列出的符号',
  failed: '读不出大纲：{message}',
  retry: '重试',

  kindFunction: '函数',
  kindStruct: '结构体',
  kindUnion: '联合',
  kindEnum: '枚举',
  kindMacro: '宏',
}
