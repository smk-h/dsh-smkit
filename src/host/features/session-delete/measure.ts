/**
 * The measured footprint of one session's on-disk artifacts, shared by the
 * delete dialog's dry run and the manager's listing.
 *
 * Both surfaces once answered "how big is this session" from different code
 * paths: the dialog measured the artifact trees it was about to remove, while
 * the list read the persistence snapshot's `sizeBytes` — the *current
 * generation's log file alone*. The two numbers never agreed (a row reading
 * 26 KB beside a dialog totaling 62 KB for the same session), so the
 * measurement lives here now, once: the lister reports the very total the
 * dialog shows, and the preview keeps its per-store rows from the same
 * functions. Nothing is estimated from a second code path that could drift.
 *
 * Every path is resolved, never assumed: the backend's own
 * `resolveCurrentLog(id)` first, then its configured `root` plus the session's
 * `cwd`, and only then the harness default `$DSH_HOME/sessions`. Every
 * candidate is verified — a real directory named exactly after the encoded
 * session id, inside a known root — before it is measured or removed.
 */

import { createHash } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { encodeSegment, sessionDir } from './path.js'
import { serviceOf } from '../../platform/util/services.js'
import { LOG_PREFIX } from '../../platform/constants.js'
import type { SessionStoreFootprint } from '../../../shared/session-delete/contract.js'
import type { LoggerLike, ServiceAccessor } from '../../platform/types.js'

/**
 * Projection-cache keys become path segments in the storage backend, which
 * accepts exactly this alphabet (`storage-json`'s `SAFE_KEY_RE`). A key
 * outside it was never written, so there is nothing to clean or measure.
 */
const SAFE_STORAGE_KEY = /^[a-zA-Z0-9_-]+$/

/** The domain and table holding one projection-checkpoint document per session. */
const PROJECTION_UNIT = 'session_projcache'
const PROJECTION_TABLE = 'sessions'

/** Structural slice of `ctx.sessionPersistence` (the JSONL backend in practice). */
export interface PersistenceLike {
  /** The backend's configured session root, when it exposes one. */
  root?: unknown
  /** Concrete-backend helper returning the current-generation artifact path. */
  resolveCurrentLog?(id: string, signal?: AbortSignal): Promise<string | undefined>
}

/** Structural slice of the storage hub's json backend, which owns the storage root. */
interface StorageBackendLike {
  root?: unknown
}

/** Structural slice of `ctx.spillStore`: the local backend exposes its resolved root. */
interface SpillStoreLike {
  root?: unknown
}

/** The dependencies the measurement reads through: services, logger, home. */
export interface MeasureDeps {
  services: ServiceAccessor | null | undefined
  logger: LoggerLike
  /** Harness home override; tests pin it instead of the process environment. */
  dshHome?: string
}

/** One store's footprint: its path, its bytes, and how many files make them up. */
export interface StoreFootprint {
  path: string
  bytes: number
  files: number
}

/** The whole measured footprint of one session, as the dialog spells it. */
export interface SessionFootprint {
  log?: StoreFootprint
  cache?: StoreFootprint
  spill?: StoreFootprint
  /** The sum the dialog shows as its total — what a delete would free. */
  totalBytes: number
}

/**
 * Measure everything a delete of this session would free: its artifact
 * directory, its projection-cache row, and its spilled tool outputs. Absent
 * stores are absent rows — an attached session that never materialized leaves
 * nothing on disk, and the total still answers.
 * @param deps - service accessor, logger, and optional home override.
 * @param persistence - the persistence service that names the artifact.
 * @param sessionId - the session to measure.
 * @param cwd - the session's project directory, when the header carries one.
 * @returns the measured footprint.
 */
export async function measureFootprint(
  deps: MeasureDeps,
  persistence: PersistenceLike | undefined,
  sessionId: string,
  cwd: string | undefined,
): Promise<SessionFootprint> {
  const log = persistence === undefined
    ? undefined
    : await measureSessionDir(persistence, sessionId, cwd, deps)
  const cacheFiles = await projectionRowPaths(deps, sessionId)
  const cache = cacheFiles.length === 0 ? undefined : await measureFiles(cacheFiles)
  let spill: StoreFootprint | undefined
  const spillPath = spillDirPath(deps, sessionId)
  if (spillPath !== undefined) {
    const measured = await measureTree(spillPath)
    // An empty (or absent) spill directory is not worth a row of its own.
    if (measured.files > 0) spill = { path: spillPath, ...measured }
  }
  return {
    ...(log === undefined ? {} : { log }),
    ...(cache === undefined ? {} : { cache }),
    ...(spill === undefined ? {} : { spill }),
    totalBytes: (log?.bytes ?? 0) + (cache?.bytes ?? 0) + (spill?.bytes ?? 0),
  }
}

