/**
 * The only channel between the browser half and the host half: same-origin
 * JSON calls under `/mcp-manager/api`.
 *
 * The client never touches Node APIs and the host never renders UI, so every
 * piece of state (servers, workspaces, settings) flows through here and is
 * polled by `McpContent` every 3 seconds.
 */

import type { ApiFn, ApiResult, StreamFn } from './types'

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

/**
 * The streaming sibling of {@link createApi}, for the one route that answers
 * with an event stream instead of a JSON body: the OpenSpec tool upgrade.
 *
 * It reads the response body a chunk at a time, splits it on the blank line
 * that separates SSE frames, and hands each `data:` payload to `onEvent` as it
 * arrives — which is the whole point, so a caller can paint a line the moment
 * the command wrote it rather than waiting for the run to finish. A frame that
 * has not been fully received yet stays in the buffer until its terminator
 * shows up, so a payload split across network chunks is never parsed twice or
 * dropped.
 */
export function createStream(): StreamFn {
  async function stream(
    path: string,
    options: RequestInit,
    onEvent: (event: Record<string, any>) => void,
  ): Promise<void> {
    const resp = await fetch('/mcp-manager/api' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    // A non-2xx or a body the runtime will not stream is reported as a single
    // failed frame, so the caller's one code path handles success and refusal.
    if (!resp.ok || resp.body === undefined || resp.body === null) {
      onEvent({ type: 'done', status: 'failed', exitCode: null, httpStatus: resp.status })
      return
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      // The last piece is either an incomplete frame or an empty tail; keep it.
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('')
        if (data === '') continue
        try {
          onEvent(JSON.parse(data) as Record<string, any>)
        } catch {
          // A frame that is not JSON is not a line the panel can show; skip it.
        }
      }
    }
  }
  return stream
}
