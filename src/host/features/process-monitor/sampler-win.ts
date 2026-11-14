/**
 * The Windows sampler: one resident PowerShell streaming a frame per second.
 *
 * Why resident at all: the only dependency-free way to read pid, ppid,
 * command line, memory *and* CPU time on Windows is `Win32_Process` through
 * PowerShell, and a PowerShell start-up costs a good fraction of a second —
 * paid once here instead of once per poll. The helper prints one compact
 * JSON line per second on stdout, which this module reads line by line; the
 * HTTP route then samples that stream on demand.
 *
 * Why it is still "close the page, stop sampling": the helper self-retires.
 * Every read records when somebody last asked; every frame checks that
 * stamp, and a helper nobody has polled for a few seconds kills itself. So
 * the flow is — page opens, first read starts the helper; page polls, frames
 * flow; page closes, polls stop, the next frame notices the silence and the
 * helper is gone. Nothing in this module runs on a timer while idle.
 *
 * When the stream misbehaves (a machine where the output stalls, a PowerShell
 * that dies) the module does not keep resurrecting it: after two stalls it
 * degrades to one-shot mode — a PowerShell per read, correct but pricier —
 * for the rest of the host session, and says so once in the log.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { SAMPLE_INTERVAL_MS } from '../../../shared/process-monitor/contract.js'
import { LOG_PREFIX } from '../../../shared/http.js'
import type { ProcessSampler, RawProcess, SamplerDeps, SamplerReading } from './sampler.js'

/** Windows PowerShell 5.1 ships with the OS; pwsh is not assumed. */
const PS_EXE = 'powershell.exe'
const PS_SWITCHES = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
/** Win32_Process fields, asked for twice: once from WMI, once from Select-Object — the CIM instance carries more properties than were loaded, and the JSON line stays one line only if exactly these seven cross it. */
const PS_FIELDS =
  'ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,KernelModeTime,UserModeTime'
/** UTF-8 on the pipe, or a Chinese command line arrives in the OEM codepage. */
const PS_BOOT = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;'
const PS_QUERY = `Get-CimInstance -ClassName Win32_Process -Property ${PS_FIELDS} | Select-Object ${PS_FIELDS} | ConvertTo-Json -Compress`
const PS_ONESHOT_SCRIPT = `${PS_BOOT} ${PS_QUERY}`
/** One frame per sample interval, minus the query's own cost. */
const PS_STREAM_SCRIPT = `${PS_BOOT} while($true){ ${PS_QUERY}; Start-Sleep -Milliseconds ${SAMPLE_INTERVAL_MS - 50} }`

/** A frame older than this is not worth answering a read with. */
const STALE_FRAME_MS = 2_000
/** How long a first frame may take: PowerShell start-up included. */
const FIRST_FRAME_TIMEOUT_MS = 4_000
/** A live stream that produced no frame for this long has stalled. */
const STALL_MS = 4_000
/** Two stalls and the stream is not trusted for the rest of the session. */
const MAX_STALLS = 2
/** No read for this long and the helper retires itself. */
const IDLE_RETIRE_MS = 6_000
const ONE_SHOT_TIMEOUT_MS = 8_000

/** One row of the JSON line, as `ConvertTo-Json` writes it. */
interface Win32ProcessRow {
  ProcessId?: unknown
  ParentProcessId?: unknown
  Name?: unknown
  CommandLine?: unknown
  WorkingSetSize?: unknown
  KernelModeTime?: unknown
  UserModeTime?: unknown
}

/**
 * One JSON line → rows. `null` for a line that is not a frame (PowerShell's
 * own chatter, a split line); an empty array is a frame nobody needs.
 * CPU times are 100 ns units — `/1e4` makes them milliseconds.
 */
export function parseWindowsFrame(line: string): RawProcess[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const rows = Array.isArray(parsed) ? (parsed as Win32ProcessRow[]) : [parsed as Win32ProcessRow]
  const out: RawProcess[] = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const pid = Number(row.ProcessId)
    const ppid = Number(row.ParentProcessId)
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
    const memBytes = Number(row.WorkingSetSize)
    const cpuMs = (Number(row.KernelModeTime) + Number(row.UserModeTime)) / 1e4
    out.push({
      pid,
      ppid,
      name: typeof row.Name === 'string' ? row.Name : '',
      cmdline: typeof row.CommandLine === 'string' ? row.CommandLine : '',
      memBytes: Number.isFinite(memBytes) ? Math.max(0, memBytes) : 0,
      cpuMs: Number.isFinite(cpuMs) ? cpuMs : 0,
    })
  }
  return out
}

/** What one one-shot run answers: a full table, or why there is none. */
type OneShotResult = { entries: RawProcess[]; sampledAt: number } | { error: string }

/** A PowerShell run that answers exactly once: the degraded mode's read. */
function runOneShot(): Promise<OneShotResult> {
  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const finish = (reading: OneShotResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(reading)
    }
    const timer = setTimeout(
      () => finish({ error: `the one-shot sampling command timed out after ${ONE_SHOT_TIMEOUT_MS} ms` }),
      ONE_SHOT_TIMEOUT_MS,
    )
    timer.unref?.()

    let child: ChildProcess
    try {
      child = spawn(PS_EXE, [...PS_SWITCHES, PS_ONESHOT_SCRIPT], { windowsHide: true })
    } catch (error) {
      finish({ error: `the sampling command failed to start: ${String(error)}` })
      return
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      finish({ error: `the sampling command failed: ${error instanceof Error ? error.message : String(error)}` })
    })
    child.on('close', () => {
      // The whole run is one document; any line that parses is the frame.
      const lines = stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '')
      for (const line of lines) {
        const entries = parseWindowsFrame(line)
        if (entries !== null && entries.length > 0) {
          finish({ entries, sampledAt: Date.now() })
          return
        }
      }
      finish({ error: `the sampling command answered nothing${stderr.trim() === '' ? '' : `: ${stderr.trim()}`}` })
    })
  })
}

