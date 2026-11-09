/**
 * `/mcp` — drive the project's MCP tools without spending a model turn.
 *
 * The command is a host-side caller, not a model surface: it runs in the same
 * process as the MCP connections, so a call lands on the very server process the
 * model would use (a serial or SSH session lives there and cannot be re-created
 * elsewhere), and its output never enters the conversation context.
 *
 * ## What it exposes
 *
 * A single command with three sub-actions rather than one command per tool: the
 * tool set changes with each server connect/disconnect and every `mcp.json`
 * edit, while a registered command name is fixed. It also has to be: the host
 * accepts `/^[a-z][a-z0-9_-]*$/u` only, so an MCP tool name (`server.action`,
 * capitalised words) cannot be a command name at all.
 *
 * ## Which registry it reads
 *
 * The clicked agent's own tool table when it has one (`agent.ctx.tools`), the
 * plugin-wide table otherwise. Workspace servers register into the agent's
 * table, so `list` and `call` see exactly what that project's sessions see, and
 * nothing from another project leaks in.
 *
 * ## The broker's guard
 *
 * With on-demand tool injection on, a `guard` hides direct `mcp__*` calls made
 * with an agent. A host-side caller is approved through the broker's own token
 * set (`approveDirectCall`) around the execution, which keeps one pipeline for
 * every entry point: the model's `tools/call`, the broker's nested call, and
 * this command all end in `tools.execute`.
 */

import { LOG_PREFIX } from './constants.js'
import { brokerCatalog } from './broker/definitions.js'
import { searchToolEntries } from './broker/search.js'
import { executeToolCall } from './mcp/execute.js'
import type { PluginContext } from '../../platform/context.js'
import type { AgentLike, ContentBlock, LoggerLike, ToolsRegistry } from './types.js'

/** The command name; the user types `/mcp`. */
export const MCP_COMMAND = 'mcp'

/** How many tools `list` and `search` print before truncating. */
const LIST_LIMIT = 50

/** How many optional parameters an example line spells out. */
const OPTIONAL_EXAMPLE_LIMIT = 3

const USAGE = [
  'Usage:',
  '  /mcp list                 list the MCP servers visible in this project',
  "  /mcp list <server>        list one server's tools",
  '  /mcp help <name>          show one tool’s parameters and a call example',
  '  /mcp search <query>       search every visible tool by keyword',
  '  /mcp call <name> [json]   call one tool by exact name, arguments as a JSON object',
].join('\n')

/** The slice of one command invocation this module reads. */
interface CommandInvocationLike {
  /** Pairing id already written to the session's `command/run` event. */
  commandId: string
  /** The agent whose UI received the command. */
  agent: AgentLike
  /** Text following the command name, including its separator whitespace. */
  rawInput: string
  signal: AbortSignal
}

/** What the dispatching UI renders for one settled command. */
type CommandResultLike =
  | { kind: 'success'; text?: string }
  | { kind: 'error'; text: string }

/** The registration shape this module depends on (host `commands` service). */
interface CommandDefinitionLike {
  name: string
  description: string
  input?: { hint: string }
  handler(
    invocation: CommandInvocationLike,
  ): CommandResultLike | Promise<CommandResultLike>
}

/** The slice of the host's `commands` service this module uses. */
interface CommandsLike {
  register(definition: CommandDefinitionLike): () => void
}

export interface McpCommandDeps {
  logger: LoggerLike
  /** The plugin-wide table: the fallback for an agent that carries none. */
  tools: ToolsRegistry
  /**
   * Broker's direct-call approval; absent when the MCP feature never built a
   * broker runtime (it always does, but a harness may not). The guard waves a
   * call through only when it carries the returned `token` as its `parent`, so
   * the token travels on the execution itself.
   */
  approveDirectCall?: (callId: string) => { token: unknown; release: () => void }
}

/** Split one invocation's input into its sub-action and the rest. */
function parseInput(rawInput: string): { action: string; rest: string } {
  const text = rawInput.trim()
  if (text === '') return { action: 'help', rest: '' }
  const space = text.search(/\s/u)
  if (space < 0) return { action: text.toLowerCase(), rest: '' }
  return { action: text.slice(0, space).toLowerCase(), rest: text.slice(space + 1).trim() }
}

/** The tool table a command run by `agent` must read. */
function registryFor(deps: McpCommandDeps, agent: AgentLike): ToolsRegistry {
  const own = agent.ctx?.tools
  return own ?? deps.tools
}

