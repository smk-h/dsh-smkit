/**
 * The Settings → MCP → Advanced sub-view's second block: automatic reconnection.
 *
 * Four fields, one write — the switch included, so a save can never leave the
 * host running a mix the user did not ask for. The drafts are seeded from the
 * values in force when the form mounts and are deliberately **not** derived from
 * props on every render: the section's 3s poll re-renders this view while the
 * user types, and only an answer from the host may replace what is being typed
 * (the rule `ToolTimeoutForm` and the retry page follow).
 *
 * Every range check lives on the host, including what `0` means in each field,
 * so the two halves cannot disagree about the bounds; this form only refuses a
 * draft that cannot be a number at all. "Restore default" writes `null` for all
 * four, which the host reads as "drop the stored value".
 */

import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import { createSwitch } from '../ui/Switch'
import type { ApiResult, ClientDeps, Translator } from '../../../platform/types'
import type { ReconnectSettings } from '../types'

export interface ReconnectFormProps {
  t: Translator
  /** The settings in force, as the last `/settings` answer reported them. */
  current: ReconnectSettings
  /** Called with the values the host confirmed, so the section can cache them. */
  onSaved(next: ReconnectSettings): void
}

/** A submittable draft: a non-negative whole number (the host owns the bounds). */
const NON_NEGATIVE_INT_RE = /^\d+$/

/** Read the four settings out of one host answer, field by field. */
function readSettings(body: Record<string, unknown>, fallback: ReconnectSettings): ReconnectSettings {
  const number = (value: unknown, previous: number): number =>
    typeof value === 'number' ? value : previous
  return {
    autoReconnect: typeof body.autoReconnect === 'boolean' ? body.autoReconnect : fallback.autoReconnect,
    reconnectMaxAttempts: number(body.reconnectMaxAttempts, fallback.reconnectMaxAttempts),
    reconnectMaxDelayMs: number(body.reconnectMaxDelayMs, fallback.reconnectMaxDelayMs),
    healthCheckIntervalMs: number(body.healthCheckIntervalMs, fallback.healthCheckIntervalMs),
  }
}

export function createReconnectForm(
  deps: ClientDeps,
): (props: ReconnectFormProps) => JSX.Element {
  const { h, react, api } = deps
  const Switch = createSwitch(deps)

  return function ReconnectForm({ t, current, onSaved }: ReconnectFormProps): JSX.Element {
    const [autoReconnect, setAutoReconnect] = react.useState(current.autoReconnect)
    const [attempts, setAttempts] = react.useState(String(current.reconnectMaxAttempts))
    const [maxDelay, setMaxDelay] = react.useState(String(current.reconnectMaxDelayMs))
    const [healthCheck, setHealthCheck] = react.useState(String(current.healthCheckIntervalMs))
    const { busy, error, setError, run } = useAsyncAction(react)

    /** Take an answer from the host as the new draft and the new cached value. */
    const seed = (next: ReconnectSettings): void => {
      setAutoReconnect(next.autoReconnect)
      setAttempts(String(next.reconnectMaxAttempts))
      setMaxDelay(String(next.reconnectMaxDelayMs))
      setHealthCheck(String(next.healthCheckIntervalMs))
      onSaved(next)
    }

    const write = (payload: Record<string, unknown>): Promise<void> =>
      run(async () => {
        const r: ApiResult = await api('/settings/reconnect', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        if (r.ok) {
          seed(readSettings(r.body, { ...current, autoReconnect }))
          return
        }
        return r.body.error || t('saveReconnectFailed', { status: r.status })
      }, 'reconnect')

    const save = (): Promise<void> => {
      const drafts = [attempts, maxDelay, healthCheck]
      if (!drafts.every((draft) => NON_NEGATIVE_INT_RE.test(draft.trim()))) {
        setError(t('invalidReconnectNumber'))
        return Promise.resolve()
      }
      return write({
        autoReconnect,
        reconnectMaxAttempts: Number(attempts.trim()),
        reconnectMaxDelayMs: Number(maxDelay.trim()),
        healthCheckIntervalMs: Number(healthCheck.trim()),
      })
    }

    /** `null` per field drops the stored value, restoring the built-in default. */
    const restore = (): Promise<void> =>
      write({
        autoReconnect: null,
        reconnectMaxAttempts: null,
        reconnectMaxDelayMs: null,
        healthCheckIntervalMs: null,
      })

    return (
      <div className="mm_row mm_add">
        <div className="mm_form">
          <div className="mm_field wide">
            <span>{t('autoReconnect')}</span>
            <Switch
              on={autoReconnect}
              text={autoReconnect ? t('on') : t('off')}
              busy={busy}
              onToggle={() => setAutoReconnect(!autoReconnect)}
              ariaLabel={t('autoReconnect')}
            />
          </div>
          <label>
            {t('reconnectMaxAttempts')}
            <input
              value={attempts}
              onChange={(e) => setAttempts(e.target.value)}
              aria-label={t('reconnectMaxAttempts')}
            />
          </label>
          <label>
            {t('reconnectMaxDelayMs')}
            <input
              value={maxDelay}
              onChange={(e) => setMaxDelay(e.target.value)}
              aria-label={t('reconnectMaxDelayMs')}
            />
          </label>
          <label className="wide">
            {t('healthCheckIntervalMs')}
            <input
              value={healthCheck}
              onChange={(e) => setHealthCheck(e.target.value)}
              aria-label={t('healthCheckIntervalMs')}
            />
          </label>
        </div>
        <div className="mm_meta">{t('reconnectHelp')}</div>
        {error ? <div className="mm_err">{error}</div> : null}
        <div className="mm_actions">
          <button
            className="mm_btn"
            onClick={save}
            disabled={busy}
            data-pending={busy ? 'true' : undefined}
            aria-busy={busy}
          >
            {t('save')}
          </button>
          <button className="mm_btn" onClick={restore} disabled={busy}>
            {t('restoreDefault')}
          </button>
        </div>
      </div>
    )
  }
}
