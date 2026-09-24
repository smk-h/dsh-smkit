/**
 * The Settings → MCP → Advanced sub-view: the global `tools/call` timeout.
 *
 * One field, one write. The draft is seeded from the value in force when the
 * form mounts and posted to `/settings/tool-timeout`; it is deliberately **not**
 * derived from props on every render, because the section's 3s poll re-renders
 * this view while the user types — only an answer from the host may replace what
 * is being typed (the same rule the retry page's form follows).
 *
 * The whole range check lives on the host: this form only refuses a draft that
 * cannot be a timeout at all (not a positive whole number), so the bounds and
 * their message cannot drift between the two halves.
 */

import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import type { ApiResult, ClientDeps, Translator } from '../../../platform/types'

export interface ToolTimeoutFormProps {
  t: Translator
  /** The timeout in force, as the last `/settings` answer reported it (ms). */
  current: number
  /** Called with the value the host confirmed, so the section can cache it. */
  onSaved(timeoutMs: number): void
  onCancel(): void
}

/** A submittable draft: a positive whole number of milliseconds. */
const POSITIVE_INT_RE = /^[1-9]\d*$/

export function createToolTimeoutForm(
  deps: ClientDeps,
): (props: ToolTimeoutFormProps) => JSX.Element {
  const { h, react, api } = deps

  return function ToolTimeoutForm({
    t,
    current,
    onSaved,
    onCancel,
  }: ToolTimeoutFormProps): JSX.Element {
    const [draft, setDraft] = react.useState(String(current))
    const { busy, error, setError, run } = useAsyncAction(react)

    /** `null` removes the stored value, restoring the built-in default. */
    const write = (timeoutMs: number | null): Promise<void> =>
      run(async () => {
        const r: ApiResult = await api('/settings/tool-timeout', {
          method: 'POST',
          body: JSON.stringify({ timeoutMs }),
        })
        if (r.ok) {
          const next =
            typeof r.body.toolCallTimeoutMs === 'number' ? r.body.toolCallTimeoutMs : current
          setDraft(String(next))
          onSaved(next)
          return
        }
        return r.body.error || t('saveTimeoutFailed', { status: r.status })
      }, 'tool-timeout')

    const save = (): Promise<void> => {
      if (!POSITIVE_INT_RE.test(draft.trim())) {
        setError(t('invalidTimeout'))
        return Promise.resolve()
      }
      return write(Number(draft.trim()))
    }

    return (
      <div className="smkit-ui-disclosure-card smkit-mcp-form-add">
        <div className="smkit-mcp-form">
          <label className="wide">
            {t('toolCallTimeout')}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={t('toolCallTimeout')}
            />
          </label>
        </div>
        <div className="smkit-mcp-section-meta">{t('toolCallTimeoutHelp')}</div>
        {error ? <div className="smkit-ui-field-error">{error}</div> : null}
        <div className="smkit-mcp-card-actions">
          <button
            className="smkit-ui-button"
            onClick={save}
            disabled={busy}
            data-smkit-pending={busy ? 'true' : undefined}
            aria-busy={busy}
          >
            {t('save')}
          </button>
          <button className="smkit-ui-button" onClick={() => write(null)} disabled={busy}>
            {t('restoreDefault')}
          </button>
          <button className="smkit-ui-button" onClick={onCancel} disabled={busy}>
            {t('cancel')}
          </button>
        </div>
      </div>
    )
  }
}
