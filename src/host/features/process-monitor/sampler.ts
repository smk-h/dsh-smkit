/**
 * The sampler seam: read the OS process table on demand, normalized.
 *
 * The two halves of the feature meet here. Below this interface everything is
 * platform-shaped — Windows asks a resident PowerShell for one JSON line per
 * second, POSIX spawns `ps` per read — and above it everything is plain rows,
 * so the report builder and the route stay platform-free and testable on any
 * CI runner.
 *
 * The contract that makes "open the page, sample; close it, stop" true is
 * pull-shaped on purpose: nothing samples unless `read()` is called, and
 * `read()` is only called by the HTTP route, and the route is only hit by the
 * page's poll. A platform whose read is expensive (Windows) may keep a
 * resident helper between reads, but it must retire it by itself when the
 * reads stop — see `sampler-win.ts`.
 */

import { createPosixSampler } from './sampler-posix.js'
import { createWindowsSampler } from './sampler-win.js'
import type { LoggerLike } from '../../platform/types.js'

/** One process as the OS reported it, normalized across platforms. */
export interface RawProcess {
  pid: number
  ppid: number
  name: string
  cmdline: string
  /** Resident set / working set, bytes. */
  memBytes: number
  /** Lifetime CPU total (kernel + user), milliseconds. */
  cpuMs: number
}

/**
 * The sample before this one, as the sampler itself saw it.
 *
 * The differential is taken **inside the sampler, between two consecutive
 * samples**, not between two HTTP requests: the Windows helper produces a
 * frame roughly every 1.2 s while the page polls every 1.0 s, so a poll-to-
 * poll window is sometimes 0 ms (both polls saw one frame) and sometimes a
 * frame gap — the 0 ms case blanked the page's whole CPU column at a drift-
 * dependent rate. A frame-to-frame window is always the real interval, and a
 * poll that arrives between frames simply re-reads the same pair.
 */
export interface SampleBaseline {
  entries: RawProcess[]
  sampledAt: number
}

/** What one read answered — exactly one of the three shapes. */
export type SamplerReading =
  | { entries: RawProcess[]; sampledAt: number; baseline: SampleBaseline | null }
  | { warmingUp: true }
  | { error: string };

/** The seam the route reads through. */
export interface ProcessSampler {
  /**
   * The freshest reading. May resolve `{ warmingUp: true }` right after a
   * (re)start, while the first OS read is still in flight; never throws —
   * failure travels as `{ error }` so the route has one answer shape.
   */
  read(): Promise<SamplerReading>
  /**
   * Pids the report should hide, with their subtrees: the sampler's own
   * helpers, which are children of the host and would otherwise appear as
   * their own noisy rows.
   */
  excludePids(): Set<number>
  /** Stop sampling for good: kill any resident helper, wake every pending read. */
  dispose(): void
}

/** What the platform samplers get from the feature. */
export interface SamplerDeps {
  logger: LoggerLike
}

/**
 * The sampler for this host: Windows gets the resident-stream PowerShell
 * helper, everything else gets the per-read `ps` (cheap enough — tens of
 * milliseconds — that a resident helper would only add state).
 */
export function createProcessSampler(deps: SamplerDeps): ProcessSampler {
  return process.platform === 'win32' ? createWindowsSampler(deps) : createPosixSampler()
}
