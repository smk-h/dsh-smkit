/**
 * Simplified Chinese dictionary for the `platform` locale namespace.
 *
 * Holds only the strings the platform layer's own components render — today the
 * confirmation dialog's two buttons and the shared refresh button's name.
 * Business copy stays in its feature's namespace (`mcp`, `session-delete`), so a
 * shared label like "删除" has exactly one home instead of one copy per feature.
 */

import type { LocaleDict } from '../types'

export const PLATFORM_LOCALE_ZH: LocaleDict = {
  "cancel": "取消",
  "delete": "删除",
  "refresh": "刷新",
}
