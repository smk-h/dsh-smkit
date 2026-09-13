/**
 * Types the MCP feature owns.
 *
 * The props DSH hands its settings section, and the view models its forms edit.
 * The wire shapes themselves are the contract shared with the host half; they
 * are re-exported through `platform/types` for now, so a component keeps one
 * import site for both infrastructure and business types — the MCP half of the
 * contract moves under this feature when the contract itself is split.
 */

import type { ServerView, Translator, WorkspaceServerView } from '../../platform/types'

/** Props every settings section component receives from the slot system. */
export interface SectionProps {
  t: Translator
}

/** One editable key/value row in the server form. */
export interface KeyValueRow {
  key: string
  value: string
}

/** Either tier can seed the edit form. */
export type EditableServer = ServerView | WorkspaceServerView
