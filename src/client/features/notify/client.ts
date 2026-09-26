/**
 * The notify feature's client half: the focus heartbeat and the web-delivery
 * subscriber.
 *
 * **The heartbeat** lets the host suppress notifications while the web page
 * is focused — ZCode's one quiet condition, transplanted. The host cannot see
 * a browser window, so the page reports its own state: `focused` while
 * `document.hasFocus()` is true (renewed on a timer so the host can expire a
 * page that died without a goodbye), and `blurred` the instant focus leaves,
 * which makes suppression end at the moment the user looks away rather than
 * at the next timer tick. A heartbeat failure is quiet by design: the route
 * being gone (an older host, a 404) must cost nothing.
 *
 * **The web-delivery subscriber** is the second notification path, for hosts
 * that run somewhere with no screen to toast on (dsh on a remote server, the
 * page opened over an SSH tunnel). It holds one event-stream connection to
 * `/notify/events`, shows each pushed decision as a Web Notification (tagged
 * with the decision's dedupeKey, so several tabs receiving the same frame
 * render one toast) and plays the shared mp3 when the frame says so. The host
 * still decides *whether* — suppression, dedupe and the toggles all happen
 * upstream, so the page only ever receives decisions worth showing.
 *
 * Both degrade silently outside a browser: the bundle is also mounted in
 * Node test harnesses where `document` may be absent entirely or carry only
 * the parts their own effects touch. (`typeof document === 'undefined'` is
 * load-bearing: the optional chain cannot short-circuit an *undeclared*
 * identifier — evaluating the base throws before `?.` gets a say.)
 */

import { API_PREFIX } from '../../../shared/http'
import { NOTIFY_LOCALE_EN } from './i18n/en'
import { NOTIFY_LOCALE_ZH } from './i18n/zh'
import { NOTIFY_CSS } from './styles'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/** How often the page renews its `focused` heartbeat, in milliseconds. The
 * host's freshness window (8s) has to cover one missed beat plus slop. */
const HEARTBEAT_INTERVAL_MS = 5_000

/** How long to wait before reconnecting a dropped event stream. */
const RESUBSCRIBE_DELAY_MS = 3_000

/** One decision pushed by the host over the event stream. */
interface NotifyEvent {
  type?: string
  title?: string
  body?: string
  dedupeKey?: string
  sound?: boolean
}

export const notifyFeature: ClientFeature = {
  id: 'notify',
  locale: { namespace: 'notify', zh: NOTIFY_LOCALE_ZH, en: NOTIFY_LOCALE_EN },
  styles: [{ name: 'page', css: NOTIFY_CSS }],

  register(ctx: ClientContext, deps: ClientDeps, _t: Translator): void {
    ctx.effect(() => {
      // The heartbeat is a browser behavior and degrades silently outside
      // one: the bundle is also mounted in Node test harnesses where
      // `document` may be absent entirely or carry only the parts their own
      // effects touch. A missing heartbeat reads as "never focused", which
      // the host already treats as "notify".
      // (`typeof document === 'undefined'` is load-bearing: the optional
      // chain cannot short-circuit an *undeclared* identifier — evaluating
      // the base throws before `?.` gets a say.)
      if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}
      if (
        typeof document.hasFocus !== 'function' ||
        typeof window.addEventListener !== 'function' ||
        typeof window.setInterval !== 'function'
      ) {
        // Every effect hands its disposer back, degraded or not.
        return () => {}
      }
      const ping = (state: 'focused' | 'blurred'): void => {
        void deps
          .api('/notify/heartbeat', { method: 'POST', body: JSON.stringify({ state }) })
          .catch(() => {})
      }
      // State at mount, whatever it is: a background tab opened straight into
      // the page must not suppress until it is actually focused.
      ping(document.hasFocus() ? 'focused' : 'blurred')
      const onFocus = (): void => ping('focused')
      const onBlur = (): void => ping('blurred')
      window.addEventListener('focus', onFocus)
      window.addEventListener('blur', onBlur)
      const timer = window.setInterval(() => {
        if (document.hasFocus()) ping('focused')
      }, HEARTBEAT_INTERVAL_MS)
      return () => {
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('blur', onBlur)
        window.clearInterval(timer)
      }
    }, 'smkit: notify/heartbeat')

    // --- the web-delivery subscriber (remote-host deployments) ---
    ctx.effect(() => {
      if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}
      // Notification is the whole point of this path; without it (very old
      // browsers, non-secure origins like a LAN address) there is nothing
      // worth connecting for. Audio failing merely silences the toast.
      if (typeof Notification === 'undefined') return () => {}
      // Unauthorized pages must not hold a stream open for nothing; the
      // panel's authorize button grants it, and this effect's registration
      // happened at mount — so a later grant is picked up on the next page
      // load (the shell re-mounts every visit, which is soon enough).
      if (Notification.permission !== 'granted') return () => {}

      let disposed = false
      let controller: AbortController | undefined
      let audio: HTMLAudioElement | null = null
      let soundUrl: string | null | undefined

      /** The notification sound, fetched once as a blob URL. `null` after a
       * failed fetch means "stay silent", like the host's own fallback. */
      async function ensureSoundUrl(): Promise<string | null> {
        if (soundUrl !== undefined) return soundUrl
        try {
          const resp = await fetch(API_PREFIX + '/notify/sound')
          soundUrl = resp.ok ? URL.createObjectURL(await resp.blob()) : null
        } catch {
          soundUrl = null
        }
        return soundUrl
      }

      /** Show one pushed decision: toast it (tag = dedupeKey collapses the
       * copies other tabs would render), then play the sound if asked. */
      async function deliver(event: NotifyEvent): Promise<void> {
        try {
          // The host suppresses on the heartbeat already; this repeat check
          // closes the race where the user came back between the host's
          // decision and this frame.
          if (document.hasFocus()) return
          if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
          if (typeof event.title !== 'string' || event.title === '') return
          const notification = new Notification(event.title, {
            body: typeof event.body === 'string' ? event.body : '',
            tag: typeof event.dedupeKey === 'string' ? event.dedupeKey : undefined,
          })
          notification.onclick = () => {
            try {
              window.focus()
              notification.close()
            } catch {
              // A focus the browser refuses costs nothing; the toast still
              // closed.
            }
          }
          if (event.sound === true) {
            const url = await ensureSoundUrl()
            if (url !== null) {
              audio ??= new Audio(url)
              // Reset the reused instance, or a replay stays silent.
              audio.pause()
              audio.currentTime = 0
              await audio.play().catch(() => {})
            }
          }
        } catch {
          // One undeliverable decision is not an error worth a console line.
        }
      }

      /** Hold one stream open, and reconnect after a drop. The promise
       * settles only when the stream closes, which is the loop's exit. */
      async function run(): Promise<void> {
        while (!disposed) {
          controller = typeof AbortController === 'undefined' ? undefined : new AbortController()
          try {
            await deps.stream(
              '/notify/events',
              { method: 'GET', ...(controller ? { signal: controller.signal } : {}) },
              (event: Record<string, unknown>) => {
                if (event.type === 'notify') void deliver(event as NotifyEvent)
              },
            )
          } catch {
            // Aborted (disposed) or dropped: both land here, and only the
            // disposed case must not retry.
            if (disposed) break
          }
          if (disposed) break
          await new Promise((resolve) => setTimeout(resolve, RESUBSCRIBE_DELAY_MS))
        }
      }
      void run()

      return () => {
        disposed = true
        try {
          controller?.abort()
        } catch {
          // Nothing to clean up if the controller is already gone.
        }
      }
    }, 'smkit: notify/web-delivery')
  },
}
