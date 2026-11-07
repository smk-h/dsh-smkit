/**
 * The tab-menu feature's client half: one native row the shell's tab menu does
 * not carry.
 *
 * The menu is `ui-context-menu`'s, opened by the right column's tab strips. The
 * column registers the rows it owns there — "close", "close others", "close
 * right" — and the shell renders every row through the same entry component, so
 * a plugin's row is a data contribution on that menu, not markup in it: same
 * glyph column, type scale, padding and shortcut slot as the shell's own rows.
 * That is what this feature registers, and it contributes nothing else — no
 * DOM capture, no menu of its own, no stylesheet.
 *
 * The action reads the pane at open time (see `menu-action.ts`) and closes
 * through the column's own controller, so the shell keeps its focus and its
 * "the guide stays open" rule.
 */

import { createCloseLeftIcon } from '../../platform/icons/CloseLeftIcon'
import {
  closeLeftAction,
  contextMenusOf,
  TAB_MENU_ICON_KEY,
  TAB_MENU_ORDER,
} from './menu-action'
import { TAB_MENU_LOCALE_EN } from './i18n/en'
import { TAB_MENU_LOCALE_ZH } from './i18n/zh'
import type { ClientContext, ClientDeps, ClientFeature, Translator } from '../../platform/types'

/** The slot that turns a glyph key into the row's icon. */
const ICON_SEAT = 'contextMenu.icon'

export const tabMenuFeature: ClientFeature = {
  id: 'tab-menu',
  locale: {
    namespace: 'tab-menu',
    zh: TAB_MENU_LOCALE_ZH,
    en: TAB_MENU_LOCALE_EN,
  },
  register(ctx: ClientContext, deps: ClientDeps, t: Translator): void {
    // The menu service is optional on purpose: a host whose shell predates the
    // shared menu has no rows to extend, and standing down costs one feature
    // rather than the whole entry.
    const menus = contextMenusOf(ctx)
    if (menus === undefined) return
    ctx.effect(
      () => menus.register({
        // The contribution and its one action are named apart on purpose: the
        // id here is this plugin's namespace on the `tab` target, while the
        // action id is what the menu selection reports.
        id: 'smkit.tab-menu',
        target: 'tab',
        order: TAB_MENU_ORDER,
        resolve: closeLeftAction(ctx, t),
      }),
      'tab-menu: close all to the left',
    )
    // The shell's own rows each wear a glyph; a row without one would break the
    // menu's icon column, so the key this action names is answered here.
    ctx.slots.inject(ICON_SEAT, () => ctx.slots.register(
      { name: ICON_SEAT, key: TAB_MENU_ICON_KEY },
      createCloseLeftIcon(deps),
    ))
  },
}
