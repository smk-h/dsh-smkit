/**
 * The two creating routes: `POST /explorer/create-folder` and
 * `POST /explorer/create-file`.
 *
 * Thin transports over {@link createEntry}: the handler validates the request
 * SHAPE, keeps the refusal codes stable, and maps them onto HTTP. The browser
 * half shows the host's own message, so the words a user reads for "already
 * exists" are the same ones the reference plugin printed.
 */

import { readBody, sendJson } from '../../platform/util/http.js'
import type { ApiHandler } from '../../platform/routes.js'
import type { ExplorerCreateRefusal } from '../../../shared/explorer-ops/contract.js'
import { createEntry, type CreateKind } from './fs.js'

/** HTTP status per stable refusal code. */
const REFUSAL_STATUS: Record<ExplorerCreateRefusal, number> = {
  'explorer/invalid-name': 400,
  'explorer/exists': 409,
  'explorer/not-directory': 400,
  'explorer/unavailable': 500,
}

/** Route suffix → the row that owns it. */
const ROUTES: Record<string, CreateKind> = {
  '/explorer/create-folder': 'folder',
  '/explorer/create-file': 'file',
}

/**
 * The feature's handler list, in matching order.
 * @returns the handler the composition root mounts.
 */
export function createExplorerHandlers(): ApiHandler[] {
  return [
    async (req, res, facts) => {
      const kind = ROUTES[facts.rest]
      if (kind === undefined || req.method !== 'POST') return false
      const body = await readBody(req)
      const path = typeof body.path === 'string' ? body.path : ''
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (path === '' || name === '') {
        sendJson(res, 400, {
          error: 'the request must carry a directory path and a name',
          code: 'explorer/invalid-name',
        })
        return true
      }
      const outcome = await createEntry(kind, path, name)
      if (outcome.ok) {
        sendJson(res, 200, { path: outcome.path })
        return true
      }
      sendJson(res, REFUSAL_STATUS[outcome.code], { error: outcome.message, code: outcome.code })
      return true
    },
  ]
}
