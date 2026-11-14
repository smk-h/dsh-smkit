/**
 * The pure half of the process monitor: turn one normalized OS read into the
 * page's report, and remember just enough of it to difference the next one.
 *
 * Everything platform-shaped happens in the samplers; everything here is
 * arithmetic and graph walking over plain rows, which is exactly why it is a
 * separate module — the unit suite can pin the CPU math and the tree rules
 * without owning a Windows machine or shelling out.
 *
 * The three rules worth reading before touching this:
 *
 * - The subtree is collected from the host pid downwards, because the plugin
 *   runs inside the dsh host process and every child worth showing (MCP stdio
 *   servers, shells, sibling plugins' helpers) descends from it. A process
 *   whose parent died before the read is unreachable through `ppid` and drops
 *   out — the same limitation VS Code's process explorer has.
 * - CPU is a differential: `cpuMs` is a lifetime total, so a percentage only
 *   exists between two samples of the same pid. The pair is supplied by the
 *   sampler (this sample plus the one before it — see `SampleBaseline`); the
 *   first sample after a gap carries `null` and the page prints "—", rather
 *   than quietly showing a since-boot average that no window in the UI
 *   corresponds to.
 * - MCP tagging is inherited down the tree: on Windows the registry deposits
 *   the *shell wrapper's* pid, and the actual node server sits below it, so
 *   the label follows parent→child instead of being looked up per row.
 * - The sampler's own subtree is excluded from the rows (a dashboard does not
 *   count the meter into what it is measuring) but never dropped silently:
 *   it is aggregated into the sample's `meter` footprint, which the page
 *   discloses under the table.
 */

import { SAMPLE_INTERVAL_MS } from '../../../shared/process-monitor/contract.js'
import type { RegisteredProcess } from '../../platform/process-registry.js'
import type {
  ProcessEntryKind,
  ProcessEntryView,
  ProcessMeterFootprint,
  ProcessMonitorSample,
  ProcessTotals,
} from '../../../shared/process-monitor/contract.js'
import type { RawProcess, SampleBaseline } from './sampler.js'

export interface BuildReportOptions {
  hostPid: number
  cores: number
  /** Epoch ms of the OS read — comes from the sampler's reading. */
  sampledAt: number
  /** `process.platform` of the host, passed through to the page. */
  platform: string
  /** Origin identities, normally `registeredProcesses()`. */
  registered: RegisteredProcess[]
  /** Pids (with their subtrees) to exclude from the rows: the sampler's own helpers — reported as `meter`. */
  excludePids?: Set<number>
  /** Command-line trim length; one line stays one line on the page. */
  maxCmdline?: number
}

/**
 * Two samples closer together than this are not one window: a genuine frame
 * pair is a second apart, so a window below this is clock noise or a
 * duplicated frame masquerading as a pair.
 */
const MIN_DELTA_MS = 250

/**
 * Two samples further apart than this are not one window either: the pair
 * spans a closed page (the sampler's baseline survives until its next
 * sample), and minutes of CPU must not be averaged as if they were one
 * second. Past this gap every entry reads null and the next pair starts over.
 */
const MAX_DELTA_MS = 5_000

const DEFAULT_MAX_CMDLINE = 200

