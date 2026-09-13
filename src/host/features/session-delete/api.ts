/**
 * The session routes: `GET /sessions/preview` and `POST /sessions/delete`.
 *
 * Both are thin transports over the matching operation (see `./delete.ts` for
 * what "for good" means, and why it takes an archive plus a filesystem
 * removal): this handler only validates the request shape and maps the outcome
 * onto HTTP. Preview and delete answer the same refusal codes, so the dialog's
 * dry run and the action it gates can be read the same way.
 */

import { readBody, sendJson } from '../../platform/util/http.js'
import type { ApiHandler } from '../../platform/routes.js'
import type { SessionDeleteRefusal } from '../../../shared/session-delete/contract.js'
import type { SessionDeleter, SessionPreviewer } from './delete.js'

/** What this feature's routes need from the host. */
export interface SessionApiDeps {
  deleteSession: SessionDeleter
  previewSession: SessionPreviewer
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
 * The feature's handler, in matching order.
 * @param deps - the delete and preview operations the feature built.
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

      return false
    },
  ]
}
