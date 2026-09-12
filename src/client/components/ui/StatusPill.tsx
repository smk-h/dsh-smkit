/**
 * The two status atoms every server list renders: the coloured dot and the
 * translated badge.
 *
 * They stay two components rather than one pill because `GlobalMaskRow` puts
 * the server name between them; keeping the halves independent lets all three
 * callers drop them in place without changing their markup.
 */

import type { ClientDeps, Translator } from '../../runtime/types'

export interface StatusDotProps {
  status: string
  /** The connection is in between: the dot pulses while the badge holds the last
   * settled status (see `useSettledStatus`). */
  busy?: boolean
}

export interface StatusBadgeProps {
  t: Translator
  status: string
  busy?: boolean
}

export function createStatusDot(deps: ClientDeps): (props: StatusDotProps) => JSX.Element {
  const { h } = deps

  return function StatusDot({ status, busy }: StatusDotProps): JSX.Element {
    return (
      <span
        className={`mm_statusDot ${status}`}
        data-busy={busy ? 'true' : undefined}
        aria-hidden="true"
      />
    )
  }
}

export function createStatusBadge(deps: ClientDeps): (props: StatusBadgeProps) => JSX.Element {
  const { h } = deps

  return function StatusBadge({ t, status, busy }: StatusBadgeProps): JSX.Element {
    return (
      <span className={`mm_badge ${status}`} data-busy={busy ? 'true' : undefined}>
        {t(status)}
      </span>
    )
  }
}
