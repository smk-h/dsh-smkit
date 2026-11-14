/**
 * Whether the debug page's seats exist right now.
 *
 * The switch lives on the settings page and the seats live here, in two feature
 * directories that may not import each other — so the flag is a module of its
 * own: the page reads it through {@link onDebugPageChange}, and the composition
 * layer above the features (`settings.ts`) writes it (`setDebugPageEnabled`) when
 * the settings page reports what the host stored. A sibling feature is never the
 * caller on either side.
 *
 * ## Why a browser cache and not a request
 *
 * The seats have to be decided **synchronously, before the first paint**, and
 * the client half makes no request at mount: an entry that fired one would make
 * every panel in this plugin pay for a switch most profiles never touch, and a
 * shell that mounts the bundle outside a browser has no `fetch` to answer it.
 *
 * So the value is mirrored into `localStorage` when it is written, and read back
 * synchronously here. The host's `GET /settings` stays the source of truth: the
 * MCP page reports every poll into {@link setDebugPageEnabled}, which heals a
 * browser that never saw the write (a second browser, or one whose storage was
 * cleared) the moment Settings → MCP is opened there.
 *
 * Default `false`: the page is opt-in, so a browser that has never been told
 * seats nothing and the host's `GET /settings` turns it on for the profiles
 * that want it. The one residual case — page stored on, opened in a browser
 * that has no cache — keeps both seats away until that first visit, and the
 * missing entry is the whole cost.
 */

/** Where the mirrored value lives. Not the host's file, and not a setting of its own. */
const CACHE_KEY = 'smkit.mcp-debug.enabled'

/** The mirror, or `null` when this browser has never been told. */
function cached(): boolean | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
  } catch {
    // Storage disabled (private mode, a hardened profile): no mirror, no crash.
    return null
  }
}

let enabled = cached() ?? false

/** Registered listeners, re-run whenever the flag flips. */
const listeners = new Set<() => void>()

/** The flag as the seats must read it now. */
export function debugPageEnabled(): boolean {
  return enabled
}

/**
 * Apply the value the host just reported, and tell whoever holds a seat.
 *
 * Called by the settings page on every poll (idempotent) and by nothing else:
 * the host owns the stored value, this owns the mirror.
 *
 * @param next - the effective value (`GET /settings`'s `debugPageEnabled`).
 */
export function setDebugPageEnabled(next: boolean): void {
  if (next === enabled) return
  enabled = next
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CACHE_KEY, next ? 'true' : 'false')
  } catch {
    // A mirror that cannot be written only costs the next page load: it falls
    // back to "on" and is corrected by the next settings poll.
  }
  for (const listener of [...listeners]) listener()
}

/**
 * Follow the gate.
 *
 * @param listener - synchronous invalidation callback.
 * @returns unsubscribe.
 */
export function onDebugPageChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
