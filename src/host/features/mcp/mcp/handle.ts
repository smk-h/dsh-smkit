/**
 * Quiet teardown of an MCP handle.
 *
 * Closing a transport is attempted from the global registry (connect reap,
 * connect failure, disconnect), the workspace close path and plugin teardown.
 * A failure is never actionable — the child process may already be gone, or the
 * socket already dead — so the empty `catch` lives here rather than five times.
 */

import type { McpHandle } from '../types.js'

/** Close a handle if it is present. A failure is swallowed: nothing to reap. */
export function closeHandleQuietly(handle: McpHandle | null | undefined): void {
  try {
    handle?.close?.()
  } catch {
    // Nothing left to reap.
  }
}
