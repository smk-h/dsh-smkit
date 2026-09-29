/**
 * The session manager's listing: every session the sidebar could show, with
 * the workspace accounting the sidebar groups by, the archive set it hides
 * by, and the metadata the manager's rows render.
 *
 * The population matches the sidebar's own ("default") view — attached
 * sessions merged with the persisted corpus, subagent children and blank
 * placeholders dropped, everything else kept — because the manager exists to
 * delete what the sidebar accumulates, and a row the sidebar never shows
 * would only be noise here. What it adds is the archive set: an archived
 * session stays in its workspace's accounting (that is how unarchiving
 * restores its position), so the manager can show it under the same
 * workspace instead of pretending it vanished.
 *
 * Every DSH service is read through the structural accessor and guarded, the
 * way `./delete.ts` reads them: a deployment without the workspace registry
 * still lists its sessions, just ungrouped; one without the title service
 * still names rows from the projection cache; one without persistence lists
 * nothing at all. Metadata is best effort by design — a row is worth showing
 * with no title and no timestamp, never worth failing the page over.
 */

import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { isRecord } from '../../platform/util/text.js'
import { serviceOf } from '../../platform/util/services.js'
import { LOG_PREFIX } from '../../platform/constants.js'
import { measureFootprint } from './measure.js'
import type {
  ManagedSessionView,
  ManagedWorkspaceView,
  SessionManagerList,
} from '../../../shared/session-delete/contract.js'
import type { LoggerLike, ServiceAccessor } from '../../platform/types.js'

/**
 * The projection-cache domain and table holding one checkpoint document per
 * session — the same pair `./delete.ts` cleans and `../notify/title.ts`
 * reads. This module reads two rows of it (`title`, `sessionListMetadata`)
 * for every listed session in one directory sweep.
 */
const PROJECTION_UNIT = 'session_projcache'
const PROJECTION_TABLE = 'sessions'

/**
 * Projection-cache keys become path segments in the storage backend, which
 * accepts exactly this alphabet. An id outside it was never written, so its
 * document cannot exist — and a filename outside it cannot be one either.
 */
const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]+$/

/** One stored session's metadata, as the persistence backend reports it. */
interface StoredHeaderLike {
  id?: unknown
  cwd?: unknown
  origin?: unknown
  /** Session creation instant, epoch milliseconds. */
  createdAt?: unknown
}

/** Structural slice of a persistence snapshot: the header the merge reads. */
interface StoredSnapshotLike {
  header?: StoredHeaderLike
}

/** Structural slice of `ctx.sessions`: the attached-session store. */
interface LiveSessionStoreLike {
  list?(): unknown
}

/** Structural slice of `ctx.agents`: liveness of a session's agent. */
interface AgentRegistryLike {
  get?(id: string): { status?: unknown } | undefined
}

/** Structural slice of `ctx.sessionTitle`: the live title service. */
interface TitleServiceLike {
  get?(session: unknown): { title?: unknown } | undefined
}

/** Structural slice of `ctx.workspaceRegistry`. */
interface WorkspaceRegistryLike {
  list?(): unknown
  /** The registry-global archive set, read as a property. */
  archivedSessionIds?: unknown
}

/** Structural slice of the storage hub's json backend, which owns the root. */
interface StorageBackendLike {
  root?: unknown
}

/** Structural slice of `ctx.sessionPersistence`. */
interface PersistenceLike {
  list?(options?: { signal?: AbortSignal }): Promise<unknown>
  /** The backend's configured session root, when it exposes one. */
  root?: unknown
  /** Concrete-backend helper returning the current-generation artifact path. */
  resolveCurrentLog?(id: string, signal?: AbortSignal): Promise<string | undefined>
}

/**
 * How long a measured total is reused across polls. The artifact trees only
 * grow while a session is in use, and the summary already says "约" — a
 * minute-old measurement is exactly as honest as a fresh one, for a fraction
 * of the filesystem traffic.
 */
