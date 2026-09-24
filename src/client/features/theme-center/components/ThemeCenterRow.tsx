/**
 * The theme center's settings row: one section of the built-in
 * Settings → General page — title with the theme count, the day/night
 * three-state, the card grid, and the hint line with its reset button.
 *
 * The row is state over the `apply.ts` module, not over itself: it renders a
 * snapshot of the shared theme/mode state, refreshed through the module's
 * pub/sub and by observing the two body attributes. The observer is load-
 * bearing — the dark attribute can be driven by this row, by the shell's own
 * appearance setting, or by the OS scheme, and the card previews have to
 * follow whichever one moved it last.
 *
 * The card paints its mini preview from the theme's own swatch, and follows
 * the *resolved* dark state rather than the row's mode preference, so the
 * previews never show a white card under a dark shell. The preview border
 * borrows the opposite mode's text color: over a light gradient a light
 * border vanishes, and vice versa. Every color around the cards — the
 * chrome, the ring, the selected name — comes from the shell's
 * `--dsw-alias-*` tokens, which is what lets one row read correctly under
 * every theme in the center.
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
    const card = (theme: ThemeDef) => {
      const sw: ThemeSwatch = snap.dark ? theme.swatch.dark : theme.swatch.light
      const [bg, surface, accent, text] = sw
      const border = snap.dark ? theme.swatch.light[3] : theme.swatch.dark[3]
      const selected = snap.theme === theme.id
      return (
        <button
          type="button"
          key={theme.id}
          className="dsh-theme-set-card"
          data-on={String(selected)}
          title={`${theme.nameZh} · ${theme.name}`}
          onClick={() => applyTheme(theme.id)}
        >
          <span
            className="dsh-theme-set-prev"
            style={{ '--dt-bg': bg, '--dt-surface': surface, '--dt-accent': accent, '--dt-text2': text, '--dt-border': border }}
          >
            <span className="bar" />
            <span className="bub" />
            <span className="dot" />
            <span className="chips">
              <i style={{ background: bg }} />
              <i style={{ background: surface }} />
              <i style={{ background: accent }} />
            </span>
          </span>
          <span className="dsh-theme-set-nm">{t(`name_${theme.id}`)}</span>
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
