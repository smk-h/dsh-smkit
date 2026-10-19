/**
 * The selection-quote feature: "add to conversation" on the host's read-only
 * surfaces.
 *
 * Chrome on surfaces the plugin does not own — the right sidebar's document
 * preview and its terminal tab — so it takes no slot and registers no seat; it
 * listens for the selection gesture and draws its own button (see `watch.ts`).
 * The upstream reference this plugin ports from (`dsh-better-sidebar`,
 * `src/client/selection-popup.ts`) draws the same button inside its own editor,
 * which is why the watcher stands down while that plugin is loaded: one
 * affordance on one surface, never two.
 */

import { SELECTION_QUOTE_LOCALE_EN } from './i18n/en'
import { SELECTION_QUOTE_LOCALE_ZH } from './i18n/zh'
import { SELECTION_QUOTE_CSS } from './styles'
import { watchSelectionQuote } from './watch'
import type { ClientContext, ClientDeps, ClientFeature } from '../../platform/types'

export const selectionQuoteFeature: ClientFeature = {
  id: 'selection-quote',
  locale: {
    namespace: 'selection-quote',
    zh: SELECTION_QUOTE_LOCALE_ZH,
    en: SELECTION_QUOTE_LOCALE_EN,
  },
  styles: [{ name: 'action', css: SELECTION_QUOTE_CSS }],

  register(ctx: ClientContext, _deps: ClientDeps, t): void {
    ctx.effect(
      () => watchSelectionQuote(ctx, t),
      'smkit: selection-quote/preview',
    )
  },
}
