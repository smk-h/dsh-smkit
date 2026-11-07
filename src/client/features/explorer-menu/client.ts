/**
 * The explorer-menu feature: the right-click rows this plugin adds to the
 * shell's file tree.
 *
 * Two doors, one set of rows (see `actions.ts`):
 *
 * - `native.ts` contributes them to the shell's shared context menu
 *   (`ui-context-menu`), which the tree already opens on a row — the rows are
 *   rendered by the host, so their glyphs, type scale and hairlines are the
 *   host's own, and "add to conversation" leads the menu while the rest sit in
 *   its pinned footer;
 * - `menu.ts` draws them with the host's `Menu` component on a shell that
 *   predates that service, and stands down whenever the host claims the
 *   gesture itself.
 *
 * Ported rows come from `dsh-better-sidebar`'s explorer menu
 * (`src/client/FileTree.tsx`). While that neighbour is loaded its explorer owns
 * the page and already carries the same rows, so this feature stays out of the
 * way (`platform/neighbour.ts`).
 */

import { EXPLORER_MENU_LOCALE_EN } from './i18n/en'
import { EXPLORER_MENU_LOCALE_ZH } from './i18n/zh'
import { EXPLORER_MENU_CSS, EXPLORER_MENU_ROW_CSS, EXPLORER_NATIVE_LEAD_CSS, EXPLORER_NEW_ROW_CSS } from './styles'
import { createExplorerActions } from './actions'
import { watchExplorerMenu } from './menu'
import { registerExplorerMenu } from './native'
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
    { name: 'explorer-menu/native-lead', css: EXPLORER_NATIVE_LEAD_CSS },
  ],

  register(ctx: ClientContext, deps: ClientDeps, t): void {
    // The dispatcher both doors share. It resolves the host modules itself, so
    // a host that seeds none of them still registers its rows — the ones that
    // need a clipboard, a React root or a menu card then stand down one by one
    // instead of the whole feature disappearing.
    const actions = createExplorerActions({ ctx, deps, t })

    // The contributions first: on a shell with the shared menu they are the
    // only rows the reader sees, and the drawn menu below never opens there.
    registerExplorerMenu(ctx, deps, actions, t)

    ctx.effect(() => {
      const dispose = watchExplorerMenu(ctx, deps, t, actions)
      return () => {
        dispose()
        actions.dispose()
      }
    }, 'smkit: explorer/menu')
  },
}
