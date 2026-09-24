/**
 * The theme-center feature's client half: one row on the built-in
 * Settings → General page, seated beside the shell's own appearance rows.
 *
 * The seat is deliberately not the plugin's merged settings section: a
 * theme is appearance, and the shell already groups appearance there — the
 * row joins that group rather than opening a shop of its own. The order
 * places it after the stock rows the shell ships, and the whole surface is
 * read-only over the state in `apply.ts`, which the mount effect restores
 * before the dialog is ever opened.
 */

import { registerThemeCenter } from './apply'
import { createThemeCenterRow } from './components/ThemeCenterRow'
import { THEME_CENTER_LOCALE_EN } from './i18n/en'
import { THEME_CENTER_LOCALE_ZH } from './i18n/zh'
import rowCss from './style/row.css'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/** The built-in Settings → General item list the shell's own rows use. */
const SETTINGS_GENERAL_ITEM = 'settings.general.item'

export const themeCenterFeature: ClientFeature = {
  id: 'theme-center',
  locale: { namespace: 'theme-center', zh: THEME_CENTER_LOCALE_ZH, en: THEME_CENTER_LOCALE_EN },
  // The row's chrome rides its own stylesheet, apart from the themes': no
  // theme swap can touch it, and no theme rule reaches into it.
  styles: [{ name: 'theme-center/row', css: rowCss }],
  register(ctx: ClientContext, deps: ClientDeps, t: Translator): void {
    // The swap element, the saved state, and the programmatic API first; the
    // row is only one reader of what this call sets up.
    registerThemeCenter(ctx)
    // Built per apply, as the other seats are: the component closes over the
    // bound dictionary and keeps no state of its own between mounts.
    const ThemeCenterRow = createThemeCenterRow(deps, t)
    ctx.slots.inject(SETTINGS_GENERAL_ITEM, () =>
      ctx.slots.register(
        {
          name: SETTINGS_GENERAL_ITEM,
          id: 'theme-center',
          order: 20,
          locale: 'theme-center',
        },
        ThemeCenterRow,
      ),
    )
  },
}
