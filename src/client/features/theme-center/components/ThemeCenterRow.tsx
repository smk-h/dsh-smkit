/**
 * The theme center's settings row: one section of the built-in
 * Settings → General page — title with the theme count, the day/night
 * three-state, the card grid, and the hint line with its reset button.
 *
 * The cards are the ones the retired `theme` page drew: a day panel and a
 * night strip stacked in one preview, the measured contrast badge, and the
 * palette strip with its hex values. That page and this row used to describe
 * two different theme systems; the three skins it shipped are entries in this
 * grid now, so its card — which previews a palette in both modes at once — is
 * the one that can describe all sixteen. Merging the styles cost nothing but
 * the class prefix: the card was always painted from the *theme's* colors, so
 * it never knew which applier stood behind them.
 *
 * The split every rule and every style prop here observes: the card's preview
 * rides the theme's own palette as custom properties (`--dt-day-*` /
 * `--dt-night-*`, set inline from the entry's swatch), because a preview's
 * whole job is to show the theme's colors and never the row's; everything
 * around it — the chrome, the ring, the selected name — comes from the shell's
 * `--dsw-alias-*` tokens, which is what lets one row read correctly under every
 * theme in the center. The ring is deliberately on the shell token rather than
 * on the card's own accent: it sits on the panel's surface, not the theme's,
 * and an accent picked to sit on that theme's background is not guaranteed to
 * be legible on this one.
 *
 * The card carries no apply button and no applied badge. The whole surface is
 * the button — clicking anywhere on it applies the theme and saves the choice
 * — so a second control inside would only be a second way to do the one thing
 * the card does. Selection reads through the ring and the name, not a label.
 *
 * The row is state over the `apply.ts` module, not over itself: it renders a
 * snapshot of the shared theme/mode state, refreshed through the module's
 * pub/sub and by observing the two body attributes. The observer is load-
 * bearing — the dark attribute can be driven by this row, by the shell's own
 * appearance setting, or by the OS scheme, and the card previews have to
 * follow whichever one moved it last.
 */

import { activeThemeId, applyMode, applyTheme, currentMode, subscribe } from '../apply'
import { THEMES, type ThemeDef, type ThemeSwatch } from '../themes.data'
import type { ClientDeps, Translator } from '../../../platform/types'

/** What the row renders: the shared state, resolved against the document. */
interface Snapshot {
  theme: string | null
  mode: 'system' | 'light' | 'dark'
  dark: boolean
}

const readSnapshot = (): Snapshot => ({
  theme: activeThemeId(),
  mode: currentMode(),
  dark: typeof document !== 'undefined' && document.body.hasAttribute('data-ds-dark-theme'),
})

export function createThemeCenterRow(deps: ClientDeps, t: Translator): () => JSX.Element {
  const { h, react } = deps

  return function ThemeCenterRow(): JSX.Element {
    const [snap, setSnap] = react.useState<Snapshot>(readSnapshot)
    react.useEffect(() => {
      const update = () => setSnap(readSnapshot())
      const unsub = subscribe(update)
      if (typeof MutationObserver === 'undefined') return () => {
        unsub()
      }
      // Watch both body attributes so the ring and the previews follow any
      // change of hand — the shell's own display toggle repaints them too.
      const mo = new MutationObserver(update)
      mo.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'data-dsh-theme'] })
      return () => {
        unsub()
        mo.disconnect()
      }
    }, [])

    const modeBtn = (key: Snapshot['mode'], label: string) => (
      <button type="button" data-on={String(snap.mode === key)} onClick={() => applyMode(key)}>
        {label}
      </button>
    )

    /** One chip of the palette strip: the swatch, then its hex. */
    const chip = (color: string, key: string) => (
      <span className="dt_chip" key={key}>
        <span className="dt_dot" style={{ background: color }} />
        <span className="dt_hex">{color}</span>
      </span>
    )

    /** One preview card. The whole surface is the `<button>` — clicking it
     * applies the theme, keyboard included — so the card carries no button of
     * its own: no nested interactive element, and nothing to click twice. The
     * two palettes ride as custom properties so the stylesheet can consume
     * them: the day panel paints the light trio, the night strip the dark pair,
     * the chip row the light trio plus the surface. */
    const card = (theme: ThemeDef) => {
      const day: ThemeSwatch = theme.swatch.light
      const night: ThemeSwatch = theme.swatch.dark
      const selected = snap.theme === theme.id
      const name = t(`name_${theme.id}`)
      const desc = t(`desc_${theme.id}`)
      return (
        <button
          type="button"
          key={theme.id}
          className="dt_card"
          data-on={String(selected)}
          aria-pressed={selected}
          title={`${theme.nameZh} · ${theme.name}`}
          style={{
            '--dt-day-bg': day[0],
            '--dt-day-fg': day[3],
            '--dt-day-accent': day[2],
            '--dt-night-bg': night[0],
            '--dt-night-fg': night[3],
          }}
          onClick={() => applyTheme(theme.id)}
        >
          <span className="dt_prev">
            <span className="dt_day">
              <span className="dt_daytop">
                <span className="dt_aa">Aa</span>
                <span className="dt_bub">{t('bubbleSample')}</span>
              </span>
              <span className="dt_line">{t('lineSample')}</span>
              <span className="dt_skel" />
              <span className="dt_grade">{theme.gradeDay}</span>
            </span>
            <span className="dt_night">
              <span className="dt_aa dt_aa-night">Aa</span>
              <span className="dt_nightgrade">{t('nightGrade', { grade: theme.gradeNight })}</span>
            </span>
          </span>
          <span className="dt_meta">
            <span className="dt_name">{name}</span>
            <span className="dt_tag">{desc}</span>
            <span className="dt_chips">
              {chip(day[0], 'bg')}
              {chip(day[1], 'surface')}
              {chip(day[2], 'accent')}
            </span>
          </span>
        </button>
      )
    }

    return (
      <div className="dsh-theme-set">
        <div className="dsh-theme-set-head">
          <div className="dsh-theme-set-title">
            {t('title')}
            <span className="dsh-theme-set-count">{t('themeCount', { count: THEMES.length })}</span>
          </div>
          <div className="dsh-theme-set-modes">
            {modeBtn('system', t('modeAuto'))}
            {modeBtn('light', t('modeLight'))}
            {modeBtn('dark', t('modeDark'))}
          </div>
        </div>
        <div className="dsh-theme-set-grid">{THEMES.map(card)}</div>
        <div className="dsh-theme-set-foot">
          <span className="dsh-theme-set-hint">{t('hint')}</span>
          <button type="button" className="dsh-theme-set-reset" onClick={() => applyTheme(null)}>
            {t('reset')}
          </button>
        </div>
      </div>
    )
  }
}