const KIND_ORDER: Record<ProcessEntryKind, number> = { host: 0, mcp: 1, other: 2 }

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** One command line, cut to a bounded length with a marker when it was cut. */
function trimCmdline(cmdline: string, max: number): string {
  const text = cmdline.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/** Executable-ish base name: the last path segment of the first token. */
function nameOf(row: RawProcess): string {
  if (row.name !== '') return row.name
  const first = row.cmdline.trim().split(/\s+/)[0] ?? ''
  return first.split(/[\\/]+/).filter(Boolean).pop() ?? ''
}

/** Collect `roots` and everything descending from them. */
function subtreeOf(roots: Iterable<number>, childrenOf: Map<number, RawProcess[]>): Set<number> {
  const found = new Set<number>()
  const queue = [...roots]
  while (queue.length > 0) {
    const pid = queue.pop() as number
    if (found.has(pid)) continue
    found.add(pid)
    for (const child of childrenOf.get(pid) ?? []) queue.push(child.pid)
  }
  return found
}

/**
 * Build one report from one raw sample and the sample before it. Pure apart
 * from the maps it allocates: the same inputs always produce the same JSON,
 * which is what the unit suite pins and what makes a saved frame replayable
 * when someone reports a wrong percentage.
 */
export function buildProcessReport(
  raw: RawProcess[],
  baseline: SampleBaseline | null,
  options: BuildReportOptions,
): ProcessMonitorSample {
  const { hostPid, cores, sampledAt } = options
  const maxCmdline = options.maxCmdline ?? DEFAULT_MAX_CMDLINE

  const byPid = new Map<number, RawProcess>()
  const childrenOf = new Map<number, RawProcess[]>()
  for (const row of raw) {
    byPid.set(row.pid, row)
    if (row.pid === row.ppid) continue // a self-parent is corrupt data, not an edge
    const siblings = childrenOf.get(row.ppid)
    if (siblings === undefined) childrenOf.set(row.ppid, [row])
    else siblings.push(row)
  }

  // The differencing side of the pair: the baseline's per-pid totals and its
  // timestamp. A null baseline (first sample ever) differences nothing.
  const prevCpuByPid = new Map<number, number>()
  let prevAt = 0
  if (baseline !== null) {
    prevAt = baseline.sampledAt
    for (const row of baseline.entries) prevCpuByPid.set(row.pid, row.cpuMs)
  }

  const host = byPid.get(hostPid)
  const views: ProcessEntryView[] = []
  // The meter's own subtree, aggregated while it is excluded: the dashboard
  // does not count the meter into what it is measuring, but the cost is real
  // and this plugin's — so it is disclosed (`meter`) rather than dropped.
  let meterCpu = 0
  let meterMeasured = 0
  let meterMem = 0
  let meterCount = 0

  if (host !== undefined) {
    const hidden = subtreeOf(options.excludePids ?? [], childrenOf)
    const labelOf = new Map<number, string>()
    for (const entry of options.registered) labelOf.set(entry.pid, entry.label)

    // Walk breadth-first from the host so a child is only reached once and
    // always after its parent — the inheritance of the MCP label depends on
    // that order. The visited set is the cycle guard: PID reuse can hand the
    // OS a list whose ppid chain loops.
    const visited = new Set<number>([hostPid])
    const queue: Array<{ row: RawProcess; label: string | null }> = [{ row: host, label: null }]
    while (queue.length > 0) {
      const { row, label } = queue.shift() as { row: RawProcess; label: string | null }

      const previous = prevCpuByPid.get(row.pid)
      const windowMs = sampledAt - prevAt
      const deltaCpu = previous === undefined ? Number.NaN : row.cpuMs - previous
      const cpuPct =
        prevAt > 0 &&
        windowMs >= MIN_DELTA_MS &&
        windowMs <= MAX_DELTA_MS &&
        previous !== undefined &&
        Number.isFinite(deltaCpu) &&
        deltaCpu >= 0
          ? round1((deltaCpu / windowMs / Math.max(1, cores)) * 100)
          : null

      // The excluded root and everything `subtreeOf` collected below it. Not
      // a row, not a total — the footprint. Its children must still be
      // walked (they belong to the footprint too); they will land in this
      // same branch via `hidden`.
      if (hidden.has(row.pid)) {
        if (cpuPct !== null) {
          meterCpu += cpuPct
          meterMeasured += 1
        }
        meterMem += row.memBytes
        meterCount += 1
        for (const child of childrenOf.get(row.pid) ?? []) {
          if (!visited.has(child.pid)) {
            visited.add(child.pid)
            queue.push({ row: child, label })
          }
        }
        continue
      }
      const own = labelOf.get(row.pid)
      const inherited = own ?? label

      const kind: ProcessEntryKind = row.pid === hostPid ? 'host' : inherited !== null ? 'mcp' : 'other'
      views.push({
        pid: row.pid,
        ppid: row.ppid,
        name: nameOf(row),
        cmdline: trimCmdline(row.cmdline, maxCmdline),
        kind,
        ...(inherited !== null && row.pid !== hostPid ? { mcpServer: inherited } : {}),
        cpuPct,
        memBytes: row.memBytes,
        cpuMs: Math.round(row.cpuMs),
      })

      for (const child of childrenOf.get(row.pid) ?? []) {
        if (!visited.has(child.pid)) {
          visited.add(child.pid)
          queue.push({ row: child, label: inherited })
        }
      }
    }
  }

  const cpuTotal = views.reduce((sum, view) => sum + (view.cpuPct ?? 0), 0)
  const totals: ProcessTotals = {
    cpuPct: round1(cpuTotal),
    memBytes: views.reduce((sum, view) => sum + view.memBytes, 0),
    count: views.length,
  }

  views.sort((a, b) => {
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    if (byKind !== 0) return byKind
    const aCpu = a.cpuPct ?? -1
    const bCpu = b.cpuPct ?? -1
    if (aCpu !== bCpu) return bCpu - aCpu
    if (a.memBytes !== b.memBytes) return b.memBytes - a.memBytes
    return a.pid - b.pid
  })

  const meter: ProcessMeterFootprint | null =
    meterCount > 0
      ? {
          cpuPct: meterMeasured > 0 ? round1(meterCpu) : null,
          memBytes: meterMem,
          count: meterCount,
        }
      : null

  return {
    sampledAt,
    intervalMs: SAMPLE_INTERVAL_MS,
    platform: options.platform,
    hostPid,
    cores,
    entries: views,
    totals,
    meter,
  }
}
