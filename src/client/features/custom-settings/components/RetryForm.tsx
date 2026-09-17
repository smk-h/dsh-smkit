/**
 * The policy form: one provider route's mode, attempt count, and backoff,
 * seeded from the values that apply right now.
 *
 * The draft is strings because the settings shell's inputs are plain text (the
 * ambient JSX vocabulary has no `number` input), so {@link parseDraft} is the
 * one place a keystroke becomes a policy: it answers the four cases the host
 * would otherwise refuse in its own words, and everything it accepts is still
 * judged by the adapter's schema on the write.
 *
 * Reset is a second write path, not a form state: `policy: null` removes the
 * stored policy so the route inherits the adapter's defaults again — the one
 * operation a merge-shaped form cannot express by emptying fields.
 */

import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import type { ApiResult, ClientDeps, Translator } from '../../../platform/types'
import type { RetryMode, RetryPolicyFields, RetryRouteView } from '../../../../shared/custom-settings/retry'

/** Largest delay Node schedules without clamping; the adapters share this bound. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** The adapter's default bounded-retry count, used when the form opens on an `always` route. */
const DEFAULT_MAX_RETRIES = 5

export interface RetryFormProps {
  t: Translator
  route: RetryRouteView
  /** The write landed: the caller refreshes and leaves the form. */
  onDone(): void
  onCancel(): void
}

/** The editable state of one draft, as typed. */
interface Draft {
  mode: RetryMode
  maxRetries: string
  initialDelayMs: string
  maxDelayMs: string
  jitterRatio: string
}

/** A whole-number millisecond field: digits only, positive, within what Node schedules. */
function millisecondsOf(value: string): number | undefined {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_TIMER_DELAY_MS ? parsed : undefined
}

/** A whole-number attempt count: digits only, zero allowed. */
function countOf(value: string): number | undefined {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

/** The jitter ratio, which is the one field the page accepts as a decimal. */
function ratioOf(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined
}

/**
 * Reduce one typed draft to a policy, or to the message key naming the field.
 * @param draft - the form's four fields and its mode.
 * @returns the policy to send, or the dictionary key the error line shows.
 */
function parseDraft(draft: Draft): { ok: true; policy: RetryPolicyFields } | { ok: false; key: string } {
  const initialDelayMs = millisecondsOf(draft.initialDelayMs)
  if (initialDelayMs === undefined) return { ok: false, key: 'invalidInitialDelay' }
  const maxDelayMs = millisecondsOf(draft.maxDelayMs)
  if (maxDelayMs === undefined) return { ok: false, key: 'invalidMaxDelay' }
  if (initialDelayMs > maxDelayMs) return { ok: false, key: 'invalidOrder' }
  const jitterRatio = ratioOf(draft.jitterRatio)
  if (jitterRatio === undefined) return { ok: false, key: 'invalidJitter' }
  const backoff = { initialDelayMs, maxDelayMs, jitterRatio }
  if (draft.mode === 'always') return { ok: true, policy: { mode: 'always', ...backoff } }
  const maxRetries = countOf(draft.maxRetries)
  if (maxRetries === undefined) return { ok: false, key: 'invalidMaxRetries' }
  return { ok: true, policy: { mode: 'normal', maxRetries, ...backoff } }
}

/** What a refused write tells the user: its stable code localized, else the host's own words. */
function refusalText(t: Translator, result: ApiResult): string {
  switch (result.body.code) {
    case 'retry/conflict': return t('conflict')
    case 'retry/unknown-provider': return t('codeUnknownProvider')
    case 'retry/not-editable': return t('codeNotEditable')
    case 'retry/unavailable': return t('codeUnavailable')
    default: return result.body.error || t('saveFailed', { status: result.status })
  }
}

export function createRetryForm(deps: ClientDeps): (props: RetryFormProps) => JSX.Element {
  const { h, react, api } = deps

  return function RetryForm({ t, route, onDone, onCancel }: RetryFormProps): JSX.Element {
    const [mode, setMode] = react.useState<RetryMode>(route.policy.mode)
    const [maxRetries, setMaxRetries] = react.useState(
      String(route.policy.maxRetries ?? DEFAULT_MAX_RETRIES),
    )
    const [initialDelayMs, setInitialDelayMs] = react.useState(String(route.policy.initialDelayMs))
    const [maxDelayMs, setMaxDelayMs] = react.useState(String(route.policy.maxDelayMs))
    const [jitterRatio, setJitterRatio] = react.useState(String(route.policy.jitterRatio))
    const { busy, error, setError, run } = useAsyncAction(react)

    const write = (policy: RetryPolicyFields | null): Promise<void> =>
      run(async () => {
        const result = await api('/llm-retry/policy', {
          method: 'POST',
          body: JSON.stringify({
            provider: route.provider,
            policy,
            // The revision this form was rendered from: a section that moved
            // since then refuses the write, and the caller re-reads the page
            // instead of overwriting somebody else's edit.
            ...route.revision === undefined ? {} : { revision: route.revision },
          }),
        })
        if (result.ok) {
          onDone()
          return
        }
        return refusalText(t, result)
      })

    const save = (): Promise<void> => {
      const parsed = parseDraft({ mode, maxRetries, initialDelayMs, maxDelayMs, jitterRatio })
      if (!parsed.ok) {
        setError(t(parsed.key))
        return Promise.resolve()
      }
      return write(parsed.policy)
    }

    return (
      <div className="lr_row">
        <div className="lr_form">
          <label>
            {t('mode')}
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value === 'always' ? 'always' : 'normal')}
            >
              <option value="normal">{t('modeNormal')}</option>
              <option value="always">{t('modeAlways')}</option>
            </select>
          </label>
          {mode === 'normal' ? (
            <label>
              {t('maxRetries')}
              <input
                value={maxRetries}
                onChange={(e) => setMaxRetries(e.target.value)}
                aria-label={t('maxRetries')}
              />
            </label>
          ) : null}
          <label>
            {t('initialDelayMs')}
            <input
              value={initialDelayMs}
              onChange={(e) => setInitialDelayMs(e.target.value)}
              aria-label={t('initialDelayMs')}
            />
          </label>
          <label>
            {t('maxDelayMs')}
            <input
              value={maxDelayMs}
              onChange={(e) => setMaxDelayMs(e.target.value)}
              aria-label={t('maxDelayMs')}
            />
          </label>
          <label>
            {t('jitterRatio')}
            <input
              value={jitterRatio}
              onChange={(e) => setJitterRatio(e.target.value)}
              aria-label={t('jitterRatio')}
            />
          </label>
        </div>
        <div className="lr_help">{mode === 'normal' ? t('maxRetriesHelp') : t('unlimitedHelp')}</div>
        <div className="lr_help">{t('backoffHelp')}</div>
        <div className="lr_help">{t('resetHint')}</div>
        {error ? <div className="mm_err">{error}</div> : null}
        <div className="lr_actions">
          <button
            className="mm_btn"
            onClick={save}
            disabled={busy}
            data-pending={busy ? 'true' : undefined}
            aria-busy={busy}
          >
            {t('save')}
          </button>
          <button className="mm_btn" onClick={() => { void write(null) }} disabled={busy}>
            {t('reset')}
          </button>
          <button className="mm_btn" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </button>
        </div>
      </div>
    )
  }
}
