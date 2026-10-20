/**
 * The explorer-collapse feature: one "collapse all" control per file tree.
 *
 * Two file trees show a workspace in this shell, and this plugin meets both:
 *
 * - **The shell's own tree** (`ui-sidebar-files`), which publishes a seat in
 *   its header row — `sidebar.right.tab.files.actions` — and draws every row
 *   itself. The control is a slot entry there (`CollapseAllButton.tsx`); the
 *   seat exists only while the native `files` tab is mounted, which is exactly
 *   as long as the button is useful.
 * - **`dsh-better-sidebar`'s tree**, which takes the `files` page over while it
 *   is loaded: the native tab body — and the seat with it — is not mounted at
 *   all, and that plugin's own window has no fold-everything control. There is
 *   no seat to fill, so the control is added to its toolbar (`toolbar.ts`).
 *
 * Both buttons do the same job the same way (see `collapse.ts`): press the
 * open-directory control the tree itself draws, deepest first. The trees stay
 * the owners of their own state, which is what keeps a collapse honest when a
 * folder was opened by something else.
 *
 * Only one of the two surfaces is on screen at a time, and each half is inert
 * on the other's: the seat renders nothing while the neighbour owns the page,
 * and the toolbar watch stands down unless the neighbour's service is
 * published (`platform/neighbour`).
 */

import { createCollapseAllButton } from './CollapseAllButton'
import { EXPLORER_COLLAPSE_LOCALE_EN } from './i18n/en'
import { EXPLORER_COLLAPSE_LOCALE_ZH } from './i18n/zh'
import { COLLAPSE_BUTTON_CSS } from './styles'
import { watchNeighbourToolbars } from './toolbar'
import type { ClientContext, ClientDeps, ClientFeature } from '../../platform/types'

/**
 * The file tree's header seat, as declared by `ui-sidebar-files`: workspace
 * directory actions, appended after the tree's own reload control.
 */
const FILES_ACTIONS = 'sidebar.right.tab.files.actions'

export const explorerCollapseFeature: ClientFeature = {
  id: 'explorer-collapse',
  locale: {
    namespace: 'explorer-collapse',
    zh: EXPLORER_COLLAPSE_LOCALE_ZH,
    en: EXPLORER_COLLAPSE_LOCALE_EN,
  },
  styles: [{ name: 'collapse/button', css: COLLAPSE_BUTTON_CSS }],

  register(ctx: ClientContext, deps: ClientDeps, t): void {
    // Built per apply: the component closes over `deps`, and a second build
    // would hand the seat a different component identity (see `settings.ts`).
    const CollapseAllButton = createCollapseAllButton(deps)
    ctx.slots.inject(FILES_ACTIONS, () =>
      ctx.slots.register(
        {
          name: FILES_ACTIONS,
          id: 'smkit-collapse-all',
          // Last of the seat's fixed entries: the sort is the column's own
          // business, this is a view action like the reload control above it.
          order: 10,
          locale: 'explorer-collapse',
        },
        CollapseAllButton,
      ),
    )
    // The neighbour has no seat to fill, so its button is decoration on a
    // surface it owns: one watcher for every file window it mounts.
    ctx.effect(
      () => watchNeighbourToolbars(ctx, t),
      'smkit: explorer/collapse-all',
    )
  },
}