/** One tool as one printable line. */
function toolLine(entry: { schema: { name: string; description?: string } }): string {
  const description = String(entry.schema.description ?? '').replace(/\s+/gu, ' ').trim()
  return description === ''
    ? `  ${entry.schema.name}`
    : `  ${entry.schema.name} — ${description.slice(0, 160)}`
}

/** One tool's input schema, read the way the command surface can print it. */
interface ParameterSheet {
  /** Print-ready lines, `*name (type)` for required ones. */
  lines: string[]
  /** Names the schema marks required. */
  required: string[]
  /** Every declared parameter name. */
  names: string[]
  /**
   * The shortest call that can work: a JSON object with every required
   * parameter, or `''` when nothing is required (a bare call is then valid).
   */
  minimal: string
  /**
   * The same call with a few optional parameters spelled out, so the reader
   * sees how they are shaped. `''` when the schema declares no optional ones.
   */
  full: string
}

/** One declared property, as far as this printer reads it. */
interface SchemaProperty {
  type?: unknown
  description?: unknown
  enum?: unknown
  default?: unknown
}

/**
 * A placeholder value for one property, so the example object parses as-is.
 *
 * An `enum` or a `default` is the server answering the question itself, so
 * those are used verbatim (a real choice beats a placeholder); everything else
 * gets a typed literal, and a string gets `…` — the reader replaces it.
 *
 * @param property - one declared property of the tool schema.
 * @returns a JSON-serialisable placeholder.
 */
function exampleValue(property: SchemaProperty): unknown {
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
 * Project a tool's JSON-Schema parameters into printable lines.
 *
 * The command surface is plain text, so the schema is flattened: one line per
 * property, required ones marked with `*`, the declared type in parentheses,
 * and the server's own description after the dash. `enum` members are printed
 * because they are the one constraint a caller cannot guess from a type.
 *
 * @param parameters - the tool definition's `parameters` (open-ended on purpose:
 *   a server writes this schema, not this plugin).
 * @returns the lines, the two name sets the caller reasons about, and a
 *   call-shaped example built from the required parameters.
 */
function parameterSheet(parameters: unknown): ParameterSheet {
  const spec = (parameters ?? {}) as {
    properties?: Record<string, SchemaProperty>
    required?: unknown
  }
  const properties = spec.properties ?? {}
  const required = Array.isArray(spec.required) ? spec.required.map(String) : []
  const names = Object.keys(properties)
  const lines = names.map((name) => {
    const property = properties[name] ?? {}
    const type = typeof property.type === 'string'
      ? property.type
      : Array.isArray(property.enum) ? 'enum' : 'any'
    const description = String(property.description ?? '').replace(/\s+/gu, ' ').trim()
    const choices = Array.isArray(property.enum)
      ? ` — one of: ${property.enum.map(String).join(', ')}`
      : ''
    return `  ${required.includes(name) ? '*' : ' '}${name} (${type})${description === '' ? '' : ` — ${description}`}${choices}`
  })
  const requiredNames = names.filter((name) => required.includes(name))
  const optionalNames = names.filter((name) => !required.includes(name)).slice(0, OPTIONAL_EXAMPLE_LIMIT)
  const sample = (chosen: readonly string[]): string => chosen.length === 0
    ? ''
    : JSON.stringify(
      Object.fromEntries(chosen.map((name) => [name, exampleValue(properties[name] ?? {})])),
    )
  return {
    lines,
    required,
    names,
    minimal: sample(requiredNames),
    full: sample([...requiredNames, ...optionalNames]),
  }
}

/**
 * The full "how do I call this" sheet: one ready-to-paste command line first,
 * then what the tool does and every parameter it takes.
 *
 * The example leads because the collapsed command card shows only the first
 * line of the text — with the example up there, the caller sees the command
 * without expanding anything, and the reference below is what they open for.
 *
 * @param name - exact public tool name.
 * @param entry - the catalog row, for the description and schema.
 * @param lead - why the sheet is being shown; empty for a plain `describe`.
 * @returns the printable block.
 */
