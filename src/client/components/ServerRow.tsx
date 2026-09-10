/**
 * One global-tier server card: a clickable header (name + status dot + badge +
 * chevron) that expands into transport details, the enable/disable switch and
 * the auth/edit/delete actions, plus the delete confirmation overlay.
 */

import type { ClientDeps, ServerView, Translator } from '../types'

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

  return function ServerRow({
    t,
    server,
    onChanged,
    onEdit,
    open,
    onToggle,
  }: ServerRowProps): JSX.Element {
    const [busy, setBusy] = react.useState(false)
    const [error, setError] = react.useState('')
    const [confirming, setConfirming] = react.useState(false)

    const startAuth = async (): Promise<void> => {
      setBusy(true)
      setError('')
      try {
        const r = await api(`/servers/${server.id}/auth`, { method: 'POST' })
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
        const r = await api(`/servers/${server.id}`, { method: 'DELETE' })
        if (!r.ok) setError(r.body.error || t('deleteFailed', { status: r.status }))
        onChanged()
      } catch (e) {
        setError(String(e))
      }
      setBusy(false)
    }

    const askRemove = (): void => setConfirming(true)

    const toggleEnabled = async (): Promise<void> => {
      setBusy(true)
      setError('')
      try {
        const r = await api(`/servers/${server.id}/enabled`, {
          method: 'POST',
          body: JSON.stringify({ enabled: server.enabled === false }),
        })
        if (!r.ok) {
          setError(
            r.body.error ||
              t(server.enabled === false ? 'enableFailed' : 'disableFailed', { status: r.status }),
          )
        }
        onChanged()
      } catch (e) {
        setError(String(e))
      }
      setBusy(false)
    }

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
            <span className={`mm_statusDot ${server.status}`} aria-hidden="true" />
            <span className={`mm_badge ${server.status}`}>{t(server.status)}</span>
            <span className="mm_chevron" data-open={open ? 'true' : undefined}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M4 6l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </span>
        </button>
        {open ? (
          <div className="mm_details">
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
            <div className="mm_cardActions">
              <span className="mm_switchRow">
                <button
                  className="mm_switch"
                  type="button"
                  role="switch"
                  data-on={server.enabled !== false ? 'true' : undefined}
                  aria-checked={server.enabled !== false}
                  onClick={toggleEnabled}
                  disabled={busy}
                >
                  <span className="mm_switchThumb" />
                </button>
                <span className="mm_switchText">
                  {server.enabled !== false ? t('disable') : t('enable')}
                </span>
              </span>
              <span className="mm_actionBtns">
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
          <div className="mm_overlay" onClick={() => setConfirming(false)}>
            <div className="mm_dialog" onClick={(e) => e.stopPropagation()}>
              <div className="mm_dialogTitle">{t('deleteServer')}</div>
              <div className="mm_dialogBody">{t('confirmDelete', { name: server.name })}</div>
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
