/**
 * The version pill's one action: "check for updates", and — when there is a
 * newer release — a dialog that hands over the command which installs it.
 *
 * Manual by design, and read-only by design. Nothing here runs on mount or on a
 * timer, the check only happens because the user pressed the button, and the
 * plugin never installs anything itself: updating writes into the profile and
 * needs the host restarted, so the gesture belongs in a terminal. What the
 * dialog adds over plain copy is the exact command — version included, profile
 * named — and one button to put it on the clipboard.
 *
 * The states the copy has to carry:
 *   - checking: a turning arc inside the button, so the wait is visible;
 *   - update available: the command, copyable, plus a note that a restart is
 *     what makes it take effect;
 *   - already latest: a line beside the pill;
 *   - the check failed (offline, registry down): a red line, not a silent no-op;
 *   - no command (the Desktop owns its own profile): the dialog says to update
 *     from the application's plugin page instead.
 */

import { createLoaderIcon } from '../../platform/icons/LoaderIcon'
import { createConfirmDialog } from '../../platform/ui/ConfirmDialog'
import type { ClientDeps, Translator } from '../../platform/types'
import type { UpdateCheckView } from '../../../shared/update/contract'

/** Put the command on the clipboard; false when the browser refuses. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function createUpdateControl(deps: ClientDeps, t: Translator): () => JSX.Element {
  const { h, react } = deps
  const ConfirmDialog = createConfirmDialog(deps)
  const Spinner = createLoaderIcon(deps)

  return function UpdateControl(): JSX.Element {
    const [checking, setChecking] = react.useState(false)
    const [note, setNote] = react.useState('')
    const [noteIsError, setNoteIsError] = react.useState(false)
    /** The newer release waiting to be read, or null when no dialog is open. */
    const [target, setTarget] = react.useState<UpdateCheckView | null>(null)
    const [copied, setCopied] = react.useState(false)
    const [copyFailed, setCopyFailed] = react.useState(false)

    const check = async (): Promise<void> => {
      if (checking) return
      setChecking(true)
      setNote('')
      setNoteIsError(false)
      try {
        const answer = await deps.api('/update/check')
        const body = answer.body as UpdateCheckView
        const latest = typeof body?.latest === 'string' ? body.latest : null
        if (!answer.ok || typeof body?.current !== 'string' || (latest === null && typeof body?.error === 'string')) {
          setNote(t('updateFailed'))
          setNoteIsError(true)
          return
        }
        if (body.hasUpdate && latest !== null) {
          setCopied(false)
          setCopyFailed(false)
          setTarget({ ...body, latest })
          return
        }
        setNote(t('updateLatest', { current: body.current }))
      } catch {
        setNote(t('updateFailed'))
        setNoteIsError(true)
      } finally {
        setChecking(false)
      }
    }

    const copy = async (): Promise<void> => {
      const command = target?.installCommand ?? ''
      if (command === '') return
      const ok = await copyText(command)
      setCopyFailed(!ok)
      setCopied(ok)
    }

    const command = target?.installCommand ?? ''
    return (
      <span className="smkit-shell-page-update">
        <button
          className="smkit-ui-button smkit-shell-page-update-check"
          type="button"
          disabled={checking}
          aria-busy={checking}
          onClick={() => void check()}
        >
          {checking ? <Spinner className="smkit-ui-spin" size={12} /> : null}
          {checking ? t('updateChecking') : t('updateCheck')}
        </button>
        {note === '' ? null : (
          <span className={noteIsError ? 'smkit-ui-field-error' : 'smkit-shell-page-update-note'}>{note}</span>
        )}
        {target === null ? null : (
          <ConfirmDialog
            title={t('updateTitle')}
            body={
              command === ''
                ? t('updateBodyNoCommand', { current: target.current, latest: target.latest ?? '' })
                : t('updateBody', { current: target.current, latest: target.latest ?? '' })
            }
            busy={false}
            confirmLabel={copied ? t('updateCopied') : t('updateCopy')}
            confirmDisabled={command === '' || copied}
            cancelLabel={t('updateClose')}
            danger={false}
            details={
              command === '' ? null : <code className="smkit-shell-page-update-command">{command}</code>
            }
            error={copyFailed ? t('updateCopyFailed') : undefined}
            onCancel={() => {
              setTarget(null)
              setCopied(false)
              setCopyFailed(false)
            }}
            onConfirm={() => void copy()}
          />
        )}
      </span>
    )
  }
}
