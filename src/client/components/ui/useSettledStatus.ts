/**
 * Hold the status a row *renders* on the last one that settled.
 *
 * The settings page learns a server's state from a 3-second poll, so a
 * transition (`connecting`, `authorizing`) gets sampled at an arbitrary point of
 * its life: a restart that takes half a second is either never seen or seen for
 * the tail of one poll, which made the badge flash — the same status rendered
 * for 0.2s or not at all, depending on where the click landed between two polls.
 *
 * Chasing that with a faster poll only moves the problem, so the rows do the
 * opposite: they keep rendering the last status they were sure about and report
 * "working on this connection" through the `busy` flag, which `StatusPill` turns
 * into a pulsing dot and a dimmed badge (`[data-busy]` in `style/pill.css`). A
 * status that is transient from the very first render still renders — a row that
 * was already connecting when the page opened has no earlier truth to hold.
 */

import type { ReactLike } from '../../runtime/types'

/** Statuses that mean "in between", reported while a connection is being
 * established: exactly the ones too short-lived to sample reliably. */
const TRANSIENT_STATUSES = ['connecting', 'authorizing']

export function isTransientStatus(status: string): boolean {
  return TRANSIENT_STATUSES.includes(status)
}

export interface SettledStatus {
  /** The status to render (the live one, or the last settled one). */
  status: string
  /** Whether the live status is transient, i.e. the connection is in between. */
  busy: boolean
}

export function useSettledStatus(react: ReactLike, status: string): SettledStatus {
  const [settled, setSettled] = react.useState(status)

  // Adjusting state during render is React's documented way to derive state
  // from props: a settled status replaces the held one, a transient one is only
  // observed. The `!==` guard is what keeps this from looping.
  if (!isTransientStatus(status) && status !== settled) setSettled(status)

  return { status: settled, busy: isTransientStatus(status) }
}
