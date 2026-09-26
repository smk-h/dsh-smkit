/**
 * Simplified Chinese dictionary for the `local-cache` locale namespace.
 *
 * The local-cache tab's own copy: what dsh keeps in the browser, what the
 * clear removes and what it costs, the category cards' titles, counts and
 * scope tags, the per-key descriptions (matched by key shape, one line each),
 * plus the three answers the button can give. The tab label lives in the
 * merged section's dictionary — the strip names its pages, not the pages
 * themselves.
 */

import type { LocaleDict } from '../../../platform/types'

export const LOCAL_CACHE_LOCALE_ZH: LocaleDict = {
  intro:
    "dsh 会在这个浏览器里记下界面的本地状态：侧边栏工作区的展开与排序、各页的视图偏好、还没发出去的输入草稿。切换 dsh 版本后，旧版本记下的内容可能和当前版本对不上，轻则偏好丢失，重则某块界面（比如左侧的工作区与会话列表）整个空白。",
  scope:
    "卡片上标着「将清理」的，就是清理会删掉的全部内容 —— 只有 dsh. 开头的键；本插件自己的设置（smkit: 开头，主题、调色板配色、语言等）和站点的其他数据一律不动。清理完成后页面自动刷新。",
  catSessionState: "dsh 会话状态",
  catSessionStateDesc: "每个会话的输入草稿与视图记录，清理后草稿会丢。",
  catCurrentSession: "dsh 当前会话",
  catCurrentSessionDesc: "记录当前打开的是哪个会话，清理后回到默认选择。",
  catWorkspaceView: "dsh 侧边栏视图偏好",
  catWorkspaceViewDesc: "侧边栏的分组、排序与展开状态，清理后恢复默认布局。",
  catDshOther: "dsh 其他条目",
  catDshOtherDesc: "dsh 记录的其他条目，同样会被清理。",
  catSmkit: "本插件设置",
  catSmkitDesc: "主题、调色板配色、语言等插件设置，清理不会动它们。",
  catOther: "其他数据",
  catOtherDesc: "该地址下的其他数据，清理不会动它们。",
  itemCount: "{count} 项",
  tagClean: "将清理",
  tagKeep: "保留",
  colKey: "键 / 值",
  colDesc: "说明",
  descCurrentSession: "当前打开的会话。清理后由侧边栏回到默认选择。",
  descSessionState: "每个会话一条：未发送的输入草稿、离开时的视图与待恢复的视图请求。",
  descWorkspaceView:
    "侧边栏工作区与会话列表的视图偏好：分组、排序、展开状态。键名带版本号（如 v5），版本更迭后旧结构可能无法读取，是本页清理的主要目标。",
  descOther: "dsh 记录的其他本地状态。",
  descSmkitTheme: "主题中心当前选中的主题 id。",
  descSmkitMode: "主题中心的深浅色模式选择（自动 / 浅色 / 深色）。",
  descSmkitColors: "调色板保存的配色覆盖。",
  descSmkitOther: "本插件记录的其他设置。",
  descSiteOther: "不属于 dsh 或本插件的其他数据，清理不会碰它。",
  tableEmpty: "当前没有任何记录。",
  tableDenied: "浏览器拒绝页面访问本地存储（可能是隐私模式），读不到条目列表。",
  action: "清理并刷新",
  resultCleared: "已清理 {count} 项，正在刷新…",
  resultEmpty: "没有可清理的条目。",
  resultDenied: "浏览器拒绝页面访问本地存储（可能是隐私模式），未做任何清理。",
}
