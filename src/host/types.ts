/**
 * Domain types and the structural slices of DSH services this plugin touches.
 *
 * Everything DSH-facing is declared *structurally* (never by importing
 * `@deepseek-ai/*`), so the plugin keeps a single peer dependency and stays
 * testable against the stub contexts in `test/`.
 */

/** Structural slice of `ctx.logger`. Never `console.log` on the host half. */
export interface LoggerLike {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/* ------------------------------------------------------------------ content */

/** A text block as DSH stores it. */
export interface TextBlock {
  type: 'text'
  text: string
  [key: string]: unknown
}

/** An image block already admitted to durable storage. */
export interface DshImageBlock {
  type: 'image'
  attachment: DshImageAttachment
  [key: string]: unknown
}

/** The durable-attachment handle DSH history reads from. */
export interface DshImageAttachment {
  attachmentId: string
  mediaType: string
  bytes: number
  width?: number
  height?: number
}

/** An image block exactly as it arrives from an MCP server (untrusted). */
export interface McpImageBlock {
  type: 'image'
  data: string
  mimeType?: string
  [key: string]: unknown
}

/** Any content block: projectors narrow it, so the tail is open. */
export type ContentBlock = TextBlock | DshImageBlock | { type: string; [key: string]: unknown }

/**
 * `image` callback signature used by `projectMcpContent`. The block arrives as
 * an untrusted record (the server controls its shape), so projectors only read
 * `mimeType` off it.
 */
export type ImageProjector = (block: Record<string, unknown>, index: number) => ContentBlock

/* ------------------------------------------------------------- server config */

export type ServerType = 'http' | 'stdio'
export type AuthMode = 'oauth' | 'static'
export type EnvMap = Record<string, string>

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
  call(name: string, args: unknown): Promise<McpCallResult>
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

export interface HttpTextResponse {
  status: number
  headers: Headers
  text: string
}

/* ----------------------------------------------------------- DSH tool API */

export interface ToolExecContext {
  callId: string
  rootCallId?: string
  name?: string
  token?: unknown
  parent?: unknown
  agent: AgentLike
  signal?: AbortSignal
  arguments?: unknown
}

export interface ToolOutput {
  schema?: unknown
  render?: (args: unknown, value: never) => ContentBlock[]
}

export interface ToolDefinition {
  name: string
  description?: string
  parameters?: unknown
  output?: ToolOutput
  isConcurrencySafe?: () => boolean
  /** `args` is `unknown` because a model can send anything; implementations
   * narrow it themselves. */
  execute?: (args: unknown, exec: ToolExecContext) => Promise<unknown>
  finalizeContent?: (exec: unknown, result: ToolFinalizeResult) => ContentBlock[] | undefined
  /** Set on MCP-backed tools so the broker can recover `<server>`/`<tool>`. */
  mcpServerName?: string
  mcpRawName?: string
}

export interface ToolFinalizeResult {
  isError?: boolean
  value?: unknown
  content?: ContentBlock[]
}

export interface ToolSchemaView {
  name: string
  description?: string
  parameters?: unknown
}

/** Structural slice of `ctx.tools`. */
export interface ToolsRegistry {
  register(definition: ToolDefinition): () => void
  restrict(options: { deny: string[] }): () => void
  guard(check: (exec: ToolExecContext & { name: string }) => string | undefined): () => void
  schemas(agent?: AgentLike): ToolSchemaView[]
  get(name: string, agent?: AgentLike): ToolDefinition | undefined
  execute(call: ToolExecContext): Promise<{ isError?: boolean; error?: { message?: string }; content?: ContentBlock[] }>
}

/* ------------------------------------------------------------- agent slice */

export interface AgentSessionHeader {
  cwd?: string
}

export interface AgentSession {
  header?: AgentSessionHeader
  requestHeader?: () => { config?: { provider?: string; model?: string } } | undefined
}

/** Minimal structural view of a DSH Agent. Every field is optional: the
 * workspace tier is best-effort and must tolerate a bare `{}`. */
export interface AgentLike {
  ctx?: { tools: ToolsRegistry }
  session?: AgentSession
  options?: { provider?: string; model?: string }
}

/* ---------------------------------------------------------- service access */

/**
 * Structural view of optional DSH services.
 *
 * Resolution prefers `ctx.get(name)` and falls back to a property lookup, which
 * is what the reference implementation's `ctxGet` does — some harness builds
 * expose a service directly on the context. `plugin.ts` casts the real Cordis
 * context into this shape once, at the single composition point.
 */
export interface ServiceAccessor {
  get?(name: string): unknown
  [key: string]: unknown
}

/* ---------------------------------------------------------------- HTTP API */

export interface RequestLike {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>
}

export interface ResponseLike {
  writeHead(code: number, headers?: Record<string, string>): void
  end(chunk?: string): void
}

export interface RouteDefinition {
  kind: 'prefix'
  path: string
  handler(req: RequestLike, res: ResponseLike): Promise<void> | void
}

/** Structural slice of `ctx.webServer`. */
export interface WebServerLike {
  register(route: RouteDefinition): () => void
}

/** Structural slice of `ctx.locale` (host side only uses nothing; declared for
 * completeness of the client service list). */

/* ------------------------------------------------------------ view models */

export type ServerStatus =
  | 'connected'
  | 'needs-auth'
  | 'authorizing'
  | 'connecting'
  | 'error'
  | 'disconnected'
  | 'disabled'
  | 'conflict'
  | 'configured'

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

/** Server shape handed to the settings UI. */
export interface ServerView {
  id: string
  name: string
  type: ServerType
  enabled: boolean
  status: ServerStatus
  toolCount: number
  error: string
  command?: string
  args?: string[]
  env?: EnvMap
  cwd?: string
  url?: string
  authMode?: AuthMode | ''
  headers?: EnvMap
  headerEnv?: EnvMap
  tokenEnv?: string
}

/** Workspace server shape handed to the settings UI. */
export interface WorkspaceServerView {
  id: string
  name: string
  type: ServerType
  authMode: AuthMode | ''
  source: 'workspace'
  status: ServerStatus
  toolCount: number
  error: string
  command?: string
  args?: string[]
  env?: EnvMap
  cwd?: string
  url?: string
  headers?: EnvMap
  headerEnv?: EnvMap
  tokenEnv?: string
}

export interface WorkspaceView {
  path: string
  servers: WorkspaceServerView[]
  exclude: string[]
  error: string
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
