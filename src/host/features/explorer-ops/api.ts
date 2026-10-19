/**
 * The explorer's four mutating routes:
 *
 * - `POST /explorer/create-folder` and `POST /explorer/create-file`;
 * - `POST /explorer/rename` and `POST /explorer/delete`.
 *
 * Thin transports over `fs.ts`: the handler validates the request SHAPE, keeps
 * the refusal codes stable, and maps them onto HTTP. The browser half shows the
 * host's own message where the reference did, so the words a user reads are the
 * same ones that plugin printed.
 */

import { readBody, sendJson } from '../../platform/util/http.js'
import type { ApiHandler } from '../../platform/routes.js'
import type { ExplorerCreateRefusal } from '../../../shared/explorer-ops/contract.js'
import { createEntry, deleteEntry, renameEntry, type CreateKind } from './fs.js'

/** HTTP status per stable refusal code. */
const REFUSAL_STATUS: Record<ExplorerCreateRefusal, number> = {
  'explorer/invalid-name': 400,
  'explorer/exists': 409,
  'explorer/not-directory': 400,
  'explorer/missing': 404,
  'explorer/refused': 400,
  'explorer/unavailable': 500,
}

/** Which operation one route suffix asks for. */
type Route =
  | { readonly action: 'create'; readonly as: CreateKind }
  | { readonly action: 'rename' }
  | { readonly action: 'delete' }

/** Route suffix → the menu row that owns it. */
const ROUTES: Record<string, Route> = {
  '/explorer/create-folder': { action: 'create', as: 'folder' },
  '/explorer/create-file': { action: 'create', as: 'file' },
  '/explorer/rename': { action: 'rename' },
  '/explorer/delete': { action: 'delete' },
}

/**
 * The feature's handler list, in matching order.
 * @returns the handler the composition root mounts.
 */
export function createExplorerHandlers(): ApiHandler[] {
  return [
    async (req, res, facts) => {
      const route = ROUTES[facts.rest]
      if (route === undefined || req.method !== 'POST') return false
      const body = await readBody(req)
      const path = typeof body.path === 'string' ? body.path : ''
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const wantsName = route.action !== 'delete'
      if (path === '' || (wantsName && name === '')) {
        sendJson(res, 400, {
          error: wantsName
            ? 'the request must carry a path and a name'
            : 'the request must carry a path',
          code: 'explorer/invalid-name',
        })
        return true
      }

      const outcome = route.action === 'create'
        ? await createEntry(route.as, path, name)
        : route.action === 'rename'
          ? await renameEntry(path, name)
          : await deleteEntry(path)
      if (outcome.ok) {
        sendJson(res, 200, { path: outcome.path })
        return true
      }
      sendJson(res, REFUSAL_STATUS[outcome.code], { error: outcome.message, code: outcome.code })
      return true
    },
  ]
}
