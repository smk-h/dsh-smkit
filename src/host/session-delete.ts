/**
 * Deleting one session for good: its log, its directory, its derived cache
 * row, and its row in every listing surface.
 *
 * ## What the harness does and does not offer
 *
 * The persistence seam (`ctx.sessionPersistence`) is append-only by design and
 * exposes `create`/`open`/`flush`/`stat`/`list` — there is no `delete`, and the
 * JSONL backend's README states plainly that it never removes session files.
 * The only session lifecycle the UI offers is *archive*
 * (`WorkspaceRegistry.archiveSession`), which writes the id into a
 * registry-global display set: the sidebar hides the row, the log stays where
 * it is. That is why "unwanted session" had no answer before this module.
 *
 * So the delete is composed from what does exist:
 *
 * 1. **refuse** the shapes a delete must not touch — an unknown id, a subagent
 *    child (its parent's catalog owns it), a session whose agent is mid-turn
 *    (its write path would keep appending to a directory we are about to
 *    remove), and an *attached* session whose deployment mounts no archive set
 *    (see step 3: without one, deleting the log would leave a listed session
 *    with nothing behind it);
 * 2. **archive** when the session is attached to this harness, so it disappears
 *    from the sidebar, the search results, and the workspace browser. A live
 *    session cannot be un-registered from the harness (`AgentRegistry.create`
 *    and `resume` hand the teardown capability to the caller, whose handle the
 *    session controller has already dropped), and `SessionCorpus.listSessions`
 *    merges every live session into `session.list` — without the archive set a
 *    deleted-but-live session would reappear as a zombie row on the next list
 *    pull. The archive entry is a durable tombstone; because the log is gone it
 *    can never resolve to a session again. A session that is *not* attached is
 *    not archived: deleting its artifacts already removes it from every
 *    listing, and a tombstone for it would be pure residue;
 * 3. **remove the artifact directory** — the whole `<root>/<projectKey>/<id>/`
 *    tree, not just the log file. Removing the directory is what makes the
 *    deletion stick: the backend's append path opens the log with `O_APPEND`
 *    and would silently recreate a header-less file inside a directory that
 *    still existed, poisoning the whole session listing;
 * 4. **drop the derived stores** that outlive the log: the projection-cache row
 *    (titles, stats, inbox, model selection) and the session's spilled
 *    tool-output directory, which the local spill backend names after the
 *    session id alone;
 * 5. **emit `api-session/removed`** on the harness event bus. That is the same
 *    event the session controller publishes when a session is disposed, and the
 *    browser reacts to it by dropping the sidebar row and masking the deleted
 *    session out of the current selection — the whole UI update is incremental,
 *    with no reload.
 *
 * ## What is deliberately left alone
 *
 * Image and file attachments live in ONE content-addressed store
 * (`<DSH_HOME>/attachments/v1/<hash>`): a blob is named by its own bytes and may
 * be referenced by several sessions, so removing "the session's attachments"
 * would break other sessions' history. The harness has no reference counting and
 * no attachment GC either, so this delete reports the session's own artifacts
 * rather than guessing which shared blobs it happened to be the last user of.
 *
 * The workspace registry keeps the id in its session accounting (`sessionIds`),
 * exactly as archiving does: that is an ordering slot, not session data, and it
 * is what the archive tombstone of an attached session lives beside.
 *
 * ## Path resolution
 *
 * The session's directory is resolved from the service that owns it, never
 * assumed: the backend's own `resolveCurrentLog(id)` first, then its configured
 * `root` plus the session's `cwd`, and only then the harness default
 * `$DSH_HOME/sessions` (see `session-path.ts`). Every candidate is verified —
 * it must be a real directory whose basename is the encoded session id and it
 * must sit inside a known root — before anything is removed.
 *
 * ## Preview
 *
 * `createSessionPreviewer` runs the delete's own preconditions as a dry run and
 * measures what each step would remove, so the confirmation dialog can show the
 * session's identity, where its data lives, and how much of it there is. Both
 * entry points share {@link inspectSession} and the same locators, which is what
 * keeps the dialog's numbers honest: nothing is estimated from a second code
 * path that could drift.
 */

