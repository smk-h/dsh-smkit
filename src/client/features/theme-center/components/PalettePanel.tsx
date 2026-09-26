/**
 * The palette panel: every adjustable color, sliders to move them, and
 * save/reset for the overrides.
 *
 * Rendered through a portal onto the body by the header button — the button
 * lives in the conversation header's utilities slot, and a panel anchored
 * inside it would inherit the header's clipping and stacking. `position:
 * fixed` in the panel's own stylesheet puts it in the viewport's top-right
 * corner regardless.
 *
 * **Every slider starts on the value the element has right now.** Nothing is
 * guessed from a table: `readAll` resolves each registry token through a probe
 * element on the body (`readTokenColor`), so what a row shows is the body's own
 * computed color after every theme rule, every `var()` chain and every saved
 * override have had their say. That read is repeated whenever what the body
 * paints can have moved — the theme applied, its day/night attribute, or the
 * shell's own display toggle — because a slider that kept a stale start value
 * would write a color derived from a palette that is no longer on screen.
 *
 * The editing model is a three-layer sandwich, cheapest read first:
 *   - `colors`  — what the sliders show, one HSL per registry token;
 *   - `edits`   — tokens moved since the last save (or reset), hex/rgba
 *                 strings, live-applied as inline custom properties on the
 *                 body so every edit is visible the moment the slider moves;
 *   - storage   — the same map under `smkit:theme-colors`, written only by
 *                 Save, so an experiment is never persisted by accident.
 * Reset throws away both layers and re-reads the resolved colors, which lands
 * the panel back on whatever the active theme paints.
 *
 * Each group folds away until its header is clicked — the full registry is
 * eighty-five colors across thirteen surfaces, and thirteen open sections
 * would be a wall — so only the first opens with the panel. Each row folds
 * its three sliders (hue, saturation, lightness) away until clicked, and the
 * alpha channel a color arrived with rides along untouched: the sliders tune
 * the RGB, translucent borders stay translucent.
 *
 * Double-clicking anywhere on a slider row puts *that one channel* back on the
 * value the active theme gives it, leaving its two neighbours where they were
 * — a way to undo a single slider without hunting for the color it started on.
 * The theme's own value is read by taking the token's override off the body
 * first, because the probe resolves custom properties by inheritance and would
 * otherwise answer with the override itself. A reset that happens to land the
 * whole color back on the theme's own drops the override outright: there is
 * nothing left for it to say, and the token stops being written out on the
 * next Save. Like every other edit here it is live-only until Save, so a
 * double-click is undone by reloading exactly the way a drag is.
 */

import type { ClientDeps, Translator } from '../../../platform/types'
import { createXIcon } from '../../../platform/icons/XIcon'
import { DARK_ATTR, subscribe, THEME_ATTR } from '../apply'
import {
  PALETTE_GROUPS,
  hslToCss,
  parseColor,
  readTokenColor,
  type Hsl,
  type PaletteItem,
} from '../palette'
import {
  clearColorOverrides,
  loadColorOverrides,
  removeColorOverrides,
  saveColorOverrides,
} from '../overrides'

