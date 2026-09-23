/**
 * The theme tab: the skins this plugin ships, as the preview cards the
 * approved design mockup laid out — a day/night split preview painted in the
 * skin's own palette, the measured contrast badge, and the three-colour strip.
 *
 * The preview colours are the skin's, not the panel's: a card's whole job is
 * to show what applying would paint, so its palette rides as CSS custom
 * properties on the card (`--th-day-*` / `--th-night-*`) and the stylesheet
 * consumes those. Everything around the cards — the intro, the summary row,
 * the card chrome — stays on the `--dsw-alias-*` tokens the other pages use,
 * which is what makes the panel itself follow the skin being previewed.
 *
 * The card is one `<button>` (the whole surface applies the skin, keyboard
 * included); the applied badge and the apply hint inside are styled spans,
 * not buttons, so no interactive element nests inside another. The applier
 * is the module-level `applySkin`/`clearSkin`, not an effect: the click is
 * the whole transaction, and the attribute outlives the panel by design.
 */

import { applySkin, clearSkin, currentSkinId } from '../apply'
import { SKINS, type SkinDef } from '../skins'
import type { ClientDeps, Translator } from '../../../platform/types'

/** Props the merged section's shell hands every panel. */
export interface ThemeContentProps {
  t: Translator
}

export function createThemeContent(
  deps: ClientDeps,
): (props: ThemeContentProps) => JSX.Element {
  const { h, react } = deps

  /** One preview card: the palette as custom properties, the two modes
   * stacked, the state badge inside the name row. The click reports up —
   * the parent owns `activeId`, so the badge and the ring can only move
   * through it. */
  function ThemeCard(props: {
    skin: SkinDef
    active: boolean
    t: Translator
    onChoose: () => void
  }): JSX.Element {
    const { skin, active, t, onChoose } = props
    const name = t(skin.nameKey)
    const tagline = t(skin.taglineKey)
    return (
      <button
        type="button"
        className={active ? 'th_card th_card--active' : 'th_card'}
        style={{
          '--th-day-bg': skin.day.bg,
          '--th-day-fg': skin.day.fg,
          '--th-day-accent': skin.day.accent,
          '--th-night-bg': skin.night.bg,
          '--th-night-fg': skin.night.fg,
        }}
        aria-pressed={active}
        title={tagline}
        onClick={() => (active ? undefined : onChoose())}
      >
        <span className="th_preview">
          <span className="th_day">
            <span className="th_daytop">
              <span className="th_aa">Aa</span>
              <span className="th_bubble">{t('bubbleSample')}</span>
            </span>
            <span className="th_line">{tagline}</span>
            <span className="th_skel" />
            <span className="th_grade">{skin.gradeDay}</span>
          </span>
          <span className="th_night">
            <span className="th_aa th_aa_night">Aa</span>
            <span className="th_nightgrade">{t('nightGrade', { grade: skin.gradeNight })}</span>
          </span>
        </span>
        <span className="th_meta">
          <span className="th_namerow">
            <span className="th_name">{name}</span>
            <span className={active ? 'th_pill' : 'th_apply'}>
              {active ? t('applied') : t('apply')}
            </span>
          </span>
          <span className="th_tagline">{tagline}</span>
          <span className="th_palette">
            <span className="th_chip">
              <span className="th_dot" style={{ background: skin.day.bg }} />
              <span className="th_hex">{skin.day.bg}</span>
            </span>
            <span className="th_chip">
              <span className="th_dot" style={{ background: skin.day.fg }} />
              <span className="th_hex">{skin.day.fg}</span>
            </span>
            <span className="th_chip">
              <span className="th_dot" style={{ background: skin.day.accent }} />
              <span className="th_hex">{skin.day.accent}</span>
            </span>
          </span>
        </span>
      </button>
    )
  }

  return function ThemeContent({ t }: ThemeContentProps): JSX.Element {
    // The storage read lives in the initializer: the browser objects must not
    // be touched at module load (Node test harnesses import this file), and
    // the panel reads the choice once per mount — a switch made elsewhere in
    // the page cannot land while the dialog is open.
    const [activeId, setActiveId] = react.useState<string | null>(() => currentSkinId())

    const choose = (skin: SkinDef) => {
      applySkin(skin.id)
      setActiveId(skin.id)
    }
    const restore = () => {
      clearSkin()
      setActiveId(null)
    }

    return (
      <div className="th_panel">
        <p className="th_intro">{t('intro')}</p>
        <div className="th_row">
          <span className="th_count">{t('summary', { count: SKINS.length })}</span>
          <span className="th_spacer" />
          {activeId !== null && (
            <button type="button" className="mm_btn" onClick={restore}>
              {t('restore')}
            </button>
          )}
        </div>
        <div className="th_grid">
          {SKINS.map((skin) => (
            <ThemeCard
              key={skin.id}
              skin={skin}
              active={skin.id === activeId}
              t={t}
              onChoose={() => choose(skin)}
            />
          ))}
        </div>
      </div>
    )
  }
}
