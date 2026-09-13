/**
 * Simplified Chinese dictionary for the `session-delete` locale namespace.
 *
 * The header control's own copy: the confirmation dialog it opens, the refusals
 * the host can answer with, and the fact block's row labels. The two button
 * labels every dialog shares (`cancel`, `delete`) live in the platform
 * namespace, so they are declared once for the whole plugin.
 */

import type { LocaleDict } from '../../../platform/types'

export const SESSION_DELETE_LOCALE_ZH: LocaleDict = {
  "deleteSession": "删除会话",
  "confirmSessionDelete": "将永久删除该会话的历史与全部已存数据（含本地日志文件），此操作不可恢复。",
  "sessionInfoId": "会话 ID",
  "sessionInfoTitle": "标题",
  "sessionInfoCwd": "工作目录",
  "sessionInfoCreated": "创建时间",
  "sessionInfoLog": "存储位置",
  "sessionInfoCache": "投影缓存",
  "sessionInfoSpill": "溢出文件",
  "sessionInfoTotal": "合计",
  "sessionInfoFiles": "{count} 个文件",
  "sessionInfoFailed": "读取会话信息失败 (HTTP {status})",
  "deleteSessionFailed": "删除会话失败 (HTTP {status})",
  "deleteSessionNotFound": "会话不存在或已被删除",
  "deleteSessionRunning": "会话正在运行，请先停止后再删除",
  "deleteSessionAttached": "会话仍挂在宿主进程中，当前部署没有可隐藏它的归档集；重启 dsh 后再删除即可",
  "deleteSessionSubagent": "子代理会话不能单独删除，请删除其所属会话",
  "deleteSessionUnavailable": "当前部署未挂载会话存储，无法删除会话数据",
}
