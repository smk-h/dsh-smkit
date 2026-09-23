/**
 * The theme feature's header control: the debug palette toggle.
 *
 * Registration, not composition — the theme feature owns no seat of its own
 * (its panel is one tab of the merged settings section), but the palette
 * toggle belongs in the conversation header's right-aligned utilities, beside
 * the OpenSpec control and the session-delete one. The slot passes this
 * plugin's translator for the seat's locale, and the component renders the
 * panel through a portal, so the whole feature stays one directory.
 *
 * `order: 48` puts it one place left of the OpenSpec control (49) and the
 * header's own session-delete (50): the read-write trio reads as one run, and
 * the outermost, most destructive seat keeps its edge.
 */

import type { ClientContext, ClientDeps } from '../../platform/types'
import { createThemeDebugButton } from './components/ThemeDebugButton'

/** The conversation header's right-aligned utilities list. */
const SESSION_HEADER_UTILITIES = 'conversation.session.header.utilities'

export function registerThemeDebug(ctx: ClientContext, deps: ClientDeps): void {
  const ThemeDebugButton = createThemeDebugButton(deps)
  ctx.slots.inject(SESSION_HEADER_UTILITIES, () =>
    ctx.slots.register(
      {
        name: SESSION_HEADER_UTILITIES,
        id: 'mcp-manager-theme-debug',
        order: 48,
        locale: 'theme',
      },
      ThemeDebugButton,
    ),
  )
}
