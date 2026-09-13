/**
 * One global-tier server card: a clickable header (name + status dot + badge +
 * chevron) that expands into transport details, the enable/disable switch and
 * the auth/edit/delete actions, plus the delete confirmation overlay.
 */

import { createChevronDownIcon } from '../icons/ChevronDownIcon'
import { createConfirmDialog } from '../../../platform/ui/ConfirmDialog'
import { serverDetails } from '../ui/ServerDetails'
import { createStatusBadge, createStatusDot } from '../ui/StatusPill'
import { createSwitch } from '../ui/Switch'
import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { ServerView } from '../types'

export interface ServerRowProps {
  t: Translator
  server: ServerView
  onChanged(): void
  /** Preview a status for this server until the next poll confirms it: an
   * action calls this with the intermediate status so the row's pills spin
   * from the click rather than from whenever the poll samples the host. */
  onStatusPreview(id: string, status: string): void
  onEdit(): void
  open: boolean
  onToggle(): void
}

export function createServerRow(deps: ClientDeps): (props: ServerRowProps) => JSX.Element {
  const { h, react, api } = deps
  const StatusDot = createStatusDot(deps)
  const StatusBadge = createStatusBadge(deps)
  const Switch = createSwitch(deps)
  const ConfirmDialog = createConfirmDialog(deps)
  const ChevronDownIcon = createChevronDownIcon(deps)

  return function ServerRow({
    t,
    server,
    onChanged,
    onStatusPreview,
    onEdit,
    open,
    onToggle,
  }: ServerRowProps): JSX.Element {
    const { busy, pending, error, run } = useAsyncAction(react)
    const [confirming, setConfirming] = react.useState(false)

    const startAuth = (): Promise<void> =>
      run(async () => {
        onStatusPreview(server.id, 'authorizing')
        const r = await api(`/servers/${server.id}/auth`, { method: 'POST' })
        if (r.ok && r.body.authorizeUrl) {
          window.open(r.body.authorizeUrl, '_blank')
          return
        }
        return r.body.error || t('authFailed', { status: r.status })
      }, 'auth')

    const remove = (): Promise<void> => {
      setConfirming(false)
      return run(async () => {
        const r = await api(`/servers/${server.id}`, { method: 'DELETE' })
        onChanged()
        return r.ok ? undefined : r.body.error || t('deleteFailed', { status: r.status })
      })
    }

    const askRemove = (): void => setConfirming(true)

    // Runtime-only operations: config and the enabled flag are untouched, so a
    // restart is "disconnect, then connect (or just connect when idle)" and a
    // stop simply drops the live transport. The pills preview the intermediate
    // status at click time; the request's own `onChanged` refresh settles them.
    const restart = (): Promise<void> =>
      run(async () => {
        onStatusPreview(server.id, 'connecting')
        const r = await api(`/servers/${server.id}/restart`, { method: 'POST' })
        onChanged()
        return r.ok ? undefined : r.body.error || t('restartFailed', { status: r.status })
      }, 'restart')

    const stop = (): Promise<void> =>
      run(async () => {
        onStatusPreview(server.id, 'disconnected')
        const r = await api(`/servers/${server.id}/stop`, { method: 'POST' })
        onChanged()
        return r.ok ? undefined : r.body.error || t('stopFailed', { status: r.status })
      }, 'stop')

    // Same reasoning as WorkspaceServerRow: the wait happens in the browser, and
    // `pending` only covers the request itself, so the button's pending state
    // follows the `authorizing` status too. Without that it turns clickable again
    // as soon as the request returns, and a second click opens another tab and
    // supersedes the flow already in progress.
    const authorizing = server.status === 'authorizing'

    const toggleEnabled = (): Promise<void> =>
      run(async () => {
        const enabling = server.enabled === false
        onStatusPreview(server.id, enabling ? 'connecting' : 'disabled')
        const r = await api(`/servers/${server.id}/enabled`, {
          method: 'POST',
          body: JSON.stringify({ enabled: enabling }),
        })
        onChanged()
        return r.ok
          ? undefined
          : r.body.error || t(enabling ? 'enableFailed' : 'disableFailed', { status: r.status })
      })

    return (
      <div className="mm_row" key={server.id} data-open={open ? 'true' : undefined}>
        <button
          className="mm_cardContent"
          type="button"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="mm_name">{server.name}</span>
          <span className="mm_cardTrailing">
            <StatusDot status={server.status} />
            <StatusBadge t={t} status={server.status} />
            <span className="mm_chevron" data-open={open ? 'true' : undefined}>
              <ChevronDownIcon size={12} />
            </span>
          </span>
        </button>
        {open ? (
          <div className="mm_details">
            {serverDetails(deps, { t, server, status: server.status })}
            {error ? <div className="mm_err">{error}</div> : null}
            <div className="mm_cardActions">
              <Switch
                on={server.enabled !== false}
                text={server.enabled !== false ? t('disable') : t('enable')}
                busy={busy}
                onToggle={toggleEnabled}
              />
              <span className="mm_actionBtns">
                {server.enabled !== false ? (
                  <button
                    className="mm_btn"
                    onClick={restart}
                    disabled={busy}
                    data-pending={pending === 'restart' ? 'true' : undefined}
                    aria-busy={pending === 'restart'}
                  >
                    {t('restart')}
                  </button>
                ) : null}
                {server.enabled !== false ? (
                  <button
                    className="mm_btn"
                    onClick={stop}
                    disabled={busy}
                    data-pending={pending === 'stop' ? 'true' : undefined}
                    aria-busy={pending === 'stop'}
                  >
                    {t('stop')}
                  </button>
                ) : null}
                {server.enabled !== false && server.authMode === 'oauth' ? (
                  <button
                    className="mm_btn"
                    onClick={startAuth}
                    disabled={busy || authorizing}
                    data-pending={pending === 'auth' || authorizing ? 'true' : undefined}
                    aria-busy={pending === 'auth' || authorizing}
                  >
                    {server.status === 'connected' ? t('reauth') : t('auth')}
                  </button>
                ) : null}
                <button className="mm_btn" onClick={onEdit} disabled={busy}>
                  {t('edit')}
                </button>
                <button className="mm_btn danger" onClick={askRemove} disabled={busy}>
                  {t('delete')}
                </button>
              </span>
            </div>
          </div>
        ) : null}
        {confirming ? (
          <ConfirmDialog
            title={t('deleteServer')}
            body={t('confirmDelete', { name: server.name })}
            busy={busy}
            onCancel={() => setConfirming(false)}
            onConfirm={remove}
          />
        ) : null}
      </div>
    )
  }
}
