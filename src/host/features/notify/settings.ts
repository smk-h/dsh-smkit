/**
 * Persistence of `~/.dsh/smkit-notify.json`: the two toggles, nothing else.
 *
 * The file is read on mount and rewritten on save; both directions fail soft
 * — an unreadable file falls back to the defaults, and the routes normalize
 * inbound values field by field so a half-written body can never flip a
 * toggle the request did not mention.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { NOTIFY_STATE_PATH } from './constants.js'
import { isRecord } from '../../platform/util/text.js'
import { DEFAULT_NOTIFY_DURATION, NOTIFY_DURATIONS } from '../../../shared/notify/contract.js'
import type { NotifyDuration, NotifySettings } from './types.js'

/** Both toggles default on and the toast stays a plain 5-second one, the
 * behavior that shipped before the duration setting existed. */
export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = {
  enabled: true,
  soundEnabled: true,
  duration: DEFAULT_NOTIFY_DURATION,
}

/**
 * Read the settings file, falling back to the defaults on any failure (the
 * file not existing yet is the normal first-run case).
 */
export function loadNotifySettings(): NotifySettings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(NOTIFY_STATE_PATH, 'utf8'))
    if (!isRecord(parsed)) return { ...DEFAULT_NOTIFY_SETTINGS }
    return {
      enabled: normalizeToggle(parsed.enabled, DEFAULT_NOTIFY_SETTINGS.enabled),
      soundEnabled: normalizeToggle(parsed.soundEnabled, DEFAULT_NOTIFY_SETTINGS.soundEnabled),
      duration: normalizeDuration(parsed.duration, DEFAULT_NOTIFY_SETTINGS.duration),
    }
  } catch {
    return { ...DEFAULT_NOTIFY_SETTINGS }
  }
}

/** Write the settings file, creating `~/.dsh` when needed. */
export function saveNotifySettings(settings: NotifySettings): void {
  mkdirSync(dirname(NOTIFY_STATE_PATH), { recursive: true })
  writeFileSync(NOTIFY_STATE_PATH, JSON.stringify(settings, null, 2))
}

/**
 * Fold one saved-or-inbound toggle into an effective value: `true`/`false`
 * pass through, `null` means "restore the built-in default" (the same
 * convention the MCP reconnect form uses), anything else leaves the previous
 * value in place.
 */
export function normalizeToggle(value: unknown, previous: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === null) return true
  return previous
}

/**
 * Fold one saved-or-inbound duration into an effective value: a spelled
 * duration passes through, `null` restores the built-in default, anything
 * else (an unknown word included) leaves the previous value in place.
 */
export function normalizeDuration(value: unknown, previous: NotifyDuration): NotifyDuration {
  if (typeof value === 'string' && (NOTIFY_DURATIONS as readonly string[]).includes(value)) {
    return value as NotifyDuration
  }
  if (value === null) return DEFAULT_NOTIFY_DURATION
  return previous
}
