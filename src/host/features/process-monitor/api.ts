/**
 * The process monitor's route: one read-only GET.
 *
 * The route is deliberately a thin shell — every read refreshes the differ-
 * encing baseline the report keeps between requests, which is the whole magic
 * of "the page's one-second poll *is* the sampling window": no timer lives on
 * the host, so a closed page costs this route nothing at all.
 *
 * Failure stays a 200 with an `error` field (the settings and debug routes
 * made the same choice): the page is a dashboard, and a dead sampler is a
 * state to render, not a request for the browser to retry harder.
 */

import { cpus } from 'node:os'
import { SAMPLE_INTERVAL_MS, PROCESS_MONITOR_SAMPLE_PATH } from '../../../shared/process-monitor/contract.js'
import type { ProcessMonitorSample } from '../../../shared/process-monitor/contract.js'
import { registeredProcesses } from '../../platform/process-registry.js'
import { sendJson } from '../../platform/util/http.js'
import { buildProcessReport } from './report.js'
import type { ProcessSampler } from './sampler.js'
import type { ApiHandler } from '../../platform/routes.js'
import type { LoggerLike } from '../../platform/types.js'

/** What the route needs; every field has a production default, none a test bypass that changes behaviour. */
export interface ProcessMonitorApiDeps {
  logger: LoggerLike
  sampler: ProcessSampler
  /** The subtree root; defaults to this host process. */
  hostPid?: number
  /** Logical cores the percentages normalize over; defaults to the machine's. */
  cores?: number
  /** Passes through to the page; defaults to `process.platform`. */
  platform?: string
}

/** The report shape of a read that produced no table to show. */
function emptyReport(
  hostPid: number,
  cores: number,
  platform: string,
  extras: { warmingUp?: true; error?: string },
): ProcessMonitorSample {
  return {
    sampledAt: Date.now(),
    intervalMs: SAMPLE_INTERVAL_MS,
    platform,
    hostPid,
    cores,
    ...extras,
    entries: [],
    totals: { cpuPct: 0, memBytes: 0, count: 0 },
    meter: null,
  }
}

/** Logical core count, guarded: a host that cannot answer it gets 1 rather than a crash. */
function cpusCount(): number {
  const count = cpus().length
  return Number.isInteger(count) && count > 0 ? count : 1
}

/** The feature's handlers, in matching order. */
export function createProcessMonitorHandlers(deps: ProcessMonitorApiDeps): ApiHandler[] {
  // Read once: `os.cpus()` re-scans /proc on Linux, and the core count of a
  // machine does not change under a route.
  const cores = deps.cores ?? cpusCount()
  const hostPid = deps.hostPid ?? process.pid
  const platform = deps.platform ?? process.platform

  return [
    async (req, res, facts) => {
      if (facts.rest !== PROCESS_MONITOR_SAMPLE_PATH || req.method !== 'GET') return false

      const reading = await deps.sampler.read()
      if ('error' in reading) {
        sendJson(res, 200, emptyReport(hostPid, cores, platform, { error: reading.error }))
        return true
      }
      if (!('entries' in reading)) {
        sendJson(res, 200, emptyReport(hostPid, cores, platform, { warmingUp: true }))
        return true
      }
      // The route holds no state of its own: the sampler's reading carries
      // its own previous sample, so the poll's landing spots cannot widen,
      // narrow or zero out the differencing window.
      sendJson(
        res,
        200,
        buildProcessReport(reading.entries, reading.baseline, {
          hostPid,
          cores,
          platform,
          sampledAt: reading.sampledAt,
          registered: registeredProcesses(),
          excludePids: deps.sampler.excludePids(),
        }),
      )
      return true
    },
  ]
}
