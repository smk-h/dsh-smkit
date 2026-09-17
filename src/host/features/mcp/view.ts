/**
 * Projection of a server config into the settings-UI view shape.
 *
 * Both tiers fill the same transport fields onto their own view type; keeping
 * one copy means a field added to the contract cannot land in one tier's rows
 * and silently miss the other. `authMode` is deliberately left to the caller:
 * the global view keeps it optional, the workspace view requires it. The tool
 * list is shared for the same reason: both tiers derive it from their raw
 * `tools/list` snapshot, so the two rows cannot disagree about what a tool is.
 */

import { MAX_DESCRIPTION_LENGTH } from './constants.js'
import { convParams } from './mcp/schema.js'
import type { McpToolInfo, ToolView } from './types.js'
import type { ServerView, WorkspaceServerView } from '../../../shared/mcp/contract.js'
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

/**
 * Project one server's `tools/list` snapshot into the list the settings page
 * renders.
 *
 * The description is capped at the same length the registry caps the
 * model-facing copy at: it is the one field here the server controls the size
 * of, and the list rides the settings page's 3-second poll.
 */
export function toolViews(tools: readonly McpToolInfo[]): ToolView[] {
  return tools.map((tool) => ({
    name: tool.name,
    description:
      typeof tool.description === 'string' ? tool.description.slice(0, MAX_DESCRIPTION_LENGTH) : '',
    parameters: convParams(tool.inputSchema),
  }))
}
