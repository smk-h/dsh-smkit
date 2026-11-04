/**
 * The update check's HTTP contract, shared by both halves.
 *
 * One manual gesture: the settings section's button asks the host whether the
 * published package is newer than the running one. Nothing here installs — the
 * answer carries the command a terminal should run, because installing goes
 * through the profile's own package manager and needs a restart of the host
 * either way. Showing the command keeps that decision where it belongs.
 */

/** Answer to `GET /update/check`. */
export interface UpdateCheckView {
  /** The running package version, from this build's `package.json`. */
  current: string
  /** The registry's `latest`, or null when the check could not answer. */
  latest: string | null
  /** Whether `latest` is strictly newer than `current`. */
  hasUpdate: boolean
  /**
   * The command that installs `latest`, present only when there is an update
   * and the host runs somewhere a command applies (the Desktop owns its own
   * profile, so it gets none).
   */
  installCommand?: string
  /**
   * Why the check could not name a latest version (network, registry, a body
   * without a `version`). Absent on success — `latest === null` alone means
   * "no answer", not "no update".
   */
  error?: string
}
