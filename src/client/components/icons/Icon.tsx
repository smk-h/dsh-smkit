/**
 * Shared plumbing for the MCP section's icon set.
 *
 * Icons live one per file, named after the icon (`MonitorIcon.tsx`), so a call
 * site imports exactly what it renders. What they have in common lives here:
 * the 16×16 grid, the `currentColor` stroke that lets an icon inherit the
 * colour of the element wrapping it (and both DSH themes with it), and the
 * `h`-injection every factory needs.
 */

import type { ClientDeps } from '../../runtime/types'

export interface IconProps {
  /** Square edge length in px; defaults to the 16px grid the paths are drawn on. */
  size?: number
  className?: string
}

/** A component that renders one icon of the set. */
export type IconFactory = (props: IconProps) => JSX.Element

/** Draw one icon: the shared `<svg>` shell around `paths`, all on the 16×16 grid. */
export function createIcon(deps: ClientDeps, paths: string[], strokeWidth: number): IconFactory {
  const { h } = deps

  return function Icon({ size = 16, className }: IconProps): JSX.Element {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        {paths.map((d) => (
          <path
            d={d}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            key={d}
          />
        ))}
      </svg>
    )
  }
}
