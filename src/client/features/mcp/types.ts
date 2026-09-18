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
import type { ReconnectSettings, ServerView, WorkspaceServerView } from '../../../shared/mcp/contract'

/*
 * The MCP half of the wire contract shared with the host half. Re-exported so
 * this feature's components keep one import site for their business types and
 * for these wire shapes.
 */
export type {
  AuthMode,
  EnvMap,
  ReconnectSettings,
  ServerStatus,
  ServerType,
  ServerView,
  SettingsView,
  ToolView,
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

/**
 * The same mirror for the reconnection knobs (`DEFAULT_AUTO_RECONNECT`,
 * `DEFAULT_RECONNECT_MAX_ATTEMPTS`, `DEFAULT_RECONNECT_MAX_DELAY_MS`,
 * `DEFAULT_HEALTH_CHECK_INTERVAL_MS`), for the same reason and under the same
 * rule: the host owns the bounds, this copy only fills the first render.
 */
export const DEFAULT_RECONNECT_SETTINGS: ReconnectSettings = {
  autoReconnect: true,
  reconnectMaxAttempts: 0,
  reconnectMaxDelayMs: 30_000,
  healthCheckIntervalMs: 30_000,
}

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
