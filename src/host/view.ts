/**
 * Projection of a server config into the settings-UI view shape.
 *
 * Both tiers fill the same transport fields onto their own view type; keeping
 * one copy means a field added to the contract cannot land in one tier's rows
 * and silently miss the other. `authMode` is deliberately left to the caller:
 * the global view keeps it optional, the workspace view requires it.
 */

import type { ServerView, WorkspaceServerView } from '../shared/contract.js'
import type { ServerConfig } from './types.js'

/** Fill the transport-specific fields of a view from its server config. */
export function applyTransportFields(
  view: ServerView | WorkspaceServerView,
  server: ServerConfig,
): void {
  if ((server.type ?? 'http') === 'stdio') {
    view.command = server.command
    view.args = server.args ?? []
    view.env = server.env ?? {}
    view.cwd = server.cwd ?? ''
    return
  }
  view.url = server.url
  view.headers = server.headers ?? {}
  view.headerEnv = server.headerEnv ?? {}
  if (server.authMode === 'static') view.tokenEnv = server.tokenEnv ?? ''
}
