/**
 * `POST /sessions/delete`: remove one session for good.
 *
 * A thin transport over `ApiContext.deleteSession` (see
 * `../session-delete.ts` for what "for good" means, and why it takes an
 * archive plus a filesystem removal): this handler only validates the request
 * shape and maps the outcome onto HTTP. The refusals are codes rather than
 * prose so the browser half can decide whether retrying could ever help.
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
  if (req.method !== 'POST' || facts.rest !== '/sessions/delete') return false

  const body = await readBody(req)
  const outcome = await api.deleteSession(body.sessionId)
  if (outcome.ok) {
    sendJson(res, 200, outcome.receipt)
    return true
  }
  sendJson(res, REFUSAL_STATUS[outcome.code], { error: outcome.message, code: outcome.code })
  return true
}
