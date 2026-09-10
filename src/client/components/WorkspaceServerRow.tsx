/**
 * One workspace-tier server row.
 *
 * Deliberately different from `ServerRow`: a workspace server is declared in
 * `<workspace>/.dsh/dshmm/mcp.json` rather than enabled per profile, so there is
 * no switch here — the row is always "on", and deleting it removes the entry
 * from that file.
 */

import type { ClientDeps, Translator, WorkspaceServerView } from '../types'

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

  return function WorkspaceServerRow({
    t,
    server,
    workspacePath,
    onChanged,
    onEdit,
  }: WorkspaceServerRowProps): JSX.Element {
    const [busy, setBusy] = react.useState(false)
    const [error, setError] = react.useState('')
    const [confirming, setConfirming] = react.useState(false)

    const startAuth = async (): Promise<void> => {
      setBusy(true)
      setError('')
      try {
        const r = await api('/workspaces/auth', {
          method: 'POST',
          body: JSON.stringify({ path: workspacePath, name: server.name }),
        })
        if (r.ok && r.body.authorizeUrl) window.open(r.body.authorizeUrl, '_blank')
        else setError(r.body.error || t('authFailed', { status: r.status }))
      } catch (e) {
        setError(String(e))
      }
      setBusy(false)
    }

    const remove = async (): Promise<void> => {
      setConfirming(false)
      setBusy(true)
      setError('')
      try {
        const r = await api('/workspaces/servers/delete', {
          method: 'POST',
          body: JSON.stringify({ path: workspacePath, name: server.name }),
        })
        if (!r.ok) setError(r.body.error || t('deleteFailed', { status: r.status }))
        onChanged()
      } catch (e) {
        setError(String(e))
      }
      setBusy(false)
    }

    // Runtime-only operations on the live connection, addressed by the row's
    // globally unique id. Hidden for `configured`/`conflict` rows: those have
    // no live instance to restart or stop (the workspace was never opened).
    const runtimeOp = async (action: 'restart' | 'stop'): Promise<void> => {
      setBusy(true)
      setError('')
      try {
        const r = await api(`/servers/${server.id}/${action}`, { method: 'POST' })
        if (!r.ok) {
          setError(r.body.error || t(action === 'restart' ? 'restartFailed' : 'stopFailed', { status: r.status }))
        }
        onChanged()
      } catch (e) {
        setError(String(e))
      }
      setBusy(false)
    }
    const hasLiveInstance = server.status !== 'configured' && server.status !== 'conflict'

    return (
      <div className="mm_row" key={server.name}>
        <div className="mm_rowHead">
          <span className="mm_name">{server.name}</span>
          <span className={`mm_statusDot ${server.status}`} aria-hidden="true" />
          <span className={`mm_badge ${server.status}`}>{t(server.status)}</span>
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
        <div className="mm_url">
          {server.type === 'stdio'
            ? `stdio · ${server.command} ${(server.args || []).join(' ')}`
            : `${server.authMode === 'oauth' ? 'OAuth' : t('staticToken')} · ${server.url}`}
        </div>
        {server.status === 'connected' ? (
          <div className="mm_meta">{t('toolCount', { count: server.toolCount })}</div>
        ) : null}
        {server.error ? <div className="mm_err">{server.error}</div> : null}
        {error ? <div className="mm_err">{error}</div> : null}
        {confirming ? (
          <div className="mm_overlay" onClick={() => setConfirming(false)}>
            <div className="mm_dialog" onClick={(e) => e.stopPropagation()}>
              <div className="mm_dialogTitle">{t('deleteWorkspaceServer')}</div>
              <div className="mm_dialogBody">{t('confirmWorkspaceDelete', { name: server.name })}</div>
              <div className="mm_dialogActions">
                <button className="mm_btn" onClick={() => setConfirming(false)} disabled={busy}>
                  {t('cancel')}
                </button>
                <button className="mm_btn danger" onClick={remove} disabled={busy}>
                  {busy ? '…' : t('delete')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }
}
