/**
 * Shared plumbing for the MCP section's icon set.
 *
 * Icons live one per file, named after the icon (`MonitorIcon.tsx`), so a call
 * site imports exactly what it renders. What they have in common lives here:
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

import type { ClientDeps } from '../../runtime/types'

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
