/**
 * `/mcp` — the host-side command that lists, searches and calls the project's
 * MCP tools without a model turn.
 *
 * What is worth pinning:
 *
 * - the command registers itself only when the composition has a `commands`
 *   service, and it reads the agent's own tool table when the agent carries one
 *   (so a workspace server's tools are visible and another project's are not);
 * - `list` prints the catalog, `search` ranks it, and both survive an empty
 *   catalog without throwing;
 * - `call` validates visibility first, parses one JSON object, and forwards the
 *   exact name/arguments/agent/signal to `tools.execute`;
 * - an execution error comes back as a command error, and a missing tool or a
 *   malformed JSON payload never reaches the registry;
 * - an unknown sub-command answers with the usage block.
 *
 * The MCP feature is mounted on its own (not the whole plugin): this file is
 * about one command, and a full `apply` would drag every feature's mount into
 * the harness.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'

// The state path is derived from homedir() at module evaluation time.
const scratchHome = mkdtempSync(join(tmpdir(), 'smkit-command-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = scratchHome
process.env.DSH_HOME = scratchHome

const { mcpFeature } = await import('../lib/host/features/mcp/host.js')

/** One tool schema, as `tools.schemas()` reports it. */
function schema(name, description) {
  return { name, description, parameters: { type: 'object', properties: {} } }
}

/**
 * A tool registry stand-in: the questions this command asks are `schemas`,
 * `get` and `execute`, and every answer is recorded.
 */
function registry(schemas, options = {}) {
  const executed = []
  const state = {
    executed,
    /** The raw input of the last execution, in whichever shape it arrived. */
    lastInput: undefined,
    /** The installed guard, if any: the harness runs it before every execute. */
    guard: undefined,
    tools: {
      register: () => () => {},
      restrict: () => () => {},
      guard: (check) => {
        state.guard = check
        return () => { state.guard = undefined }
      },
      schemas: () => schemas,
      get: (name) => {
        const found = schemas.find((entry) => entry.name === name)
        if (found === undefined) return undefined
        return {
          ...found,
          mcpServerName: name.split('__')[1],
          mcpRawName: name.split('__').slice(2).join('__'),
        }
      },
      execute: async (call) => {
        state.lastInput = call
        // The two service generations are flattened back to one call here, the
        // way `executeToolCall` asks for both shapes at once.
        const block = Array.isArray(call.calls) ? call.calls[0] : undefined
        const flat = {
          callId: call.callId ?? block?.id,
          name: call.name ?? block?.name,
          arguments: call.arguments ?? JSON.parse(block?.arguments ?? '{}'),
          parent: call.parent,
        }
        // The host runs the installed guard before the definition; so does
        // this stand-in, which is what makes the approval token observable.
        // An agent-scoped table borrows the plugin-wide guard, the way a
        // workspace table shares one execution pipeline in the real host.
        const guard = state.guardSource?.guard ?? state.guard
        if (guard !== undefined && String(flat.name).startsWith('mcp__')) {
          const refusal = guard({ ...flat, agent: {} })
          if (refusal !== undefined) throw new Error(refusal)
        }
        executed.push(flat)
        const outcome = options.fail === true
          ? { isError: true, error: { message: 'device is busy' }, content: [] }
          : { isError: false, content: [{ type: 'text', text: 'ok from ' + flat.name }] }
        // `singleCall` models DSH 0.1.x, which answers the outcome itself.
        return options.singleCall === true
          ? outcome
          : { results: [{ callId: flat.callId, result: outcome }], additionalContexts: [], concluded: false }
      },
    },
  }
  return state
}

/** Mount the MCP feature against a command service stand-in. */
function mount(options = {}) {
  // Each mount sees a deterministic state file: the feature loads it at mount.
  mkdirSync(join(scratchHome, '.dsh'), { recursive: true })
  writeFileSync(
    join(scratchHome, '.dsh', 'mcp-manager.json'),
    JSON.stringify({ servers: [], workspaceTokens: {}, onDemandToolInjection: options.onDemand === true }),
  )
  const global = registry(options.globalSchemas ?? [])
  const agentSchemas = options.agentSchemas ?? []
  const agentTools = registry(agentSchemas, options)
  agentTools.guardSource = global

  const registered = []
  const effects = []
  const childCtx = {
    effect: (callback) => { effects.push(callback()) },
    commands: {
      register: (definition) => {
        registered.push(definition)
        return () => {}
      },
    },
  }
  const logger = { info: () => {}, warn: () => {}, error: () => {} }
  const ctx = {
    logger,
    tools: global.tools,
    on: () => () => {},
    effect: (callback) => { effects.push(callback()) },
    inject: (names, callback) => {
      if (options.commands !== false && names.includes('commands')) callback(childCtx)
      return { dispose: () => {} }
    },
  }
  mcpFeature.mount({
    logger,
    tools: global.tools,
    services: { get: () => undefined },
    ctx,
    handlers: [],
    outsideApi: [],
  })

  const definition = registered.find((entry) => entry.name === 'mcp')

  /** Run one invocation the way the host's executor would. */
  function run(rawInput, agent = { ctx: { tools: agentTools.tools } }) {
    assert.ok(definition, 'the command registered itself')
    return definition.handler({
      commandId: 'cmd-1',
      agent,
      rawInput,
      signal: new AbortController().signal,
    })
  }

  return { run, registered, agentTools, global, definition, effects }
}

const THREE_TOOLS = [
  schema('mcp__board__serial_exec', 'Run one command on the serial console'),
  schema('mcp__board__serial_log', 'Read the console log'),
  schema('read_file', 'A host tool, not MCP'),
]

