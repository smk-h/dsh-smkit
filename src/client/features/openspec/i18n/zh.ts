/**
 * Simplified Chinese dictionary for the `openspec` locale namespace.
 *
 * The conversation-header control's own copy: what the panel shows about one
 * workspace's OpenSpec footprint, and the delete it offers. The two button
 * labels every confirmation dialog shares (`cancel`, `delete`) live in the
 * platform namespace, so they are declared once for the whole plugin.
 */

import type { LocaleDict } from '../../../platform/types'

export const OPENSPEC_LOCALE_ZH: LocaleDict = {
  "manageOpenSpec": "管理 OpenSpec",
  "openSpecStatusReady": "已初始化",
  "openSpecStatusAbsent": "未初始化",
  "openSpecRefresh": "重新读取",
  "openSpecReading": "读取中…",
  "openSpecNoWorkspace": "当前会话没有工作目录，无法定位 OpenSpec",
  "openSpecLoadFailed": "读取 OpenSpec 状态失败 (HTTP {status})",
  "openSpecRemoveFailed": "删除 OpenSpec 失败 (HTTP {status})",
  "openSpecRoot": "项目根目录",
  "openSpecStore": "规范存储",
  "openSpecTree": "文件树",
  "openSpecArtifacts": "技能与命令",
  "openSpecExpand": "展开",
  "openSpecCollapse": "收起",
  "openSpecMissing": "布局中应当存在的部分磁盘上没有：{names}",
  "openSpecKindSkills": "技能",
  "openSpecKindCommands": "命令",
  "openSpecKindExtra": "其他生成文件",
  "openSpecSharedBy": "共享：{tools}",
  "openSpecKeptShort": "保留 {count} 项",
  "openSpecMarker": "OpenSpec 的归属标记（不是技能或命令）：告诉 openspec update 这个目录归它管，删掉它那些技能才不会被装回来 · {path}",
  "openSpecEntries": "{count} 项",
  "openSpecFiles": "{count} 个文件",
  "openSpecDirs": "{count} 个目录",
  "openSpecTruncated": "内容较多，此处只统计了前一部分",
  "openSpecEmpty": "该工作区还没有初始化 OpenSpec（未发现 openspec/ 目录）。点击下方按钮即可在此创建。",
  "openSpecInit": "初始化 OpenSpec",
  "openSpecInitCommand": "openspec init --tools agents --force",
  "openSpecInitRunning": "正在执行 openspec init …",
  "openSpecInitDone": "初始化完成",
  "openSpecInitNotInstalled": "未找到 openspec 命令，请先安装：npm install -g @fission-ai/openspec",
  "openSpecInitTimeout": "openspec init 执行超时",
  "openSpecInitFailed": "初始化 OpenSpec 失败 (HTTP {status})",
  "openSpecRemove": "删除 OpenSpec 与技能",
  "openSpecConfirm": "将删除 openspec/ 目录，以及下列 OpenSpec 生成的条目（技能目录以 openspec- 开头，命令以 opsx 开头）。同一目录下其他内容不属于 OpenSpec，不会被改动。此操作不可恢复。",
  "openSpecPartial": "有些内容没能删除，详见下方",
}