const SIZE_CACHE_TTL_MS = 60_000

export interface SessionListerDeps {
  /** The host context cast into the plugin's structural service view. */
  services: ServiceAccessor | null | undefined
  logger: LoggerLike
  /** Harness home override; tests pin it instead of the process environment. */
  dshHome?: string
  /**
   * Ids the deleter has removed in this process. Their sessions stay live in
   * the harness until it restarts (the archive tombstone hides them from the
   * sidebar), but the manager must not read that tombstone as "archived" — a
   * deleted session is deleted, not filed. Absent set lists everything.
   */
  deletedIds?: ReadonlySet<string>
}

/** The listing operation the API layer calls. */
export type SessionLister = () => Promise<SessionManagerList>

/**
 * Build the listing operation over the host services. Everything DSH-facing
 * is resolved lazily per call: the manager is one more GUI page, and a
 * service that mounts late must not have been required at boot.
 * @param deps - service accessor, logger, and optional home override.
 * @returns the session lister.
 */
export function createSessionLister(deps: SessionListerDeps): SessionLister {
  // Measured totals, briefly cached: the page polls, and re-walking every
  // session's artifact trees on each poll buys nothing over an answer a few
  // seconds old — while the delete dialog's own dry run always measures fresh.
  const measured = new Map<string, { bytes: number; at: number }>()

  return async function listSessions(): Promise<SessionManagerList> {
    const registry = serviceOf(deps.services, 'workspaceRegistry') as WorkspaceRegistryLike | undefined
    const workspaces = readWorkspaces(registry, deps.logger)
    const archivedSessionIds = readArchived(registry)

    // Session → workspace, straight from the accounting the sidebar groups by.
    const workspaceOf = new Map<string, string>()
    for (const ws of workspaces) {
      for (const sessionId of ws.sessionIds) workspaceOf.set(sessionId, ws.workspaceId)
    }

    // Attached sessions first, then the persisted corpus — the same merge the
    // session list performs, with the live header winning by id.
    const merged = new Map<string, MergeRow>()
    collectLive(serviceOf(deps.services, 'sessions') as LiveSessionStoreLike | undefined, merged)
    await collectStored(serviceOf(deps.services, 'sessionPersistence') as PersistenceLike | undefined, merged, deps.logger)

    // One directory sweep for every projection-cache document, rather than a
    // read per session: the corpus can hold hundreds of rows.
    const cache = await readProjectionCache(deps)

    const agents = serviceOf(deps.services, 'agents') as AgentRegistryLike | undefined
    const titles = serviceOf(deps.services, 'sessionTitle') as TitleServiceLike | undefined

    const sessions: ManagedSessionView[] = []
    for (const row of merged.values()) {
      const header = row.header
      const id = typeof header.id === 'string' ? header.id : undefined
      if (id === undefined || id === '') continue
      // A session this deleter removed is a tombstone, not an archive entry:
      // its artifacts are gone and the manager has nothing to manage.
      if (deps.deletedIds?.has(id) === true) continue
      // Subagent children belong to their parent's catalog and the sidebar
      // never shows them; the delete refuses them too. Blank sessions are
      // the provisional New-Session placeholders, listed only while current —
      // there is nothing in either to manage.
      if (header.origin === 'subagent') continue
      const meta = cache.metadata.get(id)
      if (meta?.blank === true) continue
      if (meta?.blank === undefined && row.live && row.seq === 0) continue

      // The live title is the freshest; the cached row covers detached sessions
      // (and compositions without the title service). Both are best effort.
      let title = cache.title.get(id)
      if (title === undefined && row.liveObject !== undefined) {
        const live = titles?.get?.(row.liveObject)?.title
        title = typeof live === 'string' && live.trim() !== '' ? live.trim() : undefined
      }

      const workspaceId = workspaceOf.get(id)
      sessions.push({
        sessionId: id,
        ...(title !== undefined ? { title } : {}),
        ...(typeof header.cwd === 'string' ? { cwd: header.cwd } : {}),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        live: row.live,
        running: agents?.get?.(id)?.status === 'running',
        ...(typeof header.createdAt === 'number' ? { createdAt: header.createdAt } : {}),
        ...(meta?.lastPromptAt !== undefined ? { lastPromptAt: meta.lastPromptAt } : {}),
        sizeBytes: await measuredSize(id, typeof header.cwd === 'string' ? header.cwd : undefined),
      })
    }

    const workspaceViews: ManagedWorkspaceView[] = workspaces.map((ws) => ({
      workspaceId: ws.workspaceId,
      path: ws.path,
      title: ws.title,
    }))
    return { workspaces: workspaceViews, sessions, archivedSessionIds }
  }

  /**
   * The session's on-disk total, as the delete dialog's own dry run measures
   * it — the artifact directory, the projection-cache row and the spill tree
   * summed, so a row's number and the dialog's total are one figure, not two
   * opinions. Measured values are cached briefly; the backing trees only grow
   * while a session is in use, and a slightly stale total is what the "约"
   * in the summary already owns up to.
   * @param id - the session to measure.
   * @param cwd - the session's project directory, when the header carries one.
   * @returns the total bytes (0 when the session has nothing on disk).
   */
  async function measuredSize(id: string, cwd: string | undefined): Promise<number> {
    const hit = measured.get(id)
    if (hit !== undefined && Date.now() - hit.at < SIZE_CACHE_TTL_MS) return hit.bytes
    const persistence = serviceOf(deps.services, 'sessionPersistence') as PersistenceLike | undefined
    const footprint = await measureFootprint(deps, persistence, id, cwd)
    measured.set(id, { bytes: footprint.totalBytes, at: Date.now() })
    return footprint.totalBytes
  }
}

