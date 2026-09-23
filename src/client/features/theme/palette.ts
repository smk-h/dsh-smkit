/**
 * The debug palette: which colors are adjustable, and the math that lets a
 * slider drive them.
 *
 * The registry is a flat list of CSS custom properties grouped by the surface
 * they paint — the theme's accents, the left sidebar, the conversation area,
 * tool-call cards, and the right panel's layer stack. Each item names its
 * token, a dictionary key for its label, and a fallback used only when the
 * token cannot be resolved (the tool-card variables are the case: the other
 * skins do not define them, so the stylesheet's `var()` fallback answers).
 *
 * Every value is read *resolved*: a probe element is attached to the body with
 * `color: var(--the-token)` and the computed color is read back, so var()
 * chains and color-mix() arrive as concrete rgb()/rgba() — what the sliders
 * need. Editing converts RGB ↔ HSL; the alpha channel survives untouched, so
 * translucent borders stay translucent no matter how the sliders move.
 */

/** One adjustable color: a custom property, its label key, its fallback. */
export interface PaletteItem {
  /** The custom property name, spelled with the leading `--`. */
  token: string
  /** Dictionary key of the row label, in the theme namespace. */
  labelKey: string
  /** Resolved when the token is not defined in the current mode or skin. */
  fallback: string
}

/** One surface group, drawn as a collapsible section of the panel. */
export interface PaletteGroup {
  /** Dictionary key of the group title, in the theme namespace. */
  labelKey: string
  items: PaletteItem[]
}

/** The surfaces the panel can repaint, in panel order. */
export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  {
    labelKey: 'groupTheme',
    items: [
      { token: '--dsw-alias-button-primary-fill', labelKey: 'itemPrimaryFill', fallback: '#000000' },
      { token: '--dsw-alias-button-info-fill', labelKey: 'itemSendFill', fallback: '#000000' },
      { token: '--dsw-alias-brand-primary', labelKey: 'itemBrand', fallback: '#000000' },
      { token: '--dsw-alias-label-primary', labelKey: 'itemInk', fallback: '#262626' },
    ],
  },
  {
    labelKey: 'groupLeftSidebar',
    items: [
      { token: '--dsw-specific-sidebar-fill', labelKey: 'itemSidebarFill', fallback: '#ececee' },
      { token: '--dsw-specific-sidebar-nav-item-active', labelKey: 'itemNavActive', fallback: '#e0e0e2' },
      { token: '--dsw-specific-sidebar-nav-item-hover', labelKey: 'itemNavHover', fallback: '#e7e7e9' },
      { token: '--dsw-specific-sidebar-nav-item-active-accent', labelKey: 'itemNavAccent', fallback: '#000000' },
    ],
  },
  {
    labelKey: 'groupConversation',
    items: [
      { token: '--dsw-alias-bg-base', labelKey: 'itemCanvas', fallback: '#f8f8f8' },
      { token: '--dsw-specific-bubble', labelKey: 'itemBubble', fallback: '#f0f0f0' },
      { token: '--dsw-specific-bubble-highlight', labelKey: 'itemBubbleHighlight', fallback: '#e6e6e6' },
      { token: '--dsw-specific-input-major', labelKey: 'itemInput', fallback: '#ffffff' },
    ],
  },
  {
    labelKey: 'groupToolCalls',
    items: [
      { token: '--dsw-zcode-tool-card-bg', labelKey: 'itemToolCardBg', fallback: '#ffffff' },
      { token: '--dsw-zcode-tool-card-border', labelKey: 'itemToolCardBorder', fallback: '#e0e0e0' },
      { token: '--dsw-alias-markdown-code-block', labelKey: 'itemCodeBlock', fallback: '#f0f0f0' },
    ],
  },
  {
    labelKey: 'groupRightPanel',
    items: [
      { token: '--dsw-alias-bg-layer-1', labelKey: 'itemPanel1', fallback: '#ffffff' },
      { token: '--dsw-alias-bg-layer-2', labelKey: 'itemPanel2', fallback: '#f0f0f0' },
      { token: '--dsw-alias-bg-layer-3', labelKey: 'itemPanel3', fallback: '#e6e6e6' },
    ],
  },
]

