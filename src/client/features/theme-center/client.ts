/**
 * The theme-center feature's client half, and the whole of what the plugin
 * does about themes: one row on the built-in Settings → General page, and one
 * control in the conversation header's right-aligned utilities.
 *
 * The row's seat is deliberately not the plugin's merged settings section: a
 * theme is appearance, and the shell already groups appearance on Settings →
 * General — the row joins that group rather than opening a shop of its own,
 * which is also why the `theme` page the plugin used to seat in its own
 * settings section is gone. The whole surface is read-only over the state in
 * `apply.ts`, which the mount effect restores before the dialog is ever opened.
 *
 * The header control is the palette panel's toggle: the one part of theming
 * that is not about picking among the shipped themes but about tuning the
 * colors of the one in force. It rides this feature rather than a feature of
 * its own for the reason the merge removed the split in the first place — a
 * theme and an override over it are two layers of one story, and they shared
 * exactly one kind of thing before (a file, a namespace, an effect label) while
 * knowing nothing about each other.
 *
 * Four things this registration sets up, in the order the two seats need them:
 * the restored choice with the theme's colors stacked under it (so the row
 * renders against the truth), the palette edits stacked above it (so the panel
 * opens onto the colors the surface really has), the workbench board (so the
 * skin is on before the row offers to switch it), then the two seats.
 */

import { registerThemeCenter } from './apply'
import { registerPaletteOverrides } from './overrides'
import { registerWorkbench } from './workbench'
import { createThemeCenterRow } from './components/ThemeCenterRow'
import { createPaletteButton } from './components/PaletteButton'
import { THEME_CENTER_LOCALE_EN } from './i18n/en'
import { THEME_CENTER_LOCALE_ZH } from './i18n/zh'
import rowCss from './style/row.css'
import paletteCss from './style/palette.css'
import workbenchCss from './style/workbench.css'
import floatingCss from './style/floating.css'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/** The built-in Settings → General item list the shell's own rows use. */
const SETTINGS_GENERAL_ITEM = 'settings.general.item'

/** The conversation header's right-aligned utilities list. `order: 48` puts the
 * palette one place left of the OpenSpec control (49) and the header's own
 * session-delete (50): the read-write trio reads as one run, and the outermost,
 * most destructive seat keeps its edge. */
const SESSION_HEADER_UTILITIES = 'conversation.session.header.utilities'

export const themeCenterFeature: ClientFeature = {
  id: 'theme-center',
  locale: { namespace: 'theme-center', zh: THEME_CENTER_LOCALE_ZH, en: THEME_CENTER_LOCALE_EN },
  // Each half rides its own stylesheet. The row's chrome stays apart from every
  // theme's — no theme swap can touch it, and no theme reaches into it — and
  // the floating panel loads with the row rather than with the button, because
  // a panel whose stylesheet arrived on click would flash unstyled. The
  // workbench sheet is scoped on its own body attribute, so it rides along
  // unconditionally and paints nothing until the switch puts that attribute on.
  //
  // A theme's *colors* are not here at all: they are the `tokens/` tables the
  // shell's override layer paints (see `apply.ts`). What can be here is a rule
  // that points a hardcoded host color back at those tokens — the hover-card
  // sheet is that one: the harness paints the HoverCard surface from a custom
  // property it ships fixed to a dark of its own, and the sheet re-points it
  // at the theme's panel surface so the card reads on every theme's ladder.
  styles: [
    { name: 'theme-center/row', css: rowCss },
    { name: 'theme-center/workbench', css: workbenchCss },
    { name: 'theme-center/palette', css: paletteCss },
    { name: 'theme-center/floating', css: floatingCss },
  ],
  register(ctx: ClientContext, deps: ClientDeps, t: Translator): void {
    // The restored theme and its colors, and the programmatic API first; the
    // row is only one reader of what this call sets up.
    registerThemeCenter(ctx)
    // Then the layer that sits above it. It rides its own effect rather than
    // the restore's: an edit the user saved must survive a theme switch and a
    // plugin unload that leaves the theme in place.
    registerPaletteOverrides(ctx)
    // And the skin over the frame, which is the same kind of layer one axis
    // further out: independent of the theme, restored at mount, and retracted
    // whole on unload.
    registerWorkbench(ctx)
    // Built per apply, as the other seats are: the components close over the
    // bound dictionary and keep no state of their own between mounts.
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
    const PaletteButton = createPaletteButton(deps)
    ctx.slots.inject(SESSION_HEADER_UTILITIES, () =>
      ctx.slots.register(
        {
          name: SESSION_HEADER_UTILITIES,
          id: 'smkit-theme-palette',
          order: 48,
          locale: 'theme-center',
        },
        PaletteButton,
      ),
    )
  },
}
