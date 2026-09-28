/**
 * Await `promise`, but stop waiting after `timeoutMs` and report which of the
 * two happened. The promise is not cancelled: a late answer still reaches
 * whoever is listening to it, this only unblocks the caller.
 *
 * The caller that needs it is the browser's notification-permission prompt.
 * When the browser folds the question into the address bar's icon instead of
 * showing a dialog — quiet UI, or a prompt the user dismissed earlier —
 * `requestPermission()` may never settle at all, and a button that awaits it
 * sits disabled forever with nothing on screen to explain why. "Never waited
 * long enough" is a state worth saying out loud.
 *
 * A rejection is the promise's own answer and passes through untouched: a
 * caller whose promise can fail converts it to a value before handing it over.
 */

/** Which of the two ends the wait had: the promise's own answer, or the clock. */
export type SettleOutcome<T> = { answered: true; value: T } | { answered: false }

export function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<SettleOutcome<T>> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve({ answered: false })
    }, timeoutMs)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ answered: true, value })
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
