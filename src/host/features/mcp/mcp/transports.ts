/**
 * Transport facade: one `openServer()` for both scoping tiers.
 *
 * The stdio half spawns the child and speaks newline-delimited JSON-RPC; the
 * HTTP half is in `http-transport.ts`. `bindToolsChanged` is re-exported so
 * callers (the registry and the workspace manager) do not need to know which
 * transport a handle came from.
 */

import { MCP_CLIENT_INFO, MCP_PROTOCOL_VERSION } from '../constants.js'
import { bindToolsChanged, createHttpTransport } from './http-transport.js'
import { listAllTools } from './tools.js'
import { spawnStdio } from './stdio-transport.js'
import type { Runtime } from '../runtime.js'
import type { LoggerLike, McpCallResult, McpHandle, McpListToolsResult, ServerConfig } from '../types.js'

export { bindToolsChanged } from './http-transport.js'

export interface TransportsDeps {
  runtime: Runtime
  logger: LoggerLike
  refreshTokens(server: ServerConfig): Promise<boolean>
}

export interface Transports {
  openServer(server: ServerConfig): Promise<McpHandle>
  bindToolsChanged(server: ServerConfig, handle: McpHandle, refresh: () => Promise<void>): void
}

export function createTransports(deps: TransportsDeps): Transports {
  const { runtime, logger } = deps
  const http = createHttpTransport({ runtime, logger, refreshTokens: deps.refreshTokens })

  /** Establish a stdio transport (spawns the child) and fetch `tools/list`. */
  async function openStdio(server: ServerConfig): Promise<McpHandle> {
    const handle: McpHandle = {
      kind: 'stdio',
      sessionId: null,
      transport: null,
      tools: [],
      closed: false,
      onNotification: null,
      call: () => Promise.reject(new Error('not connected')),
      listTools: () => Promise.reject(new Error('not connected')),
      startNotifications: () => {},
      close() {
        if (handle.closed) return
        handle.closed = true
        handle.transport?.close()
      },
    }
    const transport = spawnStdio(server, (message) => handle.onNotification?.(message))
    handle.transport = transport
    try {
      await transport.request('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO,
      })
      transport.notify('notifications/initialized')
      handle.listTools = (cursor?: string) =>
        transport.request(
          'tools/list',
          cursor === undefined ? {} : { cursor },
        ) as Promise<McpListToolsResult>
      handle.tools = await listAllTools(handle)
      handle.call = (name: string, args: unknown) =>
        transport.request('tools/call', { name, arguments: args }) as Promise<McpCallResult>
      return handle
    } catch (error) {
      handle.close()
      throw error
    }
  }

  async function openServer(server: ServerConfig): Promise<McpHandle> {
    if ((server.type ?? 'http') === 'stdio') return openStdio(server)
    return http.openHttp(server)
  }

  return {
    openServer,
    bindToolsChanged: (server, handle, refresh) =>
      bindToolsChanged(runtime, logger, server, handle, refresh),
  }
}
