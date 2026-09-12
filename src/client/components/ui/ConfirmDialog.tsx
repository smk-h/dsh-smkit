/**
 * The delete-confirmation overlay shared by the global and workspace rows.
 *
 * The title and body arrive already translated, so the same dialog serves both
 * tiers without knowing which one it belongs to; the confirm button shows the
 * busy ellipsis while the delete request is in flight.
 */

import type { ClientDeps, Translator } from '../../runtime/types'

export interface ConfirmDialogProps {
  t: Translator
  title: string
  body: string
  busy: boolean
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
    onCancel,
    onConfirm,
  }: ConfirmDialogProps): JSX.Element {
    return (
      <div className="mm_overlay" onClick={onCancel}>
        <div className="mm_dialog" onClick={(e) => e.stopPropagation()}>
          <div className="mm_dialogTitle">{title}</div>
          <div className="mm_dialogBody">{body}</div>
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
