/**
 * The delete-confirmation overlay shared by the global rows, the workspace
 * rows, and the Session-header delete control.
 *
 * The title and body arrive already translated, so the same dialog serves every
 * caller without knowing which one it belongs to. The two buttons are the
 * dialog's own copy and read from the platform namespace (`deps.platformT`), so
 * a label every caller would otherwise repeat in its own dictionary exists
 * once. The confirm button shows the
 * busy ellipsis while the delete request is in flight. `error` is optional
 * because only the callers that keep the dialog open on failure need it: the
 * row deletes close immediately and report through the row, while the Session
 * delete has no row left to report into once the request comes back.
 * `details` is the same kind of optional extra: a caller that can say exactly
 * what it is about to remove passes the rendered facts, and the dialog widens to
 * give them room instead of squeezing paths into a 360px column.
 */

import type { ClientDeps } from '../types'

export interface ConfirmDialogProps {
  title: string
  body: string
  busy: boolean
  /** Rendered facts about the target, between the body and the buttons. */
  details?: unknown
  /** Failure text to show inside the dialog; absent means "nothing went wrong". */
  error?: string
  /**
   * Lock the confirm action without dressing it as pending: a caller whose
   * dry run already learned the action cannot succeed (e.g. the session is
   * still running) keeps the dialog open as an explanation, not as a trap.
   */
  confirmDisabled?: boolean
  onCancel(): void
  onConfirm(): void
}

export function createConfirmDialog(deps: ClientDeps): (props: ConfirmDialogProps) => JSX.Element {
  const { h, platformT } = deps

  return function ConfirmDialog({
    title,
    body,
    busy,
    details,
    error,
    confirmDisabled,
    onCancel,
    onConfirm,
  }: ConfirmDialogProps): JSX.Element {
    return (
      <div className="mm_overlay" onClick={onCancel}>
        <div
          className={details === undefined || details === null ? 'mm_dialog' : 'mm_dialog mm_dialogWide'}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mm_dialogTitle">{title}</div>
          <div className="mm_dialogBody">{body}</div>
          {details}
          {error ? <div className="mm_err">{error}</div> : null}
          <div className="mm_dialogActions">
            <button className="mm_btn" onClick={onCancel} disabled={busy}>
              {platformT('cancel')}
            </button>
            <button
              className="mm_btn danger"
              onClick={onConfirm}
              disabled={busy || confirmDisabled === true}
              data-pending={busy ? 'true' : undefined}
              aria-busy={busy}
            >
              {platformT('delete')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
