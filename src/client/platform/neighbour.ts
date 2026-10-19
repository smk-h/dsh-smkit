/**
 * The one probe for the optional `dsh-better-sidebar` neighbour.
 *
 * Three features decorate surfaces that plugin also draws: the Markdown
 * preview's outline, the explorer's `@` reference chip, and the explorer's row
 * menu (copy path, rename, delete, new file/folder). That plugin's client half
 * publishes a `betterSidebar` service while it is active, and its own versions
 * of all three ride on it — so a published service means the surfaces are the
 * neighbour's, and this plugin's copy would be a second one on the same rows.
 *
 * ## Policy: loaded means yield
 *
 * The service's presence is the whole answer. Its per-type switches (whether
 * the `editor` tab type is enabled) are deliberately not consulted: the
 * surfaces belong to that plugin for as long as it is loaded, and this plugin
 * does not try to win them back when a type is switched off. That keeps the
 * check a single reflection read, and keeps the answer stable for one plugin
 * lifetime — the features re-run it on every scan and every gesture, so
 * loading or unloading the neighbour still takes effect without a reload.
 *
 * Read through reflection (`ctx.reflect`) because the neighbour is optional:
 * declaring `betterSidebar` in the bundle's `inject` list would make this
 * plugin unloadable on a host that does not have it.
 */

import type { ClientContext } from './types'

/**
 * Whether `dsh-better-sidebar` is loaded and therefore owns the surfaces this
 * plugin also knows how to decorate.
 *
 * @param ctx - the client context (a reflection read only).
 * @returns true while that plugin's `betterSidebar` service is published.
 */
export function betterSidebarOwnsSurfaces(ctx: ClientContext): boolean {
  try {
    return ctx.reflect?.get('betterSidebar') !== undefined
  } catch {
    // A reflection read that throws resolves nothing: treat the neighbour as
    // absent rather than losing the feature to a broken service lookup.
    return false
  }
}
