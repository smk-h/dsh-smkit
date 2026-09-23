/**
 * The skins the theme tab ships, as the one source both readers share: the
 * panel draws its cards from it, the applier switches body attributes by it.
 *
 * The palettes are copied from the ported stylesheets' own token blocks
 * (`style/skin-*.css`), so a card previews exactly what applying paints — a
 * hand-tuned swatch here would drift from the CSS the first time either moved.
 * The grades are the WCAG contrast of each palette's body-text pair, measured
 * once at port time: the badge reports a fact about the palette, not a claim
 * the panel makes. The names and taglines are copy and live in the
 * dictionaries (`nameKey` / `taglineKey`) — no module outside `i18n/` may
 * carry user-visible strings.
 */

/** One mode's palette, as the card preview paints it. */
export interface SkinSwatch {
  /** The surface body text sits on. */
  bg: string
  /** The body text colour on `bg`. */
  fg: string
  /** The skin's brand accent (buttons, links, the applied ring). */
  accent: string
}

/** One portable skin: its identity, its two palettes, its measured grades. */
export interface SkinDef {
  /** The skin id, spelled the way dsh-themes spells it; also the storage value. */
  id: string
  /** The `body.dataset` property the stylesheet scopes on (`data-dsh-<id>`,
   * camelCased). The ported CSS is verbatim, so this must stay exactly the
   * key the rules select on. */
  dataset: string
  /** Dictionary key of the display name, in the theme namespace. */
  nameKey: string
  /** Dictionary key of the tagline, in the theme namespace. */
  taglineKey: string
  day: SkinSwatch
  night: SkinSwatch
  /** WCAG contrast of the day pair, as the card's badge reads it. */
  gradeDay: string
  /** WCAG contrast of the night pair — the number only; the label around it
   * is copy and stays in the dictionaries. */
  gradeNight: string
}

export const SKINS: readonly SkinDef[] = [
  {
    id: 'festival-dragonboat',
    dataset: 'dshFestivalDragonboat',
    nameKey: 'skinDragonboatName',
    taglineKey: 'skinDragonboatTagline',
    day: { bg: '#f2f6ef', fg: '#1a2b21', accent: '#2e7d4f' },
    night: { bg: '#0a120d', fg: '#e6f0e9', accent: '#58b386' },
    gradeDay: 'AAA · 13.6:1',
    gradeNight: '16.3:1',
  },
  {
    id: 'nord',
    dataset: 'dshNord',
    nameKey: 'skinNordName',
    taglineKey: 'skinNordTagline',
    day: { bg: '#eceff4', fg: '#2e3440', accent: '#5e81ac' },
    night: { bg: '#2e3440', fg: '#e5e9f0', accent: '#88c0d0' },
    gradeDay: 'AAA · 10.8:1',
    gradeNight: '10.3:1',
  },
  {
    id: 'zcode',
    dataset: 'dshZcode',
    nameKey: 'skinZcodeName',
    taglineKey: 'skinZcodeTagline',
    day: { bg: '#f8f8f8', fg: '#262626', accent: '#000000' },
    night: { bg: '#161616', fg: '#d4d4d4', accent: '#ffffff' },
    gradeDay: 'AAA · 14.2:1',
    gradeNight: '12.2:1',
  },
]
