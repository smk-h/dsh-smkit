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
  /**
   * A process of the host's *application* but not of its subtree: the GUI main
   * process, the renderers, the GPU process — the rows Windows Task Manager
   * folds into the app's one line and the dsh tree by definition cannot reach
   * (they are siblings of the host, not its children).
   */
  | 'app'

/** One process row as the page's table renders it: a subtree row or an app row. */
export interface ProcessEntryView {
  pid: number
  ppid: number
  /** Executable base name as the OS reported it (`node.exe`, `node`). */
  name: string
  /** The full command line, trimmed to a bounded length by the host. */
  cmdline: string
  kind: ProcessEntryKind
  /**
   * The MCP server this subtree belongs to, by its label: the configured
   * server name, plus `@<workspace directory>` on the workspace tier, where
   * the same name can exist in two workspaces at once. Present on the
   * registered wrapper itself and inherited by its descendants (an `npx`
   * shim's node child is the server, not the shim). Deliberately not the
   * registry id — that is a hash by construction, and a row the reader
   * cannot pronounce cannot be matched against the /mcp picker.
   */
  mcpServer?: string
  /** Percent of the machine's whole capacity, or null until two samples exist. */
  cpuPct: number | null
  /** Resident set / working set, in bytes — shared pages included. */
  memBytes: number
  /**
   * Dedicated working set, in bytes, when the platform reports it (Windows).
   * This is what Task Manager's memory column prints and the only figure that
   * can be summed over a process group without counting shared pages twice;
   * absent on POSIX, where every reader falls back to `memBytes`.
   */
  memPrivateBytes?: number
  /** Total CPU time consumed so far, in milliseconds. */
  cpuMs: number
}

/** The subtree's aggregates, as the summary cards print them. */
export interface ProcessTotals {
  /** Sum of the entries' `cpuPct`; a gap's null entries contribute nothing. */
  cpuPct: number
  /** Sum of the entries' `memBytes` — working set, so shared pages repeat. */
  memBytes: number
  /** Sum of the entries' `memPrivateBytes`; absent when no row reported one. */
  memPrivateBytes?: number
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
  /** Dedicated working set, when the platform reports it — see `ProcessEntryView`. */
  memPrivateBytes?: number
  count: number
}

/**
 * The *application* the host belongs to, when that is a wider thing than the
 * host's subtree — the desktop profile's case: dsh runs as one process of an
 * Electron app, so the GUI main process, the renderer drawing this very page
 * and the GPU process are siblings of the host and invisible to a subtree walk.
 * Windows Task Manager folds exactly this group into the app's one line, which
 * is why a page that reported only the subtree disagreed with it by a factor.
 *
 * The group is defined by executable identity — the host's highest ancestor
 * that runs the same executable, plus every same-executable process below it —
 * because that is the rule Task Manager's own grouping follows in practice.
 * It is null whenever the host already is the top of its executable chain
 * (a terminal-launched `node`, the POSIX case, any app with a launcher of a
 * different executable), and also when the chain holds nothing but the host's
 * own ancestry: a parent that merely shares the executable (npm's node running
 * a node script) is a launcher, not an application, and has no sibling branch
 * for the group to be about.
 */
export interface ProcessAppScope {
  /** The application's topmost same-executable process. */
  rootPid: number
  /** Its executable base name, as the OS reported it. */
  rootName: string
  /** The group's processes outside the host's subtree — the rows Task Manager folds in but this page would otherwise never show. */
  entries: ProcessEntryView[]
  /** Aggregates over the whole group, host included: Task Manager's "App" line, in this page's window. */
  totals: ProcessTotals
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
  /** The host's subtree — the rows the two "dsh total" cards count. */
  entries: ProcessEntryView[]
  /** Aggregates over `entries` only; the app group is a separate scope. */
  totals: ProcessTotals
  /** The wider application group, or null when the host is the top of its executable chain. */
  app: ProcessAppScope | null
  /** The sampler's own footprint: excluded from `entries`/`totals`, disclosed. */
  meter: ProcessMeterFootprint | null
}