function callSheet(
  name: string,
  entry: { schema: { description?: string; parameters?: unknown } },
  lead: string,
): string {
  const sheet = parameterSheet(entry.schema.parameters)
  const description = String(entry.schema.description ?? '').replace(/\s+/gu, ' ').trim()
  // Two shapes when they differ: the shortest call that works, then the same
  // call with a few optional parameters spelled out. When the schema declares
  // nothing optional they collapse into one line, and no duplicate is printed.
  const minimalLine = sheet.minimal === ''
    ? `/mcp call ${name}`
    : `/mcp call ${name} ${sheet.minimal}`
  const fullLine = sheet.full === '' || sheet.full === sheet.minimal
    ? ''
    : `/mcp call ${name} ${sheet.full}`
  return [
    minimalLine,
    ...(fullLine === '' ? [] : [fullLine]),
    '',
    ...(lead === '' ? [] : [lead]),
    ...(description === '' ? [] : [description]),
    ...(lead === '' && description === '' ? [] : ['']),
    'Parameters (* marks required):',
    ...(sheet.lines.length === 0 ? ['  (this tool declares no parameters)'] : sheet.lines),
  ].join('\n')
}

/** Render one execution's content blocks as text the command card can show. */
function renderContent(content: readonly ContentBlock[] | undefined): string {
  const blocks = content ?? []
  if (blocks.length === 0) return '(no output)'
  return blocks
    .map((block) => {
      if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
        return (block as { text: string }).text
      }
      // A projector may have rewritten the block (an image from a screenshot,
      // for instance); the command surface is text, so name what it is.
      return `[${block.type} output]`
    })
    .join('\n')
}

/**
 * Read one tool result the way the command surface can show it.
 *
 * @param result - what `tools.execute` answered.
 * @returns the printable text, or the failure message.
 */
function resultText(result: {
  isError?: boolean
  error?: { message?: string }
  content?: ContentBlock[]
}): { text: string; failed: boolean } {
  if (result.isError === true) {
    return { text: result.error?.message ?? 'The MCP tool reported an error.', failed: true }
  }
  return { text: renderContent(result.content), failed: false }
}

/**
 * Install `/mcp` on a context that has the host's command service.
 *
 * @param childCtx - the injected child context (`commands` in scope).
 * @param deps - the registry, logger and broker approval.
 */
