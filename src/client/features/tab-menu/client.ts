/**
 * The tab-menu feature's client half: batch-close rows for the right sidebar's
 * tab menu.
 *
 * The shell's tab menu (`ui-dockkit`'s `TabMenu`) opens with a single row,
 * "close", on every tab chip of the right column. The column is where a reader
 * parks every file they touched, so closing it one tab at a time is the one
 * gesture that gets tedious. The shell already reserves a seat for rows like
 * these — `sidebar.right.tab.menu.item`, a `list` slot appended after its own
 * row — so this feature is a slot entry and nothing else: no DOM capture, no
 * menu of its own, no z-index of its own.
 *
 * The rows read the strip at open time (see `TabMenuItems.tsx`) and close
 * through the column's own controller, so the shell keeps its focus and its
 * "the guide stays open" rule.
 */

import { createTabMenuItems, TAB_MENU_ITEM } from './TabMenuItems'
import { TAB_MENU_LOCALE_EN } from './i18n/en'
import { TAB_MENU_LOCALE_ZH } from './i18n/zh'
import { TAB_MENU_CSS } from './styles'
import type { ClientContext, ClientDeps, ClientFeature } from '../../platform/types'

export const tabMenuFeature: ClientFeature = {
  id: 'tab-menu',
  locale: {
    namespace: 'tab-menu',
    zh: TAB_MENU_LOCALE_ZH,
    en: TAB_MENU_LOCALE_EN,
  },
  styles: [{ name: 'tab-menu', css: TAB_MENU_CSS }],
  register(ctx: ClientContext, deps: ClientDeps): void {
    // Built per apply: the rows read the live strip through `document` and the
    // column through `ctx`, so nothing is cached between mounts.
    const TabMenuItems = createTabMenuItems(deps, ctx)
    // `order` places these after the kit's own close row, which is the seat's
    // only fixed entry; the seat appends contributions in ascending order.
    ctx.slots.inject(TAB_MENU_ITEM, () =>
      ctx.slots.register(
        {
          name: TAB_MENU_ITEM,
          id: 'smkit-tab-menu',
          order: 10,
          locale: 'tab-menu',
        },
        TabMenuItems,
      ),
    )
  },
}
