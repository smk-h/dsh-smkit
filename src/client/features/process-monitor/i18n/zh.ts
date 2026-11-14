/**
 * Simplified Chinese dictionary for the `process-monitor` locale namespace.
 *
 * `en.ts` must carry the exact same key set — DSH owns language selection and
 * every user-visible string on this page resolves through `t`. Deliberately
 * absent: process names, command lines and server ids, which the OS and the
 * registry wrote, and the sampler's own error text, which is shown as it
 * arrived.
 */

import type { LocaleDict } from '../../../platform/types'

export const PROCESS_MONITOR_LOCALE_ZH: LocaleDict = {
  "panelLabel": "进程资源",
  "pageTitle": "进程资源",
  "refresh": "刷新",
  "live": "采样中",
  "liveStarting": "启动中",
  "paused": "已暂停",
  "metaLine": "{count} 个进程 · 1 秒/次 · {cores} 核归一",
  "loading": "正在读取进程表…",
  "warmingUp": "采样器启动中，下一秒开始出数据…",
  "sampleFailed": "采样失败：{error}",
  "empty": "当前没有可展示的进程。",
  "emptyMcpHint": "MCP stdio 服务器会归入「MCP 服务器」一组；若由其他 MCP 管理插件接管，该组为空，但服务进程仍会出现在「其他子进程」里。",
  "meterNotePrefix": "本页采样器另占",
  "meterNoteSuffix": "（{count} 个进程，未计入上表）",
  "groupHost": "宿主进程",
  "groupMcp": "MCP 服务器",
  "groupOther": "其他子进程",
  "groupMeta": "{count} 个进程 · {cpu}",
  "colProcess": "进程",
  "colPid": "PID",
  "colCpu": "CPU",
  "colMem": "内存",
  "colCpuTime": "累计 CPU",
  "colCmdline": "命令行",
  "cardTreeCpu": "dsh 总 CPU",
  "cardTreeMem": "dsh 总内存",
  "cardHostCpu": "宿主 CPU",
  "cardHostMem": "宿主内存",
  "totalHint": "宿主进程及其全部子进程（MCP 服务器、其他插件子进程等）的合计，即整个 dsh 服务进程树的占用",
  "hostHint": "仅 dsh 宿主进程本身的占用，不含子进程",
  "noValue": "—",
}
