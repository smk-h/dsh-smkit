/**
 * The types the debug page works with.
 *
 * The wire shapes are the MCP feature's own contract, re-exported so the page
 * keeps one import site: it reads the very `GET /servers` and `GET /workspaces`
 * answers the settings page reads, because the two surfaces must never disagree
 * about which tools a server has.
 *
 * `DebugServer` is the one addition. The two tiers answer in two shapes
 * (`ServerView` carries `enabled`, `WorkspaceServerView` carries `authMode` and
 * `source`), and the page's three columns care about neither difference — they
 * ask "what is this, is it up, what tools does it have". Flattening once here
 * keeps every column free of tier branching.
 */

import type {
  AuthMode,
  EnvMap,
  ServerInfoView,
  ServerStatus,
  ServerType,
  ToolView,
} from '../../../shared/mcp/contract'

export type {
  DebugCallResponse,
  DebugNotificationView,
  EnvMap,
  ServerInfoView,
  ServerView,
  ServerStatus,
  ServerType,
  SettingsView,
  ToolView,
  WorkspaceServerView,
  WorkspaceView,
} from '../../../shared/mcp/contract'

/** One server of either tier, as the page lists it. */
export interface DebugServer {
  /** Globally unique; the address of both the call route and the notification ring. */
  id: string
  name: string
  type: ServerType
  status: ServerStatus
  authMode?: AuthMode | ''
  /** The transport's own facts, printed under the server row. */
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  env?: EnvMap
  /** What the server called itself at handshake time. */
  serverInfo?: ServerInfoView
  tools: ToolView[]
  error: string
  /** The group this server sits in: `global` for the profile tier, else its workspace path. */
  scope: string
}

/** One column-1 group: the global tier, or one workspace. */
export interface DebugGroup {
  /** What the group's heading says: the last path segment, or the literal scope. */
  label: string
  /** The workspace path, or `''` for the global tier. */
  path: string
  servers: DebugServer[]
}

/**
 * What the result pane shows: always an answer the host produced.
 *
 * A refusal the page makes itself (a missing required parameter, a number field
 * that is not a number) never gets here — it is marked on the field that caused
 * it, and no request leaves the browser. `error` is the transport's or the
 * server's own message, shown verbatim in whatever language it came in.
 */
export interface CallOutcome {
  ok: boolean
  durationMs: number
  result?: unknown
  error?: string
}

/** One past call, kept for the session so a reader can go back to an answer. */
export interface HistoryRow extends CallOutcome {
  /** Unique within the page's lifetime; also the row's React key. */
  id: number
  /** The raw tool name the call was made with. */
  tool: string
  /** Epoch milliseconds. */
  at: number
}
