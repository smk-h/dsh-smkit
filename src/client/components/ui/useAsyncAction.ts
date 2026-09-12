/**
 * The busy/error/run triple behind every API call the section makes.
 *
 * Each row and form used to repeat `useState(false)` + `useState('')` + the
 * same try/catch around one `api(...)` call — ten times over. This hook owns
 * that shape, so an action declares only what to request and which message a
 * failure should surface (`undefined` means "succeeded, show nothing").
 *
 * `busy` is the row-wide flag (everything in the row is disabled while a request
 * is in flight); `pending` carries the *key* of the action that is running, which
 * is what lets a row with several buttons turn only the clicked one into `…`
 * instead of blanking all of them — a restart can take a minute on a stdio
 * server that has to be respawned, and three dots on every button reads as a
 * hung row.
 *
 * `setError` stays exposed for the one early return that never enters `run`:
 * a form rejecting its own input before it talks to the host.
 */

import type { ReactLike } from '../../runtime/types'

/** Key of an action its caller did not tag. No button label is compared to it,
 * so an untagged action shows no `…` anywhere. */
const UNTAGGED = '(untagged)'

export interface AsyncAction {
  busy: boolean
  /** Key of the action in flight, `''` when idle. `busy` is `pending !== ''`. */
  pending: string
  error: string
  setError(message: string): void
  /** Runs one request. The callback returns the message to show on failure, or
   * `undefined` when it succeeded (or caught the failure itself). `key` names
   * the action so its button can render as pending. */
  run(action: () => Promise<string | undefined | void>, key?: string): Promise<void>
}

export function useAsyncAction(react: ReactLike): AsyncAction {
  const [pending, setPending] = react.useState('')
  const [error, setError] = react.useState('')

  const run = async (
    action: () => Promise<string | undefined | void>,
    key: string = UNTAGGED,
  ): Promise<void> => {
    setPending(key)
    setError('')
    try {
      const message = await action()
      if (message) setError(message)
    } catch (e) {
      setError(String(e))
    }
    setPending('')
  }

  return { busy: pending !== '', pending, error, setError, run }
}