import { createHash } from 'node:crypto'
import { readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { encodeSegment, sessionDir } from './session-path.js'
import { serviceOf } from './util/services.js'
import type {
  SessionDeleteRefusal,
  SessionDeleteReceipt,
  SessionPreview,
  SessionStoreFootprint,
} from '../shared/contract.js'
import type { LoggerLike, ServiceAccessor } from './types.js'

/** Longest session id accepted from the wire; far above any id the harness mints. */
const MAX_SESSION_ID_LENGTH = 200

/**
 * Projection-cache keys become path segments in the storage backend, which
 * accepts exactly this alphabet (`storage-json`'s `SAFE_KEY_RE`). A key
 * outside it was never written, so there is nothing to clean.
 */
const SAFE_STORAGE_KEY = /^[a-zA-Z0-9_-]+$/

/** The domain and table holding one projection-checkpoint document per session. */
const PROJECTION_UNIT = 'session_projcache'
const PROJECTION_TABLE = 'sessions'

/** One stored session's metadata, as the persistence service reports it. */
interface SessionHeaderLike {
  id?: unknown
  cwd?: unknown
  origin?: unknown
  /** Session creation instant, epoch milliseconds. */
  createdAt?: unknown
}

/** Structural slice of `ctx.sessionPersistence` (the JSONL backend in practice). */
interface PersistenceLike {
  /** The backend's configured session root, when it exposes one. */
  root?: unknown
  stat?(id: string, options?: { signal?: AbortSignal }): Promise<{ header?: SessionHeaderLike } | undefined>
  /** Concrete-backend helper returning the current-generation artifact path. */
  resolveCurrentLog?(id: string, signal?: AbortSignal): Promise<string | undefined>
}

/** Structural slice of `ctx.sessions`. */
interface SessionStoreLike {
  get?(id: string): { header?: SessionHeaderLike } | undefined
}

/** Structural slice of `ctx.agents`. */
interface AgentRegistryLike {
  get?(id: string): { status?: unknown } | undefined
}

/** Structural slice of `ctx.workspaceRegistry`. */
interface WorkspaceRegistryLike {
  archiveSession?(id: string): Promise<void>
}

/** Structural slice of the storage hub's json backend, which owns the storage root. */
interface StorageBackendLike {
  root?: unknown
}

/** Structural slice of `ctx.spillStore`: the local backend exposes its resolved root. */
interface SpillStoreLike {
  root?: unknown
}

export interface SessionDeleterDeps {
  /** The host context cast into the plugin's structural service view. */
  services: ServiceAccessor | null | undefined
  logger: LoggerLike
  /** Cordis `ctx.emit`; the client's incremental update rides `api-session/removed`. */
  emit?: (event: string, ...args: unknown[]) => void
  /** Harness home override; tests pin it instead of the process environment. */
  dshHome?: string
}

/** Outcome of one delete request: the receipt, or a stable refusal. */
export type SessionDeleteOutcome =
  | { ok: true; receipt: SessionDeleteReceipt }
  | { ok: false; code: SessionDeleteRefusal; message: string }

/** Outcome of one preview request: what would go, or the same refusals. */
export type SessionPreviewOutcome =
  | { ok: true; preview: SessionPreview }
  | { ok: false; code: SessionDeleteRefusal; message: string }

/** The delete operation the API layer calls. */
export type SessionDeleter = (sessionId: unknown) => Promise<SessionDeleteOutcome>

/** The dry run the delete dialog asks for before it offers to confirm. */
export type SessionPreviewer = (sessionId: unknown) => Promise<SessionPreviewOutcome>

/** One session resolved far enough to act on: its identity, header, and liveness. */
interface SessionTarget {
  /** The validated id every later step addresses. */
  readonly id: string
  readonly persistence: PersistenceLike
  readonly header: SessionHeaderLike
  /** Whether the harness currently holds this session in memory. */
  readonly live: boolean
  readonly cwd: string | undefined
}

/** The result of the preconditions both entry points share. */
type SessionInspection =
  | { ok: true; target: SessionTarget }
  | { ok: false; code: SessionDeleteRefusal; message: string }

/**
 * Resolve one session and apply the refusals a delete must not run past. The
 * delete and the preview both start here, so the dialog can never offer an
 * action the delete would then refuse for a reason it already knew.
 * @param deps - deleter dependencies.
 * @param sessionId - the id as received from the wire.
 * @returns the resolved target, or the refusal to report.
 */
async function inspectSession(deps: SessionDeleterDeps, sessionId: unknown): Promise<SessionInspection> {
  if (
    typeof sessionId !== 'string'
    || sessionId.length === 0
    || sessionId.length > MAX_SESSION_ID_LENGTH
    || sessionId.includes('\0')
  ) {
    return { ok: false, code: 'session/not-found', message: 'sessionId must be a non-empty session id' }
  }

  const persistence = serviceOf(deps.services, 'sessionPersistence') as PersistenceLike | undefined
  if (persistence === undefined) {
    return {
      ok: false,
      code: 'session/unavailable',
      message: 'this deployment mounts no session persistence backend, so there is no session data to delete',
    }
  }

  // A live session carries the authoritative header already; a cold one is read
  // from the backend without resuming its agent.
  const liveSession = (serviceOf(deps.services, 'sessions') as SessionStoreLike | undefined)?.get?.(sessionId)
  const header = liveSession?.header ?? await readHeader(persistence, sessionId, deps.logger)
  if (header === undefined) {
    return { ok: false, code: 'session/not-found', message: `session "${sessionId}" is not a live or stored session` }
  }
  if (header.origin === 'subagent') {
    return {
      ok: false,
      code: 'session/subagent',
      message: `session "${sessionId}" is a subagent child; delete its parent session instead`,
    }
  }
  const agents = serviceOf(deps.services, 'agents') as AgentRegistryLike | undefined
  if (agents?.get?.(sessionId)?.status === 'running') {
    return { ok: false, code: 'session/running', message: `session "${sessionId}" is running; stop it before deleting` }
  }

  // A detached session is complete once its artifacts are gone; an attached one
  // also needs the registry's archive set to disappear from the session list.
  // Checked here so the preview reports it before the user commits to anything.
  if (liveSession !== undefined && !archiveAvailable(deps)) {
    return {
      ok: false,
      code: 'session/attached',
      message: `session "${sessionId}" is attached to this harness and no archive set is mounted to hide it from the session list`,
    }
  }

  return {
    ok: true,
    target: {
      id: sessionId,
      persistence,
      header,
      live: liveSession !== undefined,
      cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
    },
  }
}

/** Whether this deployment can hide an attached session from the session list. */
function archiveAvailable(deps: SessionDeleterDeps): boolean {
  const registry = serviceOf(deps.services, 'workspaceRegistry') as WorkspaceRegistryLike | undefined
  return typeof registry?.archiveSession === 'function'
}

/**
 * Build the delete operation over the host services. All DSH-facing access is
 * resolved lazily per call: a deletion is rare, and a service that mounts late
 * (the workspace registry, on the web layer) must not have been required at
 * boot.
 * @param deps - service accessor, logger, event emitter, and optional home override.
 * @returns the session deleter.
 */
export function createSessionDeleter(deps: SessionDeleterDeps): SessionDeleter {
  return async function deleteSession(sessionId: unknown): Promise<SessionDeleteOutcome> {
    const inspection = await inspectSession(deps, sessionId)
    if (!inspection.ok) return refuse(inspection.code, inspection.message)
    const { id, persistence, live, cwd } = inspection.target

    // A session that is no longer attached needs no hiding: with its artifacts
    // gone it cannot appear in a listing at all, and the event below takes the
    // row out of the browsers. An ATTACHED session is the hard case — the
    // session list merges every live session into itself, and the harness hands
    // the agent-teardown capability to whoever created it (the session
    // controller drops that handle), so the registry's archive set is the only
    // lever that hides it. Order matters: the archive set only accepts a
    // session that still exists, so it is written before the log goes away.
    const archived = live ? await archiveSession(deps, id) : false
    if (live && !archived) {
      return refuse(
        'session/attached',
        `session "${id}" is attached to this harness and no archive set is mounted to hide it from the session list`,
      )
    }
    const removed = await removeArtifacts(persistence, id, cwd, deps)
    await forgetProjectionRows(deps, id)
    const spillDir = await forgetSpillFiles(deps, id)
    if (spillDir !== undefined) removed.push(spillDir)

    // The browser's sidebar row, current selection, and workspace browser all
    // follow this one frame — no reload, no stale entry.
    deps.emit?.('api-session/removed', id)

    return { ok: true, receipt: { deleted: true, sessionId: id, live, archived, removed } }
  }
}

/**
 * Build the delete dialog's dry run: the same preconditions, plus a measurement
 * of what each removal step would free. No mutation happens here — the archive
 * set is only *checked* for availability, never written.
 * @param deps - service accessor, logger, and optional home override.
 * @returns the preview operation.
 */
export function createSessionPreviewer(deps: SessionDeleterDeps): SessionPreviewer {
  return async function previewSession(sessionId: unknown): Promise<SessionPreviewOutcome> {
    const inspection = await inspectSession(deps, sessionId)
    if (!inspection.ok) return refuse(inspection.code, inspection.message)
    const { id, persistence, header, cwd } = inspection.target

    const log = await measureSessionDir(persistence, id, cwd, deps)
    const cacheFiles = await projectionRowPaths(deps, id)
    const cache = cacheFiles.length === 0 ? undefined : await measureFiles(cacheFiles)
    let spill: SessionStoreFootprint | undefined
    const spillPath = spillDirPath(deps, id)
    if (spillPath !== undefined) {
      const measured = await measureTree(spillPath)
      // An empty (or absent) spill directory is not worth a row of its own.
      if (measured.files > 0) spill = { path: spillPath, ...measured }
    }

    return {
      ok: true,
      preview: {
        sessionId: id,
        ...(cwd === undefined ? {} : { cwd }),
        ...(typeof header.createdAt === 'number' ? { createdAt: header.createdAt } : {}),
        ...(log === undefined ? {} : { log }),
        ...(cache === undefined ? {} : { cache }),
        ...(spill === undefined ? {} : { spill }),
        totalBytes: (log?.bytes ?? 0) + (cache?.bytes ?? 0) + (spill?.bytes ?? 0),
      },
    }
  }
}

/**
 * Measure the directory the delete would remove for this session.
 * @param persistence - the persistence service that names the artifact.
 * @param sessionId - the session being previewed.
 * @param cwd - the session's project directory, when the header carries one.
 * @param deps - deleter dependencies.
 * @returns the footprint, or undefined when the session has no directory (an
 *   attached session that never materialized leaves nothing on disk).
 */
async function measureSessionDir(
  persistence: PersistenceLike,
  sessionId: string,
  cwd: string | undefined,
  deps: SessionDeleterDeps,
): Promise<SessionStoreFootprint | undefined> {
  const encoded = encodeSegment(sessionId)
  const roots = knownRoots(persistence, deps.dshHome)
  const dir = await locateSessionDir(persistence, sessionId, cwd, encoded, roots, deps.logger)
  if (dir === undefined) return undefined
  return { path: dir, ...await measureTree(dir) }
}

/** Sum the bytes and count the files of a list of existing files (all in one directory). */
async function measureFiles(paths: readonly string[]): Promise<SessionStoreFootprint> {
  let bytes = 0
  for (const path of paths) bytes += await fileSize(path)
  return { path: dirname(paths[0]), bytes, files: paths.length }
}

/**
 * Walk one path and total its file bytes. An unreadable entry contributes
 * nothing rather than failing the preview: the dialog showing a smaller number
 * than reality is harmless next to refusing to open.
 * @param path - the directory to measure.
 * @returns the total bytes and file count (0/0 when the path is absent).
 */
async function measureTree(path: string): Promise<{ bytes: number; files: number }> {
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return { bytes: 0, files: 0 }
  }
  let bytes = 0
  let files = 0
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      const nested = await measureTree(child)
      bytes += nested.bytes
      files += nested.files
      continue
    }
    bytes += await fileSize(child)
    files += 1
  }
  return { bytes, files }
}

