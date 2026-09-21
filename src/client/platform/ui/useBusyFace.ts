/**
 * The floor under a busy face: how long a control that says "working" keeps
 * saying it, whether or not the work is still going.
 *
 * Two components raise one — the platform's refresh button, and any control
 * that swaps its glyph for the spinner while it waits on the host — and they
 * all answer the same question: a read of a local directory can come back in a
 * couple of milliseconds, and a busy face that comes and goes inside a frame is
 * not an acknowledgement. It is a flicker, and the user reads it as the control
 * misfiring rather than as the host being quick. So a click opens a showing of
 * the face and the read only closes it once `BUSY_FLOOR_MS` has run out.
 *
 * The floor is measured from the *click*, not from the answer, because the
 * answer is the thing that arrives too early. That is the whole reason the hook
 * keeps a timestamp rather than a flag, and why `start()` has to be called from
 * the click handler itself: an effect runs one frame after the paint, and a
 * click acknowledged a frame late is the flicker this exists to avoid.
 *
 * A caller that reports work in flight without ever calling `start()` (a page
 * mounted mid-read) shows the face for exactly as long as that work lasts, and
 * skips the floor — there was no click to acknowledge.
 */

import type { ReactLike } from '../types'

/** The shortest showing of the busy face, in ms. */
export const BUSY_FLOOR_MS = 1000

export interface BusyFace {
  /** Show the face: the caller's work is in flight, or its floor is still running. */
  showing: boolean
  /** Open a showing, from the handler that starts the work. */
  start(): void
}

/**
 * @param react - the injected React, so the hook rides the same runtime as its caller.
 * @param working - the caller's own in-flight flag, from its request.
 * @param floorMs - the minimum showing; `BUSY_FLOOR_MS` unless a control is slower to settle.
 */
export function useBusyFace(react: ReactLike, working: boolean, floorMs = BUSY_FLOOR_MS): BusyFace {
  // When the click that opened the face happened, in ms — `0` when none has.
  const [since, setSince] = react.useState(0)

  // The falling edge: the work is over, so the face comes down — never before
  // the floor, which is the only reason this effect exists.
  react.useEffect(() => {
    if (working || since === 0) return
    const remaining = Math.max(0, floorMs - (Date.now() - since))
    const timer = setTimeout(() => setSince(0), remaining)
    return () => clearTimeout(timer)
  }, [working, since])

  return { showing: working || since !== 0, start: () => setSince(Date.now()) }
}
