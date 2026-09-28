/**
 * Simplified Chinese dictionary for the `session-manager` locale namespace.
 *
 * The manager tab's own copy: the sub-tab labels, the toolbar, the workspace
 * group header, the row metadata words, the confirmation dialog and the
 * per-session refusals a batch can report. The refusal lines mirror the
 * header control's (`session-delete` namespace) so both surfaces speak the
 * same refusal the same way; the dictionaries stay separate because features
 * do not share a namespace.
 *
 * Key set must stay identical to `en.ts`.
 */

import type { LocaleDict } from '../../../platform/types'

export const SESSION_MANAGER_LOCALE_ZH: LocaleDict = {
  intro: '按工作区查看 dsh 的会话并批量清理。删除会立即生效，侧边栏同步移除；会话的历史与本地数据（日志、缓存、溢出文件）一并清除，不可恢复。',

  subtabsLabel: '会话视图',
  subtabActive: '活跃会话（{count}）',
  subtabArchived: '归档会话（{count}）',

  selectAll: '全选',
  selectedSummary: '已选 {count} 项 · 合计约 {size}',
  deleteSelected: '删除所选（{count}）',
  refreshFailed: '读取会话列表失败 (HTTP {status})',

  ungrouped: '未分组',
  ungroupedHint: '不归属任何工作区的会话',
  sessionCount: '{count} 个会话',

  untitledSession: '未命名会话',
  badgeRunning: '运行中',

  emptyActive: '没有活跃会话。',
  emptyArchived: '没有归档会话。',
  loadFailed: '会话列表读取失败，请稍后重试。',

  confirmBatchTitle: '删除 {count} 个会话',
  confirmBatchBody: '将永久删除所选会话的历史与全部本地数据（日志、缓存、溢出文件），此操作不可恢复。正在运行或仍挂载的会话会被跳过并逐条说明。',

  batchDone: '已删除 {deleted} 个会话。',
  batchPartial: '已删除 {deleted} 个，{failed} 个未删除：',
  batchFailed: '批量删除失败 (HTTP {status})',

  deleteSessionNotFound: '会话不存在或已被删除',
  deleteSessionRunning: '会话正在运行，请先停止后再删除',
  deleteSessionAttached: '会话仍挂在宿主进程中，当前部署没有可隐藏它的归档集；重启 dsh 后再删除即可',
  deleteSessionSubagent: '子代理会话不能单独删除，请删除其所属会话',
  deleteSessionUnavailable: '当前部署未挂载会话存储，无法删除会话数据',

  timeYesterday: '昨天',
}
