/**
 * What the `/mcp` picker shows, derived from the two wire views the settings
 * page already reads.
 *
 * The panel answers one question — "which tool, in this project?" — so the rows
 * are grouped by server (the same unit `list` prints and the same heading the
 * model picker uses for a provider) and every row carries the command line it
 * submits. Two rules keep the picker safe and useful:
 *
 * - a tool row completes `/mcp help <public name>`, never a call: `help` prints
 *   the ready-to-paste call line and the parameter sheet without executing
 *   anything, which is exactly what a reader needs after picking a name;
 * - every tool gets a second row that completes `/mcp call <public name>` —
 *   completed, not run. The line carries a parseable placeholder for every
 *   parameter the tool declares, in schema order (`{"name":"…","count":0}`),
 *   each value the same shape the host's own sheet prints; the reader replaces
 *   the `…`s instead of recalling the signature. A tool that declares no
 *   parameter gets the bare call, trailing space included as the edit point.
 *
 * Scope comes from the same two sources the page trusts: the global tier
 * (enabled, connected, not excluded by this workspace) plus the workspace tier
 * of the session's own `cwd`. A project therefore sees its own servers and the
 * shared ones, and never another project's.
 */

import type { ServerView, ToolView, WorkspaceView } from '../../../shared/mcp/contract'
import type { SelectOptionLike, Translator } from '../../platform/types'

/**
 * The prefix a call row's line carries. The picker completes these lines rather
 * than submitting them, so the prefix is also the branch key in `onSelect`.
 */
export const CALL_LINE_PREFIX = '/mcp call '

/** One server's tools, as one picker group. */
export interface ProjectServer {
  name: string
  tools: readonly ToolView[]
}

/** Everything the picker lists for one project. */
export interface ProjectTools {
  servers: readonly ProjectServer[]
}

/** A description as one printable line; 160 chars is the card's own budget. */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, 160)
}

/** One declared property, as far as the placeholder rule reads it. */
interface SchemaPropertyLike {
  type?: unknown
  enum?: unknown
  default?: unknown
}

/** The `properties` map of a sanitised schema (empty when it declares none). */
function propertiesOf(parameters: Record<string, unknown>): Record<string, SchemaPropertyLike> {
  const properties = parameters.properties
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) return {}
  return properties as Record<string, SchemaPropertyLike>
}

/**
 * A placeholder that keeps the example JSON parseable.
 *
 * A server answering with an `enum`/`default` is answering this question
 * itself, so those win; everything else gets a typed literal, and a string gets
 * `…` — the reader replaces it. Deliberately the same rule the host's
 * `help` sheet applies, so the line a row completes and the line the card
 * prints cannot disagree about what a first call looks like.
 */
function placeholderOf(property: SchemaPropertyLike): unknown {
  if (Array.isArray(property.enum) && property.enum.length > 0) return property.enum[0]
  if (property.default !== undefined) return property.default
  switch (property.type) {
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
      return '…'
  }
}

/**
 * The arguments a call row starts from: every parameter the schema declares,
 * each with its placeholder value, serialised as one JSON object in declaration
 * order.
 *
 * Optional parameters are included on purpose. Showing the shortest legal call
 * is the `help` sheet's job; completing a call is the moment to save the reader
 * from recalling the signature, so the line arrives complete and they only
 * replace the `…`s (or delete what this call does not need).
 *
 * @param parameters - the sanitised input schema the wire view carries.
 * @returns the JSON object text, or `''` when the tool declares no parameter at
 *   all — the bare call is then the whole line, with a trailing space as the
 *   edit point.
 */
function argumentSample(parameters: Record<string, unknown>): string {
  const properties = propertiesOf(parameters)
  const names = Object.keys(properties)
  if (names.length === 0) return ''
  return JSON.stringify(
    Object.fromEntries(names.map((name) => [name, placeholderOf(properties[name] ?? {})])),
  )
}

/** One path comparison key: separators unified, trailing slash dropped. */
function pathKey(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
}

/**
 * The servers and tools one project can reach.
 *
 * @param servers - the global tier (`GET /servers`).
 * @param workspaces - every registered workspace (`GET /workspaces`).
 * @param cwd - the session's working directory, when the host reports one.
 * @returns the connected workspace servers of that project first (they are what
 *   the session is about), then the global ones it does not exclude, each name
 *   taken once.
 */
export function projectTools(
  servers: readonly ServerView[],
  workspaces: readonly WorkspaceView[],
  cwd: string | undefined,
): ProjectTools {
  const key = cwd === undefined ? undefined : pathKey(cwd)
  const workspace = key === undefined
    ? undefined
    : workspaces.find((candidate) => pathKey(candidate.path) === key)
  const excluded = new Set(workspace?.exclude ?? [])
  const taken = new Set<string>()
  const collected: ProjectServer[] = []
  const add = (name: string, tools: readonly ToolView[], connected: boolean): void => {
    if (!connected || taken.has(name) || tools.length === 0) return
    taken.add(name)
    collected.push({ name, tools })
  }
  for (const server of workspace?.servers ?? []) {
    add(server.name, server.tools, server.status === 'connected')
  }
  for (const server of servers) {
    add(server.name, server.tools, server.enabled && server.status === 'connected' && !excluded.has(server.name))
  }
  return { servers: collected }
}

/**
 * The picker rows for one project.
 *
 * @param tools - the resolved project scope.
 * @param t - the feature's bound `t`.
 * @returns the rows, `list` first and then one group per server.
 */
export function commandRows(tools: ProjectTools, t: Translator): readonly SelectOptionLike[] {
  const rows: SelectOptionLike[] = [{
    id: '/mcp list',
    label: t('rowList'),
    detail: t('rowListDetail'),
    group: { name: 'commands', label: t('groupCommands') },
  }]
  for (const server of tools.servers) {
    const group = { name: `server:${server.name}`, label: server.name }
    for (const tool of server.tools) {
      const detail = oneLine(tool.description)
      rows.push({
        id: `/mcp help ${tool.publicName}`,
        label: tool.name,
        ...(detail === '' ? {} : { detail }),
        group,
      })
      const sample = argumentSample(tool.parameters)
      rows.push({
        // The trailing space is the edit point of a parameterless call; with
        // arguments the caret already lands at the end of the object.
        id: sample === ''
          ? `${CALL_LINE_PREFIX}${tool.publicName} `
          : `${CALL_LINE_PREFIX}${tool.publicName} ${sample}`,
        label: tool.name,
        badge: t('badgeCall'),
        ...(detail === '' ? {} : { detail }),
        group,
      })
    }
  }
  return rows
}
