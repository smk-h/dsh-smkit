/**
 * The HTTP surface, named once for both halves.
 *
 * The host half mounts these routes and the browser half calls them, so the
 * two must agree on the prefix or every request 404s — and they are built
 * separately (the host by `tsc`, the browser by `tsdown`), which means nothing
 * checks that they do. Keeping the strings here is what makes the agreement a
 * compile-time fact rather than a coincidence.
 *
 * The prefix is `smkit`, the plugin's own namespace. It used to be
 * `mcp-manager`, the name from before the plugin grew past MCP, and it was
 * written out twice — once here, once again at the call site in
 * `client/platform/api.ts`.
 */

/** Prefix route the GUI webserver mounts. */
export const ROUTE_PATH = '/smkit'

/** JSON API base, mounted under the prefix route. */
export const API_PREFIX = '/smkit/api'

/** OAuth redirect receiver prefix, mounted outside the API prefix. */
export const CALLBACK_PATH = '/smkit/callback'

/** `ctx.logger` message prefix. */
export const LOG_PREFIX = 'smkit'
