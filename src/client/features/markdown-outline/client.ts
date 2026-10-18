/**
 * The markdown-outline feature: the table of contents the host's Markdown
 * preview does not draw itself.
 *
 * This is chrome on a surface the plugin does not own — the right sidebar's
 * document preview (`ui-sidebar-documentpreview`) — so it takes no slot and
 * registers no seat: it watches the rendered document (see `watch.ts`). It is
 * the direct port of `dsh-better-sidebar`'s `MdToc`, which draws the same
 * outline inside that plugin's own editor tab.
 *
 * Like the explorer chip, it yields to that neighbour: while
 * `dsh-better-sidebar`'s `editor` type is enabled, that plugin owns the file
 * preview and already shows its own outline, so this feature stands itself
 * down and takes the surface back only when the type is switched off.
 */

import { MARKDOWN_OUTLINE_LOCALE_EN } from './i18n/en'
import { MARKDOWN_OUTLINE_LOCALE_ZH } from './i18n/zh'
import { MARKDOWN_OUTLINE_CSS } from './styles'
import { watchMarkdownOutline } from './watch'
import type { ClientContext, ClientDeps, ClientFeature } from '../../platform/types'

export const markdownOutlineFeature: ClientFeature = {
  id: 'markdown-outline',
  locale: {
    namespace: 'markdown-outline',
    zh: MARKDOWN_OUTLINE_LOCALE_ZH,
    en: MARKDOWN_OUTLINE_LOCALE_EN,
  },
  styles: [{ name: 'toc', css: MARKDOWN_OUTLINE_CSS }],

  register(ctx: ClientContext, _deps: ClientDeps, t): void {
    ctx.effect(
      () => watchMarkdownOutline(ctx, t),
      'smkit: markdown-outline/preview',
    )
  },
}
