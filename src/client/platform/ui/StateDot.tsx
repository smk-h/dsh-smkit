/**
 * The status dot the plugin shares: DSH's own state mark, drawn the way the
 * shell draws it beside the tag that says a plugin is enabled.
 *
 * It lives in the platform layer because the states are not one section's
 * vocabulary — a store that exists, a connection that failed, a task waiting
 * on the user are all the same kind of answer, and the shell already has one
 * picture for it. A section that needs a status drops this in and keeps no
 * rules of its own for it; where it sits is layout, and that travels through
 * `className`.
 *
 * `state` picks the colour and nothing else. `done` is the outcome that needs
 * no explanation, `warning` the one that needs the user, `error` the one that
 * went wrong, and `idle` the absence of all three. (DSH adds an animated
 * `ongoing` for a live process; here a process in flight already has the
 * platform spinner, and a dot that turns is two answers to one question.)
 *
 * **The name is this component's business only when there is no text beside
 * it.** DSH pairs its dot with a word or a row label and hides the mark from
 * assistive tech; a lone dot in a toolbar head has no such partner, so `label`
 * moves the dot from decoration to image and gives it the same tooltip the
 * control beside it carries. Left out, the dot stays `aria-hidden` — a screen
 * reader then reads the text it stands next to, which is the point of standing
 * next to it.
 */

import type { ClientDeps } from '../types'

/** Which of the shell's state colours to wear. */
export type StateDotState = 'done' | 'warning' | 'error' | 'idle'

/** DSH's own measure for the dot, in px. */
const DEFAULT_SIZE = 10

export interface StateDotProps {
  /** The state to paint. */
  state: StateDotState
  /** Accessible name, for a dot that stands alone; a dot beside its text omits it. */
  label?: string
  /** Outer diameter in px, halo included. */
  size?: number
  /** Extra classes, for the row that has to place it. */
  className?: string
}

export function createStateDot(deps: ClientDeps): (props: StateDotProps) => JSX.Element {
  const { h } = deps

  return function StateDot({ state, label, size, className }: StateDotProps): JSX.Element {
    const named = label !== undefined
    return (
      <span
        className={className === undefined ? 'mm_stateDot' : `mm_stateDot ${className}`}
        data-state={state}
        style={{ width: `${size ?? DEFAULT_SIZE}px`, height: `${size ?? DEFAULT_SIZE}px` }}
        role={named ? 'img' : undefined}
        aria-label={label}
        title={label}
        aria-hidden={named ? undefined : true}
      />
    )
  }
}
