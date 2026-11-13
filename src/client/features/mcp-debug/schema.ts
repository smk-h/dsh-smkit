/**
 * The schema reading the debug form stands on: one flat row per declared
 * parameter, one argument object back out of what the reader typed.
 *
 * The page renders a form *and* a raw JSON box, which have to agree. Both build
 * the same `arguments` object, so the coercion rules live here instead of in the
 * component: a field is included only when it was filled in (an empty box is
 * "not sent", which is what an optional parameter means), a number is a number,
 * an object/array is parsed, and anything the schema left unconstrained is sent
 * as text unless it parses as JSON.
 *
 * The values arrive as strings because that is what an `<input>` yields; nothing
 * here reads the DOM, and nothing here writes copy: a refusal is a dictionary
 * key plus the parameter it is about, which the pane translates (this half may
 * carry no user-visible string of its own — see `test/client-language.test.mjs`).
 */

import type { ToolView } from './types'

/** One declared parameter, flattened. */
export interface FieldSpec {
  name: string
  /** Declared type, or `any` when the schema only annotated the value. */
  type: string
  required: boolean
  description: string
  /**
   * The members of a declared `enum`, in the server's order. `null` when the
   * schema declares none — the difference between "pick one of these" and "type
   * anything", which the form's control follows.
   */
  enumValues: Array<string | number | boolean> | null
}

/**
 * Why the page will not send a call it built itself.
 *
 * `key` is a key of the `mcp-debug` dictionary and `values` its interpolation;
 * the pane renders it exactly like any other message, so a refusal and a
 * server's answer look alike without this module knowing any language.
 */
export interface LocalRefusal {
  key: string
  values?: Record<string, unknown>
}

/** One field the form could not send, and why. */
export interface InvalidField {
  name: string
  refusal: LocalRefusal
}

/** A value a form can send, and why it cannot when it cannot. */
export interface PreparedArguments {
  args?: Record<string, unknown>
  /**
   * Every field that could not be sent, in schema order — all of them, not the
   * first: a reader who missed two required parameters should see both marked
   * at once instead of fixing them one round trip at a time.
   */
  invalid?: InvalidField[]
  /** A refusal about the whole argument bag (the raw JSON box), not one field. */
  refusal?: LocalRefusal
}

/** The property bag of one tool, as `convParams` left it. */
type PropertyBag = Record<string, unknown>

/** One `properties` entry, as far as this module reads it. */
function fieldOf(name: string, node: unknown, required: Set<string>): FieldSpec {
  const spec = node !== null && typeof node === 'object' ? (node as Record<string, unknown>) : {}
  const declared = typeof spec.type === 'string' ? spec.type : ''
  const members = Array.isArray(spec.enum)
    ? spec.enum.filter(
        (value): value is string | number | boolean =>
          typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
      )
    : []
  return {
    name,
    type: declared === '' ? (Array.isArray(spec.oneOf) ? 'oneOf' : 'any') : declared,
    required: required.has(name),
    description: typeof spec.description === 'string' ? spec.description : '',
    enumValues: members.length > 0 ? members : null,
  }
}

/**
 * The parameter rows of one tool, in schema order.
 *
 * @param parameters - the view's sanitised schema (root object with
 *   `properties`/`required`); a tool declaring none arrives as an empty map.
 * @returns one row per declared property, empty when there is nothing to send.
 */
export function fieldsOf(parameters: ToolView['parameters'] | undefined): FieldSpec[] {
  if (parameters === null || typeof parameters !== 'object') return []
  const properties = parameters.properties
  if (properties === null || typeof properties !== 'object') return []
  const bag = properties as PropertyBag
  const required = new Set(
    Array.isArray(parameters.required)
      ? parameters.required.filter((name): name is string => typeof name === 'string')
      : [],
  )
  return Object.keys(bag).map((name) => fieldOf(name, bag[name], required))
}

