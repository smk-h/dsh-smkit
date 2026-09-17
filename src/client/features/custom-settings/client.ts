/**
 * The custom-settings feature's client half: the Custom settings page of the
 * settings dialog, its dictionary, its stylesheets, and the glyph its
 * settings-nav row wears.
 *
 * The page is a strip of tabs, one per configuration area this plugin exposes
 * (`components/CustomSettingsContent` owns the list — the model-retry tab is
 * the first entry). Everything the plugin needs to know about the feature is in
 * the descriptor below; `entry.ts` walks the list and stays ignorant of retry
 * policies.
 */

import { createCustomSettingsContent } from './components/CustomSettingsContent'
import { CUSTOM_SETTINGS_LOCALE_EN } from './i18n/en'
import { CUSTOM_SETTINGS_LOCALE_ZH } from './i18n/zh'
import { markSettingsNavRow } from '../../platform/ui/settings-nav'
import { CUSTOM_SETTINGS_CSS, CUSTOM_SETTINGS_NAV_ICON_CSS } from './styles'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/**
 * The feature's name: its dictionary namespace, its stylesheet prefix, and the
 * value `styles.ts` keys this section's nav-glyph rule by — the three must
 * agree, and only the first is read from here.
 */
const FEATURE_ID = 'custom-settings'

/**
 * The section component, built once for the life of the module: it closes over
 * `deps`, and building it again would hand the slot a different component
 * identity than the one already mounted (the same reason the MCP section is
 * built once).
 */
let section: unknown

export const customSettingsFeature: ClientFeature = {
  id: FEATURE_ID,
  locale: { namespace: FEATURE_ID, zh: CUSTOM_SETTINGS_LOCALE_ZH, en: CUSTOM_SETTINGS_LOCALE_EN },
  styles: [
    { name: FEATURE_ID, css: CUSTOM_SETTINGS_CSS },
    { name: `${FEATURE_ID}/nav-icon`, css: CUSTOM_SETTINGS_NAV_ICON_CSS },
  ],
  register(ctx: ClientContext, deps: ClientDeps, t: Translator): void {
    // DSH projects only `id`, `order` and `label` out of a section registration
    // and picks each row's glyph from a closed list of built-in ids, so this
    // feature marks its own row and lets the stylesheet paint the glyph (see
    // `platform/ui/settings-nav` and `CUSTOM_SETTINGS_NAV_ICON_CSS`). The marker
    // owns no shell structure and is dropped again on disposal, which keeps the
    // adaptation HMR-safe.
    ctx.effect(
      () => markSettingsNavRow(FEATURE_ID, () => t('sectionLabel')),
      `dsh-mcp-manager: ${FEATURE_ID} settings nav row`,
    )
    section ??= createCustomSettingsContent(deps)
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'mcp-manager-custom-settings',
          // After MCP's row: both are sections of the same settings dialog, and
          // the order here is the order the dialog lists them in.
          order: 60,
          label: () => t('sectionLabel'),
          locale: FEATURE_ID,
        },
        section,
      ),
    )
  },
}