/** One file's size, or 0 when it cannot be read. */
async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/**
 * Build one refusal without losing the stable code the UI branches on. Spelled
 * as the refusal arm alone so both the delete and the preview outcomes accept it.
 * @param code - the stable refusal code the browser branches on.
 * @param message - the host's own diagnostic, shown when no code-specific copy exists.
 * @returns the refusal.
 */
function refuse(code: SessionDeleteRefusal, message: string): { ok: false; code: SessionDeleteRefusal; message: string } {
  return { ok: false, code, message }
}

/**
 * Read one stored session's header without resuming its agent.
 * @param persistence - the persistence service.
 * @param sessionId - the session to read.
 * @param logger - host logger; a corrupt artifact is reported, not fatal.
 * @returns the header, or undefined when the session is absent or unreadable.
 */
async function readHeader(
  persistence: PersistenceLike,
  sessionId: string,
  logger: LoggerLike,
): Promise<SessionHeaderLike | undefined> {
  if (typeof persistence.stat !== 'function') return undefined
  try {
    return (await persistence.stat(sessionId))?.header
  } catch (error) {
    // A log the reader refuses (a foreign format generation, damage) carries no
    // trustworthy header, hence no cwd to derive a directory from: the call
    // reports it as a miss, the same nothing a listing that skips such an
    // artifact already shows the user. Deletion never guesses a path.
    logger.warn(`mcp-manager: could not read session "${sessionId}" before deletion: ${String(error)}`)
    return undefined
  }
}

