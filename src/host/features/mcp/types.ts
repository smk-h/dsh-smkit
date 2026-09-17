/**
 * The MCP feature's domain types.
 *
 * The host-facing slices this feature also needs (the tool registry, the agent
 * view, HTTP shapes) are re-exported from the platform layer, so every module
 * inside the feature keeps the single `types.js` import site it had before the
 * split. The wire contract shared with the browser half is re-exported too, for
 * the same reason.
 */

export * from '../../platform/types.js'

import type { AuthMode, EnvMap, ServerStatus, ServerType } from '../../../shared/mcp/contract.js'
import type { AgentLike, ToolDefinition } from '../../platform/types.js'

/*
 * The wire contract shared with the browser half (`shared/mcp/contract.ts`).
 * Re-exported so every module of this feature keeps importing these names from
 * `./types.js`, and `src/index.ts` keeps publishing them.
 */
export type {
  AuthMode,
  EnvMap,
  ServerStatus,
  ServerType,
  ServerView,
  SettingsView,
  WorkspaceServerView,
  WorkspaceView,
} from '../../../shared/mcp/contract.js'

/* ------------------------------------------------------------------ content */

/** An image block exactly as it arrives from an MCP server (untrusted). */
export interface McpImageBlock {
  type: 'image'
  data: string
  mimeType?: string
  [key: string]: unknown
}

/* ------------------------------------------------------------- server config */

export interface OAuthTokens {
  access_token: string
  refresh_token: string
  expires_at: number
}

/** OAuth client registration + tokens for one server. */
export interface OAuthState {
  issuer?: string
  clientId?: string
  redirect?: string
  tokens?: OAuthTokens
}

/** One MCP server, in either the global tier or the workspace tier. */
export interface ServerConfig {
  id: string
  name: string
  type?: ServerType
  /** Global tier only: `false` keeps config + tokens but drops the connection. */
  enabled?: boolean
  /** HTTP transport. */
  url?: string
  authMode?: AuthMode
  tokenEnv?: string
  headers?: EnvMap
  headerEnv?: EnvMap
  /** Legacy ≤0.3.0 plaintext bearer token; honoured, then dropped on re-save. */
  staticToken?: string
  oauth?: OAuthState
  /** stdio transport. */
  command?: string
  args?: string[]
  env?: EnvMap
  cwd?: string
  /** Set on workspace-tier servers: canonical workspace path. */
  wsPath?: string
}

/** Per-workspace OAuth slot in the sensitive state file. */
export interface WorkspaceTokenSlot {
  oauth?: OAuthState
}

/** Shape of `~/.dsh/mcp-manager.json`. */
export interface PluginState {
  servers: ServerConfig[]
  workspaceTokens: Record<string, WorkspaceTokenSlot>
  onDemandToolInjection: boolean
  /**
   * Global `tools/call` timeout in milliseconds. Absent — or a value outside the
   * bounds — means the built-in default; `initialize` / `tools/list` never read
   * it (they keep the fixed connect-phase timeout).
   */
  toolCallTimeoutMs?: number
  /** Legacy keys (e.g. `language`) are preserved verbatim but never read. */
  [key: string]: unknown
}

/* --------------------------------------------------------------- MCP wire */

export interface RpcErrorShape {
  code?: number
  message?: string
  data?: unknown
}

export interface RpcMessage {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: RpcErrorShape
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface McpListToolsResult {
  tools?: McpToolInfo[]
  nextCursor?: string
}

export interface McpContentItem {
  type?: string
  text?: string
  data?: string
  mimeType?: string
  name?: string
  uri?: string
  [key: string]: unknown
}

export interface McpCallResult {
  content?: McpContentItem[]
  isError?: boolean
  [key: string]: unknown
}

/** One live MCP transport (HTTP or stdio), shared by both scoping tiers. */
export interface McpHandle {
  kind: ServerType
  sessionId: string | null
  transport: StdioTransport | null
  tools: McpToolInfo[]
  closed: boolean
  onNotification: ((message: RpcMessage) => void) | null
  notificationStarted?: boolean
  notificationController?: AbortController | null
  /** `timeoutMs` overrides the transport default (the settings-paged tool timeout). */
  call(name: string, args: unknown, timeoutMs?: number): Promise<McpCallResult>
  listTools(cursor?: string): Promise<McpListToolsResult>
  startNotifications(): void
  close(): void
}

/** stdio child-process JSON-RPC channel. */
export interface StdioTransport {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>
  notify(method: string, params?: unknown): void
  close(): void
}

/* ------------------------------------------------------------ view models */

/** One registered MCP tool plus the signature used for stable refreshes. */
export interface RegisteredTool {
  definition: ToolDefinition
  signature: string
  dispose: () => void
}

/** Live status of one global-tier server, keyed by `server.id`. */
export interface LiveConnection {
  name?: string
  sessionId: string | null
  status: ServerStatus
  error: string
  toolCount: number
  tools: Map<string, RegisteredTool>
  handle: McpHandle | null
  transport: StdioTransport | null
}

/** Live status of one workspace-tier server. */
export interface WorkspaceConnection {
  server: ServerConfig
  handle: McpHandle | null
  status: ServerStatus
  error: string
  toolCount: number
  tools: McpToolInfo[]
  call(name: string, args: unknown): Promise<McpCallResult>
}

/** Runtime record for one canonical workspace path. */
export interface WorkspaceRuntime {
  path: string
  rawPath: string
  servers: Map<string, WorkspaceConnection>
  agents: Set<AgentLike>
  exclude: string[]
  watchStop: (() => void) | null
  watchTimer: ReturnType<typeof setTimeout> | null
  error: string
}

/** Per-agent scoping state: which workspace, which registrations, which mask. */
export interface AgentScopeState {
  wsPath: string
  disposers: Map<string, Map<string, RegisteredTool>>
  restrictDisposer?: () => void
  restrictKey?: string
}

/** Raw on-disk workspace config (`mcpServers` + `exclude`). */
export interface WorkspaceRawConfig {
  mcpServers?: Record<string, unknown>
  exclude?: unknown
  [key: string]: unknown
}

/** Parsed workspace config. */
export interface WorkspaceConfig {
  servers: ServerConfig[]
  exclude: string[]
  error: string
}

/* ------------------------------------------------------------------ broker */

/** One row of the broker search catalog. */
export interface ToolCatalogEntry {
  name: string
  server: string
  tool: string
  description: string
}

export interface ToolSearchMatch {
  name: string
  server: string
  tool: string
  description: string
  score: number
}

export interface ToolSearchResult {
  query: string
  total: number
  matches: ToolSearchMatch[]
}

export interface SearchTerm {
  term: string
  weight: number
}
