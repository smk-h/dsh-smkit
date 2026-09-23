/**
 * The merged settings section: one seat in the settings dialog for the three
 * pages this plugin used to seat on its own.
 *
 * The feature directories stay what they were — each owns its panel, its
 * dictionary and its stylesheets — and none of them seats a page any more:
 * this file is the composition layer that decides how those pages are shown,
 * which is exactly the boundary the architecture guard protects (a feature may
 * not import a sibling feature; a layer above the features may import them
 * all).
 *
 * The stylesheets are declared one per page rather than concatenated into one:
 * `entry.ts` injects them in list order, so the cascade stays what it was while
 * the three pages were separate seats — platform rules first, then MCP, skills
 * and custom-settings, and this shell's own frame last.
 */

import { SMKIT_LOCALE_EN } from './settings/i18n/en'
import { SMKIT_LOCALE_ZH } from './settings/i18n/zh'
import { MCP_LOCALE_EN } from './features/mcp/i18n/en'
import { MCP_LOCALE_ZH } from './features/mcp/i18n/zh'
import { SKILLS_LOCALE_EN } from './features/skills/i18n/en'
import { SKILLS_LOCALE_ZH } from './features/skills/i18n/zh'
import { CUSTOM_SETTINGS_LOCALE_EN } from './features/custom-settings/i18n/en'
import { CUSTOM_SETTINGS_LOCALE_ZH } from './features/custom-settings/i18n/zh'
import { createSettingsSection } from './settings/components/SettingsSection'
import { MCP_CSS } from './features/mcp/styles'
import { SKILLS_CSS } from './features/skills/styles'
import { CUSTOM_SETTINGS_CSS } from './features/custom-settings/styles'
import { SETTINGS_NAV_ATTRIBUTE, markSettingsNavRow } from './platform/ui/settings-nav'
import { iconMaskDataUri } from './platform/icons/Icon'
import { SETTINGS2_SPEC } from './platform/icons/Settings2Icon'
import pageCss from './settings/style/page.css'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from './platform/types'

/** The glyph the merged nav row wears: the sliders the custom-settings row used
 * to paint, which is what this section now is — the plugin's configuration.
 * The same spec feeds the icon on the custom-settings tab, so the row and the
 * tab cannot drift. */
const NAV_GLYPH = iconMaskDataUri(SETTINGS2_SPEC)

/** The glyph as a custom property — how a stylesheet receives a value only
 * code can produce. The platform layer's `style/settings-nav.css` consumes it
 * on every marked row; this rule supplies it on this section's row alone,
 * keyed by the marker's value. */
const NAV_GLYPH_RULE = `[${SETTINGS_NAV_ATTRIBUTE}='smkit']{--dsh-smkit-nav-glyph:url("${NAV_GLYPH}")}`

/**
 * The section component, built once for the life of the module: it closes over
 * `deps`, and building it again would hand the slot a different component
 * identity than the one already mounted (the same reason the three pages this
 * replaces were each built once).
 */
let section: unknown

export const settingsFeature: ClientFeature = {
  id: 'smkit',
  locale: { namespace: 'smkit', zh: SMKIT_LOCALE_ZH, en: SMKIT_LOCALE_EN },
  // The three pages' own dictionaries: their panels still read their copy
  // through their own namespace, so this section registers what the three
  // descriptors used to.
  extraLocales: [
    { namespace: 'mcp', zh: MCP_LOCALE_ZH, en: MCP_LOCALE_EN },
    { namespace: 'skills', zh: SKILLS_LOCALE_ZH, en: SKILLS_LOCALE_EN },
    { namespace: 'custom-settings', zh: CUSTOM_SETTINGS_LOCALE_ZH, en: CUSTOM_SETTINGS_LOCALE_EN },
  ],
  styles: [
    { name: 'mcp', css: MCP_CSS },
    { name: 'skills', css: SKILLS_CSS },
    { name: 'custom-settings', css: CUSTOM_SETTINGS_CSS },
    { name: 'smkit/page', css: pageCss },
    { name: 'smkit/nav-icon', css: NAV_GLYPH_RULE },
  ],
  register(ctx: ClientContext, deps: ClientDeps, t: Translator): void {
    // DSH projects only `id`, `order` and `label` out of a section registration
    // and picks each row's glyph from a closed list of built-in ids, so this
    // section marks its own row and lets the stylesheet paint the glyph (see
    // `platform/ui/settings-nav` and `NAV_GLYPH_RULE`). The marker owns no
    // shell structure and is dropped again on disposal, which keeps the
    // adaptation HMR-safe.
    ctx.effect(
      () => markSettingsNavRow('smkit', () => t('sectionLabel')),
      'dsh-mcp-manager: merged settings nav row',
    )
    // Each panel reads its own namespace: the seat binds this shell's, but the
    // words inside a page still belong to the feature that wrote them.
    section ??= createSettingsSection(deps, {
      section: t,
      mcp: ctx.locale.bind('mcp'),
      skills: ctx.locale.bind('skills'),
      customSettings: ctx.locale.bind('custom-settings'),
    })
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          // The id the MCP page has always used: a host that remembered which
          // section was open across reloads keeps landing on this one.
          id: 'mcp-manager',
          order: 50,
          label: () => t('sectionLabel'),
          locale: 'smkit',
        },
        section,
      ),
    )
  },
}