/**
 * Add the session to the registry-global archive set: the durable hiding half
 * of the delete. Best effort — a deployment without the workspace layer still
 * gets the data removed and the `api-session/removed` frame.
 * @param deps - deleter dependencies.
 * @param sessionId - the session to hide.
 * @returns whether the archive set accepted the id.
 */
async function archiveSession(deps: SessionDeleterDeps, sessionId: string): Promise<boolean> {
  const registry = serviceOf(deps.services, 'workspaceRegistry') as WorkspaceRegistryLike | undefined
  if (typeof registry?.archiveSession !== 'function') return false
  try {
    await registry.archiveSession(sessionId)
    return true
  } catch (error) {
    deps.logger.warn(`mcp-manager: could not archive session "${sessionId}" while deleting it: ${String(error)}`)
    return false
  }
}

/**
 * Remove the session's own directory (log, write lock, session-local files).
 * @param persistence - the persistence service that names the artifact.
 * @param sessionId - the session being deleted.
 * @param cwd - the session's project directory, when the header carries one.
 * @param deps - deleter dependencies.
 * @returns the directories actually removed.
 */
async function removeArtifacts(
  persistence: PersistenceLike,
  sessionId: string,
  cwd: string | undefined,
  deps: SessionDeleterDeps,
): Promise<string[]> {
  const encoded = encodeSegment(sessionId)
  const roots = knownRoots(persistence, deps.dshHome)
  const dir = await locateSessionDir(persistence, sessionId, cwd, encoded, roots, deps.logger)
  if (dir === undefined) {
    // Nothing on disk: either the session never materialized (a created-but-
    // empty session leaves no footprint) or it was removed out of band. The
    // in-memory and registry halves of the delete still stand.
    deps.logger.info(`mcp-manager: session "${sessionId}" has no artifact directory to remove`)
    return []
  }
  await rm(dir, { recursive: true, force: true })
  return [dir]
}

