/**
 * Simplified Chinese dictionary for the `plugin-gallery` locale namespace.
 *
 * The gallery tab's own copy: the line that introduces the shelf, and one
 * description per card. Everything a card shows that is not a sentence —
 * the plugin's name, its repository, the exact install command — is data in
 * `catalog.ts`, because an identifier is the same in every language. The tab
 * label lives in the merged section's dictionary: the strip names its pages,
 * not the pages themselves.
 */

import type { LocaleDict } from '../../../platform/types'

export const PLUGIN_GALLERY_LOCALE_ZH: LocaleDict = {
  intro:
    "这里列出常用的 dsh 插件，一张卡片一个：插件名（点击即打开它的仓库）和它自己文档里给出的那一条安装命令，命令右侧的按钮可直接把它复制到剪贴板。命令都装进 web profile —— 用的不是 web 就换成自己的名字 —— 并写进该 profile 的依赖；装完重启该 profile，再硬刷新页面。本页只负责记得这份清单，不会替你做任何安装。",
  copy: "复制",
  copied: "已复制",
  copyFailed: "复制失败",
  betterSidebarDesc:
    "侧边栏工作台：内置文件预览与编辑、终端、侧边对话、Git 与子代理页面，侧边栏本身还是其它插件注册新页面的底座。",
  sessionsManagerDesc:
    "会话管理：设置页里统一浏览全部 / 活动 / 已归档会话，支持搜索、收藏、标签、批量归档与跨工作区移动；侧栏会话行的 ⋯ 菜单多了标记未读、移动与删除，删除先进回收站，可恢复或按 7/30/90 天自动清理。",
}
