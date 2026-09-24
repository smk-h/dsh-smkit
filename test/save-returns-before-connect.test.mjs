/**
 * Saving a server must not block on its connection: both tiers answer the
 * save with the row in its transitional `connecting` state and let the
 * transport open in the background (the settings page's poll settles it on
 * the card). Regression for the add form pinning open on slow servers.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// STATE_PATH is derived from homedir() when the module is evaluated, so point
// HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-savefast-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME // Windows: homedir() 读 USERPROFILE 而非 HOME
mkdirSync(join(scratchHome, '.dsh'), { recursive: true })

const { apply } = await import('../lib/index.js')
after(() => rmSync(scratchHome, { recursive: true, force: true }))

/**
 * Minimal ctx: webServer route mounting, an agents registry whose create/resume
 * drive the workspace-scoping decorator, and an optional registered workspace
 * path. Collected disposers release the live workspace so its config watcher
 * cannot keep the test process alive.
 */
function makeCtx({ workspacePath } = {}) {
  const routes = []
  const disposers = []
  const collectEffect = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  }
  const agent = {
    id: 'session-savefast',
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
async function request(handler, method, path, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    url: path,
    headers: { host: '127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() { for (const chunk of payload) yield chunk },
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
 * A dependency-free MCP stub whose initialize/tools/list replies are delayed
 * by `delayMs`, so a save that returns inside that window must have skipped
 * waiting for the connection.
 */
function startStub(delayMs) {
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
        setTimeout(() => reply({ protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'slow-stub', version: '1' } }), delayMs)
      } else if (payload.method === 'tools/list') {
        setTimeout(() => reply({ tools: [{ name: 'echo', description: 'echo back', inputSchema: { type: 'object' } }] }), delayMs)
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

it('answers a global-server save with `connecting` and connects in the background', async () => {
  const stub = await startStub(600)
  const { handler } = makeCtx()

  const created = await request(handler, 'POST', '/smkit/api/servers', { name: 'slow', type: 'http', url: stub.url, authMode: 'none' })
  assert.equal(created.code, 201)
  assert.equal(created.json.server.status, 'connecting', 'the save must return while the transport is still opening')

  const listed = await settleMs(2500).then(() => request(handler, 'GET', '/smkit/api/servers'))
  const row = listed.json.servers.find((server) => server.name === 'slow')
  assert.equal(row.status, 'connected', 'the background connect must settle on its own')
  assert.equal(row.toolCount, 1)

  await stub.close()
})

it('answers a workspace-server save with the row connecting and settles in the background', async () => {
  const stub = await startStub(600)
  const wsDir = mkdtempSync(join(tmpdir(), 'dsh-smkit-savefast-ws-'))
  const { handler, agents, dispose } = makeCtx({ workspacePath: wsDir })

  // Open the workspace once so it goes live (server map + config watcher).
  await agents.create({ setup: async () => {} })

  const created = await request(handler, 'POST', '/smkit/api/workspaces/servers', { path: wsDir, name: 'ws-slow', type: 'http', url: stub.url, authMode: 'none' })
  assert.equal(created.code, 200)
  const row = created.json.workspaces
    .find((workspace) => workspace.path === wsDir)
    ?.servers.find((server) => server.name === 'ws-slow')
  assert.ok(row, 'the response must already list the new server')
  assert.equal(row.status, 'connecting', 'the save must return while the transport is still opening')

  const listed = await settleMs(2500).then(() => request(handler, 'GET', '/smkit/api/workspaces'))
  const settled = listed.json.workspaces
    .find((workspace) => workspace.path === wsDir)
    ?.servers.find((server) => server.name === 'ws-slow')
  assert.equal(settled.status, 'connected', 'the background connect must settle on its own')
  assert.equal(settled.toolCount, 1)

  dispose()
  rmSync(wsDir, { recursive: true, force: true })
  await stub.close()
})
