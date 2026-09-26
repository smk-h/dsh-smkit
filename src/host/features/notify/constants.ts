/**
 * Constants of the notify feature: where its settings live, the timing
 * windows its decisions read, and the identity the Windows toast presents.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The feature's settings file: two toggles, nothing secret. A file of its own
 * rather than a slice of `mcp-manager.json` — that file is a secret (OAuth
 * tokens) and this has no business touching it.
 */
export const NOTIFY_STATE_PATH = join(homedir(), '.dsh', 'smkit-notify.json')

/**
 * The dedupe window, in milliseconds: one notification per
 * `kind:target` key inside the window, no matter how many times the event
 * fires. Same value ZCode's notification dispatcher uses.
 */
export const NOTIFY_DEDUPE_WINDOW_MS = 3_000

/**
 * How long a "page focused" heartbeat stays believable, in milliseconds. The
 * client half pings every 5s while `document.hasFocus()` is true and pings
 * `blurred` the moment focus leaves, so this only has to cover one missed
 * beat plus transport slop — its real job is expiring a page that died
 * without ever sending the blur (crash, browser killed).
 */
export const FOCUSED_HEARTBEAT_FRESH_MS = 8_000

/**
 * When an `api-session/error` arrives the run usually ends right after, and
 * the `status → false` that follows must not also toast "任务已完成" — the
 * failure already spoke for the run. This window decides how long the error
 * mark keeps the completion toast quiet. ZCode reads the same fact from its
 * phase mapping (an errored phase reports `failed`, never also `completed`);
 * the mark is the closest fact the host bus carries.
 */
export const ERROR_COMPLETED_GAP_MS = 30_000

/** One PowerShell child per notification; it must not hang the host. */
export const POWERSHELL_TIMEOUT_MS = 10_000

/**
 * The AUMID the toast presents under. A WinRT toast needs an AppUserModelId
 * Windows already knows, or it silently refuses to show; dsh-smkit installs
 * no Start-menu shortcut of its own, so the toast borrows PowerShell's
 * (the `{1AC14E77-…}` folder is the machine-wide Start-menu apps folder),
 * which every Windows 10/11 machine has registered.
 */
export const TOAST_AUMID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

/**
 * Cap on the per-session maps (running state, cwd/origin metadata, error
 * marks). Sessions are bounded by real usage, but a long-lived host that
 * meets thousands of them must not grow the maps forever; past the cap the
 * oldest entry is evicted, and a session that aged out simply re-baselines on
 * its next event — which is exactly how a session first seen behaves.
 */
export const MAX_TRACKED_SESSIONS = 200

/** Longest body text the toast carries, in characters. */
export const TOAST_BODY_MAX_CHARS = 120
