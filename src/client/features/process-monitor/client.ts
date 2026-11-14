/**
 * The process monitor page as a client feature.
 *
 * It takes two seats:
 *
 * - `main` (keyed) hosts the page itself in the shell's central column — a
 *   table with a summary card row wants the conversation area's width.
 * - `sidebar.panellist.actions` is the sidebar More menu's content seat —
 *   the same seat the host's own "browse / create plugins" rows use — and
 *   the row registered there opens the page. The page is a diagnostic you
 *   open occasionally, so it spends no launcher-strip icon of its own; the
 *   row switches the main panel through `ctx.layout.selectPanel`, the
 *   cross-plugin panel-navigation face. That service is reached through
 *   reflection at click time rather than declared in `inject`: a host
 *   without it costs the gesture, not the bundle's activation.
 *
 * There is deliberately no gate (the debug page has one because its existence
 * is a setting's business): this page's entire cost — the host's per-request
 * sampling included — is scoped to the page being open. A page that costs
 * nothing closed needs no switch deciding whether it may exist.
 */

import { PROCESS_MONITOR_LOCALE_EN } from './i18n/en'
import { PROCESS_MONITOR_LOCALE_ZH } from './i18n/zh'
import { createGaugeIcon } from './icons/GaugeIcon'
import { createProcessMonitorPage } from './components/ProcessMonitorPage'
import { createProcessMonitorMenuEntry } from './components/ProcessMonitorMenuEntry'
import { PROCESS_MONITOR_CSS } from './styles'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/**
 * The page's id: the `main` key the menu row switches to.
 *
 * Prefixed with the plugin's own root because `main` is a flat key space
 * shared with every other plugin in the profile (the shell reserves
 * `conversation`).
 */
export const PROCESS_MONITOR_PANEL = 'smkit-process-monitor'

export const processMonitorFeature: ClientFeature = {
  id: 'process-monitor',
  locale: { namespace: 'process-monitor', zh: PROCESS_MONITOR_LOCALE_ZH, en: PROCESS_MONITOR_LOCALE_EN },
  styles: [{ name: 'process-monitor', css: PROCESS_MONITOR_CSS }],
  register(ctx: ClientContext, deps: ClientDeps, t: Translator): void {
    // Built once per registration: the slot hands the seat a component
    // identity it keeps for the section's lifetime, so rebuilding it per
    // render would remount the page (and drop its state) on every shell
    // commit.
    const Page = createProcessMonitorPage(deps, t)
    const GaugeIcon = createGaugeIcon(deps)
    const openPanel = (): void => {
      const layout = ctx.reflect?.get('layout') as
        | { selectPanel?: (id: string) => void }
        | undefined
      layout?.selectPanel?.(PROCESS_MONITOR_PANEL)
    }
    const MenuEntry = createProcessMonitorMenuEntry(deps, t, openPanel, GaugeIcon)

    // `inject` runs the setup for one declaration lifetime of the seat —
    // synchronously when the shell has already declared it, otherwise inside
    // the declaring `register()` call — and its return value is the disposer.
    ctx.slots.inject('main', () =>
      ctx.slots.register({ name: 'main', key: PROCESS_MONITOR_PANEL, locale: 'process-monitor' }, Page))
    ctx.slots.inject('sidebar.panellist.actions', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist.actions', id: PROCESS_MONITOR_PANEL, locale: 'process-monitor' },
        MenuEntry,
      ))
  },
}
