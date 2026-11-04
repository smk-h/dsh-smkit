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
 *
 * `confirmLabel` and `danger` are the two things a non-destructive caller — the
 * update prompt — has to change to stop the dialog from reading as a delete:
 * the word it names its own action with, and the ink that action wears.
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
  /**
   * The confirm button's word. Defaults to the platform's own "delete", which
   * is what every destructive caller wants; a caller doing something else names
   * its own action instead of borrowing the wrong verb.
   */
  confirmLabel?: string
  /**
   * Paint the confirm button as destructive (the default) or as the primary
   * action. The update prompt is the second: installing a version is not a
   * removal, and a red button would ask the user to fear it.
   */
  danger?: boolean
  /**
   * The dismiss button's word. Defaults to the platform's "cancel", which is
   * right for a caller that is deciding something; a caller that is only
   * showing a result wants "close" instead.
   */
  cancelLabel?: string
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
    confirmLabel,
    danger = true,
    cancelLabel,
    onCancel,
    onConfirm,
  }: ConfirmDialogProps): JSX.Element {
    return (
      <div className="smkit-ui-dialog-overlay" onClick={onCancel}>
        <div
          className={details === undefined || details === null ? 'smkit-ui-dialog' : 'smkit-ui-dialog smkit-ui-dialog-wide'}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="smkit-ui-dialog-title">{title}</div>
          <div className="smkit-ui-dialog-body">{body}</div>
          {details}
          {error ? <div className="smkit-ui-field-error">{error}</div> : null}
          <div className="smkit-ui-dialog-actions">
            <button className="smkit-ui-button" onClick={onCancel} disabled={busy}>
              {cancelLabel ?? platformT('cancel')}
            </button>
            <button
              className={danger ? 'smkit-ui-button danger' : 'smkit-ui-button primary'}
              onClick={onConfirm}
              disabled={busy || confirmDisabled === true}
              data-smkit-pending={busy ? 'true' : undefined}
              aria-busy={busy}
            >
              {confirmLabel ?? platformT('delete')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
