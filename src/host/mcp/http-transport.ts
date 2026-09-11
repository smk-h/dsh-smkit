/**
 * Streamable-HTTP MCP transport.
 *
 * Contract:
 * - POST + JSON-RPC; the session is carried by the `Mcp-Session-Id` response
 *   header and echoed on every later request.
 * - A response body may be plain JSON or a short SSE stream (`parseRpc` handles
 *   both).
 * - A 401 triggers exactly **one** `refresh_token` retry, then the caller
 *   reconnects.
 * - When `initialize` advertises `tools.listChanged`, a background GET SSE
 *   stream keeps the tool list fresh; `notifications/tools/list_changed` is
 *   coalesced into a single serialised refresh.
 */

import { LOG_PREFIX, MCP_CLIENT_INFO, MCP_PROTOCOL_VERSION } from '../constants.js'
import { authHeaders } from '../auth/credentials.js'
import { httpPostJson } from '../util/http.js'
import { errorText } from '../util/text.js'
import { parseRpc, parseSseMessages } from './rpc.js'
import { listAllTools } from './tools.js'
import type { Runtime } from '../runtime.js'
import type {
  LoggerLike,
  McpCallResult,
  McpHandle,
  McpListToolsResult,
  RpcMessage,
  ServerConfig,
} from '../types.js'

const NOTIFICATION_RETRY_MS = 1000

export interface HttpTransportDeps {
  runtime: Runtime
  logger: LoggerLike
  refreshTokens(server: ServerConfig): Promise<boolean>
}

export interface HttpTransport {
  openHttp(server: ServerConfig): Promise<McpHandle>
  startHttpNotificationStream(server: ServerConfig, handle: McpHandle): void
}

/**
 * Coalesce `notifications/tools/list_changed` into serialised refreshes. The
 * handle is closed-checked at every step so a reaped transport cannot publish
 * into a live registration map.
 */
export function bindToolsChanged(
  runtime: Runtime,
  logger: LoggerLike,
  server: ServerConfig,
  handle: McpHandle,
  refresh: () => Promise<void>,
): void {
  void runtime
  let running = false
  let queued = false
  const run = async (): Promise<void> => {
    if (running || handle.closed) return
    running = true
    try {
      do {
        queued = false
        await refresh()
      } while (queued && !handle.closed)
    } catch (error) {
      logger.warn(`${LOG_PREFIX}: refreshing tools for ${server.name} failed: ${errorText(error)}`)
    } finally {
      running = false
      if (queued && !handle.closed) void run()
    }
  }
  handle.onNotification = (message: RpcMessage) => {
    if (message?.method !== 'notifications/tools/list_changed' || handle.closed) return
    queued = true
    void run()
  }
  handle.startNotifications?.()
}