export interface PalettePanelProps {
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

export function createPalettePanel(deps: ClientDeps): (props: PalettePanelProps) => JSX.Element {
  const { h, react } = deps
  const XIcon = createXIcon(deps)

  return function PalettePanel({ t, onClose }: PalettePanelProps): JSX.Element {
    /** The colors the body paints right now: one HSL per token, resolved
     * through the probe. A token whose computed value is not a color the
     * parser can read falls back to the registry's own default, which is the
     * value that token would have resolved to anyway. */
    const readAll = (): Record<string, Hsl> => {
      const out: Record<string, Hsl> = {}
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

    /** Keep the start values the body's own. The two triggers are the ones that
     * can repaint a token under an open panel: the theme center's state (a card
     * clicked, or the restored choice at mount) and the body's two attributes
     * (the day/night override, and the shell's own display setting moving the
     * dark one). The `attributeFilter` is load-bearing rather than tidy: an
     * edit sets the body's `style` attribute, and watching that would make
     * every slider drag re-read the value it had just written. */
    react.useEffect(() => {
      const reread = () => setColors(readAll())
      const unsub = subscribe(reread)
      if (typeof MutationObserver === 'undefined') {
        return () => {
          unsub()
        }
      }
      const mo = new MutationObserver(reread)
      mo.observe(document.body, {
        attributes: true,
        attributeFilter: [DARK_ATTR, THEME_ATTR],
      })
      return () => {
        unsub()
        mo.disconnect()
      }
    }, [])

    /** The color the active theme paints for a token, read with the token's own
     * override off the body — custom properties inherit, so an override still
     * set there would be what the probe answers with. Nothing is put back: the
     * caller writes the token's next value in the same synchronous block, and
     * when that next value *is* the theme's, leaving the property off is the
     * whole point. No repaint slips in between, so the removal is invisible. */
    const themeOwn = (item: PaletteItem): Hsl => {
      document.body.style.removeProperty(item.token)
      return (
        parseColor(readTokenColor(item.token, item.fallback)) ?? { h: 0, s: 0, l: 100, a: 1 }
      )
    }

    /** Apply one edit: paint the body inline, remember it, move the sliders. */
    const edit = (token: string, next: Hsl): void => {
      const value = hslToCss(next.h, next.s, next.l, next.a)
      document.body.style.setProperty(token, value)
      setColors((prev) => ({ ...prev, [token]: next }))
      setEdits((prev) => ({ ...prev, [token]: value }))
      setSaved(false)
    }

    /** Double-click on a slider row: put this one channel back on the theme's
     * own value and leave the other two alone. When the move happens to restore
     * the token's color whole — the common case, a reader who only moved that
     * one slider — the override has no work left and is dropped from the body
     * and from the saved map alike, so the next Save no longer carries a token
     * that has nothing to say. Anything short of that stays an ordinary edit:
     * live on the body now, written to storage only by Save. */
    const resetChannel = (item: PaletteItem, channel: 'h' | 's' | 'l'): void => {
      const color = colors[item.token] ?? { h: 0, s: 0, l: 100, a: 1 }
      const own = themeOwn(item)
      const next = { ...color, [channel]: own[channel] }
      if (next.h === own.h && next.s === own.s && next.l === own.l && next.a === own.a) {
        document.body.style.removeProperty(item.token)
        setColors((prev) => ({ ...prev, [item.token]: next }))
        setEdits((prev) => {
          const remaining = { ...prev }
          delete remaining[item.token]
          return remaining
        })
        setSaved(false)
        return
      }
      edit(item.token, next)
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
      <div
        className="smkit-theme-palette-panel"
        /* The marker the toggle's outside-press rule reads to ask "is this
         * press inside the panel?". Declared here, on the panel's own root,
         * so the rule does not have to reach for a class name that belongs to
         * the stylesheet. */
        data-smkit-palette-panel="true"
        role="dialog"
        aria-label={t('paletteTitle')}
      >
        <div className="smkit-theme-palette-head">
          <span className="smkit-theme-palette-title">{t('paletteTitle')}</span>
          {/* The shared cross, at 14 px rather than the filter boxes' 12: this
           * button is 22 px square, and the glyph is the whole of it. */}
          <button
            type="button"
            className="smkit-theme-palette-close"
            aria-label={t('paletteClose')}
            onClick={onClose}
          >
            <XIcon size={14} />
          </button>
        </div>
        <div className="smkit-theme-palette-groups">
          {PALETTE_GROUPS.map((group, index) => (
            <details key={group.labelKey} className="smkit-theme-palette-group" open={index === 0}>
              <summary className="smkit-theme-palette-group-head">{t(group.labelKey)}</summary>
              {group.items.map((item) => {
                const color = colors[item.token] ?? { h: 0, s: 0, l: 100, a: 1 }
                const value = hslToCss(color.h, color.s, color.l, color.a)
                const isOpen = expanded === item.token
                return (
                  <div key={item.token} className="smkit-theme-palette-row">
                    <button
                      type="button"
                      className="smkit-theme-palette-row-head"
                      onClick={() => setExpanded(isOpen ? null : item.token)}
                    >
                      <span className="smkit-theme-palette-swatch" style={{ background: value }} />
                      <span className="smkit-theme-palette-label">{t(item.labelKey)}</span>
                      <span className="smkit-theme-palette-hex">{value}</span>
                    </button>
                    {isOpen && (
                      <div className="smkit-theme-palette-sliders">
                        {(
                          [
                            ['h', t('sliderHue'), 360, HUE_TRACK],
                            ['s', t('sliderSat'), 100, satTrack(color)],
                            ['l', t('sliderLight'), 100, lightTrack(color)],
                          ] as const
                        ).map(([channel, label, max, track]) => (
                          <label
                            key={channel}
                            className="smkit-theme-palette-slider"
                            title={t('sliderResetHint')}
                            onDoubleClick={() => resetChannel(item, channel)}
                          >
                            <span className="smkit-theme-palette-slider-label">{label}</span>
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
                            <span className="smkit-theme-palette-slider-value">{color[channel]}</span>
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
        <div className="smkit-theme-palette-foot">
          <button type="button" className="smkit-theme-palette-save" onClick={onSave}>
            {saved ? t('paletteSavedHint') : t('paletteSave')}
          </button>
          <button
            type="button"
            className="smkit-theme-palette-reset"
            onClick={onReset}
            disabled={Object.keys(edits).length === 0}
          >
            {t('paletteReset')}
          </button>
        </div>
      </div>
    )
  }
}
