/**
 * The center's themes as one typed dataset.
 *
 * Each entry carries its identity, both language names, a short description,
 * the four colors its card paints with, and its complete stylesheet — every
 * rule scoped on `body[data-dsh-theme="<id>"]`, with the dark variant on the
 * same scope plus the shell's own `data-ds-dark-theme`. The CSS travels as
 * data because the browser half is a single script: a theme is painted by
 * swapping its text into the active-style element (see `apply.ts`), never by
 * fetching a file.
 *
 * The data file is generated token set, treated as verbatim: adding a theme
 * is one more entry in `themes.data.json` plus one name key in each
 * dictionary; nothing in this module's shape changes.
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
  /** The theme's complete stylesheet, verbatim. */
  readonly css: string
}

export const THEMES: readonly ThemeDef[] = raw as unknown as readonly ThemeDef[]
