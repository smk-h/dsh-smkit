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

const USAGE = [
  'Usage:',
  '  /mcp list                 list the MCP servers visible in this project',
  "  /mcp list <server>        list one server's tools",
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
  approveDirectCall?: () => { token: unknown; release: () => void }
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
      description: 'List this project\'s MCP servers, search their tools, or call one',
      input: { hint: 'list [server] | search <query> | call <name> [json]' },
      async handler(invocation) {
        const { action, rest } = parseInput(invocation.rawInput)
        const registry = registryFor(deps, invocation.agent)

        if (action === 'help') return { kind: 'success', text: USAGE }

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
              text: `${own.length} tool${own.length === 1 ? '' : 's'} from MCP server "${rest}":\n${shown.join('\n')}${truncated}`,
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

        if (action === 'call') {
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
          let args: unknown = {}
          if (rawArguments !== '') {
            try {
              args = JSON.parse(rawArguments)
            } catch (error) {
              return {
                kind: 'error',
                text: `Arguments must be one JSON object: ${(error as Error).message}`,
              }
            }
            if (args === null || typeof args !== 'object' || Array.isArray(args)) {
              return { kind: 'error', text: 'Arguments must be one JSON object.' }
            }
          }
          // Broker mode waits for the approval token on the execution itself
          // (`parent`), not for anything on this scope; the release runs even
          // when execution throws. Outside broker mode the token is simply
          // never read.
          const approval = deps.approveDirectCall?.()
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
