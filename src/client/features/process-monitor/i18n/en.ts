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
  "refresh": "Refresh",
  "live": "Live",
  "liveStarting": "Starting",
  "paused": "Paused",
  "metaLine": "{count} processes · 1 s/sample · {cores}-core normalized",
  "loading": "Reading the process table…",
  "warmingUp": "The sampler is starting; data arrives on the next tick…",
  "sampleFailed": "Sampling failed: {error}",
  "empty": "No processes to show right now.",
  "emptyMcpHint": "MCP stdio servers group under \"MCP servers\"; when another MCP manager owns them that group stays empty, but their processes still appear under \"Other children\".",
  "meterNotePrefix": "This page's own sampler costs a further",
  "meterNoteSuffix": " ({count} processes, not counted above)",
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
  "cardTreeCpu": "dsh total CPU",
  "cardTreeMem": "dsh total memory",
  "cardHostCpu": "Host CPU",
  "cardHostMem": "Host memory",
  "totalHint": "The host process plus every child it spawned (MCP servers, other plugins' helpers) — the whole dsh tree",
  "hostHint": "The dsh host process alone, children not included",
  "noValue": "—",
}
