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
  "pageIntro": "dsh 宿主进程及其全部子进程的实时占用：CPU 按整机容量归一（任务管理器口径），内存为驻留集。页面打开时每秒采样一次，关闭即停。",
  "refresh": "刷新",
  "countLabel": "{count} 个进程",
  "intervalLabel": "1 秒/次",
  "loading": "正在读取进程表…",
  "warmingUp": "采样器启动中，下一秒开始出数据…",
  "sampleFailed": "采样失败：{error}",
  "empty": "当前没有可展示的进程。",
  "emptyMcpHint": "MCP stdio 服务器会归入「MCP 服务器」一组；若由其他 MCP 管理插件接管，该组为空，但服务进程仍会出现在「其他子进程」里。",
  "meterNote": "本页采样器另占 {cpu} · {mem}（{count} 个进程，未计入上表）",
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
  "cardTreeCpu": "子树 CPU",
  "cardTreeMem": "子树内存",
  "cardHostCpu": "宿主 CPU",
  "cardHostMem": "宿主内存",
  "noValue": "—",
}
