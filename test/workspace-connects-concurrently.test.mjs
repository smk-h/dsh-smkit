/**
 * Opening a workspace must register every server row up front and open all of
 * their transports concurrently — not connect one server before the next one
 * even shows up. Regression for the serial first-time connect.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// STATE_PATH is derived from homedir() when the module is evaluated, so point
// HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-concurrent-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME // Windows: homedir() 读 USERPROFILE 而非 HOME
mkdirSync(join(scratchHome, '.dsh'), { recursive: true })

const { apply } = await import('../lib/index.js')
after(() => rmSync(scratchHome, { recursive: true, force: true }))

/**
 * Minimal ctx: webServer route mounting, an agents registry whose create/resume
 * drive the workspace-scoping decorator, and a registered workspace path.
 * Collected disposers release the live workspace so its config watcher cannot
 * keep the test process alive.
 */
function makeCtx({ workspacePath }) {
  const routes = []
  const disposers = []
  const collectEffect = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  }
  const agent = {
    id: 'session-concurrent',
    session: { header: { cwd: workspacePath } },
    ctx: {
      tools: {
        register: () => () => {},
        restrict: () => () => {},
        schemas: () => [],
        get: () => undefined,
        execute: async () => ({}),
      },
    },
  }
  const agents = {
    create: (options) => options.setup({ effect: collectEffect }, agent),
    resume: (options) => options.setup({ effect: collectEffect }, agent),
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { guard: () => () => {}, register: () => () => {}, restrict: () => () => {}, execute: async () => ({}) },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: (name) => (name === 'workspaceRegistry' && workspacePath
      ? { list: () => [{ path: workspacePath }] }
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
  return { handler: routes[0]?.handler, agents, dispose }
}

/** Call the mounted route with a minimal req/res pair. */
async function request(handler, method, path) {
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() { /* no body */ },
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

/**
 * A dependency-free MCP stub. `gate` (a { promise, resolve } pair) parks the
 * initialize reply until it is resolved, simulating a slow server while the
 * test observes everything else.
 */
function startStub(gate) {
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
        const result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'concurrent-stub', version: '1' } }
        if (gate) gate.promise.then(() => reply(result))
        else reply(result)
      } else if (payload.method === 'tools/list') {
        reply({ tools: [{ name: 'echo', description: 'echo back', inputSchema: { type: 'object' } }] })
      } else reply({})
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/mcp`,
        async close() {
          gate?.resolve()
          server.closeAllConnections?.()
          await new Promise((done) => server.close(done))
        },
      })
    })
  })
}

const settleMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

it('registers every workspace row at once and opens their transports concurrently', async () => {
  // The gated server's initialize parks until the test releases it, so with a
  // serial connect the second row would never even appear while parked.
  const gate = { promise: null, resolve: null }
  gate.promise = new Promise((resolve) => { gate.resolve = resolve })
  const gated = await startStub(gate)
  const fast = await startStub(null)
  const wsDir = mkdtempSync(join(tmpdir(), 'dsh-smkit-concurrent-ws-'))
  mkdirSync(join(wsDir, '.dsh', 'dshmm'), { recursive: true })
  // Gated first in the file: with a serial scan it connects (and blocks) first.
  writeFileSync(join(wsDir, '.dsh', 'dshmm', 'mcp.json'), JSON.stringify({
    mcpServers: {
      'ws-gated': { type: 'http', url: gated.url, authMode: 'none' },
      'ws-fast': { type: 'http', url: fast.url, authMode: 'none' },
    },
  }))

  const { handler, agents, dispose } = makeCtx({ workspacePath: wsDir })

  // Open the workspace: agent setup awaits the scan, which awaits every
  // transport — kick it off without awaiting so the mid-flight state is
  // observable.
  const created = agents.create({ setup: async () => {} })
  await settleMs(200)

  const midFlight = await request(handler, 'GET', '/mcp-manager/api/workspaces')
  const rows = midFlight.json.workspaces
    .find((workspace) => workspace.path === wsDir)
    ?.servers ?? []
  assert.deepEqual(
    rows.map((row) => `${row.name}:${row.status}`).sort(),
    ['ws-fast:connected', 'ws-gated:connecting'],
    'both rows must be listed while one transport is still opening',
  )

  gate.resolve()
  await created
  const settled = await request(handler, 'GET', '/mcp-manager/api/workspaces')
  const settledRows = settled.json.workspaces
    .find((workspace) => workspace.path === wsDir)
    ?.servers ?? []
  for (const row of settledRows) {
    assert.equal(row.status, 'connected')
    assert.equal(row.toolCount, 1)
  }

  dispose()
  rmSync(wsDir, { recursive: true, force: true })
  await gated.close()
  await fast.close()
})
