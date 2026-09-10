/**
 * Outbound HTTP + inbound request helpers.
 *
 * Every outbound call sets `redirect: 'manual'` on purpose: MCP streamable HTTP
 * and OAuth endpoints must not be followed transparently, otherwise a 401/303
 * would be masked as a 200 from somewhere else.
 */

import type { HttpTextResponse, RequestLike, ResponseLike } from '../types.js'

const DEFAULT_TIMEOUT_MS = 60_000

/** POST a JSON-RPC / registration payload and return the raw text response. */
export async function httpPostJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<HttpTextResponse> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      redirect: 'manual',
    })
    return { status: resp.status, headers: resp.headers, text: await resp.text() }
  } finally {
    clearTimeout(timer)
  }
}

/** POST `application/x-www-form-urlencoded` — what OAuth token endpoints speak. */
export async function httpPostForm(
  url: string,
  headers: Record<string, string>,
  form: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<HttpTextResponse> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        ...headers,
      },
      body: new URLSearchParams(form).toString(),
      signal: ctrl.signal,
      redirect: 'manual',
    })
    return { status: resp.status, headers: resp.headers, text: await resp.text() }
  } finally {
    clearTimeout(timer)
  }
}

/** Parse a text response body as JSON, returning `null` instead of throwing. */
export function parseJsonText(resp: { text: string }): unknown {
  try {
    return JSON.parse(resp.text)
  } catch {
    return null
  }
}

/** Drain and JSON-parse an inbound request body; malformed input becomes `{}`. */
export async function readBody(req: RequestLike): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = []
  for await (const chunk of req) chunks.push(chunk)
  try {
    const text = Buffer.concat(chunks).toString('utf8') || '{}'
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** Write a JSON response with the no-store cache header the settings UI needs. */
export function sendJson(res: ResponseLike, code: number, value: unknown): void {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(value))
}
