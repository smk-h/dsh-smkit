/**
 * The session-delete feature's client half: one control, in the conversation
 * header, that removes the current session for good.
 *
 * It has nothing to do with MCP; it lives in this plugin only because a
 * dsh-smkit install always has one plugin and the header seat is worth having.
 * The descriptor below is the whole of what the plugin knows about it.
 */

import { createSessionDeleteButton } from './SessionDeleteButton'
import { SESSION_DELETE_LOCALE_EN } from './i18n/en'
import { SESSION_DELETE_LOCALE_ZH } from './i18n/zh'
import { SESSION_DELETE_CSS } from './styles'
import type { ClientContext, ClientDeps, ClientFeature } from '../../platform/types'

/** The conversation header's right-aligned utilities list. */
const SESSION_HEADER_UTILITIES = 'conversation.session.header.utilities'

export const sessionDeleteFeature: ClientFeature = {
  id: 'session-delete',
  locale: {
    namespace: 'session-delete',
    zh: SESSION_DELETE_LOCALE_ZH,
    en: SESSION_DELETE_LOCALE_EN,
  },
  styles: [{ name: 'session-delete', css: SESSION_DELETE_CSS }],
  register(ctx: ClientContext, deps: ClientDeps): void {
    // Built per apply, as it was before: the control keeps no module-level state
    // between mounts, and `ctx` is how it reaches the client session store.
    const SessionDeleteButton = createSessionDeleteButton(deps, ctx)
    // Its `order` places it after the header's own utilities and anything a
    // negative-order contributor (e.g. open-in-app) put before them.
    ctx.slots.inject(SESSION_HEADER_UTILITIES, () =>
      ctx.slots.register(
        {
          name: SESSION_HEADER_UTILITIES,
          id: 'smkit-session-delete',
          order: 50,
          locale: 'session-delete',
        },
        SessionDeleteButton,
      ),
    )
  },
}
