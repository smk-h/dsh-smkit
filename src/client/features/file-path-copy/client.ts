/**
 * The file-path-copy feature: the two "copy path" rows on the shell's file tree.
 *
 * The direct port of `dsh-better-sidebar`'s explorer menu rows
 * (`src/client/FileTree.tsx`). The shell's tree publishes no context menu of its
 * own, so this feature supplies one — the shell's own `Menu` component with two
 * rows — for the rows the shell draws. It yields to that neighbour: while
 * `dsh-better-sidebar`'s `editor` type is enabled its explorer owns the page and
 * already carries both rows, so this feature stays out of the way.
 */

import { PATH_COPY_LOCALE_EN } from './i18n/en'
import { PATH_COPY_LOCALE_ZH } from './i18n/zh'
import { PATH_COPY_CSS } from './styles'
import { watchFilePathCopy } from './watch'
import type { ClientContext, ClientDeps, ClientFeature } from '../../platform/types'

export const filePathCopyFeature: ClientFeature = {
  id: 'file-path-copy',
  locale: {
    namespace: 'path-copy',
    zh: PATH_COPY_LOCALE_ZH,
    en: PATH_COPY_LOCALE_EN,
  },
  styles: [{ name: 'label', css: PATH_COPY_CSS }],

  register(ctx: ClientContext, deps: ClientDeps, t): void {
    ctx.effect(
      () => watchFilePathCopy(ctx, deps, t),
      'smkit: path-copy/explorer',
    )
  },
}
