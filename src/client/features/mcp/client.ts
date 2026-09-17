/**
 * The MCP feature's client half: the Settings → MCP section, its dictionary,
 * its stylesheets, and the glyph its settings-nav row wears.
 *
 * Everything the plugin needs to know about the feature is in the descriptor
 * below; `entry.ts` walks the list and stays ignorant of MCP.
 */

import { createMcpContent } from './components/McpContent'
import { MCP_LOCALE_EN } from './i18n/en'
import { MCP_LOCALE_ZH } from './i18n/zh'
import { markSettingsNavRow } from '../../platform/ui/settings-nav'
import { MCP_CSS, MCP_NAV_ICON_CSS } from './styles'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/**
 * The section component, built once for the life of the module: it closes over
 * `deps`, and building it again would hand the slot a different component
 * identity than the one already mounted (the same reason the single-plugin
 * entry built it once at load time).
 */
let section: unknown

export const mcpFeature: ClientFeature = {
  id: 'mcp',
  locale: { namespace: 'mcp', zh: MCP_LOCALE_ZH, en: MCP_LOCALE_EN },
  styles: [
    { name: 'mcp', css: MCP_CSS },
    { name: 'mcp/nav-icon', css: MCP_NAV_ICON_CSS },
  ],
  register(ctx: ClientContext, deps: ClientDeps, t: Translator): void {
    // DSH projects only `id`, `order` and `label` out of a section registration
    // and picks each row's glyph from a closed list of built-in ids, so this
    // feature marks its own row and lets the stylesheet paint the glyph (see
    // `platform/ui/settings-nav` and `MCP_NAV_ICON_CSS`). The marker owns no
    // shell structure and is dropped again on disposal, which keeps the
    // adaptation HMR-safe.
    ctx.effect(
      () => markSettingsNavRow('mcp', () => t('sectionLabel')),
      'dsh-mcp-manager: settings nav row',
    )
    section ??= createMcpContent(deps)
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'mcp-manager',
          order: 50,
          label: () => t('sectionLabel'),
          locale: 'mcp',
        },
        section,
      ),
    )
  },
}
