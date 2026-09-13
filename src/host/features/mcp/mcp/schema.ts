/**
 * JSON-Schema sanitisation for the tool registry boundary.
 *
 * The registry accepts only a raw JSON-Schema subset. Unsupported vocabulary
 * (`anyOf`/`allOf`/`$ref`/`pattern`/`format`/bounds/…) degrades to the
 * annotation-only "unconstrained JSON value" form, which the raw boundary
 * allows — the same pass-through shape the official `dsh-mcp-client` uses.
 */

const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])

function isScalar(value: unknown): value is string | number | boolean | null {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
}

function isPlainObj(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function sanitizeValue(node: unknown): Record<string, unknown> {
  if (!isPlainObj(node)) return { description: 'unconstrained JSON value' }
  if (Array.isArray(node.oneOf) && node.oneOf.length >= 2) {
    return { oneOf: node.oneOf.map(sanitizeValue) }
  }
  const type = typeof node.type === 'string' ? node.type : null
  const out: Record<string, unknown> = {}
  if (typeof node.description === 'string') out.description = node.description
  if (type === 'object') {
    out.type = 'object'
    if (typeof node.additionalProperties === 'boolean') out.additionalProperties = node.additionalProperties
    if (isPlainObj(node.properties)) {
      const properties: Record<string, unknown> = {}
      for (const key of Object.keys(node.properties)) {
        properties[key] = sanitizeValue(node.properties[key])
      }
      out.properties = properties
      if (Array.isArray(node.required)) {
        const required = node.required.filter(
          (key): key is string => typeof key === 'string' && key in properties,
        )
        if (required.length > 0) out.required = required
      }
    }
  } else if (type === 'array') {
    out.type = 'array'
    if (node.items != null) out.items = sanitizeValue(node.items)
  } else if (type && SCALAR_TYPES.has(type)) {
    out.type = type
    if (Array.isArray(node.enum)) {
      const values = node.enum.filter(isScalar)
      if (values.length > 0) out.enum = values
    }
    if (isScalar(node.const)) out.const = node.const
  } else {
    // Unsupported vocabulary (anyOf/allOf/$ref/pattern/format/bounds/...):
    // degrade to annotation-only — the raw boundary's unconstrained form.
    out.description = out.description ?? 'unconstrained JSON value'
  }
  return out
}

export function convParams(schema: unknown): Record<string, unknown> {
  const root = sanitizeValue(schema)
  if (root.type !== 'object') return { type: 'object', properties: {} }
  return root
}

/** Value shape returned by an MCP-backed tool's `execute`. */
export const MCP_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string' },
    content: { type: 'array', items: { description: 'MCP content block.' } },
    isError: { type: 'boolean' },
  },
  required: ['text', 'content', 'isError'],
}

export const BROKER_SEARCH_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string' },
    total: { type: 'integer' },
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          server: { type: 'string' },
          tool: { type: 'string' },
          description: { type: 'string' },
          score: { type: 'integer' },
        },
        required: ['name', 'server', 'tool', 'description', 'score'],
      },
    },
  },
  required: ['query', 'total', 'matches'],
}

export const BROKER_DESCRIBE_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    server: { type: 'string' },
    tool: { type: 'string' },
    description: { type: 'string' },
    inputSchema: { description: 'Exact registered JSON Schema for this tool input.' },
  },
  required: ['name', 'server', 'tool', 'description', 'inputSchema'],
}

export const BROKER_EXECUTE_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    content: { type: 'array', items: { description: 'DSH content block.' } },
  },
  required: ['content'],
}
