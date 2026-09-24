/**
 * Cross-cutting constants of the plugin shell.
 *
 * `PLUGIN_ID` and `PLUGIN_VERSION` come from package.json: the client bundle id
 * and anything that must quote the package derive from them, so a rename or a
 * version bump is a one-line change with nothing to drift. The specifier is
 * relative to the *compiled* file (`lib/host/platform/constants.js`) = the
 * package root; package.json ships with the package, so the read works both in
 * the repo and installed into a profile.
 *
 * The HTTP surface (`/smkit/...`) is declared here rather than with the
 * feature that serves it: it is the prefix the package owns, and every route —
 * MCP's and the session delete's — mounts under the same one.
 */

import { createRequire } from 'node:module'

const { name, version }: { name: string; version: string } = createRequire(
  import.meta.url,
)('../../../package.json')

/** DSH client bundle id / diagnostics prefix — always the package name. */
export const PLUGIN_ID = name

/** Package version, for the surfaces that must quote it (the MCP client info). */
export const PLUGIN_VERSION = version

/**
 * The HTTP surface lives in `shared/http.ts`, because the browser half fetches
 * these same paths and is built by a different toolchain. Re-exported here so
 * every host feature keeps importing them from the platform constants.
 */
export { API_PREFIX, CALLBACK_PATH, LOG_PREFIX, ROUTE_PATH } from '../../shared/http.js'

/** Cap applied to error strings persisted into live status. */
export const MAX_ERROR_LENGTH = 300