it('registers one /mcp command, with a hint that names its sub-commands', () => {
  const view = mount()
  assert.equal(view.registered.length, 1)
  assert.equal(view.definition.name, 'mcp')
  assert.match(view.definition.input.hint, /list/)
  assert.match(view.definition.input.hint, /call/)
})

it('stands down on a host with no command service', () => {
  const view = mount({ commands: false })
  assert.deepEqual(view.registered, [])
})

it('lists the servers, not their tools', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS, globalSchemas: [schema('mcp__other__tool', 'Elsewhere')] })
  const result = await view.run(' list')
  assert.equal(result.kind, 'success')
  assert.match(result.text, /1 MCP server visible in this project/)
  assert.match(result.text, /board — 2 tools/)
  assert.doesNotMatch(result.text, /mcp__board__serial_exec/, 'tools wait for the server name')
  assert.doesNotMatch(result.text, /mcp__other__tool/, 'another project’s server stays out')
  assert.doesNotMatch(result.text, /read_file/, 'non-MCP tools are not counted')
})

it('lists one server’s tools when the server is named', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS })
  const result = await view.run(' list board')
  assert.equal(result.kind, 'success')
  assert.match(result.text, /2 tools from MCP server "board"/)
  assert.match(result.text, /mcp__board__serial_exec/)
  assert.match(result.text, /mcp__board__serial_log/)
  assert.doesNotMatch(result.text, /read_file/)
})

it('refuses a server it cannot see', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS })
  const result = await view.run(' list other')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /No MCP server named "other"/)
})

it('says so when the project has no MCP server at all', async () => {
  const view = mount({ agentSchemas: [] })
  const result = await view.run(' list')
  assert.equal(result.kind, 'success')
  assert.match(result.text, /No MCP server exposes tools/)
})

it('searches the catalog by keyword', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS })
  const result = await view.run(' search console')
  assert.equal(result.kind, 'success')
  assert.match(result.text, /matched "console"/)
  assert.match(result.text, /mcp__board__serial_exec/)
})

it('calls a visible tool with the parsed JSON object', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS })
  const result = await view.run(' call mcp__board__serial_exec {"cmd":"uptime","timeout":5}')
  assert.equal(result.kind, 'success')
  assert.equal(view.agentTools.executed.length, 1)
  const call = view.agentTools.executed[0]
  assert.equal(call.name, 'mcp__board__serial_exec')
  assert.deepEqual({ ...call.arguments }, { cmd: 'uptime', timeout: 5 })
  assert.equal(call.callId, 'cmd-1', 'the command id pairs the call with its log record')
  assert.match(result.text, /ok from mcp__board__serial_exec/)
})

it('defaults the arguments to an empty object', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS })
  const result = await view.run(' call mcp__board__serial_log')
  assert.equal(result.kind, 'success')
  assert.deepEqual({ ...view.agentTools.executed[0].arguments }, {})
})

it('refuses a tool that is not visible without touching the registry', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS })
  const result = await view.run(' call mcp__other__tool {}')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /not visible in this project/)
  assert.equal(view.agentTools.executed.length, 0)
  assert.equal(view.global.executed.length, 0)
})

it('refuses malformed arguments before executing anything', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS })
  const result = await view.run(' call mcp__board__serial_exec not-json')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /JSON object/)
  assert.equal(view.agentTools.executed.length, 0)

  const array = await view.run(' call mcp__board__serial_exec [1,2]')
  assert.equal(array.kind, 'error')
  assert.match(array.text, /JSON object/)
})

it('turns an execution failure into a command error', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS, fail: true })
  const result = await view.run(' call mcp__board__serial_exec {}')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /device is busy/)
})

it('answers an unknown sub-command with the usage block', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS })
  const unknown = await view.run(' nope')
  assert.equal(unknown.kind, 'error')
  assert.match(unknown.text, /Unknown sub-command/)
  assert.match(unknown.text, /\/mcp list/)

  const help = await view.run('')
  assert.equal(help.kind, 'success')
  assert.match(help.text, /\/mcp call <name> \[json\]/)
})

it('sends both input shapes, so either service generation runs the call once', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS })
  await view.run(' call mcp__board__serial_log {"lines":10}')
  const input = view.agentTools.lastInput
  // 0.2.x reads the batch: raw model calls, arguments as a JSON string.
  assert.equal(input.calls.length, 1)
  assert.equal(input.calls[0].type, 'tool-call')
  assert.equal(input.calls[0].name, 'mcp__board__serial_log')
  assert.deepEqual(JSON.parse(input.calls[0].arguments), { lines: 10 })
  // 0.1.x reads the flat fields; one execution, never a retry.
  assert.equal(input.name, 'mcp__board__serial_log')
  assert.deepEqual({ ...input.arguments }, { lines: 10 })
  assert.equal(view.agentTools.executed.length, 1)
})

it('reads a single-call answer from the older service', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS, singleCall: true })
  const result = await view.run(' call mcp__board__serial_log {}')
  assert.equal(result.kind, 'success')
  assert.match(result.text, /ok from mcp__board__serial_log/)
})

it('passes the broker guard with the approval token it attaches', async () => {
  const view = mount({ agentSchemas: THREE_TOOLS, onDemand: true })
  assert.ok(view.global.guard !== undefined, 'broker mode installed its guard')

  const result = await view.run(' call mcp__board__serial_exec {"cmd":"ls"}')
  assert.equal(result.kind, 'success', result.text)
  assert.equal(view.agentTools.executed.length, 1)
  assert.ok(
    view.agentTools.executed[0].parent !== undefined,
    'the execution carries the token the guard looks for',
  )

  // The same table without an approval is exactly what the guard exists to
  // refuse, which is the control case for the assertion above.
  const refused = view.global.guard({ name: 'mcp__board__serial_exec', agent: {} })
  assert.match(String(refused), /hidden while on-demand MCP tools are enabled/)
})
