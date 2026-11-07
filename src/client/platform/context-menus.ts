/**
 * The shell's shared context-menu service (`ctx.contextMenus`), read through
 * reflection.
 *
 * A plugin's rows on any of the shell's menus are data contributions, never
 * markup: the shell renders them through the same entry component it uses for
 * its own rows, so the glyph column, type scale, padding, hairline and keyboard
 * walk all come from the host. That is why both of this plugin's menu features
 * — the tab menu's one row and the explorer's set — reach it the same way and
 * never draw a menu of their own on a host that has it.
 *
 * Reflect rather than `inject`: a host whose shell predates the shared menu has
 * no service at all, and declaring it would unload the whole client entry there
 * instead of costing the feature that extends it.
 */

import type { ClientContext, ContextMenusLike } from './types'

/**
 * Read the menu service without declaring it.
 * @param ctx - the client context.
 * @returns the service when this host publishes one, otherwise undefined.
 */
export function contextMenusOf(ctx: ClientContext): ContextMenusLike | undefined {
  try {
    const menus = ctx.reflect?.get('contextMenus') as ContextMenusLike | undefined
    return typeof menus?.register === 'function' ? menus : undefined
  } catch {
    // A reflection read that throws resolves nothing: the feature stands down
    // and the shell keeps the rows it provides itself.
    return undefined
  }
}
