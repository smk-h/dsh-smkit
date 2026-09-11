/**
 * One global-tier server card: a clickable header (name + status dot + badge +
 * chevron) that expands into transport details, the enable/disable switch and
 * the auth/edit/delete actions, plus the delete confirmation overlay.
 */

import { createChevronDownIcon } from './icons/ChevronDownIcon'
import { createConfirmDialog } from './ui/ConfirmDialog'
import { serverDetails } from './ui/ServerDetails'
import { createStatusBadge, createStatusDot } from './ui/StatusPill'
import { createSwitch } from './ui/Switch'
import { useAsyncAction } from './ui/useAsyncAction'
import type { ClientDeps, ServerView, Translator } from '../runtime/types'

export interface ServerRowProps {
  t: Translator
  server: ServerView
  onChanged(): void
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
    onEdit,
    open,
    onToggle,
  }: ServerRowProps): JSX.Element {
    const { busy, error, run } = useAsyncAction(react)
    const [confirming, setConfirming] = react.useState(false)

    const startAuth = (): Promise<void> =>
      run(async () => {
        const r = await api(`/servers/${server.id}/auth`, { method: 'POST' })
        if (r.ok && r.body.authorizeUrl) {
          window.open(r.body.authorizeUrl, '_blank')
          return
        }
        return r.body.error || t('authFailed', { status: r.status })
      })

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
    // stop simply drops the live transport. The 3s poll picks up the new status.
    const restart = (): Promise<void> =>
      run(async () => {
        const r = await api(`/servers/${server.id}/restart`, { method: 'POST' })
        onChanged()
        return r.ok ? undefined : r.body.error || t('restartFailed', { status: r.status })
      })

    const stop = (): Promise<void> =>
      run(async () => {
        const r = await api(`/servers/${server.id}/stop`, { method: 'POST' })
        onChanged()
        return r.ok ? undefined : r.body.error || t('stopFailed', { status: r.status })
      })

    const toggleEnabled = (): Promise<void> =>
      run(async () => {
        const r = await api(`/servers/${server.id}/enabled`, {
          method: 'POST',
          body: JSON.stringify({ enabled: server.enabled === false }),
        })
        onChanged()
        return r.ok
          ? undefined
          : r.body.error ||
              t(server.enabled === false ? 'enableFailed' : 'disableFailed', { status: r.status })
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
            {serverDetails(deps, { t, server })}
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
                  <button className="mm_btn" onClick={restart} disabled={busy}>
                    {busy ? '…' : t('restart')}
                  </button>
                ) : null}
                {server.enabled !== false ? (
                  <button className="mm_btn" onClick={stop} disabled={busy}>
                    {busy ? '…' : t('stop')}
                  </button>
                ) : null}
                {server.enabled !== false && server.authMode === 'oauth' ? (
                  <button className="mm_btn" onClick={startAuth} disabled={busy}>
                    {busy ? '…' : server.status === 'connected' ? t('reauth') : t('auth')}
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
            t={t}
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
