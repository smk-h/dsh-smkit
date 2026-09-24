/**
 * The center's themes as one typed dataset.
 *
 * Each entry carries its identity, both language names, a short description,
 * the four colors its card paints with, its measured contrast grades, and its
 * complete stylesheet — every rule scoped on `body[data-smkit-theme="<id>"]`,
 * with the dark variant on the same scope plus the shell's own
 * `data-ds-dark-theme`. The CSS travels as data because the browser half is a
 * single script: a theme is painted by swapping its text into the active-style
 * element (see `apply.ts`), never by fetching a file.
 *
 * The three skins the plugin used to ship as a separate feature are entries
 * here too, their ported selectors rewritten from `body[data-dsh-<dataset>]`
 * onto this one scope — that rewrite is the whole of what merging them cost,
 * and `scripts/build-theme-data.mjs` is the record of it.
 *
 * The data file is generated token set, treated as verbatim: adding a theme is
 * one more entry in `themes.data.json` (plus one name and one description key
 * in each dictionary); nothing in this module's shape changes. The grades are
 * the one field that is computed rather than authored — `build-theme-data.mjs`
 * measures them from each palette's own background and body ink, so a card's
 * badge always reports the pair it paints.
 */

import raw from './themes.data.json'

/** The card colors, in the order the row reads them: bg, surface, accent, text. */
export type ThemeSwatch = readonly [string, string, string, string]

/** One theme of the center. */
export interface ThemeDef {
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
  /** The theme's complete stylesheet, verbatim. */
  readonly css: string
}

export const THEMES: readonly ThemeDef[] = raw as unknown as readonly ThemeDef[]
