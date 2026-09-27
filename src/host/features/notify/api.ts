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
import { headerValue } from '../../platform/routes.js'
import { notifySettingsUrl } from '../../../shared/notify/browser.js'
import type { ApiHandler } from '../../platform/routes.js'
import type { LoggerLike } from '../../platform/types.js'
import type { NotifyOrchestrator } from './orchestrator.js'
import { normalizeDuration } from './settings.js'
import { soundBytes } from './sound.js'
import type { NotifyBroadcaster } from './broadcaster.js'
import type { NotifySettings } from './types.js'

/** What the routes need: the toggles, the orchestrator, and the test fire. */
export interface NotifyApiDeps {
  getSettings(): NotifySettings
  saveSettings(next: NotifySettings): void
  orchestrator: NotifyOrchestrator
  fireTest(): void
  /** Recorded on every heartbeat: the origin the page is served from. */
  onOrigin(origin: string): void
  /** The event-stream registry the web-delivery route hands connections to. */
  broadcaster: NotifyBroadcaster
  logger: LoggerLike
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

/**
 * The settings answer, as the panel reads it: the three saved values, where the
 * host runs, and the address of the asking browser's own notification settings.
 *
 * The address is derived here, from the user agent of this very request, for
 * one reason: the client half reads no user agent of its own, and the request
 * already carries the answer to "which browser is this". `null` — a browser
 * the mapping does not know — is a legitimate answer, and the panel keeps its
 * own wording then.
 */
export function notifySettingsView(
  settings: NotifySettings,
  userAgent: string | undefined,
): Record<string, unknown> {
  return {
    ...settings,
    platform: process.platform,
    webSettingsUrl: notifySettingsUrl(userAgent ?? ''),
  }
}

/** The feature's handlers, in matching order. */
export function createNotifyHandlers(deps: NotifyApiDeps): ApiHandler[] {
  return [
    async (req, res, facts) => {
      if (facts.rest === '/notify/settings' && req.method === 'GET') {
        sendJson(res, 200, notifySettingsView(deps.getSettings(), headerValue(req, 'user-agent')))
        return true
      }

      if (facts.rest === '/notify/settings' && req.method === 'POST') {
        const body = await readBody(req)
        const next = nextSettings(body, deps.getSettings())
        deps.saveSettings(next)
        // The POST answer becomes the panel's next state, so it has to carry
        // the same browser address the GET does.
        sendJson(res, 200, notifySettingsView(next, headerValue(req, 'user-agent')))
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

      if (facts.rest === '/notify/events' && req.method === 'GET') {
        // Takes ownership of the response: headers, pings, and the close
        // listener that drops it again. The handler returns immediately; the
        // connection stays open in the broadcaster's hands.
        deps.broadcaster.connect(res)
        return true
      }

      if (facts.rest === '/notify/sound' && req.method === 'GET') {
        const bytes = soundBytes(deps.logger)
        if (bytes === null) {
          sendJson(res, 404, { error: 'sound unavailable' })
          return true
        }
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Content-Length': String(bytes.length),
          'Cache-Control': 'no-store',
        })
        res.end(bytes)
        return true
      }

      return false
    },
  ]
}
