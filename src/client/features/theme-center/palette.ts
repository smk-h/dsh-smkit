/**
 * The palette panel's registry: which colors are adjustable, and the math that
 * lets a slider drive them.
 *
 * The registry is a flat list of CSS custom properties grouped by the surface
 * they paint, and the grouping is correspondence with the center itself: every
 * color-bearing `--dsw-alias-*`, `--dsw-specific-*` and `--dsw-zcode-*` token
 * any theme of the center defines is on the list (the two families are the
 * shell design system's part vocabulary, so token coverage here is part
 * coverage of what the center repaints). Three things are deliberately absent,
 * all for the same reason — the panel edits *colors*: `--dsw-font-family` is a
 * font stack, the two `--dsw-linear-*` tokens are gradient strings a color
 * slider cannot express, and the `--dsw-static-*` palettes are each theme's
 * private pigment shelf, not a part. A theme that does not define some token
 * here (zcode skips six) leaves the host's own default standing, which the
 * override still beats; a token only one theme consumes (zcode's tool-card
 * pair) only shows its effect under that theme — under the others the slider
 * writes an override nothing reads. Each item names its token, a dictionary
 * key for its label, and a fallback used only when the token cannot be
 * resolved (the tool-card variables are the case: themes other than zcode do
 * not define them, so this fallback answers).
 *
 * Every value is read *resolved*: a probe element is attached to the body with
 * `color: var(--the-token)` and the computed color is read back, so var()
 * chains and color-mix() arrive as concrete rgb()/rgba() — the value the
 * element actually has, which is what the sliders have to start from. Editing
 * converts RGB ↔ HSL; the alpha channel survives untouched, so translucent
 * borders stay translucent no matter how the sliders move.
 */

/** One adjustable color: a custom property, its label key, its fallback. */
export interface PaletteItem {
  /** The custom property name, spelled with the leading `--`. */
  token: string
  /** Dictionary key of the row label, in the theme-center namespace. */
  labelKey: string
  /** Resolved when the token is not defined in the current mode or theme. */
  fallback: string
}

/** One surface group, drawn as a collapsible section of the panel. */
export interface PaletteGroup {
  /** Dictionary key of the group title, in the theme-center namespace. */
  labelKey: string
  items: PaletteItem[]
}

/** The surfaces the panel can repaint, in panel order: the theme's accents,
 * its text hierarchy, its borders, the left sidebar, the conversation area,
 * markdown rendering, tool-call cards, status colors, scrollbars, interaction
 * washes, overlays and tips, the remaining surfaces, and the right panel's
 * layer stack. */
