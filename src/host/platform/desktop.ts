/**
 * Whether this host is the Desktop profile.
 *
 * The Electron application is the only thing that boots a `desktop` host: its
 * harness process calls `runProfile({ profile: 'desktop' })`, and the profile
 * boot publishes that name as the `profileContext` service — the harness's own
 * notion of "which profile am I", rather than something inferred from argv,
 * `process.execPath` or the working directory. That distinction is the whole
 * reason this file exists: the Desktop installs its own `dsh` command, so a
 * `dsh web` started from that wrapper also runs under the Electron executable
 * and in an install directory full of `dsh-desktop-*` paths. Only the profile
 * name separates the application from the browser half of the same install.
 *
 * The read is structural and optional: a host that registers nothing under the
 * name — or one old enough to have no `get` at all — answers `false`, which is
 * the web answer. Anything gated on this must be something the Desktop cannot
 * do, never something the web needs.
 */

import type { PluginContext } from './context.js'

/** The profile name the Electron application boots. */
export const DESKTOP_PROFILE = 'desktop'

/**
 * The profile this host runs, or `null` when the harness does not say. Both
 * the read and the shape check are defensive: `profileContext` is another
 * package's service, and a missing one must read as "unknown", not throw
 * inside a feature's mount.
 */
export function profileNameOf(ctx: PluginContext): string | null {
  try {
    const context = ctx.get?.('profileContext')
    if (typeof context !== 'object' || context === null) return null
    const name: unknown = (context as { name?: unknown }).name
    return typeof name === 'string' && name !== '' ? name : null
  } catch {
    return null
  }
}

/**
 * Whether this host is the Desktop profile. Case-insensitive because the CLI
 * normalizes `--profile DESKTOP` down to `desktop` before it boots, and a name
 * that arrived by another route should not read as a different profile.
 */
export function isDesktopProfile(ctx: PluginContext): boolean {
  return profileNameOf(ctx)?.toLowerCase() === DESKTOP_PROFILE
}
