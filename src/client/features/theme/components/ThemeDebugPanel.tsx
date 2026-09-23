/**
 * The debug palette panel: every adjustable color, sliders to move them, and
 * save/reset for the overrides.
 *
 * Rendered through a portal onto the body by the header button — the button
 * lives in the conversation header's utilities slot, and a panel anchored
 * inside it would inherit the header's clipping and stacking. `position:
 * fixed` in the panel's own stylesheet puts it in the viewport's top-right
 * corner regardless.
 *
 * The editing model is a three-layer sandwich, cheapest read first:
 *   - `colors`  — what the sliders show, one HSL per registry token;
 *   - `edits`   — tokens moved since the last save (or reset), hex/rgba
 *                 strings, live-applied as inline custom properties on the
 *                 body so every edit is visible the moment the slider moves;
 *   - storage   — the same map under `smkit:skin-colors`, written only by
 *                 Save, so an experiment is never persisted by accident.
 * Reset throws away both layers and re-reads the resolved colors, which lands
 * the panel back on whatever the active skin paints.
 *
 * Each row folds its three sliders (hue, saturation, lightness) away until
 * clicked — eighteen colors times three sliders would be a wall — and the
 * alpha channel a color arrived with rides along untouched: the sliders tune
 * the RGB, translucent borders stay translucent.
 */

import type { ClientDeps, Translator } from '../../../platform/types'
import {
  PALETTE_GROUPS,
  hslToCss,
  parseColor,
  readTokenColor,
  type Hsl,
} from '../palette'
import {
  clearColorOverrides,
  loadColorOverrides,
  removeColorOverrides,
  saveColorOverrides,
} from '../apply'

export interface ThemeDebugPanelProps {
  t: Translator
  onClose: () => void
}

/** The hue track: the full wheel, so the thumb always sits on the color it
 * would produce. The stops sit at the exact degree marks (60° per sector),
 * which makes the track's sRGB interpolation identical to the HSL sweep the
 * sliders write — no drift between what the thumb points at and what the
 * token gets. */
const HUE_TRACK =
  'linear-gradient(to right, #f00 0%, #ff0 16.6667%, #0f0 33.3333%, #0ff 50%, #00f 66.6667%, #f0f 83.3333%, #f00 100%)'

/** The saturation track: grey at 0% into the fully saturated color at the
 * current hue and lightness. */
function satTrack(color: { h: number; s: number; l: number; a: number }): string {
  const at = (s: number): string => `hsl(${color.h}, ${s}%, ${color.l}%)`
  return `linear-gradient(to right, ${at(0)}, ${at(100)})`
}

/** The lightness track: black through the pure hue to white. */
function lightTrack(color: { h: number; s: number; l: number; a: number }): string {
  const pure = `hsl(${color.h}, ${color.s}%, 50%)`
  return `linear-gradient(to right, #000, ${pure}, #fff)`
}

export function createThemeDebugPanel(
  deps: ClientDeps,
): (props: ThemeDebugPanelProps) => JSX.Element {
  const { h, react } = deps

  return function ThemeDebugPanel({ t, onClose }: ThemeDebugPanelProps): JSX.Element {
    /** Resolved start colors: one HSL per token, read once at mount. */
    const readAll = (): Record<string, ReturnType<typeof parseColor>> => {
      const out: Record<string, ReturnType<typeof parseColor>> = {}
      for (const group of PALETTE_GROUPS) {
        for (const item of group.items) {
          out[item.token] = parseColor(readTokenColor(item.token, item.fallback)) ?? {
            h: 0,
            s: 0,
            l: 100,
            a: 1,
          }
        }
      }
      return out
    }

    const [colors, setColors] = react.useState(readAll)
    /** Tokens moved since save/reset — the map Save writes. Seeded from
     * storage, so the overrides this browser already saved count as pending
     * edits: Reset can take them back, Save re-writes them. */
    const [edits, setEdits] = react.useState<Record<string, string>>(() => loadColorOverrides())
    /** The row whose sliders are unfolded; one at a time keeps the panel short. */
    const [expanded, setExpanded] = react.useState<string | null>(null)
    /** Set for a beat after Save, so the button's answer is visible. */
    const [saved, setSaved] = react.useState(false)

    /** Apply one edit: paint the body inline, remember it, move the sliders. */
    const edit = (token: string, next: Hsl): void => {
      const value = hslToCss(next.h, next.s, next.l, next.a)
      document.body.style.setProperty(token, value)
      setColors((prev) => ({ ...prev, [token]: next }))
      setEdits((prev) => ({ ...prev, [token]: value }))
      setSaved(false)
    }

    const onSave = (): void => {
      saveColorOverrides(edits)
      setSaved(true)
    }

    const onReset = (): void => {
      removeColorOverrides(edits)
      clearColorOverrides()
      setEdits({})
      setExpanded(null)
      setSaved(false)
      // re-read one frame later: the inline properties must be off the body
      // before the probe resolves the tokens again.
      window.setTimeout(() => setColors(readAll()), 50)
    }

    return (
      <div className="tp_panel" role="dialog" aria-label={t('panelTitle')}>
        <div className="tp_head">
          <span className="tp_title">{t('panelTitle')}</span>
          <button type="button" className="tp_close" aria-label={t('close')} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="tp_groups">
          {PALETTE_GROUPS.map((group) => (
            <details key={group.labelKey} className="tp_group" open>
              <summary className="tp_groupHead">{t(group.labelKey)}</summary>
              {group.items.map((item) => {
                const color = colors[item.token] ?? { h: 0, s: 0, l: 100, a: 1 }
                const value = hslToCss(color.h, color.s, color.l, color.a)
                const isOpen = expanded === item.token
                return (
                  <div key={item.token} className="tp_row">
                    <button
                      type="button"
                      className="tp_rowHead"
                      onClick={() => setExpanded(isOpen ? null : item.token)}
                    >
                      <span className="tp_swatch" style={{ background: value }} />
                      <span className="tp_label">{t(item.labelKey)}</span>
                      <span className="tp_hex">{value}</span>
                    </button>
                    {isOpen && (
                      <div className="tp_sliders">
                        {(
                          [
                            ['h', t('sliderHue'), 360, HUE_TRACK],
                            ['s', t('sliderSat'), 100, satTrack(color)],
                            ['l', t('sliderLight'), 100, lightTrack(color)],
                          ] as const
                        ).map(([channel, label, max, track]) => (
                          <label key={channel} className="tp_slider">
                            <span className="tp_sliderLabel">{label}</span>
                            <input
                              type="range"
                              min={0}
                              max={max}
                              step={1}
                              value={color[channel]}
                              style={{ background: track }}
                              onChange={(e) =>
                                edit(item.token, { ...color, [channel]: Number(e.target.value) })
                              }
                            />
                            <span className="tp_sliderValue">{color[channel]}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </details>
          ))}
        </div>
        <div className="tp_foot">
          <button type="button" className="tp_save" onClick={onSave}>
            {saved ? t('savedHint') : t('save')}
          </button>
          <button
            type="button"
            className="tp_reset"
            onClick={onReset}
            disabled={Object.keys(edits).length === 0}
          >
            {t('reset')}
          </button>
        </div>
      </div>
    )
  }
}
