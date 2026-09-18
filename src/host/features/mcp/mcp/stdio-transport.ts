/**
 * Local stdio MCP transport: a long-lived child process speaking
 * newline-delimited JSON-RPC over stdin/stdout.
 *
 * Windows specifics that matter:
 * - `npx`/`uvx` are `.cmd` shims that `spawn()` cannot launch directly (ENOENT
 *   for the bare name, EINVAL for the `.cmd` path), so `shell: true` lets
 *   `cmd.exe` resolve them.
 * - With `shell: true`, Node joins command + args with bare spaces and adds no
 *   quoting of its own, so every token goes through `quoteWindowsToken` or
 *   `cmd.exe` truncates paths containing spaces.
 * POSIX passes args through untouched: **no shell expansion**.
 *
 * The command is frequently not the server itself but a bridge to it — the
 * documented remote setup runs `ssh <windows-host> remote-start-mcp.bat`, so the
 * child dies whenever that link drops. `onExit` exists for exactly that case:
 * it fires only when the child went away **by itself**, never for a `close()`
 * the caller asked for.
 */

import { spawn } from 'node:child_process'
import { errorText, quoteWindowsToken } from '../../../platform/util/text.js'
import type { RpcMessage, ServerConfig, StdioTransport } from '../types.js'

const STDERR_TAIL_LIMIT = 2000
const STDERR_MESSAGE_LIMIT = 300
const DEFAULT_TIMEOUT_MS = 60_000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function spawnStdio(
  server: ServerConfig,
  onNotification: (message: RpcMessage) => void,
  onExit?: (reason: string) => void,
): StdioTransport {
  const isWin = process.platform === 'win32'
  const command = isWin ? quoteWindowsToken(server.command) : String(server.command)
  const args = isWin ? (server.args ?? []).map(quoteWindowsToken) : (server.args ?? [])
  const child = spawn(command, args, {
    cwd: server.cwd || process.cwd(),
    env: { ...process.env, ...(server.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: isWin,
  })

  const pending = new Map<number, PendingRequest>()
  let buffer = ''
  let stderrTail = ''
  let closed = false
  let seq = 1

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      let message: RpcMessage
      try {
        message = JSON.parse(line) as RpcMessage
      } catch {
        continue
      }
      if (message.id != null && pending.has(message.id as number)) {
        const request = pending.get(message.id as number)
        if (!request) continue
        pending.delete(message.id as number)
        clearTimeout(request.timer)
        if (message.error) {
          request.reject(new Error(message.error.message ?? JSON.stringify(message.error)))
        } else {
          request.resolve(message.result)
        }
      } else if (message.id == null && typeof message.method === 'string') {
        try {
          onNotification(message)
        } catch {
          // A notification handler must never take down the transport.
        }
      }
    }
  })

  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_LIMIT)
  })

  /**
   * Reject every in-flight request and mark the channel dead.
   * @returns whether this call was the one that tore it down. `close()` sets
   * `closed` before killing the child, so a `false` here means the shutdown was
   * already requested and is not a drop to report.
   */
  const fail = (error: Error): boolean => {
    if (closed) return false
    closed = true
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
    return true
  }

  /** The child's exit, as the diagnostic the settings page shows. */
  const exitReason = (): string =>
    stderrTail
      ? `stdio process exited: ${stderrTail.slice(-STDERR_MESSAGE_LIMIT)}`
      : 'stdio process exited'

  // 'error' (spawn failed, pipe broke) precedes 'close' whenever both fire;
  // `fail` is idempotent, so only the first one reports the exit.
  child.on('error', (error) => {
    if (fail(error instanceof Error ? error : new Error(String(error)))) onExit?.(errorText(error))
  })
  child.on('close', () => {
    if (fail(new Error(exitReason()))) onExit?.(exitReason())
  })

  function send(payload: unknown): void {
    if (closed) throw new Error('stdio process closed')
    child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  function request(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    if (closed) return Promise.reject(new Error('stdio process closed'))
    return new Promise((resolve, reject) => {
      const id = seq++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`stdio ${method} timeout`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  function notify(method: string, params?: unknown): void {
    if (closed) return
    try {
      send({ jsonrpc: '2.0', method, params })
    } catch {
      // A notification on a dying child is not actionable.
    }
  }

  function close(): void {
    closed = true
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('stdio process closed'))
    }
    pending.clear()
    try {
      child.kill()
    } catch {
      // The child is already gone.
    }
  }

  return { request, notify, close }
}
