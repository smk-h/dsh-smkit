/**
 * Cross-cutting constants for the MCP server manager.
 *
 * `STATE_PATH` is derived from `homedir()` at module-evaluation time, which is
 * why every test points `HOME` at a scratch directory *before* importing the
 * plugin (see the `test/*.mjs` suites).
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Profile-level state file: server configs plus OAuth tokens (secrets!). */
export const STATE_PATH = join(homedir(), '.dsh', 'mcp-manager.json')

/** JSON API base, mounted on the DSH GUI webserver. */
export const API_PREFIX = '/mcp-manager/api'

/** OAuth redirect receiver prefix. */
export const CALLBACK_PATH = '/mcp-manager/callback'

/** Prefix route the GUI webserver mounts. */
export const ROUTE_PATH = '/mcp-manager'

/** Per-workspace declarative config, Claude/Codex style. */
export const WORKSPACE_CONFIG_REL = join('.dsh', 'dshmm', 'mcp.json')

/** MCP protocol revision the client advertises. */
export const MCP_PROTOCOL_VERSION = '2025-03-26'

/** DSH client bundle id / diagnostics prefix. */
export const PLUGIN_ID = '@smai-kit/dsh-smkit'

/** `ctx.logger` message prefix. */
export const LOG_PREFIX = 'mcp-manager'

/** Localised `mcp` namespace registered in the browser half. */
export const LOCALE_NAMESPACE = 'mcp'

/** Cap applied to error strings persisted into live status. */
export const MAX_ERROR_LENGTH = 300

/** Cap applied to tool descriptions forwarded to the registry. */
export const MAX_DESCRIPTION_LENGTH = 2000

/** Public tool names longer than this get a sha256 suffix. */
export const MAX_TOOL_NAME_LENGTH = 64

/** Per-server `mcp__<name>__*` name rule, enforced on both tiers. */
export const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

/** Raster formats the DSH attachment vocabulary accepts. */
export const IMAGE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/** Canonical (re-encoded-safe) base64, matching the durable attachment rule. */
export const CANONICAL_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** MCP `clientInfo` reported on initialize. */
export const MCP_CLIENT_INFO = { name: 'dsh-mcp-manager', version: '0.6.0' } as const
