/**
 * The outline feature: the symbol list the host's code preview does not draw.
 *
 * Like the Markdown table of contents, this decorates a surface the plugin does
 * not own, so it registers no seat and instead watches the preview (see
 * `watch.ts`). The symbols themselves come from the host half, which reads the
 * whole file — a paged preview only holds the pages loaded so far, so the DOM
 * cannot answer for a long file.
 *
 * It does **not** stand down for `dsh-better-sidebar`. That plugin owns the file
 * preview (its CodeMirror tab replaces the host's renderer) but offers no code
 * outline of its own — only a Markdown table of contents — so yielding would
 * remove the feature for every reader who has it installed. `watch.ts` therefore
 * decorates both surfaces.
 */

import { OUTLINE_LOCALE_EN } from './i18n/en'
import { OUTLINE_LOCALE_ZH } from './i18n/zh'
import { OUTLINE_CSS } from './styles'
import { watchOutline } from './watch'
import type { ClientContext, ClientDeps, ClientFeature } from '../../platform/types'

export const outlineFeature: ClientFeature = {
  id: 'outline',
  locale: {
    namespace: 'outline',
    zh: OUTLINE_LOCALE_ZH,
    en: OUTLINE_LOCALE_EN,
  },
  styles: [{ name: 'outline', css: OUTLINE_CSS }],

  register(ctx: ClientContext, deps: ClientDeps, t): void {
    ctx.effect(
      () => watchOutline(deps.api, t),
      'smkit: outline/preview',
    )
  },
}
