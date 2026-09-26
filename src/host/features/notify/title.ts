/**
 * The session title a toast names its task by.
 *
 * A terminal toast names its task — `任务已完成 / 任务：<标题>` — and the host
 * keeps that title in two places this module can reach:
 *
 * - the title service (`ctx.sessionTitle`), which serves a live session's
 *   current title synchronously — the cheap path, and the freshest one while
 *   the session is attached;
 * - the projection-cache document dsh writes per session, whose `title` row is
 *   what the session list itself is projected from — the fallback for a
 *   composition without the service, or a session that is not attached.
 *
 * Everything here is best effort by design. A title is presentation: a session
 * that never sent a prompt, a pruned or relaid-out cache, a service that is not
 * mounted — each costs the title alone, never the notification. The caller
 * falls back to the workspace name.
 *
 * Reads are synchronous because the decision path is: a listener dispatches in
 * the same tick its event arrives, and one small document read at that moment
 * is cheaper than making every decision wait on I/O. The title is read per
 * notification rather than cached: a rename between two runs of one session
 * must show up in the second toast.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { isRecord } from '../../platform/util/text.js'
import { serviceOf } from '../../platform/util/services.js'
import type { LoggerLike, ServiceAccessor } from '../../platform/types.js'

const LOG_PREFIX = 'smkit notify:'

/**
 * The projection-cache domain and table holding one checkpoint document per
 * session. Same pair `session-delete` reads to drop a deleted session's row.
 */
const PROJECTION_UNIT = 'session_projcache'
const PROJECTION_TABLE = 'sessions'

/**
 * Projection-cache keys become path segments in the storage backend, which
 * accepts exactly this alphabet. A session id outside it was never written, so
 * there is nothing to read — and nothing to escape from, either.
 */
const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]+$/

/** The slice of `ctx.sessionTitle` this reads: a synchronous read by Session. */
interface TitleServiceLike {
  get?(session: unknown): { title?: unknown } | undefined
}

/** The slice of `ctx.sessions` this reads. */
interface SessionStoreLike {
  get?(id: string): unknown
}

/** The slice of the storage backend that names its root, as the deleter reads it. */
interface StorageBackendLike {
  root?: unknown
}

/**
 * Read one session's title, or `undefined` when nothing can name it.
 * @param services - the host's service accessor.
 * @param logger - host logger for a failed read.
 * @returns a lookup that never throws: every failure degrades to `undefined`.
 */
export function createSessionTitleLookup(
  services: ServiceAccessor | null | undefined,
  logger: LoggerLike,
): (sessionId: string) => string | undefined {
  return (sessionId: string): string | undefined => {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    try {
      const live = titleFromService(services, sessionId)
      if (live !== undefined) return live
    } catch (error) {
      logger.warn?.(`${LOG_PREFIX} title service read failed: ${String(error)}`)
    }
    try {
      return titleFromCache(services, sessionId)
    } catch (error) {
      logger.warn?.(`${LOG_PREFIX} title cache read failed: ${String(error)}`)
      return undefined
    }
  }
}

/**
 * The live title, when the session is attached and the service is mounted.
 * `SessionTitleService.get` takes the Session object itself, so the store read
 * comes first: an id nothing holds is an answer, not a failure.
 */
function titleFromService(
  services: ServiceAccessor | null | undefined,
  sessionId: string,
): string | undefined {
  const store = serviceOf(services, 'sessions') as SessionStoreLike | undefined
  const session = store?.get?.(sessionId)
  if (session === undefined || session === null) return undefined
  const titles = serviceOf(services, 'sessionTitle') as TitleServiceLike | undefined
  return textOf(titles?.get?.(session)?.title)
}

/**
 * The cached title row — one document per session under
 * `<storage root>/session_projcache/sessions/`.
 *
 * The row is a checkpoint of the title projection unit, so its `val` is that
 * unit's own state: the plain string the current format stores, and tolerably
 * the whole snapshot object if a later version keeps the event payload. Both
 * are read; anything else (absent file, unrelated layout, a version bump)
 * throws or fails the shape check and costs only the title.
 */
function titleFromCache(
  services: ServiceAccessor | null | undefined,
  sessionId: string,
): string | undefined {
  if (!SAFE_SESSION_ID.test(sessionId)) return undefined
  const root = storageRoot(services)
  const parsed: unknown = JSON.parse(readFileSync(join(root, PROJECTION_UNIT, PROJECTION_TABLE, `${sessionId}.json`), 'utf8'))
  if (!isRecord(parsed) || !isRecord(parsed.record)) return undefined
  const rows = parsed.record.rows
  const row = isRecord(rows) ? rows.title : undefined
  if (!isRecord(row)) return undefined
  return isRecord(row.val) ? textOf(row.val.title) : textOf(row.val)
}

/**
 * Where the storage backend writes, when it says so — and the runtime default
 * otherwise. Asking is fenced on its own: this is the fallback path, and a
 * service accessor that cannot answer (a broken service, a failed lookup)
 * must not also cost the cache read that exists to cover it.
 */
function storageRoot(services: ServiceAccessor | null | undefined): string {
  try {
    const backend = serviceOf(services, 'storage.backend.json') as StorageBackendLike | undefined
    if (typeof backend?.root === 'string' && backend.root !== '') return backend.root
  } catch {
    // Fall through to the default root.
  }
  return join(dshHome(), 'storages')
}

/** The harness home, the way the runtime resolves it: `$DSH_HOME`, else `~/.dsh`. */
function dshHome(): string {
  const configured = process.env.DSH_HOME?.trim()
  return resolve(configured && configured.length > 0 ? configured : join(homedir(), '.dsh'))
}

/** A non-blank title string, or nothing to show. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}
