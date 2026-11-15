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
  "groupApp": "Application processes",
  "appScopeLabel": "Whole application (GUI included)",
  "appScopeValue": "{count} processes · {cpu} · dedicated {mem} (working set {ws})",
  "appScopeValueWs": "{count} processes · {cpu} · {mem}",
  "appScopeSuffix": "· the same process set as Task Manager's app row",
  "appScopeHint": "One executable's process group — GUI main process, renderer, GPU and utility processes — which is exactly the set Task Manager's Processes tab folds into the application's single row. They are not in the dsh tree, so the two total cards above leave them out. \"Dedicated\" is the private working set, the figure Task Manager prints; the working-set sum includes shared pages and runs much larger.",
  "expandChildren": "Expand {count} child processes",
  "collapseChildren": "Collapse {count} child processes",
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
  "totalHint": "The host process plus every child it spawned (MCP servers, other plugins' helpers) — the dsh service tree. The desktop app's GUI main process, renderers and GPU process are not included; the whole-application number is the line under the table.",
  "hostHint": "The dsh host process alone, children not included",
  "memHint": "Memory is the dedicated working set — Task Manager's own column; hover a row for the working set, which includes shared pages.",
  "memWsTitle": "Working set {mem} (shared pages included)",
  "noValue": "—",
}
