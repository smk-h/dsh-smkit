/**
 * The session routes: `GET /sessions/preview` and `POST /sessions/delete`.
 *
 * Both are thin transports over the matching `ApiContext` operation (see
 * `../session-delete.ts` for what "for good" means, and why it takes an archive
 * plus a filesystem removal): this handler only validates the request shape and
 * maps the outcome onto HTTP. Preview and delete answer the same refusal codes,
 * so the dialog's dry run and the action it gates can be read the same way.
 */

import { readBody, sendJson } from '../util/http.js'
import type { SessionDeleteRefusal } from '../../shared/contract.js'
import type { ApiHandler } from './context.js'

/** HTTP status per stable refusal code. */
const REFUSAL_STATUS: Record<SessionDeleteRefusal, number> = {
  'session/not-found': 404,
  'session/running': 409,
  'session/attached': 409,
  'session/subagent': 400,
  'session/unavailable': 503,
}

export const handleSessions: ApiHandler = async (req, res, facts, api) => {
  if (facts.rest === '/sessions/preview' && req.method === 'GET') {
    const outcome = await api.previewSession(facts.url.searchParams.get('sessionId'))
    if (outcome.ok) {
      sendJson(res, 200, outcome.preview)
      return true
    }
    sendJson(res, REFUSAL_STATUS[outcome.code], { error: outcome.message, code: outcome.code })
    return true
  }

  if (facts.rest === '/sessions/delete' && req.method === 'POST') {
    const body = await readBody(req)
    const outcome = await api.deleteSession(body.sessionId)
    if (outcome.ok) {
      sendJson(res, 200, outcome.receipt)
      return true
    }
    sendJson(res, REFUSAL_STATUS[outcome.code], { error: outcome.message, code: outcome.code })
    return true
  }

  return false
}
