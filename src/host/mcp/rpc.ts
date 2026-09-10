/**
 * JSON-RPC response decoding for streamable HTTP.
 *
 * A streamable-HTTP endpoint may answer a POST either with a plain JSON body or
 * with a short SSE stream, so both shapes are decoded here. Notifications
 * (messages with a `method` and no `id`) are forwarded to the transport handle,
 * which is how `notifications/tools/list_changed` reaches the tool refresher.
 */

import { isRecord } from '../util/text.js'
import type { RpcMessage } from '../types.js'

/** Parse a text body as JSON without throwing. */
export function parseBody(resp: { text: string }): unknown {
  try {
    return JSON.parse(resp.text)
  } catch {
    return null
  }
}

/**
 * Decode every `data:` payload of one SSE block into RPC messages.
 * `[DONE]` terminates the stream; a payload that is a JSON array is flattened.
 */
export function parseSseMessages(text: unknown): RpcMessage[] {
  const messages: RpcMessage[] = []
  let data: string[] = []
  const flush = (): void => {
    if (data.length === 0) return
    const value = data.join('\n')
    data = []
    if (value === '[DONE]') return
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed)) messages.push(...(parsed as RpcMessage[]))
      else messages.push(parsed as RpcMessage)
    } catch {
      // A malformed frame is dropped; the caller reports a non-JSON response.
    }
  }
  for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (line === '') flush()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  flush()
  return messages
}

/** Pick the RPC message this request waits for, forwarding notifications first. */
export function parseRpc(
  resp: { text: string },
  expectedId: number | undefined,
  conn?: { onNotification?: ((message: RpcMessage) => void) | null } | null,
): RpcMessage | null {
  const body = parseBody(resp)
  const raw = body == null ? parseSseMessages(resp.text) : Array.isArray(body) ? body : [body]
  const messages = raw.filter(isRecord) as RpcMessage[]
  for (const message of messages) {
    if (message && message.id == null && typeof message.method === 'string') conn?.onNotification?.(message)
  }
  if (expectedId !== undefined) return messages.find((message) => message?.id === expectedId) ?? null
  return (
    messages.find(
      (message) => message?.id != null || message?.result !== undefined || message?.error !== undefined,
    ) ?? null
  )
}
