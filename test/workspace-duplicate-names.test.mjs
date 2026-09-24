/**
 * Two workspaces may declare the same server name.
 *
 * A workspace server's tools are registered into *its own* agents' registries,
 * so two workspaces answering to one name never put two `mcp__<name>__*`
 * surfaces in front of the same agent: both rows must connect, each against its
 * own config, and each agent must see only its own server's tools.
 *
 * The remaining rules are one-directional and stay in force: the global tier
 * still refuses a name a live workspace holds, and a workspace still refuses a
 * name the global tier holds.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// STATE_PATH is derived from homedir() when the module is evaluated, so point
// HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-duplicate-names-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME // Windows: homedir() 读 USERPROFILE 而非 HOME
mkdirSync(join(scratchHome, '.dsh'), { recursive: true })

const { apply } = await import('../lib/index.js')
after(() => rmSync(scratchHome, { recursive: true, force: true }))

/**
 * Minimal ctx: webServer route mounting, an agents registry whose create/resume
 * drive the workspace-scoping decorator, and every workspace registered.
 * Each agent gets its own tool registry, so what lands there is exactly what
 * one session's model would see. Collected disposers release the live
 * workspaces so their config watchers cannot keep the test process alive.
 */
function makeCtx({ workspacePaths }) {
  const routes = []
  const disposers = []
  const registeredByPath = new Map()
  const collectEffect = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  }
  const agentFor = (workspacePath) => {
    /** Every definition this one agent's registry was handed. */
    const definitions = []
    registeredByPath.set(workspacePath, definitions)
    return {
      id: `session-${workspacePath}`,
      session: { header: { cwd: workspacePath } },
      ctx: {
        tools: {
          register: (definition) => {
            definitions.push(definition)
            return () => {}
          },
          restrict: () => () => {},
          schemas: () => definitions.map(({ name, description, parameters }) => ({ name, description, parameters })),
          get: (name) => definitions.find((definition) => definition.name === name),
          execute: async () => ({}),
        },
      },
    }
  }
  /**
   * The agent the next create/resume call scopes. The decorated `agents.create`
   * forwards the options object only — the plugin hands the Agent through the
   * setup context — so the agent under test is read from this slot instead of
   * from a second argument.
   */
  let nextAgent
  const agents = {
    create: (options) => options.setup({ effect: collectEffect, agent: nextAgent }),
    resume: (options) => options.setup({ effect: collectEffect, agent: nextAgent }),
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { guard: () => () => {}, register: () => () => {}, restrict: () => () => {}, execute: async () => ({}) },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: (name) => (name === 'workspaceRegistry'
      ? { list: () => workspacePaths.map((path) => ({ path })) }
      : undefined),
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback !== 'function') return { dispose: () => {} }
      if (names.includes('webServer')) {
        callback({ webServer: ctx.webServer, get: () => undefined, effect: collectEffect })
      }
      if (names.includes('agents')) callback({ agents, effect: collectEffect })
      return { dispose: () => {} }
    },
    effect: collectEffect,
  }
  apply(ctx)
  const dispose = () => { for (const fn of disposers.reverse()) { try { fn() } catch {} } }
  return {
    handler: routes[0]?.handler,
    /**
     * Open a session in one workspace: the agent built for `workspacePath` is
     * the one the decorator scopes, and its registry collects exactly what that
     * session's model would see.
     */
    open: (workspacePath) => {
      nextAgent = agentFor(workspacePath)
      return agents.create({ setup: async () => {} })
    },
    registeredByPath,
    dispose,
  }
}

/** Call the mounted route with a minimal req/res pair. */
async function request(handler, method, path, body) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8')
    },
  }
  const res = {
    code: 0,
    body: '',
    writeHead(code) { this.code = code },
    end(chunk) { this.body = chunk ?? '' },
  }
  await handler(req, res)
  return { code: res.code, json: res.body ? JSON.parse(res.body) : undefined }
}

