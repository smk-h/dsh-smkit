/**
 * The detail lines every expanded server row shows: the transport summary, the
 * tool count (connected rows only) and the last server-side error.
 *
 * Returns an array instead of wrapping in an element on purpose — the lines are
 * direct children of the row's flex column, so an extra wrapper would change
 * the layout. Keys are supplied here because React requires them for arrays.
 */

import type { ClientDeps, Translator } from '../../../platform/types'
import type { ServerView, WorkspaceServerView } from '../types'

export interface ServerDetailsProps {
  t: Translator
  server: ServerView | WorkspaceServerView
  /** Status to render the status-dependent lines from. The rows pass the live
   * one (`server.status`, possibly previewing a transition), so the tool-count
   * line tracks exactly what the pills show. */
  status?: string
}

export function serverDetails(
  deps: ClientDeps,
  { t, server, status = server.status }: ServerDetailsProps,
): Array<JSX.Element | null> {
  const { h } = deps

  return [
    <div className="mm_url" key="transport">
      {server.type === 'stdio'
        ? `stdio · ${server.command} ${(server.args || []).join(' ')}`
        : `${server.authMode === 'oauth' ? 'OAuth' : server.authMode === 'none' ? t('noAuth') : t('staticToken')} · ${server.url}`}
    </div>,
    status === 'connected' ? (
      <div className="mm_meta" key="tools">
        {t('toolCount', { count: server.toolCount })}
      </div>
    ) : null,
    server.error ? (
      <div className="mm_err" key="error">
        {server.error}
      </div>
    ) : null,
  ]
}
