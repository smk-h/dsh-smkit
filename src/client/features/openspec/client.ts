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

/**
 * One path segment of a `dsh-resource://file` address, as the shell's own
 * sidebar tree encodes one: URI-escaped, except that a colon stays literal —
 * a Windows drive letter survives the round trip through the address.
 */
const encodeSegment = (segment: string): string => encodeURIComponent(segment).replace(/%3A/gi, ':')

/**
 * The address the shell's sidebar viewer claims for one file.
 *
 * Composed the way the sidebar's file tree composes its own: a path under the
 * session's working directory travels workspace-relative, and anything else
 * travels absolute — the Host's read endpoint resolves both, and matching the
 * tree's spelling is what makes the panel's click reveal the tab the tree
 * would have opened rather than a second tab on the same file.
 *
 * @param sessionId - the session whose workspace resolves a relative path.
 * @param root - that session's working directory.
 * @param path - absolute path of the file to open.
 */
export function sessionFileAddress(sessionId: string, root: string, path: string): string {
  const slashed = (value: string): string => value.replace(/\\/g, '/')
  const base = slashed(root).replace(/\/+$/, '')
  const full = slashed(path)
  const rel = base !== '' && full.startsWith(`${base}/`) ? full.slice(base.length + 1) : full
  const encoded = rel.split('/').filter(part => part !== '').map(encodeSegment).join('/')
  return `dsh-resource://file/session/${encodeSegment(sessionId)}/${encoded}`
}

/**
 * The right sidebar's navigation face, read at click time through cordis's
 * reflection layer.
 *
 * The read is late on purpose: the column's controller is provided by a shell
 * package this plugin does not declare, so at registration it may not exist
 * yet — and on a host whose shell has no right sidebar at all it never will,
 * which is the case the `false` answer covers.
 */
function sidebarFileOpener(ctx: ClientContext): (sessionId: string, root: string, path: string) => boolean {
  return (sessionId, root, path) => {
    const sidebar = ctx.reflect?.get('sidebarRight') as { openResource?: (address: string) => void } | undefined
    if (sidebar === undefined || typeof sidebar.openResource !== 'function') return false
    sidebar.openResource(sessionFileAddress(sessionId, root, path))
    return true
  }
}

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
    const OpenSpecButton = createOpenSpecButton(deps, { openFile: sidebarFileOpener(ctx) })
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
