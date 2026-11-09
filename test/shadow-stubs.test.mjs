/**
 * Shadow stubs — the token-cheap face a route without `toolUpdate` gets.
 *
 * dsh strips the `deferLoading` marker on such routes (the core needs every tool
 * immediately available), so the marker alone cannot keep full MCP schemas out
 * of the request. A stub keeps the identity and the executor, and drops only
 * the description and the parameter table; the full entry stays in the
 * connection record, which is what `mcp_describe_tool` reads.
 */
import assert from 'node:assert/strict'
import { it } from 'node:test'

const { STUB_PARAMETERS, stubDefinition, stubDescription } = await import(
  '../lib/host/features/mcp/broker/shadow.js'
)
const { registrationSignature, syncToolRegistrations } = await import(
  '../lib/host/features/mcp/mcp/tools.js'
)

/** A full definition shaped like the ones the registry receives. */
function fullDefinition(overrides = {}) {
  return {
    name: 'mcp__rich__serial_exec',
    mcpServerName: 'rich',
    mcpRawName: 'serial_exec',
    description: 'Run one command on an already-open serial session and capture everything it writes back.',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session handle' },
        cmd: { type: 'string', description: 'Exact bytes to send' },
        timeout: { type: 'number', description: 'Seconds to wait' },
      },
      required: ['session_id', 'cmd'],
    },
    deferLoading: true,
    isConcurrencySafe: () => true,
    execute: async () => ({ ok: true }),
    finalizeContent: undefined,
    ...overrides,
  }
}

it('keeps the identity and the executor, and drops only the weight', async () => {
  const base = fullDefinition()
  const stub = stubDefinition(base)

  assert.equal(stub.name, base.name, 'the public name stays callable')
  assert.equal(stub.mcpServerName, 'rich')
  assert.equal(stub.mcpRawName, 'serial_exec')
  assert.equal(stub.execute, base.execute, 'the same executor: a stub is still runnable')
  assert.equal(stub.deferLoading, true)
  assert.deepEqual(stub.parameters, STUB_PARAMETERS)
  assert.equal(stub.parameters.properties && Object.keys(stub.parameters.properties).length, 0)
  assert.ok(stub.description.length <= 160, 'the pointer sentence stays inside the cap')
  assert.match(stub.description, /mcp_describe_tool/)
  assert.match(stub.description, /mcp_execute_tool/)
  // The parameter table is where the bytes are: the pointer sentence is a fixed
  // cost, so a stub always wins as soon as the real schema carries a few
  // properties.
  const baseParams = JSON.stringify(base.parameters).length
  const stubParams = JSON.stringify(stub.parameters).length
  assert.ok(stubParams * 5 < baseParams, `stub parameters must collapse (${stubParams} vs ${baseParams} bytes)`)
  assert.ok(JSON.stringify(stub).length < JSON.stringify(base).length * 0.7, 'a stub is materially smaller')

  const result = await stub.execute({}, { agent: {} })
  assert.deepEqual(result, { ok: true }, 'calling the stub runs the real tool')
})

it('describes the real schema even when the registry row is a stub', async () => {
  const { createBrokerCatalog } = await import('../lib/host/features/mcp/broker/catalog.js')
  const agent = {}
  const full = fullDefinition()
  const runtime = {
    agentScopeState: new Map([[agent, { wsPath: '/ws' }]]),
    workspaces: new Map([
      ['/ws', {
        servers: new Map([
          ['rich', {
            server: { name: 'rich' },
            tools: [{ name: 'serial_exec', description: 'Run one command.', inputSchema: full.parameters }],
          }],
        ]),
      }],
    ]),
    live: new Map(),
  }
  const tools = {
    schemas: () => [{
      name: 'mcp__rich__serial_exec',
      description: stubDescription('mcp__rich__serial_exec'),
      parameters: STUB_PARAMETERS,
    }],
  }

  const rows = createBrokerCatalog({ runtime, tools })(agent)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].server, 'rich')
  assert.equal(rows[0].tool, 'serial_exec')
  assert.deepEqual(
    Object.keys(rows[0].schema.parameters.properties),
    ['session_id', 'cmd', 'timeout'],
    'describe answers from the connection record, not from the stub row',
  )
  assert.equal(rows[0].schema.description, 'Run one command.')
})

it('describes a stub differently from the definition it shadows', () => {
  assert.notEqual(stubDescription('mcp__x__y'), stubDescription('mcp__x__z'))
  assert.ok(stubDescription('a'.repeat(200)).length <= 160)
})

it('registers the stub while the record keeps the full tools/list entry', () => {
  const registered = []
  const disposed = []
  const registry = {
    register(definition) {
      registered.push(definition)
      return () => disposed.push(definition.name)
    },
  }
  const registrations = new Map()
  const server = { name: 'rich', type: 'stdio', command: 'node', args: [] }
  const info = {
    name: 'serial_exec',
    description: 'Run one command on an already-open serial session.',
    inputSchema: fullDefinition().parameters,
  }
  const call = async () => ({ content: [], isError: false })

  syncToolRegistrations(registry, null, server, registrations, [info], call, true, true)
  assert.equal(registered.length, 1)
  assert.deepEqual(registered[0].parameters, STUB_PARAMETERS, 'the model sees no parameter table')
  const entry = registrations.get('serial_exec')
  assert.deepEqual(
    entry.info.inputSchema.properties.session_id,
    { type: 'string', description: 'Session handle' },
    'the record keeps the real schema for describe/settings',
  )

  // Turning the stub off has to look like a real change, or the old row stays.
  const stubSignature = entry.signature
  syncToolRegistrations(registry, null, server, registrations, [info], call, true, false)
  assert.equal(registered.length, 2)
  assert.equal(disposed.length, 1, 'the stub registration is released before the full one goes in')
  assert.notEqual(registrations.get('serial_exec').signature, stubSignature)
  assert.equal(
    registered[1].parameters.properties.session_id.description,
    'Session handle',
    'the full schema is back',
  )
  assert.notEqual(registrationSignature(registered[0]), registrationSignature(registered[1]))
})
