/**
 * The line-jump feature: Ctrl+G on the host's text preview.
 *
 * Chrome on a surface the plugin does not own — the right sidebar's document
 * preview — so it takes no slot and registers no seat; it listens for the
 * keystroke and draws its own box (see `watch.ts`). The upstream reference this
 * plugin ports from has no equivalent for this surface: its go-to-line is
 * CodeMirror's own dialog inside its editor tab, behind Mod-Alt-g.
 *
 * Unlike the outline and the row menu, it does NOT yield to
 * `dsh-better-sidebar`: that plugin draws its own version of those surfaces but
 * has no go-to-line of its own (its Mod-g is "find next"), so this feature
 * answers the keystroke on the neighbour's CodeMirror editor as well — see
 * `watch.ts` for how the view is reached without importing CodeMirror.
 */

import { LINE_JUMP_LOCALE_EN } from './i18n/en'
import { LINE_JUMP_LOCALE_ZH } from './i18n/zh'
import { LINE_JUMP_CSS } from './styles'
import { watchLineJump } from './watch'
import type { ClientContext, ClientDeps, ClientFeature } from '../../platform/types'

export const lineJumpFeature: ClientFeature = {
  id: 'line-jump',
  locale: {
    namespace: 'line-jump',
    zh: LINE_JUMP_LOCALE_ZH,
    en: LINE_JUMP_LOCALE_EN,
  },
  styles: [{ name: 'jump', css: LINE_JUMP_CSS }],

  register(ctx: ClientContext, _deps: ClientDeps, t): void {
    ctx.effect(
      () => watchLineJump(t),
      'smkit: line-jump/preview',
    )
  },
}
