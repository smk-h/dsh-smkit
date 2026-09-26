/**
 * The sound: ZCode's notification mp3, carried as base64 (see
 * `sound-data.ts`), decoded once per process into the temp directory and
 * handed to the toast child as a plain file path.
 *
 * Nothing here throws at the caller: a sound that cannot be decoded or
 * written resolves to `null` and the toast still fires, silent — a broken
 * notification nicety must never take the notification down with it.
 */

import { createHash } from 'node:crypto'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TASK_NOTIFICATION_SOUND_BASE64 } from './sound-data.js'
import type { LoggerLike } from '../../platform/types.js'

const LOG_PREFIX = 'smkit notify:'

/** The decoded file's path, resolved once per process. */
let resolved: string | null | undefined

/** The decoded bytes, cached once per process — what the `/notify/sound`
 * route serves to pages that deliver their own notifications. */
let bytesCache: Buffer | null | undefined

/**
 * Resolve the sound to its bytes, decoding the embedded payload on first
 * call. `null` means "no sound available" — not an error.
 */
export function soundBytes(logger: LoggerLike): Buffer | null {
  if (bytesCache !== undefined) return bytesCache
  try {
    const bytes = Buffer.from(TASK_NOTIFICATION_SOUND_BASE64.replace(/\s+/g, ''), 'base64')
    if (bytes.length === 0) throw new Error('embedded sound decoded to zero bytes')
    bytesCache = bytes
  } catch (error) {
    logger.warn?.(`${LOG_PREFIX} sound unavailable, toasts will be silent: ${String(error)}`)
    bytesCache = null
  }
  return bytesCache
}

/**
 * Resolve the sound to a playable file path, decoding the embedded bytes on
 * first call. `null` means "no sound this time" — not an error.
 */
export function resolveSoundFile(logger: LoggerLike): string | null {
  if (resolved !== undefined) return resolved
  try {
    const bytes = soundBytes(logger)
    if (bytes === null) throw new Error('embedded sound unavailable')
    // A content-hash name: a swapped asset rewrites the temp file instead of
    // playing whatever an older process left behind under the old name.
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    const path = join(tmpdir(), `smkit-notification-${digest}.mp3`)
    const stale = !existsSync(path) || statSync(path).size !== bytes.length
    if (stale) writeFileSync(path, bytes)
    resolved = path
  } catch (error) {
    logger.warn?.(`${LOG_PREFIX} sound unavailable, toasts will be silent: ${String(error)}`)
    resolved = null
  }
  return resolved
}
