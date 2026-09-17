/**
 * Types the MCP feature owns.
 *
 * The props DSH hands its settings section, and the view models its forms edit.
 * The wire shapes themselves are the contract shared with the host half; they
 * are re-exported through `platform/types` for now, so a component keeps one
 * import site for both infrastructure and business types — the MCP half of the
 * contract moves under this feature when the contract itself is split.
 */

import type { Translator } from '../../platform/types'
import type { ServerView, WorkspaceServerView } from '../../../shared/mcp/contract'

/*
 * The MCP half of the wire contract shared with the host half. Re-exported so
 * this feature's components keep one import site for their business types and
 * for these wire shapes.
 */
export type {
  AuthMode,
  EnvMap,
  ServerStatus,
  ServerType,
  ServerView,
  SettingsView,
  WorkspaceServerView,
  WorkspaceView,
} from '../../../shared/mcp/contract'

/**
 * Mirror of the host's `DEFAULT_TOOL_CALL_TIMEOUT_MS` (`host/features/mcp/constants.ts`).
 * The contract carries no runtime values, so the section needs one number of its
 * own for the render before the first `/settings` answer arrives; every later
 * render uses the value the host reported. The host re-validates every write, so
 * this copy never has to know the bounds.
 */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

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