export function installMcpCommand(childCtx: PluginContext, deps: McpCommandDeps): void {
  const commands = childCtx.commands as CommandsLike | undefined
  if (commands === undefined || typeof commands.register !== 'function') return
  childCtx.effect(
    () => commands.register({
      name: MCP_COMMAND,
      description: 'List this project\'s MCP servers, show a tool\'s parameters, or call one',
      input: { hint: 'list [server] | help <name> | search <query> | call <name> [json]' },
      async handler(invocation) {
        const { action, rest } = parseInput(invocation.rawInput)
        const registry = registryFor(deps, invocation.agent)

        // Bare `/mcp help` is the usage block; `help <name>` is the tool sheet
        // below (the same answer `describe` gives, kept as an alias).
        if (action === 'help' && rest === '') return { kind: 'success', text: USAGE }

        if (action === 'list' || action === 'search') {
          const catalog = brokerCatalog(registry, invocation.agent).map((entry) => ({
            name: entry.schema.name,
            server: entry.server,
            tool: entry.tool,
            description: String(entry.schema.description ?? ''),
          }))
          if (catalog.length === 0) {
            return {
              kind: 'success',
              text: 'No MCP server exposes tools to this project. Enable a server in Settings → MCP, or open a workspace that has one.',
            }
          }
          // `list` names the SERVERS first: that is the unit a reader thinks in
          // ("what is connected"), and a project with several servers can carry
          // hundreds of tools. One server's tools are one `list <server>` away.
          if (action === 'list' && rest === '') {
            const counts = new Map<string, number>()
            for (const entry of catalog) counts.set(entry.server, (counts.get(entry.server) ?? 0) + 1)
            const rows = [...counts.entries()]
              .sort((left, right) => left[0].localeCompare(right[0]))
              .map(([server, tools]) => `  ${server} — ${tools} tool${tools === 1 ? '' : 's'}`)
            return {
              kind: 'success',
              text: [
                `${counts.size} MCP server${counts.size === 1 ? '' : 's'} visible in this project:`,
                ...rows,
                '',
                'Run "/mcp list <server>" for one server\'s tools, or "/mcp search <query>" to search all of them.',
              ].join('\n'),
            }
          }
          if (action === 'list') {
            const own = catalog.filter((entry) => entry.server === rest)
            if (own.length === 0) {
              return {
                kind: 'error',
                text: `No MCP server named "${rest}" exposes tools to this project. Run "/mcp list" for the names.`,
              }
            }
            const shown = own.slice(0, LIST_LIMIT).map((entry) => toolLine({ schema: entry }))
            const truncated = own.length > shown.length
              ? `\n… ${own.length - shown.length} more; raise the server's tool set or call one by name.`
              : ''
            return {
              kind: 'success',
              text: [
                `${own.length} tool${own.length === 1 ? '' : 's'} from MCP server "${rest}":`,
                ...shown,
                ...(truncated === '' ? [] : [truncated]),
                '',
                'Run "/mcp help <name>" to see one tool\'s parameters.',
              ].join('\n'),
            }
          }
          const found = searchToolEntries(catalog, { query: rest, limit: LIST_LIMIT })
          if (found.total === 0) {
            return {
              kind: 'success',
              text: `No MCP tool matched "${rest}". ${catalog.length} tools are visible in this project.`,
            }
          }
          const shown = found.matches.map((entry) => toolLine({ schema: entry }))
          const truncated = found.total > shown.length
            ? `\n… ${found.total - shown.length} more; narrow the query to see them.`
            : ''
          return {
            kind: 'success',
            text: `${found.total} MCP tool${found.total === 1 ? '' : 's'} matched "${found.query}":\n${shown.join('\n')}${truncated}`,
          }
        }

        if (action === 'call' || action === 'describe' || action === 'help') {
          const space = rest.search(/\s/u)
          const name = space < 0 ? rest : rest.slice(0, space)
          const rawArguments = space < 0 ? '' : rest.slice(space + 1).trim()
          if (name === '') return { kind: 'error', text: USAGE }
          const visible = brokerCatalog(registry, invocation.agent).find(
            (entry) => entry.schema.name === name,
          )
          if (visible === undefined) {
            return {
              kind: 'error',
              text: `MCP tool "${name}" is not visible in this project. Run "/mcp list" for the exact names.`,
            }
          }
          // `help <name>` never executes: it is the "what does this one take?"
          // answer, and the same sheet a `call` shows when it is missing
          // something. `describe` stays as the older spelling.
          if (action !== 'call') {
            return { kind: 'success', text: callSheet(name, visible, '') }
          }
          let args: unknown = {}
          if (rawArguments !== '') {
            try {
              args = JSON.parse(rawArguments)
            } catch (error) {
              return {
                kind: 'error',
                text: callSheet(
                  name,
                  visible,
                  `Arguments must be one JSON object (${(error as Error).message}). This tool takes:`,
                ),
              }
            }
            if (args === null || typeof args !== 'object' || Array.isArray(args)) {
              return {
                kind: 'error',
                text: callSheet(name, visible, 'Arguments must be one JSON object. This tool takes:'),
              }
            }
          }
          // A call missing a required parameter would fail at the server with
          // its own wording; naming the gaps here is the difference between a
          // guess and a next step. Only `required` is checked — anything else
          // is the server's business.
          const sheet = parameterSheet(visible.schema.parameters)
          const missing = sheet.required.filter((key) => !(key in (args as Record<string, unknown>)))
          if (missing.length > 0) {
            return {
              kind: 'error',
              text: callSheet(
                name,
                visible,
                `Missing required argument${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. This tool takes:`,
              ),
            }
          }
          // Broker mode waits for the approval token on the execution itself
          // (`parent`), not for anything on this scope; the release runs even
          // when execution throws. Outside broker mode the token is simply
          // never read.
          const approval = deps.approveDirectCall?.(invocation.commandId)
          try {
            const result = await executeToolCall(registry, {
              callId: invocation.commandId,
              name,
              arguments: args,
              agent: invocation.agent,
              ...(approval === undefined ? {} : { parent: approval.token }),
              signal: invocation.signal,
            })
            const { text, failed } = resultText(result)
            return failed
              ? { kind: 'error', text: `${name} failed: ${text}` }
              : { kind: 'success', text: `${name}\n${text}` }
          } catch (error) {
            deps.logger.warn(`${LOG_PREFIX}: /mcp call ${name} failed: ${(error as Error).message}`)
            return { kind: 'error', text: `${name} failed: ${(error as Error).message}` }
          } finally {
            approval?.release()
          }
        }

        return { kind: 'error', text: `Unknown sub-command "${action}".\n${USAGE}` }
      },
    }),
    'mcp: /mcp command',
  )
}
