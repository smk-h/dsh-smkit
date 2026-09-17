/**
 * Shared plumbing for the plugin's icon sets.
 *
 * Icons live one per file, named after the icon (`MonitorIcon.tsx`), so a call
 * site imports exactly what it renders. A glyph only one section draws lives in
 * that section's own `icons/`; one two sections draw lives beside this file.
 * What they have in common lives here:
 * the `<svg>` shell, `currentColor` (an icon takes the colour of the element
 * wrapping it, and follows both DSH themes with it), and the `h`-injection
 * every factory needs.
 *
 * Glyphs are declared as data — a list of `{ tag, attrs }` elements — instead
 * of JSX, because the set mixes fills and strokes: `h(tag, …)` takes any SVG
 * tag and attribute (`d`, `fill`, `strokeWidth`, `transform`) without widening
 * the JSX intrinsic table in `ambient.d.ts`. Most glyphs are ported verbatim
 * from DSH's own `@deepseek-ai/dsh-client-ui-primitives` (MIT, © 2026 DeepSeek);
 * each ported file names its upstream export in its header.
 */

import type { ClientDeps } from '../types'

export interface IconProps {
  /** Square edge length in px; defaults to the glyph's own drawn size. */
  size?: number
  className?: string
}

/** A component that renders one icon of the set. */
export type IconFactory = (props: IconProps) => JSX.Element

/** One element of a glyph: an SVG tag name plus React's SVG props, exactly as
 * the glyph declares them (`d`, `fill`, `strokeWidth`, `clipPath`, `transform`). */
export interface IconNode {
  tag: string
  attrs: Record<string, string | number>
}

/** One glyph: the grid it is drawn on, its natural edge length, its elements. */
export interface IconSpec {
  viewBox: string
  size?: number
  nodes: IconNode[]
}

/** Draw one icon: the shared `<svg>` shell around the glyph's `nodes`. */
export function createIcon(deps: ClientDeps, spec: IconSpec): IconFactory {
  const { h } = deps

  return function Icon({ size = spec.size ?? 16, className }: IconProps): JSX.Element {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox={spec.viewBox}
        fill="none"
        aria-hidden="true"
      >
        {spec.nodes.map((node, index) => h(node.tag, { ...node.attrs, key: String(index) }))}
      </svg>
    )
  }
}

/**
 * One glyph as a `mask-image` value: the same `<svg>` shell `createIcon`
 * renders, serialized and URL-encoded for a stylesheet. Alpha only — the glyph
 * strokes in `currentColor`, which resolves to opaque inside a mask, so the
 * masked element's own colour shows through while `currentColor` in the rule
 * keeps the tint following hover and active states.
 *
 * React spells SVG presentation attributes in camelCase (`strokeWidth`) while
 * serialized markup must use SVG's kebab-case (`stroke-width`), so attribute
 * names are converted on the way out; the `viewBox` is on the shell and is
 * already in its SVG spelling.
 */
export function iconMaskDataUri(spec: IconSpec): string {
  const kebabCase = (name: string): string =>
    name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
  const attributes = (attrs: Record<string, string | number>): string =>
    Object.entries(attrs)
      .map(([name, value]) => ` ${kebabCase(name)}="${String(value)}"`)
      .join('')
  const nodes = spec.nodes.map((node) => `<${node.tag}${attributes(node.attrs)}/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${spec.viewBox}" fill="none">${nodes}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
