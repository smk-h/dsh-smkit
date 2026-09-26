/**
 * Shared contract of the notify feature: the one setting both halves touch.
 *
 * The host persists the settings and renders the toast from them; the web
 * panel reads and writes them through the notify routes. Only the duration
 * vocabulary travels across — the toggles are plain booleans the client
 * sends and the host validates field by field.
 */

/**
 * How long the toast stays on screen, as the toast XML itself spells it:
 *
 * - `short` — the Windows default, about 5 seconds, then it slides into the
 *   notification center;
 * - `long` — `duration="long"`, about 25 seconds;
 * - `reminder` — `scenario="reminder"`, pinned on screen until dismissed.
 *   This scenario only takes effect when the toast carries at least one
 *   action button (otherwise Windows silently treats it as a normal toast),
 *   so the dispatcher always adds a dismiss button under it.
 */
export type NotifyDuration = 'short' | 'long' | 'reminder'

/** The three values, in the order the panel lists them. */
export const NOTIFY_DURATIONS: readonly NotifyDuration[] = ['short', 'long', 'reminder']

/** The default: the plain Windows toast, what shipped before this setting. */
export const DEFAULT_NOTIFY_DURATION: NotifyDuration = 'short'