/** The session roots this process can legitimately find an artifact under. */
function knownRoots(persistence: PersistenceLike, dshHome: string | undefined): string[] {
  const roots: string[] = []
  const configured = typeof persistence.root === 'string' && persistence.root !== ''
    ? persistence.root
    : undefined
  if (configured !== undefined) roots.push(configured)
  const fallback = join(dshHome ?? resolveDshHome(), 'sessions')
  if (configured === undefined || resolve(configured) !== resolve(fallback)) roots.push(fallback)
  return roots
}

/**
 * Resolve the harness home the way the runtime does: `$DSH_HOME` when set and
 * non-blank, otherwise `~/.dsh`. Only used to locate a backend that does not
 * report its own root.
 * @returns the absolute harness home.
 */
function resolveDshHome(): string {
  const fromEnv = process.env.DSH_HOME
  const home = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(home)
}

/**
 * Find the one directory that belongs to this session.
 * @param persistence - the persistence service.
 * @param sessionId - the session being deleted.
 * @param cwd - the session's project directory, when known.
 * @param encoded - the session id as one path segment.
 * @param roots - candidate session roots.
 * @param logger - host logger for a failed backend probe.
 * @returns the verified directory, or undefined when the session has none.
 */
async function locateSessionDir(
  persistence: PersistenceLike,
  sessionId: string,
  cwd: string | undefined,
  encoded: string,
  roots: string[],
  logger: LoggerLike,
): Promise<string | undefined> {
  // The backend's own answer is the most authoritative one: it is where the
  // service reads and writes this exact session right now, so its directory
  // needs no root arithmetic — only the name and kind check.
  if (typeof persistence.resolveCurrentLog === 'function') {
    try {
      const path = await persistence.resolveCurrentLog(sessionId)
      if (typeof path === 'string' && path !== '') {
        const dir = dirname(path)
        if (basename(dir) === encoded && await isDirectory(dir)) return resolve(dir)
      }
    } catch (error) {
      logger.warn(`mcp-manager: could not locate session "${sessionId}" through persistence: ${String(error)}`)
    }
  }

  for (const root of roots) {
    const candidate = sessionDir(root, cwd, sessionId)
    if (await isOwnSessionDirectory(candidate, encoded, roots)) return resolve(candidate)
  }

  // Last resort: a session whose header lost its cwd, or a backend that reports
  // a root spelled differently than it resolves. Scanning the project
  // directories under the known roots costs one readdir per root and keeps the
  // delete possible at all.
  for (const root of roots) {
    for (const dir of await projectDirectories(root)) {
      const candidate = join(dir, encoded)
      if (await isOwnSessionDirectory(candidate, encoded, roots)) return resolve(candidate)
    }
  }
  return undefined
}

