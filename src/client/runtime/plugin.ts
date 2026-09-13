/**
 * Client-side `apply`.
 *
 * Four responsibilities, all delegated to DSH:
 * - register the bilingual `mcp` dictionary (`ctx.locale.register`), so DSH owns
 *   language selection, browser fallback, persistence and live updates;
 * - register the Settings → MCP tab in the `settings.section` slot, tagged with
 *   `locale: "mcp"` so its component receives the standard `t` prop;
 * - register the session delete control in the conversation header's
 *   `conversation.session.header.utilities` slot (a `session`-scope list slot:
 *   the framework supplies `sessionId` and the bound `t`), so the current
 *   session can be removed from the session window itself;
 * - mark this section's own row in the settings nav, which the shell draws the
 *   glyph for itself with no icon field on the registration (see `./nav-icon`).
 *
 * Both slot contributions are injected, never assumed: a composition without
 * the settings shell or without the conversation shell simply never gets the
 * corresponding registration, and the other one still works.
 *
 * The plugin deliberately has no language selector, no language state and no
 * language API of its own.
 */

import { createSessionDeleteButton } from '../components/SessionDeleteButton'
import { markSettingsNavRow } from './nav-icon'
import type { ClientContext, ClientDeps } from './types'

const NAMESPACE = 'mcp'

/** The conversation header's right-aligned utilities list. */
const SESSION_HEADER_UTILITIES = 'conversation.session.header.utilities'

export function createApply(deps: ClientDeps, McpContent: unknown): (ctx: ClientContext) => void {
  return function apply(ctx: ClientContext): void {
    ctx.effect(
      () => ctx.locale.register(NAMESPACE, { zh: deps.zh, en: deps.en }),
      'dsh-mcp-manager: dictionaries',
    )
    const t = ctx.locale.bind(NAMESPACE)
    ctx.effect(
      () => markSettingsNavRow(() => t('sectionLabel')),
      'dsh-mcp-manager: settings nav row',
    )
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          id: 'mcp-manager',
          order: 50,
          label: () => t('sectionLabel'),
          locale: NAMESPACE,
        },
        McpContent,
      ),
    )
    // The delete control deletes sessions, not MCP servers, so it lives here
    // only because this is the one plugin a dsh-smkit install always has. Its
    // `order` places it after the header's own utilities and anything a
    // negative-order contributor (e.g. open-in-app) put before them.
    const SessionDeleteButton = createSessionDeleteButton(deps, ctx)
    ctx.slots.inject(SESSION_HEADER_UTILITIES, () =>
      ctx.slots.register(
        {
          name: SESSION_HEADER_UTILITIES,
          id: 'mcp-manager-session-delete',
          order: 50,
          locale: NAMESPACE,
        },
        SessionDeleteButton,
      ),
    )
  }
}
