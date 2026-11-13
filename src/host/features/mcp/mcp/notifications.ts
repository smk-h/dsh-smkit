/**
 * The inbound-notification ring the debug page reads.
 *
 * A live MCP server pushes frames nobody asked for: log lines
 * (`notifications/message`), `notifications/tools/list_changed`, progress
 * frames. The agent path only ever consumes one of them (the tool-list change,
 * see `bindToolsChanged`), and everything else was dropped at the transport
 * boundary — which is exactly what a debug surface must not do. So the
 * transports record every inbound frame here **before** handing it to the
 * handle's own single-slot listener, which the registry may replace at any time.
 *
 * The ring is per server and bounded: a chatty server under a long session is
 * normal (log level `debug` on a device daemon is a message per second), and an
 * unbounded buffer would be the plugin's memory leak. A frame whose parameters
 * are enormous is kept, but its parameters are not: the page can say "too large"
 * honestly, and nothing replays them.
 */

import { isRecord } from '../../../platform/util/text.js'
import type { Runtime } from '../runtime.js'
import type { DebugNotificationView, RpcMessage, ServerInfoView } from '../types.js'

/** How many frames one server keeps. */
export const MAX_DEBUG_NOTIFICATIONS = 50

/** Largest serialised `params` kept verbatim; beyond it the frame is flagged. */
const MAX_PARAMS_LENGTH = 8_000

/**
 * Record one inbound notification for the debug page.
 *
 * @param runtime - the mount's runtime container.
 * @param serverId - the server the frame arrived from (unique across tiers).
 * @param message - the frame as the transport parsed it.
 */
export function recordNotification(runtime: Runtime, serverId: string, message: RpcMessage): void {
  const method = typeof message?.method === 'string' ? message.method : ''
  // A response (no method) is a call result, never a notification.
  if (method === '') return
  const entry: DebugNotificationView = {
    seq: runtime.nextNotificationSeq(),
    at: Date.now(),
    method,
  }
  const params = message.params
  if (params !== undefined) {
    let serialized = ''
    try {
      serialized = JSON.stringify(params) ?? ''
    } catch {
      serialized = ''
    }
    if (serialized.length > MAX_PARAMS_LENGTH) entry.truncated = true
    else entry.params = params
  }
  const ring = runtime.debugNotifications.get(serverId) ?? []
  ring.push(entry)
  if (ring.length > MAX_DEBUG_NOTIFICATIONS) ring.splice(0, ring.length - MAX_DEBUG_NOTIFICATIONS)
  runtime.debugNotifications.set(serverId, ring)
}

/**
 * The recorded frames of one server, oldest first.
 *
 * @param runtime - the mount's runtime container.
 * @param serverId - the server to read; an unknown id answers an empty list.
 * @returns a copy, so a caller cannot mutate the ring.
 */
export function notificationsOf(runtime: Runtime, serverId: string): DebugNotificationView[] {
  return [...(runtime.debugNotifications.get(serverId) ?? [])]
}

/** Drop one server's recorded frames (the page's own "clear"). */
export function clearNotifications(runtime: Runtime, serverId: string): void {
  runtime.debugNotifications.delete(serverId)
}

/**
 * Project an `initialize` result into the view the page prints.
 *
 * Servers answer `{ protocolVersion, capabilities, serverInfo }`, and any of
 * those fields may be missing on a hand-written one, so every read is guarded.
 *
 * @param result - the raw `initialize` result.
 * @returns the name/version pair, or `undefined` when the server sent neither.
 */
export function serverInfoOf(result: unknown): ServerInfoView | undefined {
  if (!isRecord(result)) return undefined
  const info = result.serverInfo
  if (!isRecord(info)) return undefined
  const view: ServerInfoView = {}
  if (typeof info.name === 'string' && info.name !== '') view.name = info.name
  if (typeof info.version === 'string' && info.version !== '') view.version = info.version
  return view.name === undefined && view.version === undefined ? undefined : view
}