/** The project directories under one session root (absence means no sessions). */
async function projectDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries.filter(entry => entry.isDirectory()).map(entry => join(root, entry.name))
}

/**
 * Whether a candidate really is one session's directory: it must exist as a
 * directory, be named exactly after the encoded session id, and lie inside a
 * known root. The three checks together make the following `rm` incapable of
 * walking outside the session store.
 * @param candidate - the path to verify.
 * @param encoded - the expected directory name (the encoded session id).
 * @param roots - the roots the candidate must sit under.
 * @returns whether the candidate is the session directory.
 */
async function isOwnSessionDirectory(candidate: string, encoded: string, roots: string[]): Promise<boolean> {
  if (basename(candidate) !== encoded) return false
  const absolute = resolve(candidate)
  if (!roots.some(root => isInside(root, absolute))) return false
  return isDirectory(absolute)
}

/** Whether a path is an existing directory (every read failure reads as "no"). */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Whether `target` is a strict descendant of `root` (both are resolved). */
function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * The session's spilled tool-output directory. Tool results too large to keep in
 * the log are written to `<spill root>/session-<hash12>/…` — one directory per
 * session, where `hash12` is the first 12 hex digits of `sha256(sessionId)`. The
 * name is a pure function of the id, so this addresses this session's directory
 * and no other.
 * @param deps - deleter dependencies.
 * @param sessionId - the session.
 * @returns the directory path, or undefined when this deployment has no spill store.
 */
