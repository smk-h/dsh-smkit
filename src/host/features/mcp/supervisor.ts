/**
 * Automatic reconnection of dropped transports.
 *
 * A transport can die in two ways, and both end up here:
 *
 * 1. **Loudly** — a stdio child exits. `handle.onExit` reports it the moment it
 *    happens (`spawnStdio`). This is the shape the remote setup lives in: the
 *    child is not the server at all but an `ssh` bridge to it, so the link
 *    dropping kills the child.
 * 2. **Quietly** — the process is alive but the session behind it is gone (a
 *    half-open TCP connection, a wedged bridge). Nothing signals that, so the
 *    health probe asks a cheap question (`tools/list`) on a timer and treats a
 *    failure as a drop.
 *
 * Deliberately **not** a trigger: a failing `tools/call`. A tool that reports
 * `isError` and a transport that is gone raise the same shaped error at that
 * layer, so reconnecting on both would tear down healthy connections over
 * ordinary tool failures. The exit signal and the probe cover the same ground
 * without having to guess which kind of failure it was.
 *
 * **Only a connection that was up is ever retried.** Nothing watches a failed
 * open: `watch()` is called by the two connect paths *after* the handshake and
 * the first `tools/list` succeeded, so a server that never came up — an
 * unreachable endpoint, a wrong command, a missing token, a browser round trip
 * still to be done — is left exactly as it is. The rule continues into the
 * retry chain: an attempt that comes back in a state a retry cannot fix
 * (`needs-auth` above all) stops the loop instead of hammering it
 * (`RETRYABLE_STATUSES`).
 *
 * A retry always re-enters the ordinary connect path (`registry.connect` /
 * `recoverWorkspaceServer`), so tool registration, status and agent scopes are
 * rebuilt by the code that already owns them. Every callback re-checks that it
 * is still talking about the live connection, and every way a user can stop a
 * server (`disconnect`, `closeWorkspaceServer`, unmount) cancels the pending
 * retry — without that, a server the user just stopped would come back a second
 * later.
 */

import { LOG_PREFIX, MAX_ERROR_LENGTH, RECONNECT_BASE_DELAY_MS } from './constants.js'
import {
  effectiveHealthCheckIntervalMs,
  effectiveReconnectMaxAttempts,
  effectiveReconnectMaxDelayMs,
  isAutoReconnectEnabled,
} from './state.js'
import { errorText } from '../../platform/util/text.js'
import type { Runtime } from './runtime.js'
import type {
  LiveConnection,
  LoggerLike,
  McpHandle,
  ServerConfig,
  ServerStatus,
  WorkspaceConnection,
} from './types.js'

/** Where a watched connection lives — enough to find it again after a drop. */
export type ConnectionRef =
  | { tier: 'global'; server: ServerConfig }
  | { tier: 'workspace'; wsPath: string; name: string }

export interface SupervisorDeps {
  runtime: Runtime
  logger: LoggerLike
  /** Re-enter the global connect path for one server. */
  reconnectGlobal(server: ServerConfig): Promise<unknown>
  /** Re-enter the workspace connect path for one live row. */
  reconnectWorkspace(wsPath: string, name: string): Promise<unknown>
}

export interface Supervisor {
  /** Take responsibility for one freshly opened transport. */
  watch(ref: ConnectionRef, handle: McpHandle): void
  /** Drop the pending retry (and probe) of one global server. */
  cancelGlobal(serverId: string): void
  /** Drop the pending retry (and probe) of one workspace server. */
  cancelWorkspace(wsPath: string, name: string): void
  /** Drop every pending retry and probe (plugin teardown). */
  cancelAll(): void
}

/** One watched connection, plus whatever it is currently waiting on. */
interface Watch {
  ref: ConnectionRef
  key: string
  /** The transport this entry speaks for; a replacement is a new entry. */
  handle: McpHandle
  /** Retries already spent on the current outage (reset by a successful open). */
  attempt: number
  retryTimer: ReturnType<typeof setTimeout> | null
  probeTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Exponential backoff from one second, capped. The jitter takes a slice *off*
 * the top (`0.8 … 1.0 ×`) rather than adding one, so a capped delay can never
 * exceed the ceiling the user configured.
 */
function backoffDelayMs(attempt: number, maxDelayMs: number): number {
  const capped = Math.min(maxDelayMs, RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1))
  return Math.round(capped * (0.8 + Math.random() * 0.2))
}

