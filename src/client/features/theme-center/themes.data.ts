/**
 * The center's themes: a metadata list, plus each theme's own stylesheet.
 *
 * The two halves live apart on purpose. `themes.data.json` carries what is
 * *fact* — the id, both language names, the one-line description, the character
 * tags, the four colors a card paints with, and the contrast grades measured
 * from them. The rules themselves are ordinary `.css` files under `themes/`,
 * one per theme, imported here as strings: `tsdown`'s `cssTextPlugin` compiles
 * each `.css` import to `export default "<rules>"` (see `tsdown.config.ts`),
 * the same mechanism `platform/styles.ts` uses for the shared chrome.
 *
 * Why they travel as strings at all: the browser half is a single script that
 * the browser resolves no modules for, so a theme cannot be a file the page
 * fetches. A theme is painted by swapping its CSS text into one active-style
 * element (see `apply.ts`) — the `.css` on disk is the authoring shape, the
 * string in the bundle is the runtime one, and `SHEETS` below is the join.
 *
 * The sheet is scoped on `body[data-smkit-theme="<id>"]`, with the dark variant
 * on the same scope plus the shell's own `data-ds-dark-theme`. A theme sheet
 * deliberately *defines* the host's `--dsw-alias-*` / `--dsw-specific-*` design
 * tokens — repainting them is what a skin is — which is the one exemption the
 * namespace guard carves out (see `HOST_TOKEN_SHEETS` in
 * `scripts/namespace-guard.mjs`).
 *
 * The grades are the one field that is computed rather than authored:
 * `build-theme-data.mjs` measures them from each palette's own background and
 * body ink, so a card's badge always reports the pair it paints, and that same
 * script checks every entry against its sheet.
 *
 * Adding a theme is therefore four edits: one `.css` under `themes/`, one entry
 * in `themes.data.json`, one import plus one `SHEETS` line here, and one name
 * plus one description key in each dictionary. `test/theme-center-data.test.mjs`
 * fails if any of the four is missed.
 */

import raw from './themes.data.json'
import oneDarkProCss from './themes/one-dark-pro.css'
import zcodeCss from './themes/zcode.css'

/** The card colors, in the order the row reads them: bg, surface, accent, text. */
export type ThemeSwatch = readonly [string, string, string, string]

/** One theme's metadata: everything a card is drawn from but the rules. */
export interface ThemeMeta {
  /** The id the body attribute carries and storage persists. */
  readonly id: string
  /** English name; the card's tooltip always shows both languages. */
  readonly name: string
  /** Chinese name. */
  readonly nameZh: string
  /** One-line description, English. */
  readonly desc: string
  /** One-line description, Chinese. */
  readonly descZh: string
  /** Character tags, exposed through the programmatic API only. */
  readonly tags: readonly string[]
  /** The two palettes the card previews paint from. */
  readonly swatch: { readonly light: ThemeSwatch; readonly dark: ThemeSwatch }
  /** WCAG contrast of the day pair, as the card's badge reads it. */
  readonly gradeDay: string
  /** WCAG contrast of the night pair — the number only; the label around it
   * is copy and stays in the dictionaries. */
  readonly gradeNight: string
}

/** One theme of the center: its metadata and its stylesheet. */
export interface ThemeDef extends ThemeMeta {
  /** The theme's complete stylesheet, as the build inlined it. */
  readonly css: string
}

/**
 * Every theme's stylesheet, keyed by id. The map is written out rather than
 * derived because the bundler resolves imports statically: a path assembled at
 * runtime would be a module the build never sees, and the theme would ship
 * without its rules.
 */
const SHEETS: Readonly<Record<string, string>> = {
  'one-dark-pro': oneDarkProCss,
  zcode: zcodeCss,
}

/**
 * The center's themes, in card order. An id with no sheet paints nothing rather
 * than throwing: the two lists are checked together at build time
 * (`test/theme-center-data.test.mjs`), and a mount-time throw would cost the
 * whole client entry — the same trade `apply.ts` makes when a service name is
 * already taken.
 */
export const THEMES: readonly ThemeDef[] = (raw as unknown as readonly ThemeMeta[]).map((meta) => ({
  ...meta,
  css: SHEETS[meta.id] ?? '',
}))
