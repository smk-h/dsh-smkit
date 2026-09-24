/**
 * One global server as seen from inside a workspace: the same status pills, plus
 * the `hide` checkbox that writes the server name into that workspace's
 * `exclude` list (which masks its global tools for agents in that workspace).
 */

import { createStatusBadge, createStatusDot } from '../ui/StatusPill'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { ServerView } from '../types'

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
  const StatusDot = createStatusDot(deps)
  const StatusBadge = createStatusBadge(deps)

  return function GlobalMaskRow({
    t,
    server,
    excluded,
    onToggleExclude,
    onEdit,
    busy,
  }: GlobalMaskRowProps): JSX.Element {
    return (
      <div className="smkit-mcp-workspace-ws-server" key={server.id}>
        <StatusDot status={server.status} />
        <span className="smkit-ui-disclosure-card-name">{server.name}</span>
        <StatusBadge t={t} status={server.status} />
        <label className="smkit-mcp-workspace-ws-check">
          <input
            type="checkbox"
            checked={excluded}
            disabled={busy}
            onChange={(e) => onToggleExclude(server.name, e.target.checked)}
          />
          <span>{t('hide')}</span>
        </label>
        <button className="smkit-ui-button" onClick={onEdit} disabled={busy}>
          {t('edit')}
        </button>
      </div>
    )
  }
}
