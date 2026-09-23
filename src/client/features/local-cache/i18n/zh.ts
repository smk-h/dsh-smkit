/**
 * Simplified Chinese dictionary for the `local-cache` locale namespace.
 *
 * The local-cache tab's own copy: what dsh keeps in the browser, what the
 * clear removes and what it costs, plus the three answers the button can
 * give. The tab label lives in the merged section's dictionary — the strip
 * names its pages, not the pages themselves.
 */

import type { LocaleDict } from '../../../platform/types'

export const LOCAL_CACHE_LOCALE_ZH: LocaleDict = {
  intro:
    "dsh 会在这个浏览器里记下界面的本地状态：侧边栏工作区的展开与排序、各页的视图偏好、还没发出去的输入草稿。切换 dsh 版本后，旧版本记下的内容可能和当前版本对不上，轻则偏好丢失，重则某块界面（比如左侧的工作区与会话列表）整个空白。",
  scope:
    "清理会删掉这个地址下 dsh 记下的全部条目，然后刷新页面；本插件自己的设置（皮肤、语言等）不在其列。",
  action: "清理并刷新",
  resultCleared: "已清理 {count} 项，正在刷新…",
  resultEmpty: "没有可清理的条目。",
  resultDenied: "浏览器拒绝页面访问本地存储（可能是隐私模式），未做任何清理。",
}
