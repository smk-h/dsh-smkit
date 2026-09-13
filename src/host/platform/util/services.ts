/**
 * Optional-service resolution.
 *
 * `attachments`, `llm` and `workspaceRegistry` are all soft dependencies: the
 * plugin keeps working without them, degrading a specific capability only.
 */

import type { ServiceAccessor } from '../types.js'

/** Read one optional service off the plugin context, or `undefined`. */
export function serviceOf(ctx: ServiceAccessor | null | undefined, name: string): unknown {
  if (ctx == null) return undefined
  if (typeof ctx.get === 'function') return ctx.get(name)
  return ctx[name]
}
