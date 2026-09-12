/**
 * The two status atoms every server list renders: the coloured dot and the
 * translated badge.
 *
 * They stay two components rather than one pill because `GlobalMaskRow` puts
 * the server name between them; keeping the halves independent lets all three
 * callers drop them in place without changing their markup.
 *
 * Both render the status they are handed, transient ones included: a
 * `connecting`/`authorizing` connection draws as a spinning arc in the same
 * colour the settled dot would have (`mm_statusSpin` in `style/pill.css`) —
 * motion carries "working on it" instead of a colour change. Rows keep this
 * honest for user-initiated transitions by previewing the intermediate status
 * at click time (see `McpContent`'s `statusPreviews`), so the spin starts
 * with the click rather than with the next poll.
 */

import type { ClientDeps, Translator } from '../../runtime/types'
import { createLoaderIcon } from '../icons/LoaderIcon'

/** Statuses that mean "in between", reported while a connection is being
 * established: rendered as a spinner rather than a dot. */
const TRANSIENT_STATUSES = ['connecting', 'authorizing']

export function isTransientStatus(status: string): boolean {
  return TRANSIENT_STATUSES.includes(status)
}

export interface StatusDotProps {
  status: string
}

export interface StatusBadgeProps {
  t: Translator
  status: string
}

export function createStatusDot(deps: ClientDeps): (props: StatusDotProps) => JSX.Element {
  const { h } = deps
  const Loader = createLoaderIcon(deps)

  return function StatusDot({ status }: StatusDotProps): JSX.Element {
    const transient = isTransientStatus(status)
    return (
      <span
        className={`mm_statusDot ${status}`}
        data-spin={transient ? 'true' : undefined}
        aria-hidden="true"
      >
        {transient ? <Loader size={9} className="mm_statusSpin" /> : null}
      </span>
    )
  }
}

export function createStatusBadge(deps: ClientDeps): (props: StatusBadgeProps) => JSX.Element {
  const { h } = deps

  return function StatusBadge({ t, status }: StatusBadgeProps): JSX.Element {
    return (
      <span className={`mm_badge ${status}`}>
        {t(status)}
      </span>
    )
  }
}
