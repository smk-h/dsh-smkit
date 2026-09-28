/**
 * The wire contract of the session-delete feature.
 *
 * The host projects what a delete would remove into these shapes and serializes
 * them over `/smkit/api/sessions/*`; the browser half renders exactly
 * these shapes.
 *
 * Type-only by design: the browser bundle is a single CommonJS script with no
 * module resolver, and `import type` is erased before bundling, so nothing here
 * reaches any emitted code. The MCP feature's contract lives in its own file
 * (`shared/mcp/contract.ts`); the two used to share one.
 */

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

/* ------------------------------------------------------------------ */
/* The session manager: one listing of everything deletable, and the   */
/* batch form of the delete above. Same domain, one more transport     */
/* shape each.                                                         */

/** One workspace row of the manager list, in the registry's own order. */
export interface ManagedWorkspaceView {
  workspaceId: string
  /** Absolute directory the workspace owns. */
  path: string
  /** The display title the harness stores for the workspace. */
  title: string
}

/**
 * One session row of the manager list. The same population the sidebar's
 * workspace groups show — attached and persisted sessions minus subagent
 * children and blank placeholders — split by the archive set on the client.
 */
export interface ManagedSessionView {
  sessionId: string
  /** The projection cache's title, when the session earned one. */
  title?: string
  /** The session's project directory, when the header carries one. */
  cwd?: string
  /**
   * The workspace whose accounting holds this session. Absent for the
   * ungrouped population: sessions no workspace claims.
   */
  workspaceId?: string
  /** Whether the harness currently holds this session in memory. */
  live: boolean
  /** Whether the session's agent is mid-turn (the delete refuses these). */
  running: boolean
  /** Session creation instant, epoch milliseconds. */
  createdAt?: number
  /** Last user prompt instant, epoch milliseconds, when the projection cache knows one. */
  lastPromptAt?: number
  /**
   * The current generation's log bytes, as the persistence snapshot reports
   * them. One file, not the whole session directory — the preview dialog
   * remains the precise tool; this number only ranks and roughly sums rows.
   */
  sizeBytes?: number
}

/** Response of `GET /sessions/manager`. */
export interface SessionManagerList {
  /** Registered workspaces, in registry order. */
  workspaces: ManagedWorkspaceView[]
  /** Every visible session, active and archived alike. */
  sessions: ManagedSessionView[]
  /** The registry-global archive set, as the sidebar hides by it. */
  archivedSessionIds: string[]
}

/** Per-session outcome inside a batch delete. */
export interface SessionBatchDeleteOutcome {
  sessionId: string
  ok: boolean
  /** Stable refusal code, when the delete refused this session. */
  code?: SessionDeleteRefusal
  /** The host's message for a refusal or failure; absent on success. */
  message?: string
}

/** Response of `POST /sessions/delete-batch`. HTTP 200 even when some deletes
 * refused: each session's outcome travels in `results`. */
export interface SessionBatchDeleteReceipt {
  results: SessionBatchDeleteOutcome[]
  deleted: number
  failed: number
}
