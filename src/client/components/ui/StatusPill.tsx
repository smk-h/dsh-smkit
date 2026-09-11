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
}

export interface StatusBadgeProps {
  t: Translator
  status: string
}

export function createStatusDot(deps: ClientDeps): (props: StatusDotProps) => JSX.Element {
  const { h } = deps

  return function StatusDot({ status }: StatusDotProps): JSX.Element {
    return <span className={`mm_statusDot ${status}`} aria-hidden="true" />
  }
}

export function createStatusBadge(deps: ClientDeps): (props: StatusBadgeProps) => JSX.Element {
  const { h } = deps

  return function StatusBadge({ t, status }: StatusBadgeProps): JSX.Element {
    return <span className={`mm_badge ${status}`}>{t(status)}</span>
  }
}
