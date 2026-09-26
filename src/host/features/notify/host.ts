/**
 * The notify feature's host half: the event listeners that decide, and the
 * dispatcher that shows.
 *
 * The listeners ride the harness's own event bus — the same emits its web UI
 * is built from — with the one registration shape the other scoped listeners
 * in this plugin use (`global: true`): dsh dispatches scoped events to the
 * agent context, and an unscoped listener only joins when it says so. The two
 * waterfall listeners (`approval/request`, `user-questions/request`) exist in
 * the harness's decision chain for the duration of one call: observe, then
 * `next()` untouched — this feature must never answer a decision.
 *
 * Suppression is ZCode's, transplanted: the only quiet condition is "the page
 * is focused", learned from the web page's heartbeat. Browser closed, tab
 * closed, page crashed — none of it suppresses, which is the point: these
 * toasts exist for the moments the user is not looking at dsh.
 *
 * Every listener is fenced in a try/catch that logs: no notification failure
 * may reach the agent's event loop.
 */

import { createNotifyOrchestrator } from './orchestrator.js'
import { loadNotifySettings, saveNotifySettings } from './settings.js'
import { resolveSoundFile } from './sound.js'
import { showToast } from './toast.js'
import { createNotifyBroadcaster } from './broadcaster.js'
import { createNotifyHandlers } from './api.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'
import type { NotifyDecision, NotifySettings } from './types.js'

const LOG_PREFIX = 'smkit notify:'

/** The slice of `SessionSummary` the orchestrator reads off `api-session/added`. */
interface AddedSummaryLike {
  sessionId?: string
  cwd?: string
  origin?: 'subagent'
}

export const notifyFeature: HostFeature = {
  id: 'notify',

  mount(platform: HostPlatform): void {
    const ctx = platform.ctx
    const logger = platform.logger

    let settings: NotifySettings = loadNotifySettings()
    const orchestrator = createNotifyOrchestrator()
    // The second delivery path: pages that show the notification themselves,
    // for hosts whose machine has no screen to toast on (dsh on a remote
    // server, the page opened over an SSH tunnel).
    const broadcaster = createNotifyBroadcaster(logger)
    // The page's origin, updated on every heartbeat; the toast's click opens
    // it. Nothing is launched until a heartbeat has reported one.
    let launchOrigin: string | undefined

    /**
     * Show one decision, unless a toggle or the focus heartbeat says not to.
     * Delivery prefers the page wherever one is connected: its Web
     * Notification focuses the existing tab on click, while the native
     * toast's protocol launch always spawns a new one. The native toast is
     * the Windows fallback for exactly the case the web cannot cover — no
     * page anywhere (browser closed), where opening a fresh tab is the only
     * click behavior left. The two paths are mutually exclusive by
     * construction, so there is no double toast to dedupe.
     */
    function dispatch(decision: NotifyDecision, options: { force?: boolean } = {}): void {
      if (!options.force && !settings.enabled) return
      if (!options.force && orchestrator.isSuppressed()) return
      logger.info?.(`${LOG_PREFIX} ${decision.kind}: ${decision.title}${decision.body ? ` — ${decision.body}` : ''}`)
      if (process.platform === 'win32' && broadcaster.size() === 0) {
        const soundFile = settings.soundEnabled ? resolveSoundFile(logger) : null
        showToast(
          { title: decision.title, body: decision.body, soundFile, launchUrl: launchOrigin, duration: settings.duration },
          logger,
        )
      } else {
        broadcaster.broadcast(decision, settings.soundEnabled, options.force === true)
      }
    }

    /** Run one observer and dispatch what it returns, swallowing everything. */
    function observe(run: () => NotifyDecision | null): void {
      try {
        const decision = run()
        if (decision !== null) dispatch(decision)
      } catch (error) {
        logger.warn?.(`${LOG_PREFIX} decision failed: ${String(error)}`)
      }
    }

    // Session lifecycle: cwd/origin metadata, map hygiene. Structural reads —
    // the harness's summary shape is projected, not imported.
    try {
      ctx.on('api-session/added', (summary: AddedSummaryLike) => {
        observe(() => {
          if (typeof summary?.sessionId === 'string') orchestrator.observeSessionAdded(summary)
          return null
        })
      })
      ctx.on('api-session/removed', (sessionId: string) => {
        observe(() => {
          if (typeof sessionId === 'string') orchestrator.observeSessionRemoved(sessionId)
          return null
        })
      })

      // Task terminal states.
      ctx.on('api-session/status', (sessionId: string, running: boolean) => {
        observe(() => orchestrator.observeStatus(sessionId, running))
      })
      ctx.on('api-session/error', (sessionId: string, message: string) => {
        observe(() => orchestrator.observeError(sessionId, message))
      })

      // The two "needs you" waterfalls: observe on the way in, delegate
      // untouched — the decision belongs to the harness's answerer chain.
      ctx.on(
        'approval/request',
        async (request: { agent?: { id?: string }; toolName?: string; reason?: string }, next: () => Promise<unknown>) => {
          observe(() => orchestrator.observeApproval(request))
          return next()
        },
        { global: true },
      )
      ctx.on(
        'user-questions/request',
        async (
          request: { agent?: { id?: string }; questions?: Array<{ id?: string; question?: string; intent?: { kind?: string } }> },
          next: () => Promise<unknown>,
        ) => {
          observe(() => orchestrator.observeQuestion(request))
          return next()
        },
        { global: true },
      )
    } catch (error) {
      logger.warn?.(`${LOG_PREFIX} listener registration failed: ${String(error)}`)
    }

    platform.handlers.push(
      ...createNotifyHandlers({
        getSettings: () => ({ ...settings }),
        saveSettings: (next: NotifySettings) => {
          settings = next
          saveNotifySettings(next)
        },
        orchestrator,
        fireTest: () =>
          dispatch(
            {
              kind: 'completed',
              title: '测试通知',
              body: 'dsh 的通知链路是通的：任务完成与需要确认时都会这样弹出。',
              dedupeKey: 'test',
            },
            { force: true },
          ),
        onOrigin: (origin: string) => {
          launchOrigin = origin
        },
        broadcaster,
        logger,
      }),
    )
  },
}
