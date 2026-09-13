/**
 * The delete-confirmation overlay shared by the global rows, the workspace
 * rows, and the Session-header delete control.
 *
 * The title and body arrive already translated, so the same dialog serves every
 * caller without knowing which one it belongs to; the confirm button shows the
 * busy ellipsis while the delete request is in flight. `error` is optional
 * because only the callers that keep the dialog open on failure need it: the
 * row deletes close immediately and report through the row, while the Session
 * delete has no row left to report into once the request comes back.
 */

import type { ClientDeps, Translator } from '../../runtime/types'

export interface ConfirmDialogProps {
  t: Translator
  title: string
  body: string
  busy: boolean
  /** Failure text to show inside the dialog; absent means "nothing went wrong". */
  error?: string
  onCancel(): void
  onConfirm(): void
}

export function createConfirmDialog(deps: ClientDeps): (props: ConfirmDialogProps) => JSX.Element {
  const { h } = deps

  return function ConfirmDialog({
    t,
    title,
    body,
    busy,
    error,
    onCancel,
    onConfirm,
  }: ConfirmDialogProps): JSX.Element {
    return (
      <div className="mm_overlay" onClick={onCancel}>
        <div className="mm_dialog" onClick={(e) => e.stopPropagation()}>
          <div className="mm_dialogTitle">{title}</div>
          <div className="mm_dialogBody">{body}</div>
          {error ? <div className="mm_err">{error}</div> : null}
          <div className="mm_dialogActions">
            <button className="mm_btn" onClick={onCancel} disabled={busy}>
              {t('cancel')}
            </button>
            <button
              className="mm_btn danger"
              onClick={onConfirm}
              disabled={busy}
              data-pending={busy ? 'true' : undefined}
              aria-busy={busy}
            >
              {t('delete')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
