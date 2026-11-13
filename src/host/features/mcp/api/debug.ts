/**
 * The debug page's host half: call one tool, and read back what a server pushed.
 *
 * This is the inside-the-harness answer to a standalone MCP inspector: the page
 * runs in the same browser as the agent, and the call lands on the very
 * connection the model's `tools/call` would use — a stdio bridge with a serial
 * or SSH session inside it cannot be re-created from a second process, so a
 * separate inspector speaking to another instance of the same command would
 * debug a different server.
 *
 * Two deliberate shapes:
 *
 * - A tool that reports `isError` is a **successful** request: JSON-RPC answered,
 *   the server said the tool failed. So `ok` follows the result's own flag and
 *   the HTTP status stays 200, while a transport failure (timeout, dead child,
 *   refused connection) is the same 200 carrying `error` — the page has one
 *   rendering path and still shows which of the two happened.
 * - Only tools in the connection's own `tools/list` snapshot are callable. That
 *   is the page's list anyway, so the check costs nothing and turns a typo into
 *   a named refusal instead of a server-side unknown-tool error.
 */

import { LOG_PREFIX } from '../constants.js'
import { clearNotifications, notificationsOf } from '../mcp/notifications.js'
import { effectiveToolCallTimeoutMs } from '../state.js'
import { readBody, sendJson } from '../../../platform/util/http.js'
import { toErrorMessage } from '../../../platform/util/text.js'
import type { DebugCallResponse } from '../types.js'
import type { McpApiDeps, McpHandler } from './context.js'
import type { McpHandle } from '../types.js'

/** The request body of `POST /debug/call`. */
interface CallBody {
  /** Server id, unique across the global and every workspace tier. */
  id: string
  /** The tool name as the server declared it (`tools/list`, not `mcp__…`). */
  tool: string
  /** The `arguments` object; absent or `{}` for a tool that takes none. */
  arguments?: unknown
}

/** The live handle of one server, whichever tier registered it. */
function handleOf(api: McpApiDeps, id: string): McpHandle | null {
  const found = api.workspaces.findServerById(id)
  if (found?.wsConn) return found.wsConn.handle
  // A workspace row that was never opened has no connection record at all;
  // `runtime.live` only ever holds global-tier servers.
  return api.runtime.live.get(id)?.handle ?? null
}

/** Whether one server's snapshot lists `tool`. */
function knowsTool(handle: McpHandle, tool: string): boolean {
  return handle.tools.some((entry) => entry.name === tool)
}

export const handleDebug: McpHandler = async (req, res, facts, api) => {
  const { rest } = facts
  if (!rest.startsWith('/debug/')) return false

  if (req.method === 'POST' && rest === '/debug/call') {
    const body = await readBody(req)
    const call = body as unknown as CallBody
    const id = typeof call.id === 'string' ? call.id : ''
    const tool = typeof call.tool === 'string' ? call.tool.trim() : ''
    if (id === '' || tool === '') {
      sendJson(res, 400, { error: 'id and tool are required' })
      return true
    }
    const args = call.arguments ?? {}
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      sendJson(res, 400, { error: 'arguments must be one JSON object' })
      return true
    }
    const handle = handleOf(api, id)
    if (handle === null) {
      sendJson(res, 409, { error: 'this server is not connected' })
      return true
    }
    if (!knowsTool(handle, tool)) {
      sendJson(res, 400, { error: `unknown tool "${tool}" (the server lists no such name)` })
      return true
    }
    const startedAt = Date.now()
    try {
      // The same per-call timeout the agent path uses, read per request so a
      // saved setting reaches the next debug call without a reconnect.
      const result = await handle.call(tool, args, effectiveToolCallTimeoutMs(api.runtime.state))
      const answered: DebugCallResponse = {
        ok: (result as { isError?: unknown })?.isError !== true,
        durationMs: Date.now() - startedAt,
        result,
      }
      sendJson(res, 200, answered)
    } catch (error) {
      const failed: DebugCallResponse = {
        ok: false,
        durationMs: Date.now() - startedAt,
        error: toErrorMessage(error),
      }
      api.logger.warn(`${LOG_PREFIX}: debug call ${tool} failed: ${failed.error}`)
      sendJson(res, 200, failed)
    }
    return true
  }

  if (req.method === 'GET' && rest === '/debug/notifications') {
    const id = facts.url.searchParams.get('id') ?? ''
    if (id === '') {
      sendJson(res, 400, { error: 'id is required' })
      return true
    }
    sendJson(res, 200, { notifications: notificationsOf(api.runtime, id) })
    return true
  }

  if (req.method === 'POST' && rest === '/debug/notifications/clear') {
    const body = await readBody(req)
    const id = typeof body.id === 'string' ? body.id : ''
    if (id === '') {
      sendJson(res, 400, { error: 'id is required' })
      return true
    }
    clearNotifications(api.runtime, id)
    sendJson(res, 200, { ok: true })
    return true
  }

  return false
}