/**
 * The statuses a retry can still fix.
 *
 * Everything else means a person has to act, and trying again only produces
 * noise:
 * - `needs-auth`: the connection being retried was working, so credentials were
 *   fine — if the re-open now says someone has to authenticate, that is a token
 *   (or a registration) the user must redo, not a transient failure;
 * - `disabled` / `disconnected` / `conflict` / `configured`: states only a user
 *   action produces. Cancel already covers them; keeping them here means a race
 *   cannot quietly undo one.
 */
const RETRYABLE_STATUSES: ReadonlySet<ServerStatus> = new Set<ServerStatus>([
  'error',
  'connecting',
  'reconnecting',
])

export function createSupervisor(deps: SupervisorDeps): Supervisor {
  const { runtime, logger } = deps
  const watching = new Map<string, Watch>()

  // The map key is the connection's identity, not the drop's: `\u0000` cannot
  // appear in a server name or a filesystem path, so the two tiers cannot
  // collide on a crafted name.
  const globalKey = (serverId: string): string => `g\u0000${serverId}`
  const workspaceKey = (wsPath: string, name: string): string => `w\u0000${wsPath}\u0000${name}`
  const keyOf = (ref: ConnectionRef): string =>
    ref.tier === 'global' ? globalKey(ref.server.id) : workspaceKey(ref.wsPath, ref.name)

  /** The live record a ref points at, or null once it is gone. */
  function recordOf(ref: ConnectionRef): LiveConnection | WorkspaceConnection | null {
    if (ref.tier === 'global') return runtime.live.get(ref.server.id) ?? null
    return runtime.workspaces.get(ref.wsPath)?.servers.get(ref.name) ?? null
  }

  /** Whether `entry` still describes the connection it was opened for. */
  function isCurrent(entry: Watch): boolean {
    return recordOf(entry.ref)?.handle === entry.handle
  }

  function stopTimers(entry: Watch): void {
    if (entry.retryTimer) clearTimeout(entry.retryTimer)
    if (entry.probeTimer) clearTimeout(entry.probeTimer)
    entry.retryTimer = null
    entry.probeTimer = null
  }

  function forget(entry: Watch): void {
    stopTimers(entry)
    if (watching.get(entry.key) === entry) watching.delete(entry.key)
  }

  /** Write a status on the live record — never `setLive`, which would resurrect
   * a record the server's deletion just removed. */
  function mark(ref: ConnectionRef, status: ServerStatus, error: string): void {
    const record = recordOf(ref)
    if (!record) return
    record.status = status
    record.error = error
  }

  /** A bounded one-liner for the row's `error` slot. */
  const note = (text: string): string => text.slice(0, MAX_ERROR_LENGTH)

  /*
   * Health probe: `tools/list` is the one request every server answers — it is
   * how the connection was established in the first place — so it needs no
   * capability negotiation and cannot false-positive on a server that simply
   * does not implement an optional method.
   */
  function scheduleProbe(entry: Watch): void {
    if (entry.handle.closed) return
    const interval = effectiveHealthCheckIntervalMs(runtime.state)
    if (interval <= 0) return
    const timer = setTimeout(() => {
      entry.probeTimer = null
      void probe(entry)
    }, interval)
    // A retry or probe must never be what keeps the host process alive.
    timer.unref?.()
    entry.probeTimer = timer
  }

  async function probe(entry: Watch): Promise<void> {
    if (watching.get(entry.key) !== entry) return
    if (!isCurrent(entry)) {
      forget(entry)
      return
    }
    // An exit already reported this handle; that path owns the retry, and it
    // cleared this probe on its way out.
    if (entry.handle.closed) return
    try {
      await entry.handle.listTools()
    } catch (error) {
      if (watching.get(entry.key) === entry) report(entry, `health check failed: ${errorText(error)}`)
      return
    }
    if (watching.get(entry.key) === entry) scheduleProbe(entry)
  }

  /** A drop was observed: say so on the row, then retry or refuse to. */
  function report(entry: Watch, reason: string): void {
    if (entry.probeTimer) {
      clearTimeout(entry.probeTimer)
      entry.probeTimer = null
    }
    if (!isAutoReconnectEnabled(runtime.state)) {
      mark(entry.ref, 'error', note(`${reason}; automatic reconnect is off`))
      forget(entry)
      return
    }
    entry.attempt += 1
    const maxAttempts = effectiveReconnectMaxAttempts(runtime.state)
    if (maxAttempts > 0 && entry.attempt > maxAttempts) {
      mark(entry.ref, 'error', note(`${reason}; gave up after ${maxAttempts} reconnect attempts`))
      forget(entry)
      return
    }
    const delay = backoffDelayMs(entry.attempt, effectiveReconnectMaxDelayMs(runtime.state))
    const budget = maxAttempts > 0 ? `/${maxAttempts}` : ''
    mark(
      entry.ref,
      'reconnecting',
      note(`${reason}; reconnecting in ${delay} ms (attempt ${entry.attempt}${budget})`),
    )
    const timer = setTimeout(() => {
      entry.retryTimer = null
      void retry(entry)
    }, delay)
    timer.unref?.()
    entry.retryTimer = timer
  }

  async function retry(entry: Watch): Promise<void> {
    if (watching.get(entry.key) !== entry) return
    // The row itself must still be there: deleted, or its workspace released,
    // means there is nothing left to reconnect.
    if (!recordOf(entry.ref)) {
      forget(entry)
      return
    }
    try {
      if (entry.ref.tier === 'global') await deps.reconnectGlobal(entry.ref.server)
      else await deps.reconnectWorkspace(entry.ref.wsPath, entry.ref.name)
    } catch (error) {
      logger.warn(`${LOG_PREFIX}: reconnect for ${entry.key} failed: ${errorText(error)}`)
    }
    // A successful reopen re-watches through `watch()` (both connect paths call
    // it), which retires this entry. So an entry that is still here failed, and
    // the connect path has already written the reason onto the record.
    if (watching.get(entry.key) !== entry) return
    const record = recordOf(entry.ref)
    if (!record) {
      forget(entry)
      return
    }
    if (!RETRYABLE_STATUSES.has(record.status)) {
      // Give up quietly, leaving the status and the reason the re-open wrote:
      // the row then says what the user has to do (typically 待认证) instead of
      // showing a retry that is never going to work.
      logger.info(
        `${LOG_PREFIX}: not retrying ${entry.key}: the connection needs attention (${record.status})`,
      )
      forget(entry)
      return
    }
    report(entry, `reconnect failed: ${record.error || 'unknown reason'}`)
  }

  function watch(ref: ConnectionRef, handle: McpHandle): void {
    const key = keyOf(ref)
    const previous = watching.get(key)
    if (previous) forget(previous)
    const entry: Watch = { ref, key, handle, attempt: 0, retryTimer: null, probeTimer: null }
    watching.set(key, entry)
    // The transport can die in the window between being opened and being handed
    // over, and that death was reported to a listener that did not exist yet —
    // so it is a drop right now, not something to wait for.
    if (handle.closed) {
      report(entry, 'transport closed before it was watched')
      return
    }
    handle.onExit = (reason) => {
      // A transport superseded mid-open exits too (its handle was replaced), and
      // that exit says nothing about the connection that replaced it.
      if (watching.get(key) !== entry) return
      if (!isCurrent(entry)) {
        forget(entry)
        return
      }
      report(entry, reason)
    }
    scheduleProbe(entry)
  }

  function cancelKey(key: string): void {
    const entry = watching.get(key)
    if (entry) forget(entry)
  }

  return {
    watch,
    cancelGlobal: (serverId) => cancelKey(globalKey(serverId)),
    cancelWorkspace: (wsPath, name) => cancelKey(workspaceKey(wsPath, name)),
    cancelAll: () => {
      for (const entry of [...watching.values()]) forget(entry)
    },
  }
}