export function createWindowsSampler(deps: SamplerDeps): ProcessSampler {
  const { logger } = deps

  let mode: 'stream' | 'one-shot' = 'stream'
  let child: ChildProcess | null = null
  let buffer = ''
  let frame: { entries: RawProcess[]; sampledAt: number } | null = null
  /** The sample before `frame` — the differencing half of the pair a read returns. */
  let baseline: { entries: RawProcess[]; sampledAt: number } | null = null
  let lastFrameAt = 0
  let lastRequestAt = 0
  let stalls = 0
  let degradedNotice = false
  let disposed = false
  /** Read()s waiting for a first frame; woken by the frame or their own timeout. */
  const waiters: Array<(ok: boolean) => void> = []
  let watchdog: ReturnType<typeof setInterval> | null = null

  const wakeWaiters = (ok: boolean): void => {
    const pending = waiters.splice(0, waiters.length)
    for (const waiter of pending) waiter(ok)
  }

  const killChild = (): void => {
    if (child === null) return
    const proc = child
    child = null
    buffer = ''
    try {
      proc.kill()
    } catch {
      // Already gone.
    }
  }

  const clearWatchdog = (): void => {
    if (watchdog !== null) {
      clearInterval(watchdog)
      watchdog = null
    }
  }

  /** The stream broke: count it, and either restart it or stop trusting it. */
  const noteStall = (reason: string): void => {
    if (disposed || mode !== 'stream') return
    stalls += 1
    killChild()
    if (stalls >= MAX_STALLS) {
      mode = 'one-shot'
      clearWatchdog()
      wakeWaiters(false)
      if (!degradedNotice) {
        degradedNotice = true
        logger.warn(`${LOG_PREFIX}: process monitor stream stalled twice (${reason}); sampling per request for the rest of this session`)
      }
      return
    }
    logger.warn(`${LOG_PREFIX}: process monitor stream stalled (${reason}); restarting the sampler`)
    start()
  }

  function start(): void {
    if (disposed || child !== null || mode !== 'stream') return
    buffer = ''
    const proc = spawn(PS_EXE, [...PS_SWITCHES, PS_STREAM_SCRIPT], { windowsHide: true })
    child = proc
    lastFrameAt = Date.now()
    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line !== '') onFrameLine(line)
      }
    })
    proc.on('error', (error) => {
      if (child === proc) noteStall(`spawn failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    proc.on('close', () => {
      if (child === proc) noteStall('the stream closed')
    })
    if (watchdog === null) {
      // The only always-on clock, and it runs only while a helper exists.
      // `unref()` keeps it from holding a test process open.
      watchdog = setInterval(() => {
        if (child === null) return
        if (Date.now() - lastFrameAt > STALL_MS) noteStall('no frame arrived')
      }, 1_000)
      watchdog.unref?.()
    }
  }

  function onFrameLine(line: string): void {
    const entries = parseWindowsFrame(line)
    if (entries === null || entries.length === 0) return
    // The pair advances only when a frame arrives: the new frame becomes the
    // head, the old head becomes the baseline. A read that lands between
    // frames re-serves the same pair (same numbers), never a zero-width one.
    if (frame !== null) baseline = frame
    frame = { entries, sampledAt: Date.now() }
    lastFrameAt = frame.sampledAt
    stalls = 0
    // The idle retirement lives here rather than on a timer: the frame loop
    // is the one clock that already runs while the page polls, so a closed
    // page costs at most one more frame before the helper is gone.
    if (lastRequestAt > 0 && frame.sampledAt - lastRequestAt > IDLE_RETIRE_MS) {
      killChild()
      wakeWaiters(false)
      return
    }
    wakeWaiters(true)
  }

  return {
    async read(): Promise<SamplerReading> {
      if (disposed) return { warmingUp: true }
      lastRequestAt = Date.now()
      if (mode === 'one-shot') {
        // The degraded path keeps its own pair: each one-shot becomes the
        // baseline of the next, so the differential survives the degradation.
        const shot = await runOneShot()
        if (!('entries' in shot)) return shot
        const pair = { entries: shot.entries, sampledAt: shot.sampledAt, baseline }
        baseline = { entries: shot.entries, sampledAt: shot.sampledAt }
        return pair
      }
      start()
      if (frame !== null && lastRequestAt - frame.sampledAt <= STALE_FRAME_MS) {
        return { entries: frame.entries, sampledAt: frame.sampledAt, baseline }
      }
      // First frame after a (re)start: wait briefly so the page's first paint
      // carries data (cpuPct null — there is nothing to difference against),
      // and answer `warmingUp` rather than blocking the poll past its cycle.
      await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(resolve)
          if (index >= 0) waiters.splice(index, 1)
          resolve(false)
        }, FIRST_FRAME_TIMEOUT_MS)
        timer.unref?.()
        waiters.push((ok) => {
          clearTimeout(timer)
          resolve(ok)
        })
      })
      if (frame !== null && Date.now() - frame.sampledAt <= STALE_FRAME_MS) {
        return { entries: frame.entries, sampledAt: frame.sampledAt, baseline }
      }
      return { warmingUp: true }
    },
    excludePids(): Set<number> {
      // The helper and whatever it spawned (a conhost, if the OS made one) —
      // the report hides the whole subtree, so the monitor never measures
      // its own sampling.
      return child?.pid !== undefined ? new Set([child.pid]) : new Set()
    },
    dispose(): void {
      disposed = true
      killChild()
      clearWatchdog()
      wakeWaiters(false)
    },
  }
}
