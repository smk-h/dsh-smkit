/**
 * The notify feature's client half: the focus heartbeat.
 *
 * The host suppresses notifications while the web page is focused — ZCode's
 * one quiet condition, transplanted. The host cannot see a browser window,
 * so the page reports its own state: `focused` while `document.hasFocus()`
 * is true (renewed on a timer so the host can expire a page that died
 * without a goodbye), and `blurred` the instant focus leaves, which makes
 * suppression end at the moment the user looks away rather than at the next
 * timer tick.
 *
 * A heartbeat failure is quiet by design: the route being gone (an older
 * host, a 404) must cost nothing, and a page that cannot reach the host has
 * bigger problems than a stale heartbeat.
 *
 * The panel this feature's settings live in is the merged settings section's
 * `notify` tab (`components/NotifyPanel.tsx`, seated by `src/client/
 * settings.ts`); the heartbeat is the one piece of this feature that runs
 * outside the settings dialog, which is why it is a client feature of its
 * own rather than only a panel.
 */

import { NOTIFY_LOCALE_EN } from './i18n/en'
import { NOTIFY_LOCALE_ZH } from './i18n/zh'
import { NOTIFY_CSS } from './styles'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/** How often the page renews its `focused` heartbeat, in milliseconds. The
 * host's freshness window (8s) has to cover one missed beat plus slop. */
const HEARTBEAT_INTERVAL_MS = 5_000

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
  },
}
