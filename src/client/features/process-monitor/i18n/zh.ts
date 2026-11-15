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
  "groupApp": "应用其他进程",
  "appScopeLabel": "整个应用（含 GUI 进程）",
  "appScopeValue": "{count} 个进程 · {cpu} · 专用 {mem}（工作集 {ws}）",
  "appScopeValueWs": "{count} 个进程 · {cpu} · {mem}",
  "appScopeSuffix": "· 与任务管理器「应用」行同一进程集合",
  "appScopeHint": "同一可执行文件的一组进程——GUI 主进程、渲染进程、GPU 进程、实用进程，也就是任务管理器「进程」页里这个应用那一行统计的集合。它们不在 dsh 的进程树里，因此不计入上面两张合计卡。括号里的「专用」是专用工作集，与任务管理器该行同口径；工作集合计含共享页，会明显更大。",
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
  "totalHint": "宿主进程及其全部子进程（MCP 服务器、其他插件子进程等）的合计，即 dsh 服务进程树；不含桌面端的 GUI 主进程 / 渲染进程 / GPU 进程 —— 整个应用的数字见分组表下方的对账行",
  "hostHint": "仅 dsh 宿主进程本身的占用，不含子进程",
  "memHint": "内存为专用工作集，与任务管理器「内存」列同口径；含共享页的工作集在行内悬停可见。",
  "memWsTitle": "工作集 {mem}（含共享页）",
  "noValue": "—",
}
