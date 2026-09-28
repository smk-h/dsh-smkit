/**
 * The center's themes: a metadata list, plus each theme's own token table.
 *
 * The two halves live apart on purpose — and in this revision the second half
 * is a table, not a stylesheet. `themes.data.json` carries what is *fact*: the
 * id, both language names, the one-line description, the character tags, the
 * palette half the theme is drawn for, the four colors a card paints with, and
 * the contrast grades measured from them. The colours themselves are the
 * `tokens/<family>.ts` tables, each of which is stacked over the shell's active
 * theme as its own override layer (`ctx.theme.overrideTokens`, see `apply.ts`).
 *
 * Why that moved out of CSS: a theme is a token table and nothing else, so the
 * shell can supply every token the theme does not name from the base palette
 * the theme declares — which is the whole point of the second revision (see
 * `tokens/one-dark-pro.ts` for the bug that motivated it). What a table cannot
 * carry is a *rule*, and the one rule the center ships (zcode's tool-call
 * cards) lives in `style/zcode-cards.css`, scoped on the body attribute
 * `apply.ts` writes.
 *
 * One theme, one table: One Dark Pro is always dark, so it declares one palette
 * half and needs nothing else — that half is also what the center pins the
 * shell's preference to while the theme is applied. A theme with both a day and
 * a night form would therefore be two entries with two tables.
 *
 * The grades are the one field that is computed rather than authored:
 * `build-theme-data.mjs` measures them from each palette's own background and
 * body ink, so a card's badge always reports the pair it paints, and that same
 * script checks every entry against its table.
 *
 * Adding a theme is therefore four edits: one table under `tokens/`, one entry
 * in `themes.data.json`, one import plus one `TOKENS` line here, and one name
 * plus one description key in each dictionary. `test/theme-center-data.test.mjs`
 * fails if any of the four is missed.
 */

import raw from './themes.data.json'
import { ONE_DARK_PRO_TOKENS } from './tokens/one-dark-pro'

/** The card colors, in the order the row reads them: bg, surface, accent, text. */
export type ThemeSwatch = readonly [string, string, string, string]

/** One theme's metadata: everything a card is drawn from but the colors. */
export interface ThemeMeta {
  /** The center's own id. */
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
  /** The palette half the theme is drawn for — the half the center pins the
   * shell's preference to while the theme is applied. */
  readonly colorScheme: 'light' | 'dark'
  /** The two palettes the card previews paint from. A theme is one half, so a
   * fixed-scheme theme repeats the same four colors on both sides: the preview
   * is then showing the same palette twice, which is the honest picture. */
  readonly swatch: { readonly light: ThemeSwatch; readonly dark: ThemeSwatch }
  /** WCAG contrast of the day pair, as the card's badge reads it. */
  readonly gradeDay: string
  /** WCAG contrast of the night pair — the number only; the label around it
   * is copy and stays in the dictionaries. */
  readonly gradeNight: string
}

/** One theme of the center: its metadata and its colors. */
export interface ThemeDef extends ThemeMeta {
  /** The alias-layer tokens the center stacks as an override layer. */
  readonly tokens: Readonly<Record<string, string>>
}

/**
 * Every theme's table, keyed by id. The map is written out rather than derived
 * because the bundler resolves imports statically: a path assembled at runtime
 * would be a module the build never sees, and the theme would ship without its
 * colors.
 */
const TOKENS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'one-dark-pro': ONE_DARK_PRO_TOKENS,
}

/**
 * The center's themes, in card order. An id with no table stacks nothing rather
 * than throwing — it paints the shell's own palette, the two lists are checked
 * together at build time (`test/theme-center-data.test.mjs`), and a mount-time
 * throw would cost the whole client entry, the same trade `apply.ts` makes for a
 * layer the shell refuses.
 */
export const THEMES: readonly ThemeDef[] = (raw as unknown as readonly ThemeMeta[]).map((meta) => ({
  ...meta,
  tokens: TOKENS[meta.id] ?? {},
}))
