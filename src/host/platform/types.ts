/**
 * Structural slices of the DSH host services this plugin touches.
 *
 * Everything here is host vocabulary, never a business type: MCP's own domain
 * (`ServerConfig`, `McpHandle`, the workspace view models) lives with the
 * feature that owns it, and that module re-exports this one so a feature module
 * keeps a single `types.js` import site.
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

/** Any content block: projectors narrow it, so the tail is open. */
export type ContentBlock = TextBlock | DshImageBlock | { type: string; [key: string]: unknown }

/**
 * `image` callback signature used by `projectMcpContent`. The block arrives as
 * an untrusted record (the server controls its shape), so projectors only read
 * `mimeType` off it.
 */
export type ImageProjector = (block: Record<string, unknown>, index: number) => ContentBlock

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
 * expose a service directly on the context. The composition root casts the real
 * Cordis context into this shape once.
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

/** One outbound response, read as text (the MCP and OAuth callers parse it). */
export interface HttpTextResponse {
  status: number
  headers: Headers
  text: string
}
