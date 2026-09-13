/**
 * The retry feature's client half: the Model retry section of Settings, its
 * dictionary, and its stylesheet.
 *
 * Everything the plugin needs to know about the feature is in the descriptor
 * below; `entry.ts` walks the list and stays ignorant of retry policies.
 *
 * Like the MCP section, the shell projects only `id`, `order` and `label` out
 * of a section registration and picks each row's glyph from a closed list of
 * built-in ids. Unlike MCP this feature does not paint a glyph over the
 * fallback one: doing so meant marking the row by its label, which couples the
 * adaptation to the dictionary, and the shell's own glyph is a fine answer for
 * a page that configures a number.
 */

import { createRetryContent } from './components/RetryContent'
import { RETRY_LOCALE_EN } from './i18n/en'
import { RETRY_LOCALE_ZH } from './i18n/zh'
import { RETRY_CSS } from './styles'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/**
 * The section component, built once for the life of the module: it closes over
 * `deps`, and building it again would hand the slot a different component
 * identity than the one already mounted.
 */
let section: unknown

export const llmRetryFeature: ClientFeature = {
  id: 'llm-retry',
  locale: { namespace: 'llm-retry', zh: RETRY_LOCALE_ZH, en: RETRY_LOCALE_EN },
  styles: [{ name: 'llm-retry', css: RETRY_CSS }],
  register(ctx: ClientContext, deps: ClientDeps, t: Translator): void {
    section ??= createRetryContent(deps)
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'mcp-manager-llm-retry',
          // After MCP's row: both are sections of the same settings dialog, and
          // the order here is the order the dialog lists them in.
          order: 60,
          label: () => t('sectionLabel'),
          locale: 'llm-retry',
        },
        section,
      ),
    )
  },
}
