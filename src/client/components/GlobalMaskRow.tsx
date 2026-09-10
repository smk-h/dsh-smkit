/**
 * One global server as seen from inside a workspace: the same status pills, plus
 * the `hide` checkbox that writes the server name into that workspace's
 * `exclude` list (which masks its global tools for agents in that workspace).
 */

import type { ClientDeps, ServerView, Translator } from '../types'

export interface GlobalMaskRowProps {
  t: Translator
  server: ServerView
  excluded: boolean
  onToggleExclude(name: string, exclude: boolean): void
  onEdit(): void
  busy: boolean
}

export function createGlobalMaskRow(deps: ClientDeps): (props: GlobalMaskRowProps) => JSX.Element {
  const { h } = deps

  return function GlobalMaskRow({
    t,
    server,
    excluded,
    onToggleExclude,
    onEdit,
    busy,
  }: GlobalMaskRowProps): JSX.Element {
    return (
      <div className="mm_wsServer" key={server.id}>
        <span className={`mm_statusDot ${server.status}`} aria-hidden="true" />
        <span className="mm_name">{server.name}</span>
        <span className={`mm_badge ${server.status}`}>{t(server.status)}</span>
        <label className="mm_wsCheck">
          <input
            type="checkbox"
            checked={excluded}
            disabled={busy}
            onChange={(e) => onToggleExclude(server.name, e.target.checked)}
          />
          <span>{t('hide')}</span>
        </label>
        <button className="mm_btn" onClick={onEdit} disabled={busy}>
          {t('edit')}
        </button>
      </div>
    )
  }
}
