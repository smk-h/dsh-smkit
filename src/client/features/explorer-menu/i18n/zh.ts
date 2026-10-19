/**
 * Simplified Chinese dictionary for the `explorer` locale namespace.
 *
 * The menu rows read exactly as they do in `dsh-better-sidebar`'s explorer menu,
 * so a user switching between the two plugins sees the same words (the shipped
 * sidebar renamed 地址 → 路径, and that spelling is what its menu shows). The
 * creating rows and their editor keep the same spelling too — 新建文件夹 /
 * 新建文件, 文件夹名称无效 / 文件名称无效, 同名文件已存在.
 */

import type { LocaleDict } from '../../../platform/types'

export const EXPLORER_MENU_LOCALE_ZH: LocaleDict = {
  "copyRelative": "复制相对路径",
  "copyAbsolute": "复制绝对路径",
  "copied": "已复制",
  "newFolder": "新建文件夹",
  "newFile": "新建文件",
  "newFolderPlaceholder": "文件夹名称",
  "newFilePlaceholder": "文件名称",
  "folderNameInvalid": "文件夹名称无效",
  "fileNameInvalid": "文件名称无效",
  "fileNameExists": "同名文件已存在",
  "createFailed": "创建失败",
  "rename": "重命名",
  "renameInvalid": "名称不能为空，且不能包含路径分隔符。",
  "renameFailed": "重命名失败",
  "delete": "删除",
  "deleteTitle": "删除「{name}」？",
  "deleteDescFile": "将永久删除该文件，此操作不可撤销。",
  "deleteDescDir": "将永久删除该目录及其全部内容，此操作不可撤销。",
  "deleteFailed": "删除失败",
}
