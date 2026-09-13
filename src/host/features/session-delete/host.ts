/**
 * The session-delete feature's host half: `mount()`.
 *
 * It builds the deleter and the previewer and contributes its two routes.
 * Nothing here is MCP's business, and nothing here declares a DSH service as a
 * hard dependency: the delete reaches into `sessionPersistence`, `sessions`,
 * `agents` and `workspaceRegistry` through the structural accessor, per call,
 * so the feature stays mountable where only some of them exist.
 */

import { createSessionDeleter, createSessionPreviewer } from './delete.js'
import { createSessionHandlers } from './api.js'
import type { HostFeature, HostPlatform } from '../../platform/context.js'

export const sessionDeleteFeature: HostFeature = {
  id: 'session-delete',

  mount(platform: HostPlatform): void {
    const ctx = platform.ctx
    // The event publication is the same mixed-in method the harness itself uses
    // (`ctx.emit`), bound to this context.
    const hostEmit = ctx.emit
    const deleteSession = createSessionDeleter({
      services: platform.services,
      logger: platform.logger,
      ...(hostEmit === undefined ? {} : { emit: hostEmit.bind(ctx) }),
    })
    const previewSession = createSessionPreviewer({
      services: platform.services,
      logger: platform.logger,
    })
    platform.handlers.push(...createSessionHandlers({ deleteSession, previewSession }))
  },
}