export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  {
    labelKey: 'groupTheme',
    items: [
      { token: '--dsw-alias-button-primary-fill', labelKey: 'itemPrimaryFill', fallback: '#000000' },
      { token: '--dsw-alias-button-primary-hover', labelKey: 'itemPrimaryHover', fallback: '#262626' },
      { token: '--dsw-alias-button-primary-dimmed', labelKey: 'itemPrimaryDimmed', fallback: '#f0f0f0' },
      { token: '--dsw-alias-button-info-fill', labelKey: 'itemSendFill', fallback: '#000000' },
      { token: '--dsw-alias-button-info-hover', labelKey: 'itemSendHover', fallback: '#262626' },
      { token: '--dsw-alias-button-contrast-fill', labelKey: 'itemContrastFill', fallback: '#000000' },
      { token: '--dsw-alias-button-elevated-fill', labelKey: 'itemElevatedFill', fallback: '#ffffff' },
      { token: '--dsw-alias-button-floating-fill', labelKey: 'itemFloatingFill', fallback: '#ffffff' },
      { token: '--dsw-alias-button-floating-hover', labelKey: 'itemFloatingHover', fallback: '#fafafa' },
      { token: '--dsw-alias-button-ghost-active-fill', labelKey: 'itemGhostFill', fallback: '#ededed' },
      { token: '--dsw-alias-button-ghost-active-hover', labelKey: 'itemGhostHover', fallback: '#e6e6e6' },
      { token: '--dsw-alias-button-ghost-active-border', labelKey: 'itemGhostBorder', fallback: '#dcdcdc' },
      { token: '--dsw-alias-button-tool-bar-fill', labelKey: 'itemToolBarFill', fallback: 'rgba(13, 13, 13, 0.1)' },
      { token: '--dsw-alias-button-tool-bar-fill-invisible', labelKey: 'itemToolBarInvisible', fallback: 'rgba(13, 13, 13, 0.06)' },
      { token: '--dsw-alias-button-tool-bar-hover', labelKey: 'itemToolBarHover', fallback: 'rgba(13, 13, 13, 0.15)' },
      { token: '--dsw-alias-brand-primary', labelKey: 'itemBrand', fallback: '#000000' },
      { token: '--dsw-alias-brand-primary-invert', labelKey: 'itemBrandInvert', fallback: '#0f2440' },
      { token: '--dsw-alias-brand-text', labelKey: 'itemBrandText', fallback: '#0f2440' },
    ],
  },
  {
    labelKey: 'groupText',
    items: [
      { token: '--dsw-alias-label-primary', labelKey: 'itemInk', fallback: '#262626' },
      { token: '--dsw-alias-label-secondary', labelKey: 'itemLabelSecondary', fallback: '#3e5c78' },
      { token: '--dsw-alias-label-tertiary', labelKey: 'itemLabelTertiary', fallback: '#6e8aa3' },
      { token: '--dsw-alias-label-caption', labelKey: 'itemLabelCaption', fallback: '#6e8aa3' },
      { token: '--dsw-alias-label-dimmed', labelKey: 'itemLabelDimmed', fallback: 'rgba(15, 36, 64, 0.45)' },
      { token: '--dsw-alias-label-primary-dimmed', labelKey: 'itemLabelPrimaryDimmed', fallback: '#0f2440' },
      { token: '--dsw-alias-label-primary-bluish', labelKey: 'itemLabelBluish', fallback: '#0f2440' },
      { token: '--dsw-alias-label-primary-foreground', labelKey: 'itemLabelForeground', fallback: '#ffffff' },
      { token: '--dsw-alias-label-primary-inverted', labelKey: 'itemLabelInverted', fallback: '#ffffff' },
    ],
  },
  {
    labelKey: 'groupBorders',
    items: [
      { token: '--dsw-alias-border-l1', labelKey: 'itemBorderL1', fallback: 'rgba(15, 36, 64, 0.055)' },
      { token: '--dsw-alias-border-l2', labelKey: 'itemBorderL2', fallback: 'rgba(15, 36, 64, 0.1)' },
      { token: '--dsw-alias-border-l3', labelKey: 'itemBorderL3', fallback: 'rgba(15, 36, 64, 0.16)' },
      { token: '--dsw-alias-border-l4', labelKey: 'itemBorderL4', fallback: 'rgba(15, 36, 64, 0.22)' },
      { token: '--dsw-alias-border-l2-darkmode-thin', labelKey: 'itemBorderThinDark', fallback: 'rgba(15, 36, 64, 0.1)' },
      { token: '--dsw-alias-border-inverted', labelKey: 'itemBorderInverted', fallback: 'rgba(15, 36, 64, 0.08)' },
      { token: '--dsw-alias-border-inverted2', labelKey: 'itemBorderInverted2', fallback: 'rgba(15, 36, 64, 0.08)' },
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
    labelKey: 'groupMarkdown',
    items: [
      { token: '--dsw-alias-markdown-code-block', labelKey: 'itemCodeBlock', fallback: '#f0f0f0' },
      { token: '--dsw-alias-markdown-inline-code', labelKey: 'itemInlineCode', fallback: '#d8e8f1' },
      { token: '--dsw-alias-markdown-citation', labelKey: 'itemCitation', fallback: '#c5dde8' },
      { token: '--dsw-alias-markdown-tag', labelKey: 'itemTag', fallback: '#c5dde8' },
      { token: '--dsw-alias-markdown-placeholder', labelKey: 'itemPlaceholder', fallback: '#c5dde8' },
      { token: '--dsw-alias-markdown-code-block-banner', labelKey: 'itemCodeBanner', fallback: '#c9dfeb' },
      { token: '--dsw-alias-markdown-code-segment-selected', labelKey: 'itemCodeSelected', fallback: '#c9dfeb' },
      { token: '--dsw-alias-markdown-code-segment-unselected', labelKey: 'itemCodeUnselected', fallback: '#d8e8f1' },
    ],
  },
  {
    labelKey: 'groupToolCalls',
    items: [
      { token: '--dsw-zcode-tool-card-bg', labelKey: 'itemToolCardBg', fallback: '#ffffff' },
      { token: '--dsw-zcode-tool-card-border', labelKey: 'itemToolCardBorder', fallback: '#e0e0e0' },
    ],
  },
  {
    labelKey: 'groupStates',
    items: [
      { token: '--dsw-alias-state-success-primary', labelKey: 'itemSuccessPrimary', fallback: '#15803d' },
      { token: '--dsw-alias-state-success-secondary', labelKey: 'itemSuccessSecondary', fallback: '#15803d' },
      { token: '--dsw-alias-state-success-tertiary', labelKey: 'itemSuccessTertiary', fallback: 'rgba(21, 128, 61, 0.14)' },
      { token: '--dsw-alias-state-warn-primary', labelKey: 'itemWarnPrimary', fallback: '#b45309' },
      { token: '--dsw-alias-state-warn-secondary', labelKey: 'itemWarnSecondary', fallback: '#b45309' },
      { token: '--dsw-alias-state-warn-tertiary', labelKey: 'itemWarnTertiary', fallback: 'rgba(180, 83, 9, 0.16)' },
      { token: '--dsw-alias-state-warn-label', labelKey: 'itemWarnLabel', fallback: '#b45309' },
      { token: '--dsw-alias-state-error-primary', labelKey: 'itemErrorPrimary', fallback: '#dc2626' },
      { token: '--dsw-alias-state-error-secondary', labelKey: 'itemErrorSecondary', fallback: 'rgba(220, 38, 38, 0.75)' },
      { token: '--dsw-alias-state-business-primary', labelKey: 'itemBusinessPrimary', fallback: '#0e7490' },
      { token: '--dsw-alias-state-business-tertiary', labelKey: 'itemBusinessTertiary', fallback: 'rgba(14, 116, 144, 0.14)' },
    ],
  },
  {
    labelKey: 'groupScrollbars',
    items: [
      { token: '--dsw-alias-scrollbar-bg-l1', labelKey: 'itemScrollbarL1', fallback: 'rgba(15, 36, 64, 0.12)' },
      { token: '--dsw-alias-scrollbar-hover-l1', labelKey: 'itemScrollbarHoverL1', fallback: 'rgba(15, 36, 64, 0.22)' },
      { token: '--dsw-alias-scrollbar-bg-l2', labelKey: 'itemScrollbarL2', fallback: 'rgba(15, 36, 64, 0.12)' },
      { token: '--dsw-alias-scrollbar-hover-l2', labelKey: 'itemScrollbarHoverL2', fallback: 'rgba(15, 36, 64, 0.22)' },
    ],
  },
  {
    labelKey: 'groupInteractive',
    items: [
      { token: '--dsw-alias-interactive-bg-hover', labelKey: 'itemHoverWash', fallback: 'rgba(15, 36, 64, 0.06)' },
      { token: '--dsw-alias-interactive-bg-active', labelKey: 'itemActiveWash', fallback: 'rgba(15, 36, 64, 0.1)' },
      { token: '--dsw-alias-interactive-bg-hover-accent', labelKey: 'itemHoverAccent', fallback: 'rgba(14, 116, 144, 0.12)' },
      { token: '--dsw-alias-interactive-bg-hover-danger', labelKey: 'itemHoverDanger', fallback: 'rgba(220, 38, 38, 0.08)' },
      { token: '--dsw-alias-interactive-bg-hover-solid', labelKey: 'itemHoverSolid', fallback: '#c5dde8' },
    ],
  },
  {
    labelKey: 'groupOverlays',
    items: [
      { token: '--dsw-alias-bg-overlay', labelKey: 'itemOverlay', fallback: '#c5dde8' },
      { token: '--dsw-specific-menu', labelKey: 'itemMenu', fallback: '#f0f7f8' },
      { token: '--dsw-specific-selector', labelKey: 'itemSelector', fallback: '#c5dde8' },
      { token: '--dsw-specific-tip', labelKey: 'itemTip', fallback: '#c5dde8' },
      { token: '--dsw-alias-toast-bg', labelKey: 'itemToast', fallback: '#0f2440' },
      { token: '--dsw-alias-tooltip-bg', labelKey: 'itemTooltip', fallback: '#0f2440' },
      { token: '--dsw-specific-login-input', labelKey: 'itemLoginInput', fallback: '#ffffff' },
    ],
  },
  {
    labelKey: 'groupSurfaces',
    items: [
      { token: '--dsw-alias-bg-module-platform', labelKey: 'itemModulePlatform', fallback: '#c5dde8' },
      { token: '--dsw-alias-bg-multi-select', labelKey: 'itemMultiSelect', fallback: '#c5dde8' },
      { token: '--dsw-alias-bg-skeleton', labelKey: 'itemSkeleton', fallback: 'rgba(15, 36, 64, 0.06)' },
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
let sampler: CanvasRenderingContext2D | null | undefined

/**
 * Normalize a computed color into a syntax `parseColor` reads, for the one case
 * the parser cannot: a token whose value lives in a wide-gamut color space
 * (`oklch()`, `lab()`, `color(display-p3 …)`) is computed *in that space* and
 * read back verbatim, and rgb/hex parsing has nothing to say about it. Without
 * this step such a token would silently show the registry's fallback — a
 * made-up number standing in for the element's real color, which is exactly
 * what the panel must not do.
 *
 * A 1×1 canvas is the cheapest normalizer there is: assigning to `fillStyle`
 * and reading it back returns any color the browser can parse as `#rrggbb` or
 * `rgba()`. An unparseable value leaves the sentinel in place, and the original
 * string is handed back for the caller's fallback path.
 */
function normalize(color: string): string {
  if (sampler === undefined) {
    sampler = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  if (sampler === null) return color
  const sentinel = '#000001'
  sampler.fillStyle = sentinel
  sampler.fillStyle = color
  const read = String(sampler.fillStyle)
  return read === sentinel ? color : read
}

/**
 * Resolve one custom property to a concrete CSS color, through a probe element
 * on the body — computed values there have var() chains and color-mix()
 * already substituted, which reading the property off `body` directly would
 * not give. Returns the item's fallback when the token resolves to nothing.
 */
export function readTokenColor(token: string, fallback: string): string {
  if (typeof document === 'undefined' || document.body === null) return fallback
  if (probe === undefined || !probe.isConnected) {
    probe = document.createElement('div')
    probe.style.display = 'none'
    document.body.append(probe)
  }
  probe.style.color = `var(${token}, ${fallback})`
  const resolved = getComputedStyle(probe).color
  probe.style.color = ''
  if (parseColor(resolved) !== undefined) return resolved
  const normalized = normalize(resolved)
  return parseColor(normalized) !== undefined ? normalized : fallback
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
