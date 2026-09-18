/**
 * Constants of the MCP feature.
 *
 * `STATE_PATH` is derived from `homedir()` at module-evaluation time, which is
 * why every test points `HOME` at a scratch directory *before* importing the
 * plugin (see the `test/*.mjs` suites).
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { PLUGIN_ID, PLUGIN_VERSION } from '../../platform/constants.js'

/*
 * The plugin-wide constants (the route prefixes, the log prefix) are part of
 * this module's surface too: every MCP module already imports `constants.js`,
 * and splitting that import for one or two platform names would say less about
 * ownership than it costs to read.
 */
export * from '../../platform/constants.js'

/** Profile-level state file: server configs plus OAuth tokens (secrets!). */
export const STATE_PATH = join(homedir(), '.dsh', 'mcp-manager.json')

/** Per-workspace declarative config, Claude/Codex style. */
export const WORKSPACE_CONFIG_REL = join('.dsh', 'dshmm', 'mcp.json')

/** MCP protocol revision the client advertises. */
export const MCP_PROTOCOL_VERSION = '2025-03-26'

/** Localised `mcp` namespace registered in the browser half. */
export const LOCALE_NAMESPACE = 'mcp'

/** Cap applied to tool descriptions forwarded to the registry. */
export const MAX_DESCRIPTION_LENGTH = 2000

/** Public tool names longer than this get a sha256 suffix. */
export const MAX_TOOL_NAME_LENGTH = 64

/** Per-server `mcp__<name>__*` name rule, enforced on both tiers. */
export const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

/**
 * `tools/call` timeout in force when the profile stores none, and the bounds the
 * settings page may store. 60 s is the historical per-request value, still used
 * verbatim for `initialize` / `tools/list` (a hung connect must fail fast).
 */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000
export const MIN_TOOL_CALL_TIMEOUT_MS = 1_000
export const MAX_TOOL_CALL_TIMEOUT_MS = 30 * 60_000

/** Refusal of one `tools/call` timeout write, shared by the API and tests. */
export const TOOL_CALL_TIMEOUT_ERROR =
  `timeoutMs must be an integer between ${MIN_TOOL_CALL_TIMEOUT_MS} and ${MAX_TOOL_CALL_TIMEOUT_MS} milliseconds, or null to restore the default`

/*
 * Automatic reconnection of a dropped transport, and the health probe that
 * notices a transport which died without saying so.
 */
export const DEFAULT_AUTO_RECONNECT = true

/** Retry attempts before giving up; 0 keeps retrying for the life of the mount. */
export const DEFAULT_RECONNECT_MAX_ATTEMPTS = 0
export const MIN_RECONNECT_MAX_ATTEMPTS = 0
export const MAX_RECONNECT_MAX_ATTEMPTS = 100

/** First retry waits this long; every later one doubles, up to the cap below. */
export const RECONNECT_BASE_DELAY_MS = 1_000
export const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000
export const MIN_RECONNECT_MAX_DELAY_MS = 1_000
export const MAX_RECONNECT_MAX_DELAY_MS = 600_000

/**
 * How often a connected transport proves it is still alive (`tools/list`, the
 * one request every server answers — it is how the connection was established).
 * 0 turns the probe off and leaves only the transports' own exit signals.
 */
export const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 30_000
export const MIN_HEALTH_CHECK_INTERVAL_MS = 1_000
export const MAX_HEALTH_CHECK_INTERVAL_MS = 600_000

/** Refusals of one reconnect-settings write, shared by the API and tests. */
export const RECONNECT_ATTEMPTS_ERROR =
  `reconnectMaxAttempts must be an integer between ${MIN_RECONNECT_MAX_ATTEMPTS} and ${MAX_RECONNECT_MAX_ATTEMPTS} (0 retries forever), or null to restore the default`
export const RECONNECT_DELAY_ERROR =
  `reconnectMaxDelayMs must be an integer between ${MIN_RECONNECT_MAX_DELAY_MS} and ${MAX_RECONNECT_MAX_DELAY_MS} milliseconds, or null to restore the default`
export const HEALTH_CHECK_ERROR =
  `healthCheckIntervalMs must be 0 (probe off) or an integer between ${MIN_HEALTH_CHECK_INTERVAL_MS} and ${MAX_HEALTH_CHECK_INTERVAL_MS} milliseconds, or null to restore the default`

/** Validation messages shared by the global API and the workspace config. */
export const SERVER_NAME_ERROR =
  'name must be 1-32 chars of [A-Za-z0-9_-] (it becomes the mcp__<name>__ tool prefix)'
export const SERVER_COMMAND_ERROR =
  'stdio server requires a command (executable, e.g. npx / uvx / python)'
export const SERVER_URL_ERROR = 'url must be an http(s) URL'

/** Raster formats the DSH attachment vocabulary accepts. */
export const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/** Canonical (re-encoded-safe) base64, matching the durable attachment rule. */
export const CANONICAL_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** MCP `clientInfo` reported on initialize — the package identity. */
export const MCP_CLIENT_INFO = { name: PLUGIN_ID, version: PLUGIN_VERSION } as const