/** One merged session row: the header that survives, plus display metadata. */
interface MergeRow {
  header: StoredHeaderLike
  live: boolean
  /** The live session object itself, for the title service's `get`. */
  liveObject?: unknown
  /** The attached session's event counter — a blank session never turned. */
  seq: number | undefined
}

/** Every registered workspace, in registry order, with its accounting. */
interface WorkspaceRow {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
}

/** Read and validate the registry's workspace projection; absence is fine. */
function readWorkspaces(registry: WorkspaceRegistryLike | undefined, logger: LoggerLike): WorkspaceRow[] {
  if (registry === undefined || typeof registry.list !== 'function') return []
  let listed: unknown
  try {
    listed = registry.list()
  } catch (error) {
    logger.warn(`${LOG_PREFIX}: could not list workspaces: ${String(error)}`)
    return []
  }
  if (!Array.isArray(listed)) return []
  const rows: WorkspaceRow[] = []
  for (const entry of listed) {
    if (!isRecord(entry)) continue
    const { id, path, title, sessionIds } = entry
    if (typeof id !== 'string' || typeof path !== 'string' || path === '') continue
    rows.push({
      workspaceId: id,
      path,
      title: typeof title === 'string' && title !== '' ? title : path,
      sessionIds: Array.isArray(sessionIds) ? sessionIds.filter((v): v is string => typeof v === 'string') : [],
    })
  }
  return rows
}

/** The registry-global archive set; a shape that is not a string array reads as empty. */
function readArchived(registry: WorkspaceRegistryLike | undefined): string[] {
  const raw = registry?.archivedSessionIds
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
}

/** Fold the attached sessions into the merge map. */
function collectLive(store: LiveSessionStoreLike | undefined, merged: Map<string, MergeRow>): void {
  if (store === undefined || typeof store.list !== 'function') return
  let listed: unknown
  try {
    listed = store.list()
  } catch {
    return
  }
  if (!Array.isArray(listed)) return
  for (const session of listed) {
    if (!isRecord(session)) continue
    const header = isRecord(session.header) ? session.header : undefined
    const id = typeof header?.id === 'string' ? header.id : undefined
    if (id === undefined) continue
    merged.set(id, {
      header: header ?? {},
      live: true,
      liveObject: session,
      seq: typeof session.seq === 'number' ? session.seq : undefined,
    })
  }
}

