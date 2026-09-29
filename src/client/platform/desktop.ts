/**
 * Whether this document is the Desktop shell's application window.
 *
 * The Electron application serves the application document from its own
 * scheme (`dsh-app://app/`, registered as a standard, secure, streamable
 * scheme), so the protocol is the entire test: a browser reaches the same UI
 * over http(s), and the shell's other documents — the update and welcome
 * windows — never mount this bundle. Nothing else about the Desktop is
 * inferable from a page, which is why the host half reads the profile name
 * instead (see `host/platform/desktop.ts`): both halves ask the same question
 * through the only channel each one has.
 *
 * `location` is absent in the Node harnesses the bundle is mounted in, and a
 * harness that has one is never on this scheme. Both answer `false`, which is
 * the web answer.
 */

/** The scheme the application document is served from. */
const DESKTOP_SCHEME = 'dsh-app:'

export function isDesktopShell(): boolean {
  try {
    if (typeof location === 'undefined') return false
    return location.protocol === DESKTOP_SCHEME
  } catch {
    return false
  }
}