function spillDirPath(deps: SessionDeleterDeps, sessionId: string): string | undefined {
  const spill = serviceOf(deps.services, 'spillStore') as SpillStoreLike | undefined
  const root = typeof spill?.root === 'string' && spill.root !== '' ? resolve(spill.root) : undefined
  if (root === undefined) return undefined
  const name = `session-${createHash('sha256').update(sessionId).digest('hex').slice(0, 12)}`
  const dir = join(root, name)
  // `name` holds no separator and `join` cannot escape its own root, so the
  // guard only states the invariant the removal depends on.
  return isInside(root, dir) ? dir : undefined
}

/**
 * Delete the session's spilled tool-output directory.
 *
 * Best effort: the default spill root is a private temp directory the harness
 * sweeps by age on startup, so a missed cleanup costs disk space, never
 * correctness.
 * @param deps - deleter dependencies.
 * @param sessionId - the deleted session.
 * @returns the removed directory, when there was one.
 */
async function forgetSpillFiles(deps: SessionDeleterDeps, sessionId: string): Promise<string | undefined> {
  const dir = spillDirPath(deps, sessionId)
  if (dir === undefined) return undefined
  try {
    await rm(dir, { recursive: true, force: true })
  } catch (error) {
    deps.logger.warn(`mcp-manager: could not remove the spill directory for "${sessionId}": ${String(error)}`)
    return undefined
  }
  return dir
}

/**
 * The projection-cache documents written for this session: the record itself
 * plus any `<key>.json.bak.<stamp>` document the backend moved aside. The store
 * is one file per session under `<storage root>/session_projcache/sessions/`,
 * and its keys are path-safe by construction (a key outside the backend's
 * alphabet was never written), so a session id that fails that check has nothing
 * to look for.
 * @param deps - deleter dependencies.
 * @param sessionId - the session.
 * @returns the matching document paths, empty when there are none.
 */
async function projectionRowPaths(deps: SessionDeleterDeps, sessionId: string): Promise<string[]> {
  if (!SAFE_STORAGE_KEY.test(sessionId)) return []
  const backend = serviceOf(deps.services, 'storage.backend.json') as StorageBackendLike | undefined
  const storageRoot = typeof backend?.root === 'string' && backend.root !== ''
    ? backend.root
    : join(deps.dshHome ?? resolveDshHome(), 'storages')
  const tableDir = join(storageRoot, PROJECTION_UNIT, PROJECTION_TABLE)
  const entries = await readdir(tableDir).catch(() => [])
  return entries
    .filter(name => name === `${sessionId}.json` || name.startsWith(`${sessionId}.json.bak.`))
    .map(name => join(tableDir, name))
}

/**
 * Delete the projection-cache documents derived from this session. Best effort:
 * the cache is a fold shortcut, never an authority, so a leftover row is inert
 * (an id is bound to one stored lifecycle, and this one no longer exists) — but
 * the user asked for the session's data to be gone, so it goes.
 * @param deps - deleter dependencies.
 * @param sessionId - the deleted session.
 */
async function forgetProjectionRows(deps: SessionDeleterDeps, sessionId: string): Promise<void> {
  for (const path of await projectionRowPaths(deps, sessionId)) {
    try {
      await rm(path, { force: true })
    } catch (error) {
      // A cache row is disposable derived data: never fail the delete over it.
      deps.logger.warn(`mcp-manager: could not remove the projection cache row for "${sessionId}": ${String(error)}`)
    }
  }
}
