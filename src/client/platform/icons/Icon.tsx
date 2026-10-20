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
 * One glyph as a React element, instead of a component.
 *
 * The host's `Menu` takes each row's icon as a node (`items[].icon`), so a menu
 * row cannot use a `createIcon` factory; this draws the same `<svg>` shell
 * here. `h` is threaded in rather than imported, exactly as everywhere else in
 * the client half, and the props bag is deliberately loose so both features can
 * pass the factory they already carry.
 */
export function iconElement(
  h: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown,
  spec: IconSpec,
): unknown {
  return h(
    'svg',
    {
      width: spec.size ?? 16,
      height: spec.size ?? 16,
      viewBox: spec.viewBox,
      fill: 'none',
      strokeWidth: 1,
      'aria-hidden': 'true',
    },
    spec.nodes.map((node, index) => h(node.tag, { key: String(index), ...node.attrs })),
  )
}

/** SVG's spelling of a React SVG attribute name (`strokeWidth` → `stroke-width`). */
function kebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

/**
 * One glyph as an `SVGSVGElement`, built with `createElementNS`.
 *
 * The counterpart of `iconElement` for the DOM-decoration route: a preview body
 * or an editor tab belongs to the host and is not a React surface this plugin
 * may render into, so a watcher cannot hand a `createIcon` factory to `h` — it
 * builds the same `<svg>` shell by hand instead.
 *
 * React spells SVG presentation attributes in camelCase (`strokeWidth`) while
 * DOM attributes must use SVG's kebab-case (`stroke-width`); names are
 * converted on the way out, because a `strokeWidth` written verbatim would land
 * as an attribute no renderer reads. `viewBox` is on the shell and is already
 * in its SVG spelling.
 */
export function iconSvg(spec: IconSpec): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', String(spec.size ?? 16))
  svg.setAttribute('height', String(spec.size ?? 16))
  svg.setAttribute('viewBox', spec.viewBox)
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  for (const node of spec.nodes) {
    const child = document.createElementNS(ns, node.tag)
    for (const [name, value] of Object.entries(node.attrs)) {
      child.setAttribute(kebabCase(name), String(value))
    }
    svg.appendChild(child)
  }
  return svg
}

/**
 * One glyph as a `mask-image` value: the same `<svg>` shell `createIcon`
 * renders, serialized and URL-encoded for a stylesheet. Alpha only — the glyph
 * strokes in `currentColor`, which resolves to opaque inside a mask, so the
 * masked element's own colour shows through while `currentColor` in the rule
 * keeps the tint following hover and active states.
 *
 * Attribute names go out in SVG's spelling for the reason `iconSvg` gives; the
 * `viewBox` is on the shell and is already in its SVG spelling.
 */
export function iconMaskDataUri(spec: IconSpec): string {
  const attributes = (attrs: Record<string, string | number>): string =>
    Object.entries(attrs)
      .map(([name, value]) => ` ${kebabCase(name)}="${String(value)}"`)
      .join('')
  const nodes = spec.nodes.map((node) => `<${node.tag}${attributes(node.attrs)}/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${spec.viewBox}" fill="none">${nodes}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
