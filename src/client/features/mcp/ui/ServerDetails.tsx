/**
 * The detail lines every expanded server row shows: the transport summary, the
 * tool list with its own disclosure (connected rows only) and the last
 * server-side error.
 *
 * A factory rather than a bare function because the tool list is a component
 * with its own open/hover state, and a component created during render — one
 * definition per row, per render — would remount (and so lose that state) on
 * every 3-second poll. Both rows build it once, like the other components they
 * compose.
 *
 * The returned array is spread as the row's own children instead of being
 * wrapped in an element on purpose — the lines are direct children of the row's
 * flex column, so an extra wrapper would change the layout. Keys are supplied
 * here because React requires them for arrays.
 */

import { createToolList } from './ToolList'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { ServerView, WorkspaceServerView } from '../types'

export interface ServerDetailsProps {
  t: Translator
  server: ServerView | WorkspaceServerView
  /** Status to render the status-dependent lines from. The rows pass the live
   * one (`server.status`, possibly previewing a transition), so the tool lines
   * track exactly what the pills show. */
  status?: string
}

export function createServerDetails(
  deps: ClientDeps,
): (props: ServerDetailsProps) => Array<JSX.Element | null> {
  const { h } = deps
  const ToolList = createToolList(deps)

  return function serverDetails({
    t,
    server,
    status = server.status,
  }: ServerDetailsProps): Array<JSX.Element | null> {
    return [
      <div className="smkit-mcp-card-url" key="transport">
        {server.type === 'stdio'
          ? `stdio · ${server.command} ${(server.args || []).join(' ')}`
          : `${server.authMode === 'oauth' ? 'OAuth' : server.authMode === 'none' ? t('noAuth') : t('staticToken')} · ${server.url}`}
      </div>,
      status === 'connected' ? <ToolList t={t} tools={server.tools} key="tools" /> : null,
      server.error ? (
        <div className="smkit-ui-field-error" key="error">
          {server.error}
        </div>
      ) : null,
    ]
  }
}