/** A color as the sliders see it: hue 0-360, saturation and lightness 0-100,
 * alpha 0-1 carried through untouched. */
export interface Hsl {
  h: number
  s: number
  l: number
  a: number
}

let probe: HTMLDivElement | undefined

/**
 * Resolve one custom property to a concrete CSS color, through a probe element
 * on the body — computed values there have var() chains and color-mix()
 * already substituted, which reading the property off `body` directly would
 * not give. Returns the item's fallback when the token resolves to nothing.
 */
export function readTokenColor(token: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  if (probe === undefined || !probe.isConnected) {
    probe = document.createElement('div')
    probe.style.display = 'none'
    document.body.append(probe)
  }
  probe.style.color = `var(${token}, ${fallback})`
  const resolved = getComputedStyle(probe).color
  probe.style.color = ''
  return parseColor(resolved) === undefined ? fallback : resolved
}

/** Parse a computed CSS color — `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`,
 * `rgb()`, `rgba()` — into HSL; undefined for anything else (transparent,
 * `var()`, empty). */
export function parseColor(value: string): Hsl | undefined {
  const value_ = value.trim()
  const match = /^rgba?\(([^)]+)\)$/i.exec(value_)
  if (match !== null) {
    const parts = match[1].split(/[\s,/]+/).filter((part) => part !== '')
    if (parts.length < 3) return undefined
    const rgb = parts.slice(0, 3).map((part) =>
      part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part),
    )
    if (rgb.some((channel) => Number.isNaN(channel))) return undefined
    const a = parts[3] !== undefined ? Number.parseFloat(parts[3]) : 1
    return rgbToHsl(rgb[0], rgb[1], rgb[2], Number.isNaN(a) ? 1 : a)
  }
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value_)
  if (hex === null) return undefined
  const digits = hex[1]
  if (digits.length === 3 || digits.length === 4) {
    const expanded = digits.split('').map((d) => d + d)
    const rgb = expanded.slice(0, 3).map((d) => Number.parseInt(d, 16))
    const a = digits.length === 4 ? Number.parseInt(expanded[3], 16) / 255 : 1
    return rgbToHsl(rgb[0], rgb[1], rgb[2], a)
  }
  if (digits.length !== 6 && digits.length !== 8) return undefined
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16))
  const a = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1
  return rgbToHsl(rgb[0], rgb[1], rgb[2], a)
}

/** RGB (0-255 channels) to HSL; the alpha rides along. */
export function rgbToHsl(r: number, g: number, b: number, a: number): Hsl {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const light = (max + min) / 2
  let hue = 0
  let saturation = 0
  if (max !== min) {
    const span = max - min
    saturation = light > 0.5 ? span / (2 - max - min) : span / (max + min)
    if (max === red) hue = ((green - blue) / span + (green < blue ? 6 : 0)) * 60
    else if (max === green) hue = ((blue - red) / span + 2) * 60
    else hue = ((red - green) / span + 4) * 60
  }
  return { h: Math.round(hue), s: Math.round(saturation * 100), l: Math.round(light * 100), a }
}

/** HSL back to a CSS color, always hex so the panel reads one format:
 * `#rrggbb` when opaque, `#rrggbbaa` carrying the alpha when not. */
export function hslToCss(h: number, s: number, l: number, a: number): string {
  const saturation = s / 100
  const light = l / 100
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation
  const huePrime = (((h % 360) + 360) % 360) / 60
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1))
  let red = 0
  let green = 0
  let blue = 0
  if (huePrime < 1) [red, green, blue] = [chroma, x, 0]
  else if (huePrime < 2) [red, green, blue] = [x, chroma, 0]
  else if (huePrime < 3) [red, green, blue] = [0, chroma, x]
  else if (huePrime < 4) [red, green, blue] = [0, x, chroma]
  else if (huePrime < 5) [red, green, blue] = [x, 0, chroma]
  else [red, green, blue] = [chroma, 0, x]
  const m = light - chroma / 2
  const channel = (v: number): number => Math.round((v + m) * 255)
  const bytes = [channel(red), channel(green), channel(blue)]
  if (a < 1) bytes.push(Math.round(a * 255))
  return `#${bytes.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
