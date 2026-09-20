/**
 * The OpenSpec feature's client half: one control, in the conversation header,
 * that shows and removes the current workspace's OpenSpec.
 *
 * It has nothing to do with MCP; it lives in this plugin for the same reason
 * the session-delete control does — a dsh-smkit install always has one plugin,
 * and the header seat beside the delete button is worth having. The descriptor
 * below is the whole of what the plugin knows about it.
 */

import { createOpenSpecButton } from './OpenSpecButton'
import { OPENSPEC_LOCALE_EN } from './i18n/en'
import { OPENSPEC_LOCALE_ZH } from './i18n/zh'
import { OPENSPEC_CSS } from './styles'
import type { ClientContext, ClientDeps, ClientFeature } from '../../platform/types'

/** The conversation header's right-aligned utilities list. */
const SESSION_HEADER_UTILITIES = 'conversation.session.header.utilities'

export const openSpecFeature: ClientFeature = {
  id: 'openspec',
  locale: {
    namespace: 'openspec',
    zh: OPENSPEC_LOCALE_ZH,
    en: OPENSPEC_LOCALE_EN,
  },
  styles: [{ name: 'openspec', css: OPENSPEC_CSS }],
  register(ctx: ClientContext, deps: ClientDeps): void {
    // Built per apply, as the session-delete control is: the control keeps no
    // module-level state between mounts.
    const OpenSpecButton = createOpenSpecButton(deps)
    // `order: 49` places it immediately before the header's own session-delete
    // control (registered at 50), so the two read as one pair and the
    // destructive button keeps the outermost seat it had.
    ctx.slots.inject(SESSION_HEADER_UTILITIES, () =>
      ctx.slots.register(
        {
          name: SESSION_HEADER_UTILITIES,
          id: 'mcp-manager-openspec',
          order: 49,
          locale: 'openspec',
        },
        OpenSpecButton,
      ),
    )
  },
}
