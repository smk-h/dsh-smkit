/**
 * The session routes: `GET /sessions/preview`, `POST /sessions/delete`, the
 * manager's listing `GET /sessions/manager`, and its batch form
 * `POST /sessions/delete-batch`.
 *
 * All four are thin transports over the matching operation (see `./delete.ts`
 * for what "for good" means, and why it takes an archive plus a filesystem
 * removal, and `./list.ts` for how the sidebar's population is enumerated):
 * this handler only validates the request shape and maps the outcome onto
 * HTTP. Preview and delete answer the same refusal codes, so the dialog's
 * dry run and the action it gates can be read the same way; the batch form
 * runs the single delete per id and reports each outcome, so one refused
 * session (a mid-turn agent, say) never fails the rows around it.
 */

import { readBody, sendJson } from '../../platform/util/http.js'
import { isRecord } from '../../platform/util/text.js'
import type { ApiHandler } from '../../platform/routes.js'
import type {
  SessionBatchDeleteOutcome,
  SessionDeleteRefusal,
} from '../../../shared/session-delete/contract.js'
import type { SessionDeleter, SessionPreviewer } from './delete.js'
import type { SessionLister } from './list.js'

/** What this feature's routes need from the host. */
export interface SessionApiDeps {
  deleteSession: SessionDeleter
  previewSession: SessionPreviewer
  listSessions: SessionLister
}

/** HTTP status per stable refusal code. */
const REFUSAL_STATUS: Record<SessionDeleteRefusal, number> = {
  'session/not-found': 404,
  'session/running': 409,
  'session/attached': 409,
  'session/subagent': 400,
  'session/unavailable': 503,
}

/**
 * The most session ids one batch accepts. A cleanup sweep is dozens of rows
 * at the extreme; beyond that the request reads as a mistake rather than a
 * gesture, and a cap keeps one careless client from holding the event loop
 * through hundreds of sequential directory removals.
 */
const MAX_BATCH_SESSIONS = 500

/** The longest session id accepted from the wire — matching `./delete.ts`. */
const MAX_SESSION_ID_LENGTH = 200

/**
 * The feature's handler, in matching order.
 * @param deps - the delete, preview and listing operations the feature built.
 * @returns the handler list the composition root mounts.
 */
export function createSessionHandlers(deps: SessionApiDeps): ApiHandler[] {
  return [
    async (req, res, facts) => {
      if (facts.rest === '/sessions/preview' && req.method === 'GET') {
        const outcome = await deps.previewSession(facts.url.searchParams.get('sessionId'))
        if (outcome.ok) {
          sendJson(res, 200, outcome.preview)
          return true
        }
        sendJson(res, REFUSAL_STATUS[outcome.code], { error: outcome.message, code: outcome.code })
        return true
      }

      if (facts.rest === '/sessions/delete' && req.method === 'POST') {
        const body = await readBody(req)
        const outcome = await deps.deleteSession(body.sessionId)
        if (outcome.ok) {
          sendJson(res, 200, outcome.receipt)
          return true
        }
        sendJson(res, REFUSAL_STATUS[outcome.code], { error: outcome.message, code: outcome.code })
        return true
      }

      if (facts.rest === '/sessions/manager' && req.method === 'GET') {
        try {
          sendJson(res, 200, await deps.listSessions())
        } catch (error) {
          sendJson(res, 500, { error: String(error) })
        }
        return true
      }

      if (facts.rest === '/sessions/delete-batch' && req.method === 'POST') {
        const body = await readBody(req)
        const requested = isRecord(body) && Array.isArray(body.sessionIds)
          ? body.sessionIds
          : undefined
        if (requested === undefined) {
          sendJson(res, 400, { error: 'sessionIds must be an array of session ids' })
          return true
        }
        if (requested.length > MAX_BATCH_SESSIONS) {
          sendJson(res, 400, { error: `sessionIds exceeds the ${MAX_BATCH_SESSIONS}-session batch limit` })
          return true
        }
        // Keep the first occurrence's order and drop repeats: a duplicated id
        // would be deleted, refused as not-found on the second pass, and read
        // as a failure it does not deserve.
        const ids: string[] = []
        const seen = new Set<string>()
        for (const value of requested) {
          if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SESSION_ID_LENGTH) {
            sendJson(res, 400, { error: 'sessionIds must be non-empty session ids of reasonable length' })
            return true
          }
          if (seen.has(value)) continue
          seen.add(value)
          ids.push(value)
        }

        const results: SessionBatchDeleteOutcome[] = []
        for (const sessionId of ids) {
          try {
            const outcome = await deps.deleteSession(sessionId)
            results.push(outcome.ok
              ? { sessionId, ok: true }
              : { sessionId, ok: false, code: outcome.code, message: outcome.message })
          } catch (error) {
            results.push({ sessionId, ok: false, message: String(error) })
          }
        }
        const deleted = results.filter((result) => result.ok).length
        sendJson(res, 200, { results, deleted, failed: results.length - deleted })
        return true
      }

      return false
    },
  ]
}
