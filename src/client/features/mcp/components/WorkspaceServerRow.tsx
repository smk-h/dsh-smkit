/**
 * One workspace-tier server row.
 *
 * Deliberately different from `ServerRow`: a workspace server is declared in
 * `<workspace>/.dsh/dshmm/mcp.json` rather than enabled per profile, so there is
 * no switch here — the row is always "on", and deleting it removes the entry
 * from that file.
 */

import { createConfirmDialog } from '../../../platform/ui/ConfirmDialog'
import { createServerDetails } from '../ui/ServerDetails'
import { createStatusBadge, createStatusDot } from '../ui/StatusPill'
import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { WorkspaceServerView } from '../types'

export interface WorkspaceServerRowProps {
  t: Translator
  server: WorkspaceServerView
  workspacePath: string
  onChanged(): void
  /** Preview a status for this server until the next poll confirms it (see
   * `ServerRowProps.onStatusPreview`). */
  onStatusPreview(id: string, status: string): void
  onEdit(): void
}

export function createWorkspaceServerRow(
  deps: ClientDeps,
): (props: WorkspaceServerRowProps) => JSX.Element {
  const { h, react, api } = deps
  const StatusDot = createStatusDot(deps)
  const StatusBadge = createStatusBadge(deps)
  const ConfirmDialog = createConfirmDialog(deps)
  const serverDetails = createServerDetails(deps)

  return function WorkspaceServerRow({
    t,
    server,
    workspacePath,
    onChanged,
    onStatusPreview,
    onEdit,
  }: WorkspaceServerRowProps): JSX.Element {
    const { busy, pending, error, run } = useAsyncAction(react)
    const [confirming, setConfirming] = react.useState(false)

    const startAuth = (): Promise<void> =>
      run(async () => {
        onStatusPreview(server.id, 'authorizing')
        const r = await api('/workspaces/auth', {
          method: 'POST',
          body: JSON.stringify({ path: workspacePath, name: server.name }),
        })
        if (r.ok && r.body.authorizeUrl) {
          window.open(r.body.authorizeUrl, '_blank')
          return
        }
        return r.body.error || t('authFailed', { status: r.status })
      }, 'auth')

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
    // The pills preview the intermediate status at click time; the request's
    // own `onChanged` refresh settles them.
    const runtimeOp = (action: 'restart' | 'stop'): Promise<void> =>
      run(async () => {
        onStatusPreview(server.id, action === 'restart' ? 'connecting' : 'disconnected')
        const r = await api(`/servers/${server.id}/${action}`, { method: 'POST' })
        onChanged()
        return r.ok
          ? undefined
          : r.body.error ||
              t(action === 'restart' ? 'restartFailed' : 'stopFailed', { status: r.status })
      }, action)
    const status = server.status
    const hasLiveInstance = status !== 'configured' && status !== 'conflict'
    // Authorizing spans a browser round trip: the request returns an authorizeUrl
    // almost immediately, and the wait then happens in the user's own tab until
    // the plugin's callback exchanges the code. So the button's pending state
    // follows this status as well — on `pending` alone it would look idle again
    // the moment the request returned, while the user is still in the tab.
    const authorizing = status === 'authorizing'
    // `authorizing` has to stay in this allow-list: missing it, the button unmounts
    // the instant it is clicked, so it vanishes instead of turning into the same
    // three dots a restart shows.
    const showAuth =
      server.authMode === 'oauth' &&
      (authorizing || status === 'needs-auth' || status === 'error' || status === 'connected')

    return (
      <div className="smkit-ui-disclosure-card" key={server.name}>
        <div className="smkit-mcp-card-row-head">
          <span className="smkit-ui-disclosure-card-name">{server.name}</span>
          <StatusDot status={status} />
          <StatusBadge t={t} status={status} />
          <span className="smkit-mcp-card-actions">
            {hasLiveInstance ? (
              <button
                className="smkit-ui-button"
                onClick={() => runtimeOp('restart')}
                disabled={busy}
                data-smkit-pending={pending === 'restart' ? 'true' : undefined}
                aria-busy={pending === 'restart'}
              >
                {t('restart')}
              </button>
            ) : null}
            {hasLiveInstance ? (
              <button
                className="smkit-ui-button"
                onClick={() => runtimeOp('stop')}
                disabled={busy}
                data-smkit-pending={pending === 'stop' ? 'true' : undefined}
                aria-busy={pending === 'stop'}
              >
                {t('stop')}
              </button>
            ) : null}
            {showAuth ? (
              <button
                className="smkit-ui-button"
                onClick={startAuth}
                disabled={busy || authorizing}
                data-smkit-pending={pending === 'auth' || authorizing ? 'true' : undefined}
                aria-busy={pending === 'auth' || authorizing}
              >
                {status === 'connected' ? t('reauth') : t('auth')}
              </button>
            ) : null}
            <button className="smkit-ui-button" onClick={onEdit} disabled={busy}>
              {t('edit')}
            </button>
            <button className="smkit-ui-button danger" onClick={() => setConfirming(true)} disabled={busy}>
              {t('delete')}
            </button>
          </span>
        </div>
        {serverDetails({ t, server, status })}
        {error ? <div className="smkit-ui-field-error">{error}</div> : null}
        {confirming ? (
          <ConfirmDialog
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
