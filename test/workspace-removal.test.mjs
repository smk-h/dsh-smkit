/**
 * Removing a workspace in the DSH sidebar must take the MCP tier with it.
 *
 * The plugin never receives a "workspace removed" event — the registry is read
 * through an accessor that only offers `list()`. So the settings page's poll is
 * where the registry and the live map meet: a path the registry listed before
 * and does not list now has been removed by the user, and its rows, transports,
 * watcher, per-agent tools and OAuth slots must go with it.
 *
 * Regression: the live `runtime.workspaces` cache was only reclaimed when the
 * last attached session released it, so a removed workspace stayed listed and
 * kept its MCP servers running until the plugin was unloaded.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// STATE_PATH is derived from homedir() when the module is evaluated, so point
// HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-wsrm-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME // Windows: homedir() 读 USERPROFILE 而非 HOME
mkdirSync(join(scratchHome, '.dsh'), { recursive: true })

// A stored per-workspace OAuth slot, so the test can prove the secrets of a
// removed workspace do not outlive it. Written before the import: `loadState`
// reads the file at mount time.
const wsDir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-smkit-wsrm-ws-')))
const tokenKey = `${wsDir}\nws-live`
writeFileSync(join(scratchHome, '.dsh', 'mcp-manager.json'), JSON.stringify({
  servers: [],
  workspaceTokens: { [tokenKey]: { oauth: { accessToken: 'secret' } } },
  onDemandToolInjection: false,
}))

const { apply } = await import('../lib/index.js')
after(() => rmSync(scratchHome, { recursive: true, force: true }))

/**
 * Minimal ctx: route mounting, an agents registry whose create/resume drive the
 * workspace-scoping decorator, and a registry whose `list()` reflects the
 * mutable `registered` array (so the test can emulate a sidebar removal).
 */
function makeCtx({ registered }) {
  const routes = []
  const disposers = []
  const collectEffect = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  }
  const agent = {
    id: 'session-removal',
    session: { header: { cwd: wsDir } },
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
    get: (name) => (name === 'workspaceRegistry'
      ? { list: () => registered.map((path) => ({ path })) }
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

const settleMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll until `condition` yields a truthy value; fail the test on timeout. */
async function waitFor(condition, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await condition()
    if (value) return value
    if (Date.now() > deadline) throw new Error('timed out waiting for the workspace transport')
    await settleMs(50)
  }
}

/** A dependency-free MCP stub: answers initialize and tools/list. */
function startStub() {
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
      if (payload.id === undefined) { res.writeHead(202); res.end(); return }
      const result = payload.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'removal-stub', version: '1' } }
        : payload.method === 'tools/list'
          ? { tools: [{ name: 'echo', description: 'echo back', inputSchema: { type: 'object' } }] }
          : {}
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }))
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

it('releases a workspace the registry no longer lists', async () => {
  const stub = await startStub()
  mkdirSync(join(wsDir, '.dsh', 'dshmm'), { recursive: true })
  writeFileSync(join(wsDir, '.dsh', 'dshmm', 'mcp.json'), JSON.stringify({
    mcpServers: { 'ws-live': { type: 'http', url: stub.url, authMode: 'none' } },
  }))

  const registered = [wsDir]
  const { handler, agents, dispose } = makeCtx({ registered })
  try {
    // Open the workspace. The session stays attached for the whole test: a
    // removed workspace must be released even then, because the user removed it.
    await agents.create({ setup: async () => {} })
    await waitFor(async () => {
      const current = await request(handler, 'GET', '/smkit/api/workspaces')
      const workspace = current.json.workspaces.find((entry) => entry.path === wsDir)
      return workspace?.servers[0]?.status === 'connected' ? workspace : undefined
    })

    // The user removes the workspace from the DSH sidebar.
    registered.length = 0

    // The settings page's next poll reconciles: the workspace is gone from the
    // list before the request answers.
    const listed = await request(handler, 'GET', '/smkit/api/workspaces')
    assert.deepEqual(listed.json.workspaces, [], 'a removed workspace must not be listed')

    // It is no longer a known path, so its routes refuse it...
    const refused = await request(handler, 'POST', '/smkit/api/workspaces/servers/delete', {
      path: wsDir,
      name: 'ws-live',
    })
    assert.equal(refused.code, 403, 'the removed workspace must be forgotten, not just hidden')

    // ...and its OAuth slot did not survive it either.
    const state = JSON.parse(readFileSync(join(scratchHome, '.dsh', 'mcp-manager.json'), 'utf8'))
    assert.deepEqual(Object.keys(state.workspaceTokens), [], 'secrets of a removed workspace must be dropped')
  } finally {
    dispose()
    rmSync(wsDir, { recursive: true, force: true })
    await stub.close()
  }
})
