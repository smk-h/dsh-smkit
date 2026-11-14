/**
 * The wire contract of the process-monitor feature.
 *
 * The host half reads the OS process table on demand and projects it into
 * these shapes at `/smkit/api/process-monitor/sample`; the browser half
 * renders exactly these shapes. The two constants are values rather than
 * comments because both halves act on them: the host labels every sample with
 * the cadence it was built for, and the page polls at that cadence — a page
 * that guessed a different number would silently widen or narrow every CPU
 * percentage the differential math produces.
 *
 * CPU percentages are normalized against the machine's whole capacity
 * (Task Manager's convention): one fully busy core on eight shows as 12.5,
 * not 100. A single `cpuMs` sample is a lifetime total, so the first sample
 * after a gap carries `cpuPct: null` and the page prints "—" until a second
 * one arrives — the same shape VS Code's own process explorer settles on.
 */

/** Path of the one read-only route, under `/smkit/api`. */
export const PROCESS_MONITOR_SAMPLE_PATH = '/process-monitor/sample'

/** The cadence the page polls at, and the window the CPU differential assumes. */
export const SAMPLE_INTERVAL_MS = 1_000

/** How one entry relates to this plugin's host process. */
export type ProcessEntryKind =
  /** The dsh host process itself — the root the subtree is collected from. */
  | 'host'
  /** The entry is, or descends from, an MCP stdio server this host spawned. */
  | 'mcp'
  /** Any other descendant: a shell, a build tool, a sibling plugin's child. */
  | 'other'

/** One process of the host's subtree, as the page's table renders it. */
export interface ProcessEntryView {
  pid: number
  ppid: number
  /** Executable base name as the OS reported it (`node.exe`, `node`). */
  name: string
  /** The full command line, trimmed to a bounded length by the host. */
  cmdline: string
  kind: ProcessEntryKind
  /**
   * The MCP server id this subtree belongs to. Present on the registered
   * wrapper itself and inherited by its descendants (an `npx` shim's node
   * child is the server, not the shim).
   */
  mcpServerId?: string
  /** Percent of the machine's whole capacity, or null until two samples exist. */
  cpuPct: number | null
  /** Resident set / working set, in bytes. */
  memBytes: number
  /** Total CPU time consumed so far, in milliseconds. */
  cpuMs: number
}

/** The subtree's aggregates, as the summary cards print them. */
export interface ProcessTotals {
  /** Sum of the entries' `cpuPct`; a gap's null entries contribute nothing. */
  cpuPct: number
  memBytes: number
  count: number
}

/**
 * The measurement's own cost: the sampler's excluded subtree, aggregated.
 *
 * The dashboard does not count the meter into what it is measuring (a page
 * whose opening raised the very number it went to read would measure the
 * observation, not the machine) — but the cost is real and caused by this
 * plugin, so it is disclosed instead of dropped: the page prints this line
 * under the table, and any cross-check against another tool should find the
 * difference to be exactly this footprint.
 */
export interface ProcessMeterFootprint {
  /** Null until two samples exist, exactly like a row's `cpuPct`. */
  cpuPct: number | null
  memBytes: number
  count: number
}

/** The answer of `GET /process-monitor/sample`. */
export interface ProcessMonitorSample {
  /** Epoch milliseconds of the OS read this report was built from. */
  sampledAt: number
  intervalMs: number
  /** `process.platform` of the host, so the page can name what it is seeing. */
  platform: string
  hostPid: number
  /** Logical cores the percentages are normalized over. */
  cores: number
  /**
   * True when the sampler has just (re)started and no OS read has landed yet —
   * the page shows its warming line and the next poll carries data.
   */
  warmingUp?: boolean
  /** Set when the OS read failed; the page shows it instead of a table. */
  error?: string
  entries: ProcessEntryView[]
  totals: ProcessTotals
  /** The sampler's own footprint: excluded from `entries`/`totals`, disclosed. */
  meter: ProcessMeterFootprint | null
}
