/**
 * Which session a host-drawn surface belongs to.
 *
 * The features that decorate surfaces the plugin does not own all ask the same
 * question — the explorer row, the preview header and anything else inside the
 * right sidebar — and the answer has to come from the host, never from "the
 * current session": there may be several sidebars on screen (docks, floating
 * panes), and the store's session list carries no `current` field to borrow.
 * Lifted out of `file-reference/reference.ts` when the preview selection popup
 * became the second caller (a feature may not import another feature).
 *
 * The right-sidebar container is the primary authority: the shell itself maps
 * an element back to its session with
 * `element.closest('[data-sidebar-right-session]')?.dataset.sidebarRightSession`
 * (`ui-sidebar-right`'s pane targeting), so reading the same attribute is the
 * same lookup the tab owner would hand a plugin as a prop. The service's
 * `mounted` covers host versions whose markup predates that attribute (0.1.5
 * still had the service, not the attribute) and is the sidebar's own session,
 * not a guess. Below that there is nothing authoritative left, so the answer is
 * `undefined` and the gesture becomes a no-op rather than a write into the
 * wrong conversation.
 */

import type { ClientContext } from './types'

/** The right sidebar's navigation face, read for its session when the DOM has none. */
interface SidebarRightService {
  mounted?: { getSnapshot(): string | undefined }
}

/**
 * The session a host-drawn element belongs to, or undefined when nothing
 * authoritative says.
 *
 * @param ctx - the client context (a reflection read only).
 * @param element - the surface's element, inside the right sidebar.
 * @returns the session id the sidebar container (or its service) names.
 */
export function sessionOfRow(ctx: ClientContext, element: Element): string | undefined {
  try {
    const owner = element.closest('[data-sidebar-right-session]')
    const fromDom = owner?.getAttribute('data-sidebar-right-session')
    if (typeof fromDom === 'string' && fromDom !== '') return fromDom
    const sidebar = ctx.reflect?.get('sidebarRight') as SidebarRightService | undefined
    const mounted = sidebar?.mounted?.getSnapshot()
    if (typeof mounted === 'string' && mounted !== '') return mounted
    return undefined
  } catch {
    // A service that answers by throwing costs this one gesture, not the tree.
    return undefined
  }
}