/** A dependency-free MCP stub announcing exactly one tool. */
function startStub(toolName) {
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' })
      res.end()
      return
    }
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      let payload = {}
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch {}
      const reply = (result) => {
        if (payload.id === undefined) { res.writeHead(202); res.end(); return }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }))
      }
      if (payload.method === 'initialize') {
        reply({ protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: toolName, version: '1' } })
      } else if (payload.method === 'tools/list') {
        reply({ tools: [{ name: toolName, description: `${toolName} back`, inputSchema: { type: 'object' } }] })
      } else reply({})
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/mcp`,
        async close() {
          server.closeAllConnections?.()
          await new Promise((done) => server.close(done))
        },
      })
    })
  })
}

const settleMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll until `condition` yields a truthy value; fail the test on timeout. */
async function waitFor(condition, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await condition()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for the workspace transports`)
    await settleMs(50)
  }
}

/** A workspace directory carrying one `mcpServers` entry. */
function makeWorkspace(label, serverName, url) {
  const dir = mkdtempSync(join(tmpdir(), `dsh-smkit-dup-${label}-`))
  mkdirSync(join(dir, '.dsh', 'dshmm'), { recursive: true })
  writeFileSync(join(dir, '.dsh', 'dshmm', 'mcp.json'), JSON.stringify({
    mcpServers: { [serverName]: { type: 'http', url, authMode: 'none' } },
  }))
  return dir
}

async function workspaceRows(handler) {
  const listed = await request(handler, 'GET', '/smkit/api/workspaces')
  return listed.json.workspaces
}

it('lets two workspaces declare the same server name, each with its own connection', async (t) => {
  const stubA = await startStub('echo_a')
  const stubB = await startStub('echo_b')
  const wsA = makeWorkspace('a', 'dup', stubA.url)
  const wsB = makeWorkspace('b', 'dup', stubB.url)

  const { handler, open, registeredByPath, dispose } = makeCtx({ workspacePaths: [wsA, wsB] })

  // Registered before the first assertion on purpose: a failing assertion must
  // not leave listening stubs or a mounted plugin behind, either of which would
  // keep the test process alive long after the run.
  t.after(async () => {
    dispose()
    rmSync(wsA, { recursive: true, force: true })
    rmSync(wsB, { recursive: true, force: true })
    await stubA.close()
    await stubB.close()
  })

  // Open a session in each: both names are declared, in two different configs.
  await open(wsA)
  await open(wsB)

  const connected = await waitFor(async () => {
    const workspaces = await workspaceRows(handler)
    const both = [wsA, wsB].map((path) =>
      workspaces.find((workspace) => workspace.path === path)?.servers.find((row) => row.name === 'dup'))
    return both.every((row) => row?.status === 'connected') ? both : undefined
  })
  for (const row of connected) {
    assert.equal(row.error, '', 'a same-named server in another workspace is not a conflict')
    assert.equal(row.toolCount, 1)
  }

  // Each agent's registry holds its own workspace's tools, under the same
  // public name prefix — the duplicate never reaches one agent twice.
  assert.deepEqual(
    [...registeredByPath.get(wsA).map((definition) => definition.name)],
    ['mcp__dup__echo_a'],
  )
  assert.deepEqual(
    [...registeredByPath.get(wsB).map((definition) => definition.name)],
    ['mcp__dup__echo_b'],
  )
})

it('keeps the same-workspace and global-tier rules', async (t) => {
  const stub = await startStub('echo_c')
  const ws = makeWorkspace('c', 'dup', stub.url)
  const { handler, open, dispose } = makeCtx({ workspacePaths: [ws] })

  t.after(async () => {
    dispose()
    rmSync(ws, { recursive: true, force: true })
    await stub.close()
  })

  await open(ws)
  await waitFor(async () => {
    const workspaces = await workspaceRows(handler)
    const row = workspaces.find((workspace) => workspace.path === ws)?.servers[0]
    return row?.status === 'connected'
  })

  // Same workspace, same name: the config file is the authority, and adding a
  // second entry under that name would silently replace the first.
  const inWorkspace = await request(handler, 'POST', '/smkit/api/workspaces/servers', {
    path: ws,
    name: 'dup',
    type: 'http',
    url: stub.url,
    authMode: 'none',
  })
  assert.equal(inWorkspace.code, 409)
  assert.match(inWorkspace.json.error, /already exists in this workspace/)

  // The global tier still refuses a name a live workspace holds: its tools land
  // in the shared root registry, where both surfaces would be visible at once.
  const global = await request(handler, 'POST', '/smkit/api/servers', {
    name: 'dup',
    type: 'http',
    url: 'http://127.0.0.1:1/mcp',
    authMode: 'none',
  })
  assert.equal(global.code, 409)
  assert.match(global.json.error, /already exists/)
})
