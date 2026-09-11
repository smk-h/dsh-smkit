/**
 * The busy/error/run triple behind every API call the section makes.
 *
 * Each row and form used to repeat `useState(false)` + `useState('')` + the
 * same try/catch around one `api(...)` call — ten times over. This hook owns
 * that shape, so an action declares only what to request and which message a
 * failure should surface (`undefined` means "succeeded, show nothing").
 *
 * `setError` stays exposed for the one early return that never enters `run`:
 * a form rejecting its own input before it talks to the host.
 */

import type { ReactLike } from '../../runtime/types'

export interface AsyncAction {
  busy: boolean
  error: string
  setError(message: string): void
  /** Runs one request. The callback returns the message to show on failure, or
   * `undefined` when it succeeded (or caught the failure itself). */
  run(action: () => Promise<string | undefined | void>): Promise<void>
}

export function useAsyncAction(react: ReactLike): AsyncAction {
  const [busy, setBusy] = react.useState(false)
  const [error, setError] = react.useState('')

  const run = async (action: () => Promise<string | undefined | void>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const message = await action()
      if (message) setError(message)
    } catch (e) {
      setError(String(e))
    }
    setBusy(false)
  }

  return { busy, error, setError, run }
}
