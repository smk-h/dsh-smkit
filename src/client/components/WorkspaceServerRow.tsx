/**
 * One workspace-tier server row.
 *
 * Deliberately different from `ServerRow`: a workspace server is declared in
 * `<workspace>/.dsh/dshmm/mcp.json` rather than enabled per profile, so there is
 * no switch here — the row is always "on", and deleting it removes the entry
 * from that file.
 */

import { createConfirmDialog } from './ui/ConfirmDialog'
import { serverDetails } from './ui/ServerDetails'
import { createStatusBadge, createStatusDot } from './ui/StatusPill'
import { useAsyncAction } from './ui/useAsyncAction'
import type { ClientDeps, Translator, WorkspaceServerView } from '../runtime/types'

export interface WorkspaceServerRowProps {
  t: Translator
  server: WorkspaceServerView
  workspacePath: string
  onChanged(): void
  onEdit(): void
}

export function createWorkspaceServerRow(
  deps: ClientDeps,
): (props: WorkspaceServerRowProps) => JSX.Element {
  const { h, react, api } = deps
  const StatusDot = createStatusDot(deps)
  const StatusBadge = createStatusBadge(deps)
  const ConfirmDialog = createConfirmDialog(deps)

  return function WorkspaceServerRow({
    t,
    server,
    workspacePath,
    onChanged,
    onEdit,
  }: WorkspaceServerRowProps): JSX.Element {
    const { busy, error, run } = useAsyncAction(react)
    const [confirming, setConfirming] = react.useState(false)

    const startAuth = (): Promise<void> =>
      run(async () => {
        const r = await api('/workspaces/auth', {
          method: 'POST',
          body: JSON.stringify({ path: workspacePath, name: server.name }),
        })
        if (r.ok && r.body.authorizeUrl) {
          window.open(r.body.authorizeUrl, '_blank')
          return
        }
        return r.body.error || t('authFailed', { status: r.status })
      })

    const remove = (): Promise<void> => {
      setConfirming(false)
      return run(async () => {
        const r = await api('/workspaces/servers/delete', {
          method: 'POST',
          body: JSON.stringify({ path: workspacePath, name: server.name }),
        })
        onChanged()
        return r.ok ? undefined : r.body.error || t('deleteFailed', { status: r.status })
      })
    }

    // Runtime-only operations on the live connection, addressed by the row's
    // globally unique id. Hidden for `configured`/`conflict` rows: those have
    // no live instance to restart or stop (the workspace was never opened).
    const runtimeOp = (action: 'restart' | 'stop'): Promise<void> =>
      run(async () => {
        const r = await api(`/servers/${server.id}/${action}`, { method: 'POST' })
        onChanged()
        return r.ok
          ? undefined
          : r.body.error ||
              t(action === 'restart' ? 'restartFailed' : 'stopFailed', { status: r.status })
      })
    const hasLiveInstance = server.status !== 'configured' && server.status !== 'conflict'

    return (
      <div className="mm_row" key={server.name}>
        <div className="mm_rowHead">
          <span className="mm_name">{server.name}</span>
          <StatusDot status={server.status} />
          <StatusBadge t={t} status={server.status} />
          <span className="mm_actions">
            {hasLiveInstance ? (
              <button className="mm_btn" onClick={() => runtimeOp('restart')} disabled={busy}>
                {busy ? '…' : t('restart')}
              </button>
            ) : null}
            {hasLiveInstance ? (
              <button className="mm_btn" onClick={() => runtimeOp('stop')} disabled={busy}>
                {busy ? '…' : t('stop')}
              </button>
            ) : null}
            {server.authMode === 'oauth' &&
            (server.status === 'needs-auth' || server.status === 'error' || server.status === 'connected') ? (
              <button className="mm_btn" onClick={startAuth} disabled={busy}>
                {busy ? '…' : server.status === 'connected' ? t('reauth') : t('auth')}
              </button>
            ) : null}
            <button className="mm_btn" onClick={onEdit} disabled={busy}>
              {t('edit')}
            </button>
            <button className="mm_btn danger" onClick={() => setConfirming(true)} disabled={busy}>
              {t('delete')}
            </button>
          </span>
        </div>
        {serverDetails(deps, { t, server })}
        {error ? <div className="mm_err">{error}</div> : null}
        {confirming ? (
          <ConfirmDialog
            t={t}
            title={t('deleteWorkspaceServer')}
            body={t('confirmWorkspaceDelete', { name: server.name })}
            busy={busy}
            onCancel={() => setConfirming(false)}
            onConfirm={remove}
          />
        ) : null}
      </div>
    )
  }
}
