/**
 * The explorer-menu feature: the right-click menu this plugin draws on the
 * shell's file tree.
 *
 * Home of the ported rows from `dsh-better-sidebar`'s explorer menu
 * (`src/client/FileTree.tsx`). The shell's tree publishes no context menu of its
 * own, so this feature supplies one — the shell's own `Menu` component, one row
 * group per action — for the rows the shell draws. It yields to that neighbour:
 * while `dsh-better-sidebar`'s `editor` type is enabled its explorer owns the
 * page and already carries the same rows, so this feature stays out of the way.
 *
 * Today the menu carries the two copy-path rows plus the two creating rows
 * (new folder, new file) that open the inline editor in `create.ts`; the
 * remaining mutating rows (rename, delete) join the same menu here.
 */

import { EXPLORER_MENU_LOCALE_EN } from './i18n/en'
import { EXPLORER_MENU_LOCALE_ZH } from './i18n/zh'
import { EXPLORER_MENU_CSS, EXPLORER_MENU_ROW_CSS, EXPLORER_NEW_ROW_CSS } from './styles'
import { watchExplorerMenu } from './menu'
import type { ClientContext, ClientDeps, ClientFeature } from '../../platform/types'

export const explorerMenuFeature: ClientFeature = {
  id: 'explorer-menu',
  locale: {
    namespace: 'explorer',
    zh: EXPLORER_MENU_LOCALE_ZH,
    en: EXPLORER_MENU_LOCALE_EN,
  },
  styles: [
    { name: 'explorer-menu/label', css: EXPLORER_MENU_CSS },
    { name: 'explorer-menu/new-row', css: EXPLORER_NEW_ROW_CSS },
    { name: 'explorer-menu/menu-row', css: EXPLORER_MENU_ROW_CSS },
  ],

  register(ctx: ClientContext, deps: ClientDeps, t): void {
    ctx.effect(
      () => watchExplorerMenu(ctx, deps, t),
      'smkit: explorer/menu',
    )
  },
}