/**
 * Measure the directory the delete would remove for this session.
 * @param persistence - the persistence service that names the artifact.
 * @param sessionId - the session being measured.
 * @param cwd - the session's project directory, when the header carries one.
 * @param deps - service accessor, logger, and optional home override.
 * @returns the footprint, or undefined when the session has no directory (an
 *   attached session that never materialized leaves nothing on disk).
 */
export async function measureSessionDir(
  persistence: PersistenceLike,
  sessionId: string,
  cwd: string | undefined,
  deps: MeasureDeps,
): Promise<SessionStoreFootprint | undefined> {
  const dir = await locateSessionDir(persistence, sessionId, cwd, deps)
  if (dir === undefined) return undefined
  return { path: dir, ...await measureTree(dir) }
}

/**
 * Locate the one directory that belongs to this session.
 * @param persistence - the persistence service.
 * @param sessionId - the session being located.
 * @param cwd - the session's project directory, when known.
 * @param deps - service accessor, logger, and optional home override.
 * @returns the verified directory, or undefined when the session has none.
 */
export async function locateSessionDir(
  persistence: PersistenceLike,
  sessionId: string,
  cwd: string | undefined,
  deps: MeasureDeps,
): Promise<string | undefined> {
  const encoded = encodeSegment(sessionId)
  const roots = knownRoots(persistence, deps.dshHome)

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
      deps.logger.warn(`${LOG_PREFIX}: could not locate session "${sessionId}" through persistence: ${String(error)}`)
    }
  }

  for (const root of roots) {
    const candidate = sessionDir(root, cwd, sessionId)
    if (await isOwnSessionDirectory(candidate, encoded, roots)) return resolve(candidate)
  }

  // Last resort: a session whose header lost its cwd, or a backend that reports
  // a root spelled differently than it resolves. Scanning the project
  // directories under the known roots costs one readdir per root and keeps the
  // operation possible at all.
  for (const root of roots) {
    for (const dir of await projectDirectories(root)) {
      const candidate = join(dir, encoded)
      if (await isOwnSessionDirectory(candidate, encoded, roots)) return resolve(candidate)
    }
  }
  return undefined
}

/** The session roots this process can legitimately find an artifact under. */
export function knownRoots(persistence: PersistenceLike, dshHome: string | undefined): string[] {
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
export function resolveDshHome(): string {
  const fromEnv = process.env.DSH_HOME
  const home = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
  return resolve(home)
}

/** The project directories under one session root (absence means no sessions). */
async function projectDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries.filter(entry => entry.isDirectory()).map(entry => join(root, entry.name))
}

/**
 * Whether a candidate really is one session's directory: it must exist as a
 * directory, be named exactly after the encoded session id, and lie inside a
 * known root. The three checks together make a following `rm` incapable of
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
  return isDirectory(candidate)
}

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
 * @param deps - service accessor, logger, and optional home override.
 * @param sessionId - the session.
 * @returns the directory path, or undefined when this deployment has no spill store.
 */
export function spillDirPath(deps: MeasureDeps, sessionId: string): string | undefined {
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
 * The projection-cache documents derived from one session: the checkpoint row
 * and any rotation backups the storage backend keeps beside it.
 * @param deps - service accessor, logger, and optional home override.
 * @param sessionId - the session.
 * @returns the existing document paths, oldest format first.
 */
export async function projectionRowPaths(deps: MeasureDeps, sessionId: string): Promise<string[]> {
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

/** Sum the bytes and count the files of a list of existing files (all in one directory). */
export async function measureFiles(paths: readonly string[]): Promise<SessionStoreFootprint> {
  let bytes = 0
  for (const path of paths) bytes += await fileSize(path)
  return { path: dirname(paths[0]), bytes, files: paths.length }
}

/**
 * Walk one path and total its file bytes. An unreadable entry contributes
 * nothing rather than failing the caller: a measurement a little smaller than
 * reality is harmless next to a listing or preview that refuses to open.
 * @param path - the directory to measure.
 * @returns the total bytes and file count (0/0 when the path is absent).
 */
export async function measureTree(path: string): Promise<{ bytes: number; files: number }> {
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
