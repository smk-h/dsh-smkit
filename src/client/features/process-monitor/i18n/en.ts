/**
 * English dictionary for the `process-monitor` locale namespace.
 *
 * `zh.ts` must carry the exact same key set — DSH owns language selection and
 * every user-visible string on this page resolves through `t`.
 */

import type { LocaleDict } from '../../../platform/types'

export const PROCESS_MONITOR_LOCALE_EN: LocaleDict = {
  "panelLabel": "Processes",
  "pageTitle": "Process resources",
  "pageIntro": "Live usage of the dsh host process and every child it spawned: CPU is normalized against the machine's whole capacity (Task Manager's convention) and memory is the resident set. Sampled once a second while this page is open; nothing samples once it is closed.",
  "refresh": "Refresh",
  "countLabel": "{count} processes",
  "intervalLabel": "1 s / sample",
  "loading": "Reading the process table…",
  "warmingUp": "The sampler is starting; data arrives on the next tick…",
  "sampleFailed": "Sampling failed: {error}",
  "empty": "No processes to show right now.",
  "emptyMcpHint": "MCP stdio servers group under \"MCP servers\"; when another MCP manager owns them that group stays empty, but their processes still appear under \"Other children\".",
  "meterNote": "This page's own sampler costs a further {cpu} · {mem} ({count} processes, not counted above)",
  "groupHost": "Host process",
  "groupMcp": "MCP servers",
  "groupOther": "Other children",
  "groupMeta": "{count} processes · {cpu}",
  "colProcess": "Process",
  "colPid": "PID",
  "colCpu": "CPU",
  "colMem": "Memory",
  "colCpuTime": "Total CPU",
  "colCmdline": "Command line",
  "cardTreeCpu": "Subtree CPU",
  "cardTreeMem": "Subtree memory",
  "cardHostCpu": "Host CPU",
  "cardHostMem": "Host memory",
  "noValue": "—",
}
