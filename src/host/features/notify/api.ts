/**
 * The notify routes: settings read/write, the page's focus heartbeat, and a
 * test fire the settings panel's button drives.
 *
 * All three are thin transports — validation here, decisions in the
 * orchestrator (`./orchestrator.ts`) and the dispatcher (`./host.ts`). The
 * heartbeat route is the one that also learns the page's origin: the web page
 * reports from where it is served, and that origin is what the toast's click
 * opens, so it is always right even when dsh's address moves.
 */

import { readBody, sendJson } from '../../platform/util/http.js'
import type { ApiHandler } from '../../platform/routes.js'
import type { NotifyOrchestrator } from './orchestrator.js'
import { normalizeDuration } from './settings.js'
import type { NotifySettings } from './types.js'

/** What the routes need: the toggles, the orchestrator, and the test fire. */
export interface NotifyApiDeps {
  getSettings(): NotifySettings
  saveSettings(next: NotifySettings): void
  orchestrator: NotifyOrchestrator
  fireTest(): void
  /** Recorded on every heartbeat: the origin the page is served from. */
  onOrigin(origin: string): void
}

/** Fold one POST /settings body into the next settings value. */
export function nextSettings(
  body: Record<string, unknown>,
  current: NotifySettings,
): NotifySettings {
  return {
    enabled: body.enabled === undefined ? current.enabled : body.enabled === null ? true : typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
    soundEnabled:
      body.soundEnabled === undefined
        ? current.soundEnabled
        : body.soundEnabled === null
          ? true
          : typeof body.soundEnabled === 'boolean'
            ? body.soundEnabled
            : current.soundEnabled,
    duration: normalizeDuration(body.duration, current.duration),
  }
}

/** The feature's handlers, in matching order. */
export function createNotifyHandlers(deps: NotifyApiDeps): ApiHandler[] {
  return [
    async (req, res, facts) => {
      if (facts.rest === '/notify/settings' && req.method === 'GET') {
        sendJson(res, 200, deps.getSettings())
        return true
      }

      if (facts.rest === '/notify/settings' && req.method === 'POST') {
        const body = await readBody(req)
        const next = nextSettings(body, deps.getSettings())
        deps.saveSettings(next)
        sendJson(res, 200, next)
        return true
      }

      if (facts.rest === '/notify/heartbeat' && req.method === 'POST') {
        const body = await readBody(req)
        deps.orchestrator.touchHeartbeat(body.state === 'focused' ? 'focused' : 'blurred')
        deps.onOrigin(facts.origin)
        sendJson(res, 200, { ok: true })
        return true
      }

      if (facts.rest === '/notify/test' && req.method === 'POST') {
        deps.fireTest()
        sendJson(res, 200, { ok: true })
        return true
      }

      return false
    },
  ]
}
