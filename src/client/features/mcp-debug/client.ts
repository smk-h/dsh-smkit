/**
 * The MCP debug page as a client feature.
 *
 * It takes two seats that only make sense as a pair:
 *
 * - `main` (keyed) hosts the page itself. `main` is the shell's central-panel
 *   seat, so the page gets the whole conversation area instead of a column —
 *   three panes of server list, tool list and answer is what the Inspector this
 *   replaces occupies, and the settings dialog is too narrow for it.
 * - `sidebar.panellist` (list) is the rail entry that opens it. The two share
 *   one id: the sidebar addresses a `main` key by the list entry's own id, so a
 *   page whose two ids disagreed would render a panel nobody could open. This is
 *   the same pair DSH's own pages and the memory-system plugin use.
 *
 * Nothing is registered eagerly against a service the host may not have: both
 * seats are declared by packages in `dsh.client.inject`, and `slots.inject`
 * waits for the declaring registration, so a host without a left rail simply
 * draws neither.
 */

import { MCP_DEBUG_LOCALE_EN } from './i18n/en'
import { MCP_DEBUG_LOCALE_ZH } from './i18n/zh'
import { createBugIcon } from './icons/BugIcon'
import { createMcpDebugPage } from './components/McpDebugPage'
import { MCP_DEBUG_CSS } from './styles'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/**
 * The page's id: the `main` key the rail entry addresses.
 *
 * Prefixed with the plugin's own root because `main` is a flat key space shared
 * with every other plugin in the profile (the shell reserves `conversation`).
 */
export const MCP_DEBUG_PANEL = 'smkit-mcp-debug'

/** Where the rail entry sits among the shell's panel launchers. */
const RAIL_ORDER = 40

export const mcpDebugFeature: ClientFeature = {
  id: 'mcp-debug',
  locale: { namespace: 'mcp-debug', zh: MCP_DEBUG_LOCALE_ZH, en: MCP_DEBUG_LOCALE_EN },
  styles: [{ name: 'mcp-debug', css: MCP_DEBUG_CSS }],
  register(ctx: ClientContext, deps: ClientDeps, t: Translator): void {
    // Built once per registration: the slot hands the seat a component identity
    // it keeps for the section's lifetime, so rebuilding it per render would
    // remount the page (and drop its state) on every shell commit.
    const Page = createMcpDebugPage(deps, t)
    const BugIcon = createBugIcon(deps)

    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: MCP_DEBUG_PANEL, locale: 'mcp-debug' },
        Page,
      ),
    )
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: MCP_DEBUG_PANEL,
          order: RAIL_ORDER,
          label: () => t('panelLabel'),
          locale: 'mcp-debug',
        },
        BugIcon,
      ),
    )
  },
}