/** Fold the persisted corpus in, never displacing an attached row. */
async function collectStored(
  persistence: PersistenceLike | undefined,
  merged: Map<string, MergeRow>,
  logger: LoggerLike,
): Promise<void> {
  if (persistence === undefined || typeof persistence.list !== 'function') return
  let snapshots: unknown
  try {
    snapshots = await persistence.list()
  } catch (error) {
    // The listing is the whole page's data here: a corpus read that fails
    // still shows the attached sessions rather than nothing, but the gap is
    // worth a log line — a missing stored row reads as "deleted" to whoever
    // is picking rows to remove.
    logger.warn(`${LOG_PREFIX}: could not list stored sessions: ${String(error)}`)
    return
  }
  if (!Array.isArray(snapshots)) return
  for (const snapshot of snapshots) {
    if (!isRecord(snapshot)) continue
    const stored = snapshot as StoredSnapshotLike
    const header = isRecord(stored.header) ? stored.header : undefined
    const id = typeof header?.id === 'string' ? header.id : undefined
    if (id === undefined || merged.has(id)) continue
    merged.set(id, {
      header: header ?? {},
      live: false,
      seq: undefined,
    })
  }
}

/** Title and list-metadata rows swept from the projection-cache table. */
interface CacheRows {
  title: Map<string, string>
  metadata: Map<string, { blank?: boolean; lastPromptAt?: number }>
}

/**
 * Read every projection-cache document of the table directory. Absent root,
 * absent table, or unreadable documents all degrade to "no metadata" — every
 * field here is display-only, never worth failing the page over.
 */
async function readProjectionCache(deps: SessionListerDeps): Promise<CacheRows> {
  const rows: CacheRows = { title: new Map(), metadata: new Map() }
  const backend = serviceOf(deps.services, 'storage.backend.json') as StorageBackendLike | undefined
  const root = typeof backend?.root === 'string' && backend.root !== ''
    ? backend.root
    : join(deps.dshHome ?? resolveDshHome(), 'storages')
  const tableDir = join(root, PROJECTION_UNIT, PROJECTION_TABLE)
  let names: string[]
  try {
    names = await readdir(tableDir)
  } catch {
    return rows
  }
  await Promise.all(names.map(async (name) => {
    if (!name.endsWith('.json')) return
    const id = name.slice(0, -'.json'.length)
    if (!SAFE_SESSION_ID.test(id)) return
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(join(tableDir, name), 'utf8'))
    } catch {
      return
    }
    if (!isRecord(parsed) || !isRecord(parsed.record)) return
    const docRows = isRecord(parsed.record.rows) ? parsed.record.rows : undefined
    if (docRows === undefined) return

    const titleVal = isRecord(docRows.title) ? docRows.title.val : undefined
    const title = typeof titleVal === 'string' && titleVal.trim() !== '' ? titleVal.trim() : undefined
    if (title !== undefined) rows.title.set(id, title)

    const metaVal = isRecord(docRows.sessionListMetadata) ? docRows.sessionListMetadata.val : undefined
    if (isRecord(metaVal)) {
      rows.metadata.set(id, {
        ...(typeof metaVal.blank === 'boolean' ? { blank: metaVal.blank } : {}),
        ...(typeof metaVal.lastPromptAt === 'number' ? { lastPromptAt: metaVal.lastPromptAt } : {}),
      })
    }
  }))
  return rows
}

/** The harness home, the way the runtime resolves it: `$DSH_HOME`, else `~/.dsh`. */
function resolveDshHome(): string {
  const configured = process.env.DSH_HOME?.trim()
  return resolve(configured && configured.length > 0 ? configured : join(homedir(), '.dsh'))
}
