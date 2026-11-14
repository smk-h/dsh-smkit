/**
 * The process monitor page as a client feature.
 *
 * It takes the same two seats every openable page takes, paired under one id:
 *
 * - `main` (keyed) hosts the page itself in the shell's central column — a
 *   table with a summary card row wants the conversation area's width.
 * - `sidebar.panellist` (list) is the rail entry that opens it. The sidebar
 *   addresses a `main` key by the list entry's own id, so a page whose two
 *   ids disagreed would render a panel nobody could open. See
 *   `mcp-debug/client.ts` for the pairing rule this follows.
 *
 * Unlike the debug page there is deliberately no gate: that page exists even
 * when hidden from the settings switch, while this one's entire cost — the
 * host's per-request sampling included — is scoped to the page being open.
 * A page that costs nothing closed needs no switch deciding whether it may
 * exist.
 */

import { PROCESS_MONITOR_LOCALE_EN } from './i18n/en'
import { PROCESS_MONITOR_LOCALE_ZH } from './i18n/zh'
import { createGaugeIcon } from './icons/GaugeIcon'
import { createProcessMonitorPage } from './components/ProcessMonitorPage'
import { PROCESS_MONITOR_CSS } from './styles'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/**
 * The page's id: the `main` key the rail entry addresses.
 *
 * Prefixed with the plugin's own root because `main` is a flat key space
 * shared with every other plugin in the profile (the shell reserves
 * `conversation`).
 */
export const PROCESS_MONITOR_PANEL = 'smkit-process-monitor'

/**
 * Where the rail entry sits among the shell's panel launchers: right after
 * the MCP debug page (40), whose sibling diagnostic this is.
 */
const RAIL_ORDER = 41

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

    // `inject` runs the setup for one declaration lifetime of the seat —
    // synchronously when the shell has already declared it, otherwise inside
    // the declaring `register()` — and its return value is the disposer.
    ctx.slots.inject('main', () =>
      ctx.slots.register({ name: 'main', key: PROCESS_MONITOR_PANEL, locale: 'process-monitor' }, Page))
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: PROCESS_MONITOR_PANEL,
          order: RAIL_ORDER,
          label: () => t('panelLabel'),
          locale: 'process-monitor',
        },
        GaugeIcon,
      ))
  },
}
