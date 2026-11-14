/**
 * The POSIX sampler: one `ps` per read, nothing resident.
 *
 * `ps` answers the whole table in tens of milliseconds, so a helper process
 * that stays alive between reads would cost more than it saves. The output
 * format is the one thing to be careful with: the first three columns are
 * numbers and the fourth is a CPU time, but `args` (everything after them)
 * contains spaces — so the parser takes the first four tokens positionally
 * and treats the remainder as one command line, never splitting on commas or
 * colons the way a CSV fantasy would.
 *
 * CPU time arrives as a lifetime total (`[[dd-]hh:]mm:ss[.cc]`), which is
 * exactly what the report's differential wants; `ps`'s own `%cpu` column is
 * a since-boot average and is deliberately not requested.
 */

import { spawn } from 'node:child_process'
import type { ProcessSampler, RawProcess, SampleBaseline, SamplerReading } from './sampler.js'

const PS_TIMEOUT_MS = 5_000

/** Column spec: no header, machine-stable order, `args` last. */
const PS_ARGS = ['-axo', 'pid=,ppid=,rss=,time=,args=']

/**
 * `[[dd-]hh:]mm:ss[.cc]` → milliseconds. Fractions of a second arrive as
 * centiseconds on Linux and macOS alike; anything malformed answers 0 rather
 * than NaN, because a row nobody can parse is a row to skip, not a report to
 * fail.
 */
export function parseCpuTimeToMs(text: string): number {
  let days = 0
  let rest = text
  const dash = rest.indexOf('-')
  if (dash >= 0) {
    const head = Number(rest.slice(0, dash))
    if (!Number.isFinite(head)) return 0
    days = head
    rest = rest.slice(dash + 1)
  }
  const parts = rest.split(':')
  if (parts.length < 2 || parts.length > 3) return 0
  const numbers = parts.map((part) => Number(part))
  if (numbers.some((value) => !Number.isFinite(value))) return 0
  const [hours, minutes, seconds] = parts.length === 3 ? numbers : [0, numbers[0], numbers[1]]
  return Math.round(((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000)
}

/** Executable-ish name for a row whose `args` is all there is: first token's basename. */
function nameFromArgs(args: string): string {
  const first = args.split(/\s+/)[0] ?? ''
  return first.split(/[\\/]+/).filter(Boolean).pop() ?? ''
}

/**
 * One `ps` output, as rows. A line that does not open with `pid ppid rss time`
 * (a header that snuck in, a truncated line) is skipped, not fatal: one bad
 * row must not cost the reader every other row.
 */
export function parsePosixOutput(text: string): RawProcess[] {
  const rows: RawProcess[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const tokens = trimmed.split(/\s+/)
    if (tokens.length < 4) continue
    const pid = Number(tokens[0])
    const ppid = Number(tokens[1])
    const rssKb = Number(tokens[2])
    const time = tokens[3]
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isFinite(rssKb)) continue
    // A CPU time always carries a colon and nothing but digits, colons, dots
    // and (on Linux) a day dash. Anything else means the columns shifted.
    if (!/^[0-9:.-]+$/.test(time) || !time.includes(':')) continue
    const args = tokens.slice(4).join(' ')
    rows.push({
      pid,
      ppid,
      name: nameFromArgs(args),
      cmdline: args,
      memBytes: Math.max(0, Math.round(rssKb * 1024)),
      cpuMs: parseCpuTimeToMs(time),
    })
  }
  return rows
}

/** What one `ps` run answers: a full table, or why there is none. */
type PsResult = { entries: RawProcess[]; sampledAt: number } | { error: string }

/**
 * One `ps` run: spawn, collect, parse, settle. `tracked` (when given) holds
 * the child's pid for exactly as long as the child lives, so a report built
 * while this read is in flight can hide the helper it is being measured by.
 */
function runPs(tracked: Set<number> | null): Promise<PsResult> {
  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const finish = (reading: PsResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (tracked !== null && child?.pid !== undefined) tracked.delete(child.pid)
      resolve(reading)
    }
    const timer = setTimeout(() => {
      try {
        child?.kill()
      } catch {
        // Already gone; the close handler settles this read.
      }
      finish({ error: `ps timed out after ${PS_TIMEOUT_MS} ms` })
    }, PS_TIMEOUT_MS)
    timer.unref?.()

    let child: ReturnType<typeof spawn> | null = null
    try {
      child = spawn('ps', PS_ARGS, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      finish({ error: `ps failed to start: ${String(error)}` })
      return
    }
    if (child.pid !== undefined && tracked !== null) tracked.add(child.pid)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      finish({ error: `ps failed: ${error instanceof Error ? error.message : String(error)}` })
    })
    child.on('close', (code) => {
      if (code !== 0) {
        finish({ error: `ps exited with ${code}${stderr.trim() === '' ? '' : `: ${stderr.trim()}`}` })
        return
      }
      finish({ entries: parsePosixOutput(stdout), sampledAt: Date.now() })
    })
  })
}

/**
 * The POSIX sampler: nothing resident between reads apart from two things —
 * the pid of whichever `ps` is in flight (which `excludePids` reports, so the
 * monitor never measures itself) and the previous reading, which is the
 * differencing baseline of the next (see `SampleBaseline` in `sampler.ts`).
 */
export function createPosixSampler(): ProcessSampler {
  const inFlight = new Set<number>()
  let baseline: SampleBaseline | null = null
  return {
    async read(): Promise<SamplerReading> {
      const reading = await runPs(inFlight)
      if (!('entries' in reading)) return reading
      const pair = { entries: reading.entries, sampledAt: reading.sampledAt, baseline }
      baseline = { entries: reading.entries, sampledAt: reading.sampledAt }
      return pair
    },
    excludePids(): Set<number> {
      return new Set(inFlight)
    },
    dispose(): void {
      // Nothing resident: the per-read child dies with its read.
    },
  }
}
