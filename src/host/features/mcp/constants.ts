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