/** Coerce one typed-in field into the value its schema declares. */
function coerce(field: FieldSpec, text: string): { value: unknown } | { refusal: LocalRefusal } {
  const trimmed = text.trim()
  if (field.enumValues !== null) {
    const member = field.enumValues.find((candidate) => String(candidate) === trimmed)
    if (member === undefined) {
      return {
        refusal: {
          key: 'errEnum',
          values: { field: field.name, values: field.enumValues.map(String).join(' / ') },
        },
      }
    }
    return { value: member }
  }
  switch (field.type) {
    case 'boolean':
      if (trimmed === 'true') return { value: true }
      if (trimmed === 'false') return { value: false }
      return { refusal: { key: 'errBoolean', values: { field: field.name } } }
    case 'number':
    case 'integer': {
      const value = Number(trimmed)
      if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) {
        return { refusal: { key: field.type === 'integer' ? 'errInteger' : 'errNumber', values: { field: field.name } } }
      }
      return { value }
    }
    case 'object':
    case 'array': {
      try {
        const value: unknown = JSON.parse(trimmed)
        const matches =
          field.type === 'array' ? Array.isArray(value) : value !== null && typeof value === 'object'
        if (!matches) {
          return { refusal: { key: field.type === 'array' ? 'errArray' : 'errObject', values: { field: field.name } } }
        }
        return { value }
      } catch {
        return { refusal: { key: 'errJson', values: { field: field.name } } }
      }
    }
    default:
      // `any` / `oneOf` / `null` / `string`: text is the value, except that a
      // JSON literal is what an unconstrained field usually wants to send.
      if (field.type === 'string' || field.type === 'null') return { value: text }
      try {
        return { value: JSON.parse(trimmed) }
      } catch {
        return { value: text }
      }
  }
}

/**
 * Build the `arguments` object from what the form holds.
 *
 * @param fields - the tool's parameter rows.
 * @param values - one raw string per field, keyed by name; a missing key is an
 *   untouched field.
 * @returns the object to send, or the first refusal named after its field.
 */
export function buildArguments(
  fields: readonly FieldSpec[],
  values: Record<string, string>,
): PreparedArguments {
  const args: Record<string, unknown> = {}
  const invalid: InvalidField[] = []
  for (const field of fields) {
    const text = values[field.name] ?? ''
    if (text.trim() === '') {
      if (field.required) {
        invalid.push({ name: field.name, refusal: { key: 'errRequired', values: { field: field.name } } })
      }
      continue
    }
    const coerced = coerce(field, text)
    if ('refusal' in coerced) {
      invalid.push({ name: field.name, refusal: coerced.refusal })
      continue
    }
    args[field.name] = coerced.value
  }
  if (invalid.length > 0) return { invalid }
  return { args }
}

/**
 * Build the `arguments` object from the raw JSON box.
 *
 * @param text - the box's contents; blank is "no arguments", not a syntax error.
 * @returns the parsed object, or why it cannot be sent.
 */
export function parseRawArguments(text: string): PreparedArguments {
  const trimmed = text.trim()
  if (trimmed === '') return { args: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { refusal: { key: 'errRawJson' } }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { refusal: { key: 'errRawShape' } }
  }
  return { args: parsed as Record<string, unknown> }
}

/**
 * The JSON the raw box is seeded with when a tool is picked: every required
 * parameter with a placeholder of its declared type, so the reader edits values
 * instead of recalling names.
 *
 * @param fields - the tool's parameter rows.
 * @returns a formatted JSON object; `{}` when nothing is required.
 */
export function seedArguments(fields: readonly FieldSpec[]): string {
  const seed: Record<string, unknown> = {}
  for (const field of fields) {
    if (!field.required) continue
    seed[field.name] = placeholder(field)
  }
  return JSON.stringify(seed, null, 2)
}

/** One field's placeholder: the server's own first enum member when it declared any. */
function placeholder(field: FieldSpec): unknown {
  if (field.enumValues !== null && field.enumValues.length > 0) return field.enumValues[0]
  switch (field.type) {
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'array':
      return []
    case 'object':
      return {}
    default:
      return ''
  }
}
