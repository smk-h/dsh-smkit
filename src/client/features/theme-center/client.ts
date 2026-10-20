/**
 * The theme-center feature's client half, and the whole of what the plugin
 * does about themes: one row on the built-in Settings → General page. The
 * palette control it used to add to the conversation header is kept in
 * `components/PaletteButton.tsx` but no longer seated — see below.
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
 * Three things this registration sets up, in the order the seat needs them:
 * the restored choice with the theme's colors stacked under it (so the row
 * renders against the truth), the palette edits stacked above it (so a tuning
 * session survives a theme switch), then the workbench board (so the skin is on
 * before the row offers to switch it) and the row itself.
 *
 * The palette control is deliberately unseated. Its component, panel, icon and
 * stylesheet all still stand, and the edits layer above is still registered —
 * what is gone is the `ctx.slots.inject` into the header's utilities, so dsh
 * shows no palette button at all. Putting it back is one injection plus its
 * stylesheet entry; nothing else in this feature changed shape.
 */

import { registerThemeCenter } from './apply'
import { registerPaletteOverrides } from './overrides'
import { registerWorkbench } from './workbench'
import { createThemeCenterRow } from './components/ThemeCenterRow'
import { THEME_CENTER_LOCALE_EN } from './i18n/en'
import { THEME_CENTER_LOCALE_ZH } from './i18n/zh'
import rowCss from './style/row.css'
import workbenchCss from './style/workbench.css'
import floatingCss from './style/floating.css'
import checkChipCss from './style/check-chip.css'
import stripCss from './style/strip.css'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/** The built-in Settings → General item list the shell's own rows use. */
const SETTINGS_GENERAL_ITEM = 'settings.general.item'

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
    { name: 'theme-center/floating', css: floatingCss },
    { name: 'theme-center/check-chip', css: checkChipCss },
    { name: 'theme-center/strip', css: stripCss },
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
    // The palette toggle is not seated here any more. `components/PaletteButton`
    // and the panel it opens are kept whole, and so is the edits layer above —
    // they are simply unreachable from dsh's UI until an injection like the one
    // this file used to hold puts the control back in the header's utilities.
  },
}
