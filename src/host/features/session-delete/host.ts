/**
 * The session-delete feature's host half: `mount()`.
 *
 * It builds the deleter, the previewer and the manager's lister, and
 * contributes the four routes over them. Nothing here is MCP's business, and
 * nothing here declares a DSH service as a hard dependency: the delete and
 * the listing reach into `sessionPersistence`, `sessions`, `agents` and
 * `workspaceRegistry` through the structural accessor, per call, so the
 * feature stays mountable where only some of them exist.
 */

import { createSessionDeleter, createSessionPreviewer } from './delete.js'
import { createSessionLister } from './list.js'
import { createSessionHandlers } from './api.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'

export const sessionDeleteFeature: HostFeature = {
  id: 'session-delete',

  mount(platform: HostPlatform): void {
    const ctx = platform.ctx
    // The event publication is the same mixed-in method the harness itself uses
    // (`ctx.emit`), bound to this context.
    const hostEmit = ctx.emit
    // One ledger shared by the delete and the listing: a deleted-but-live
    // session stays merged into `sessions.list()` until the harness restarts,
    // and the manager reads the tombstone as "gone", never as "archived".
    const deletedIds = new Set<string>()
    const deleteSession = createSessionDeleter({
      services: platform.services,
      logger: platform.logger,
      deletedIds,
      ...(hostEmit === undefined ? {} : { emit: hostEmit.bind(ctx) }),
    })
    const previewSession = createSessionPreviewer({
      services: platform.services,
      logger: platform.logger,
    })
    const listSessions = createSessionLister({
      services: platform.services,
      logger: platform.logger,
      deletedIds,
    })
    platform.handlers.push(...createSessionHandlers({ deleteSession, previewSession, listSessions }))
  },
}
