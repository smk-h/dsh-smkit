/**
 * The selection-quote feature: "add to conversation" on the host's read-only
 * surfaces.
 *
 * Chrome on surfaces the plugin does not own — the right sidebar's document
 * preview and its terminal tab — so it takes no slot and registers no seat; a
 * right-click on a selection there replaces the native menu with a small card
 * that quotes the passage into the draft, or copies it (see `watch.ts` and
 * `menu.ts`). The upstream reference this plugin ports from
 * (`dsh-better-sidebar`, `src/client/selection-popup.ts`) draws its own floating
 * button inside its own editor; this feature deliberately does not stand down
 * while that plugin is loaded, because the two never share a surface — its
 * editor carries its button, the host's previews and terminals carry this card.
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

  register(ctx: ClientContext, deps: ClientDeps, t): void {
    ctx.effect(
      () => watchSelectionQuote(ctx, deps, t),
      'smkit: selection-quote/preview',
    )
  },
}