export function createHttpTransport(deps: HttpTransportDeps): HttpTransport {
  const { runtime, logger } = deps

  async function mcpRpc(
    server: ServerConfig,
    method: string,
    params: unknown,
    conn: McpHandle | null,
    options: { isNotification?: boolean } = {},
  ): Promise<unknown> {
    const payload: Record<string, unknown> = { jsonrpc: '2.0', method }
    if (params !== undefined) payload.params = params
    const requestId = options.isNotification ? undefined : runtime.nextRpcId()
    if (!options.isNotification) payload.id = requestId
    const url = String(server.url)
    let resp = await httpPostJson(url, authHeaders(server, conn), payload)
    if (resp.status === 401 && server.authMode === 'oauth' && (await deps.refreshTokens(server))) {
      resp = await httpPostJson(url, authHeaders(server, conn), payload)
    }
    if (resp.status >= 400) {
      throw new Error(`MCP ${method} HTTP ${resp.status}: ${String(resp.text).slice(0, 200)}`)
    }
    const parsed = parseRpc(resp, requestId, conn)
    if (options.isNotification) return null
    if (!parsed) throw new Error(`MCP ${method}: non-JSON response`)
    if (parsed.error) {
      throw new Error(`MCP ${method}: ${parsed.error.message ?? JSON.stringify(parsed.error)}`)
    }
    return parsed.result
  }

  function startHttpNotificationStream(server: ServerConfig, handle: McpHandle): void {
    if (handle.notificationStarted || handle.closed) return
    handle.notificationStarted = true
    const controller = new AbortController()
    handle.notificationController = controller
    void (async () => {
      while (!controller.signal.aborted && !handle.closed) {
        try {
          const request = (): Promise<Response> =>
            fetch(String(server.url), {
              method: 'GET',
              headers: { Accept: 'text/event-stream', ...authHeaders(server, handle) },
              signal: controller.signal,
              redirect: 'manual',
            })
          let response = await request()
          if (response.status === 401 && server.authMode === 'oauth' && (await deps.refreshTokens(server))) {
            await response.body?.cancel().catch(() => {})
            response = await request()
          }
          if (response.status === 404 || response.status === 405) return
          if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
          const decoder = new TextDecoder()
          let buffer = ''
          for await (const chunk of response.body) {
            buffer += decoder.decode(chunk as Uint8Array, { stream: true })
            buffer = buffer.replace(/\r\n/g, '\n')
            let split: number
            while ((split = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, split)
              buffer = buffer.slice(split + 2)
              for (const message of parseSseMessages(`${block}\n\n`)) handle.onNotification?.(message)
            }
          }
          buffer += decoder.decode()
          for (const message of parseSseMessages(buffer)) handle.onNotification?.(message)
        } catch (error) {
          if (controller.signal.aborted || handle.closed) return
          logger.warn(
            `${LOG_PREFIX}: notification stream for ${server.name} stopped: ${errorText(error)}`,
          )
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, NOTIFICATION_RETRY_MS)
          controller.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              resolve()
            },
            { once: true },
          )
        })
      }
    })()
  }

  async function openHttp(server: ServerConfig): Promise<McpHandle> {
    const handle: McpHandle = {
      kind: 'http',
      sessionId: null,
      transport: null,
      tools: [],
      closed: false,
      onNotification: null,
      notificationStarted: false,
      notificationController: null,
      call: () => Promise.reject(new Error('not connected')),
      listTools: () => Promise.reject(new Error('not connected')),
      startNotifications: () => {},
      close() {
        handle.closed = true
        handle.notificationController?.abort()
      },
    }
    const url = String(server.url)
    const initId = runtime.nextRpcId()
    const initPayload = {
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO,
      },
    }
    let resp = await httpPostJson(url, authHeaders(server, handle), initPayload)
    if (resp.status === 401 && server.authMode === 'oauth' && (await deps.refreshTokens(server))) {
      resp = await httpPostJson(url, authHeaders(server, handle), initPayload)
    }
    if (resp.status === 401) throw new Error('authentication required')
    if (resp.status >= 400) {
      throw new Error(`initialize HTTP ${resp.status}: ${String(resp.text).slice(0, 200)}`)
    }
    const init = parseRpc(resp, initId, handle)
    if (!init || init.error) throw new Error(`initialize failed: ${String(resp.text).slice(0, 200)}`)
    const sessionId = resp.headers?.get?.('mcp-session-id')
    handle.sessionId = sessionId ?? null
    await mcpRpc(server, 'notifications/initialized', undefined, handle, { isNotification: true }).catch(
      () => {},
    )
    handle.listTools = (cursor?: string) =>
      mcpRpc(server, 'tools/list', cursor === undefined ? {} : { cursor }, handle) as Promise<McpListToolsResult>
    handle.tools = await listAllTools(handle)
    handle.call = (name: string, args: unknown) =>
      mcpRpc(server, 'tools/call', { name, arguments: args }, handle) as Promise<McpCallResult>
    const result = init.result as
      | { capabilities?: { tools?: { listChanged?: boolean } } }
      | undefined
    if (result?.capabilities?.tools?.listChanged === true) {
      handle.startNotifications = () => startHttpNotificationStream(server, handle)
    }
    return handle
  }

  return { openHttp, startHttpNotificationStream }
}
