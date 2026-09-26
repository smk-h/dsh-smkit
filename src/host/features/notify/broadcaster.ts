/**
 * The web-delivery broadcaster: the second notification path, for deployments
 * where dsh runs on a remote host and the user's screen is the browser.
 *
 * Decision-making stays with the orchestrator; this module only carries the
 * final decision to whoever is listening. Each open page holds one
 * `text/event-stream` connection (`GET /notify/events`), and every decision
 * is written as one `data:` frame to all of them at once — the same pattern
 * the OpenSpec upgrade stream uses, down to the content type DSH's webserver
 * never gzips, which is what keeps frames reaching the browser as they are
 * written rather than in one buffered block.
 *
 * A page shows the frame as a Web Notification (its `tag` carries the
 * dedupeKey, so N tabs receiving one decision still render one toast) and
 * plays the shared mp3 when `sound` says so. Only used where the native toast
 * cannot be: the dispatcher routes by platform, so a Windows host never
 * double-fires.
 */

import type { LoggerLike } from '../../platform/types.js'
import type { NotifyDecision } from './types.js'

/** The slice of a Node `http.ServerResponse` a connected stream needs. */
export interface StreamClientLike {
  writeHead(code: number, headers?: Record<string, string>): void
  write(chunk: string): boolean
  end(chunk?: string): void
  on?(event: string, listener: () => void): unknown
}

/** One frame on the wire: a decision, plus whether the sound should play. */
export interface NotifyEventFrame {
  type: 'notify'
  kind: NotifyDecision['kind']
  title: string
  body?: string
  dedupeKey: string
  sound: boolean
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store',
  Connection: 'keep-alive',
} as const

/** Idle pings keep tunnels and proxies from reaping a quiet stream. */
const PING_INTERVAL_MS = 20_000

export interface NotifyBroadcaster {
  /** Adopt a response as a live stream; takes ownership of its lifetime. */
  connect(res: StreamClientLike): void
  /** Push one decision to every connected page. */
  broadcast(decision: NotifyDecision, sound: boolean): void
  /** Connected pages right now (diagnostics). */
  size(): number
}

export function createNotifyBroadcaster(logger: LoggerLike): NotifyBroadcaster {
  const clients = new Set<StreamClientLike>()

  return {
    connect(res: StreamClientLike): void {
      res.writeHead(200, SSE_HEADERS)
      // EventSource-style clients read this as "reconnect after 3s"; the
      // fetch-stream reader ignores it, and its own loop carries the retry.
      res.write('retry: 3000\n\n')
      res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`)
      clients.add(res)
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n')
        } catch {
          clients.delete(res)
        }
      }, PING_INTERVAL_MS)
      ping.unref?.()
      // Connection gone (tab closed, tunnel dropped): stop pinging and stop
      // broadcasting to it. The next page read reconnects on its own.
      res.on?.('close', () => {
        clearInterval(ping)
        clients.delete(res)
      })
    },

    broadcast(decision: NotifyDecision, sound: boolean): void {
      if (clients.size === 0) return
      const frame: NotifyEventFrame = {
        type: 'notify',
        kind: decision.kind,
        title: decision.title,
        ...(decision.body === undefined ? {} : { body: decision.body }),
        dedupeKey: decision.dedupeKey,
        sound,
      }
      const chunk = `data: ${JSON.stringify(frame)}\n\n`
      for (const res of clients) {
        try {
          res.write(chunk)
        } catch (error) {
          logger.warn?.(`smkit notify: stream write failed, dropping client: ${String(error)}`)
          clients.delete(res)
        }
      }
    },

    size(): number {
      return clients.size
    },
  }
}
