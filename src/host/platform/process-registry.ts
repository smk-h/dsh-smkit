/**
 * The registry of child processes this plugin spawned, keyed by pid.
 *
 * A cross-feature seam: the MCP feature knows which pid a stdio server runs
 * under (its transport holds the child), and the process-monitor feature
 * knows how to read the OS process table — but a feature may not import
 * another feature, so the one fact both need is deposited here, in the
 * platform layer both are allowed to import.
 *
 * The registry holds identities, never handles: nothing here can kill or
 * signal a process, so a stale entry (a child that died before its
 * unregister ran) costs the monitor one mislabelled row for the second the OS
 * takes to drop the pid — and a reused pid simply overwrites the entry.
 */

/** What a registered child is, for the monitor's grouping. */
export type RegisteredProcessKind =
  /** An MCP stdio server wrapper spawned by the transports facade. */
  | 'mcp-server'

/** One deposited fact: this pid belongs to that named thing. */
export interface RegisteredProcess {
  pid: number
  kind: RegisteredProcessKind
  /** The thing's own name — for an MCP server, its `server.id`. */
  label: string
  /** When the entry was deposited, for diagnostics. */
  at: number
}

/**
 * The registry itself. Module-level on purpose: both features reach it
 * through this module rather than through the composition root, because the
 * spawn site (a reconnect inside the supervisor) and the read site (an HTTP
 * request) never share a context object.
 */
const registered = new Map<number, RegisteredProcess>()

/** Deposit (or overwrite, on a reused pid) one process's identity. */
export function registerProcess(entry: {
  pid: number
  kind: RegisteredProcessKind
  label: string
}): void {
  if (!Number.isInteger(entry.pid) || entry.pid <= 0) return
  registered.set(entry.pid, { ...entry, at: Date.now() })
}

/** Withdraw one pid's identity — the child exited or was closed. */
export function unregisterProcess(pid: number): void {
  registered.delete(pid)
}

/** A snapshot of every live identity, for the monitor's per-sample read. */
export function registeredProcesses(): RegisteredProcess[] {
  return [...registered.values()]
}

/** Test seam: the registry outlives one test, so each starts it empty. */
export function clearRegisteredProcesses(): void {
  registered.clear()
}
