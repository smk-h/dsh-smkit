/**
 * Shadow stubs: the tool definitions a model sees when the route cannot defer
 * loading.
 *
 * On-demand MCP injection wants the model to see three broker tools instead of
 * every MCP tool. The registry's `deferLoading` marker achieves that on a route
 * that declares `toolUpdate`, but dsh deliberately drops the marker on routes
 * that declare none (an OpenAI-compatible model is the common case): such a
 * route needs every tool immediately available, so the full schemas are sent
 * anyway.
 *
 * A stub keeps the tool's identity — same public name, same server/tool
 * metadata, same `execute` — and replaces only what costs tokens: the
 * description becomes one pointer sentence and the schema becomes an empty
 * object. The model still sees the name (and can call it through
 * `mcp_execute_tool`, or fetch the real schema with `mcp_describe_tool`), while
 * the request carries a fraction of the bytes.
 *
 * The full definition is never lost: connection records keep it, and the broker
 * catalogue reads descriptions and schemas from there, not from the registry.
 */

import { MAX_DESCRIPTION_LENGTH } from '../constants.js'
import type { ToolDefinition } from '../types.js'

/** The schema every stub carries: no arguments, nothing to describe. */
export const STUB_PARAMETERS = { type: 'object', properties: {} } as const

/** Cap on the pointer sentence, matching the tool-description budget. */
const STUB_DESCRIPTION_LIMIT = 160

/**
 * The one sentence a stub carries instead of the real description.
 *
 * @param name - the public tool name, already capped by the naming rules.
 * @returns a description that names the tool and the two ways to learn more.
 */
export function stubDescription(name: string): string {
  const text = `${name}: MCP tool; schema hidden for prompt budget. Call mcp_describe_tool for its arguments, or mcp_execute_tool to run it.`
  return text.slice(0, Math.min(STUB_DESCRIPTION_LIMIT, MAX_DESCRIPTION_LENGTH))
}

/**
 * Turn one full definition into its stub.
 *
 * `execute`, `finalizeContent` and the MCP identity fields are kept by
 * reference, so the name stays executable (the broker dispatches through the
 * very same pipeline) and the settings page still knows which server/tool it
 * belongs to.
 *
 * @param base - the full definition from the connection record.
 * @returns a definition with the same identity and a token-cheap face.
 */
export function stubDefinition(base: ToolDefinition): ToolDefinition {
  return {
    ...base,
    description: stubDescription(base.name),
    parameters: STUB_PARAMETERS,
    deferLoading: true,
  }
}
