/**
 * The wire contract between the two halves of the plugin.
 *
 * The host projects its runtime state into these shapes and serializes them
 * over `/mcp-manager/api/*`; the browser half renders exactly these shapes.
 * They live outside both `src/host` and `src/client` because each half used to
 * declare its own copy — with the client quietly widening `status` to `string`,
 * so nothing caught a host-side status the UI had no label for.
 *
 * Type-only by design: the browser bundle is a single CommonJS script with no
 * module resolver, and `import type` is erased before bundling, so nothing here
 * reaches any emitted code.
 */

export type ServerType = 'http' | 'stdio'
export type AuthMode = 'oauth' | 'static' | 'none'
export type EnvMap = Record<string, string>

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

/** A global-tier server as `GET /servers` reports it. */
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

/** A workspace-tier server as `GET /workspaces` reports it. */
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

export interface SettingsView {
  onDemandToolInjection: boolean
}

/**
 * Stable refusal codes of `POST /sessions/delete`. The browser half shows the
 * host's own message and uses the code only to decide whether offering the
 * action again could ever succeed.
 */
export type SessionDeleteRefusal =
  /** No live or stored session carries that id. */
  | 'session/not-found'
  /** The session's agent is mid-turn; deleting under it would race its writes. */
  | 'session/running'
  /** Subagent sessions belong to their parent's catalog and are not deletable on their own. */
  | 'session/subagent'
  /** This deployment mounts no session persistence backend to delete from. */
  | 'session/unavailable'
  /**
   * The session is still attached to this harness and no archive set is
   * mounted to hide it from the session list. Deleting its data now would
   * leave a listed session whose log is gone, so the delete refuses instead.
   */
  | 'session/attached'

/** Successful deletion receipt from `POST /sessions/delete`. */
export interface SessionDeleteReceipt {
  deleted: true
  sessionId: string
  /**
   * Whether the session was still attached to the running harness. Its durable
   * data is gone either way; `true` additionally means the archive set hides
   * the in-memory session from every listing surface until the process exits.
   */
  live: boolean
  /** Whether the durable archive set accepted the id (the hiding half of the delete). */
  archived: boolean
  /** Absolute directories removed from disk, in the order they were resolved. */
  removed: string[]
}

/** Measured disk footprint of one store the delete would remove. */
export interface SessionStoreFootprint {
  /** Absolute path on the harness host. */
  path: string
  bytes: number
  /** Files inside the path (a single-file store counts as 1). */
  files: number
}

/**
 * What `GET /sessions/preview` reports about one session: its identity, and the
 * disk footprint the delete would remove. The numbers come from the same path
 * resolution the delete uses, so the dialog shows what will actually go —
 * nothing is estimated.
 */
export interface SessionPreview {
  sessionId: string
  /** The session's project directory (its `cwd`), when the header carries one. */
  cwd?: string
  /** Session creation instant, epoch milliseconds. */
  createdAt?: number
  /** The session's own directory: log generations, write lock, session-local files. */
  log?: SessionStoreFootprint
  /** Projection-cache documents derived from this session (titles, stats, inbox). */
  cache?: SessionStoreFootprint
  /** The session's spilled tool-output directory. */
  spill?: SessionStoreFootprint
  /** Sum of the footprints above, in bytes. */
  totalBytes: number
}
