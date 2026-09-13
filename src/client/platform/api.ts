/**
 * The only channel between the browser half and the host half: same-origin
 * JSON calls under `/mcp-manager/api`.
 *
 * The client never touches Node APIs and the host never renders UI, so every
 * piece of state (servers, workspaces, settings) flows through here and is
 * polled by `McpContent` every 3 seconds.
 */

import type { ApiFn, ApiResult } from './types'

export function createApi(): ApiFn {
  function api(path: string, options?: RequestInit): Promise<ApiResult> {
    return fetch('/mcp-manager/api' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    }).then(async (resp) => ({
      ok: resp.ok,
      status: resp.status,
      body: await resp.json().catch(() => ({})),
    }))
  }
  return api
}
