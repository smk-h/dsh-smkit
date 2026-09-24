/**
 * Automatic reconnection (`Settings → MCP → 高级`).
 *
 * Three things have to hold together, so they are asserted end to end rather
 * than per module — and each through the signal that actually produces it:
 *
 * 1. a stdio child that exits **on its own** is respawned, and the row reports
 *    `reconnecting` while it is being rebuilt (the killed child below is the
 *    local shape of the documented remote setup, where the child is an `ssh`
 *    bridge to the server and dies with the link);
 * 2. stopping a server cancels the retry a drop already scheduled — without
 *    that, "关闭" would be undone a second later;
 * 3. a transport that is alive but dead inside is found by the health probe,
 *    and a spent retry budget gives up instead of probing forever.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// STATE_PATH is derived from homedir() when the module is evaluated, so point
// HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-reconnect-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME // Windows: homedir() 读 USERPROFILE 而非 HOME
mkdirSync(join(scratchHome, '.dsh'), { recursive: true })
const statePath = join(scratchHome, '.dsh', 'mcp-manager.json')

const { apply } = await import('../lib/index.js')
after(() => rmSync(scratchHome, { recursive: true, force: true }))

/**
 * Mounting auto-connects every server in the store, so a test must not inherit
 * the previous one's rows: start each from an empty state file.
 */
function resetState() {
  writeFileSync(
    statePath,
    JSON.stringify({ servers: [], workspaceTokens: {}, onDemandToolInjection: false }),
  )
}

/**
 * Minimal ctx: enough for apply() to mount its route without a real harness.
 * Collected disposers run the plugin's teardown, which is what kills the stdio
 * children a test left behind.
 */
function makeCtx() {
  const routes = []
  const disposers = []
  const collectEffect = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: {
      register: () => () => {},
      restrict: () => () => {},
      guard: () => () => {},
      schemas: () => [],
      get: () => undefined,
      execute: async () => ({ content: [] }),
    },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: () => undefined,
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback === 'function' && names.includes('webServer')) {
        callback({ webServer: ctx.webServer, get: () => undefined, effect: collectEffect })
      }
      return { dispose: () => {} }
    },
    effect: collectEffect,
  }
  apply(ctx)
  const dispose = () => { for (const fn of disposers.reverse()) { try { fn() } catch {} } }
  return { handler: routes[0]?.handler, dispose }
}

/**
 * `makeCtx` plus the pieces the workspace tier needs: an agents registry whose
 * `create` drives the scoping decorator (which is what brings a workspace live,
 * connecting its servers), and a registered workspace path for the routes to
 * resolve.
 */
function makeWorkspaceCtx(workspacePath) {
  const agent = {
    id: 'session-reconnect',
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
    create: (options) => options.setup(agentCtx, agent),
    resume: (options) => options.setup(agentCtx, agent),
  }
  const routes = []
  const disposers = []
  const agentCtx = {
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { guard: () => () => {}, register: () => () => {}, restrict: () => () => {}, execute: async () => ({}) },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: (name) => (name === 'workspaceRegistry' ? { list: () => [{ path: workspacePath }] } : undefined),
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback !== 'function') return { dispose: () => {} }
      if (names.includes('webServer')) {
        callback({ webServer: ctx.webServer, get: () => undefined, effect: ctx.effect })
      }
      if (names.includes('agents')) callback({ agents, effect: ctx.effect })
      return { dispose: () => {} }
    },
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
  }
  apply(ctx)
  return {
    handler: routes[0]?.handler,
    agents,
    dispose: () => { for (const fn of disposers.reverse()) { try { fn() } catch {} } },
  }
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

/** One global-tier row from `GET /servers`, or undefined when it is gone. */
async function globalRow(handler, name) {
  const listed = await request(handler, 'GET', '/smkit/api/servers')
  return listed.json.servers.find((server) => server.name === name)
}

/** One workspace-tier row from `GET /workspaces`, or undefined when it is gone. */
async function workspaceRow(handler, wsPath, name) {
  const listed = await request(handler, 'GET', '/smkit/api/workspaces')
  const workspace = listed.json.workspaces.find((candidate) => candidate.path === wsPath)
  return workspace?.servers.find((server) => server.name === name)
}

/**
 * Poll one row until `done` accepts it.
 * @returns the row and every distinct status seen on the way, so a caller can
 * assert the intermediate `reconnecting` the poll happened to catch.
 */
async function waitForRow(read, name, done, timeoutMs = 6_000) {
  const seen = []
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const row = await read()
    if (row && seen[seen.length - 1] !== row.status) seen.push(row.status)
    if (row && done(row)) return { row, seen }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${name}; statuses seen: ${seen.join(' → ') || '(none)'}`)
    }
    await settleMs(30)
  }
}

/** `waitForRow` bound to one global-tier row. */
const waitForGlobal = (handler, name, done, timeoutMs) =>
  waitForRow(() => globalRow(handler, name), name, done, timeoutMs)

/** Write the reconnect settings this test needs (they persist in the store). */
const configure = (handler, settings) =>
  request(handler, 'POST', '/smkit/api/settings/reconnect', settings)

/**
 * A newline-delimited JSON-RPC MCP server that appends its pid to
 * `$SPAWN_LOG` on every start, so a test can both count the starts and kill
 * the current child to simulate the bridge dropping.
 */
const STDIO_STUB = `
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
appendFileSync(process.env.SPAWN_LOG, process.pid + '\\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.id === undefined) return
  const result =
    message.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'stdio-stub', version: '1' } }
      : message.method === 'tools/list'
        ? { tools: [{ name: 'echo', description: 'echo back', inputSchema: { type: 'object' } }] }
        : {}
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
})
`

/** The pids the stub has started, oldest first. */
const startedPids = (log) => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** Add a stdio stub server and wait for it to come up. */
async function addStdioServer(handler, { name, dir }) {
  const log = join(dir, `${name}.log`)
  const script = join(dir, `${name}.mjs`)
  writeFileSync(script, STDIO_STUB)
  const created = await request(handler, 'POST', '/smkit/api/servers', {
    name,
    type: 'stdio',
    command: process.execPath,
    args: [script],
    env: { SPAWN_LOG: log },
  })
  assert.equal(created.code, 201)
  await waitForGlobal(handler, name, (row) => row.status === 'connected')
  return { id: created.json.server.id, log }
}

/**
 * A dependency-free MCP stub whose `tools/list` fails while `state.down` — the
 * connect phase (`initialize` + one `tools/list`) must succeed first, so a test
 * can turn the endpoint into the "process alive, session gone" case after the
 * connection is up.
 */
function startHttpStub({ failInitialize = false } = {}) {
  const state = { down: false, lists: 0, inits: 0 }
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
      if (payload.method === 'tools/list') {
        state.lists += 1
        if (state.down) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('down')
          return
        }
        reply({ tools: [{ name: 'echo', description: 'echo back', inputSchema: { type: 'object' } }] })
        return
      }
      if (payload.method === 'initialize') {
        state.inits += 1
        if (failInitialize) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('boom')
          return
        }
        reply({ protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'http-stub', version: '1' } })
        return
      }
      reply({})
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        state,
        url: `http://127.0.0.1:${server.address().port}/mcp`,
        async close() {
          server.closeAllConnections?.()
          await new Promise((done) => server.close(done))
        },
      })
    })
  })
}

it('respawns a stdio child that exits on its own', async () => {
  resetState()
  const { handler, dispose } = makeCtx()
  // No health probe: this case must be caught by the child's own exit.
  await configure(handler, { healthCheckIntervalMs: 0, reconnectMaxDelayMs: 1000, reconnectMaxAttempts: 0 })
  const { log } = await addStdioServer(handler, { name: 'stdio-bridge', dir: scratchHome })

  const pids = startedPids(log)
  assert.equal(pids.length, 1, 'the stub must have started once')

  // The drop: the child dies without anyone asking it to.
  process.kill(Number(pids[0]), 'SIGKILL')

  const dropped = await waitForGlobal(handler, 'stdio-bridge', (row) => row.status === 'reconnecting')
  assert.ok(
    dropped.row.error.includes('stdio process exited'),
    `the reason must name the exit: ${dropped.row.error}`,
  )

  const revived = await waitForGlobal(handler, 'stdio-bridge', (row) => row.status === 'connected')
  assert.equal(revived.row.toolCount, 1, 'the respawned server must register its tool again')

  const restarted = startedPids(log)
  assert.equal(restarted.length, 2, 'the child must have been respawned exactly once')
  assert.notEqual(restarted[1], restarted[0], 'the respawn must be a new process')

  dispose()
})

it('keeps a stopped server stopped', async () => {
  resetState()
  const { handler, dispose } = makeCtx()
  await configure(handler, { healthCheckIntervalMs: 0, reconnectMaxDelayMs: 1000, reconnectMaxAttempts: 0 })
  const { id, log } = await addStdioServer(handler, { name: 'stopped-bridge', dir: scratchHome })

  process.kill(Number(startedPids(log)[0]), 'SIGKILL')
  // Stop from inside the retry window: the drop has been seen and a retry is
  // already scheduled.
  await waitForGlobal(handler, 'stopped-bridge', (row) => row.status === 'reconnecting')
  const stopped = await request(handler, 'POST', `/smkit/api/servers/${id}/stop`)
  assert.equal(stopped.code, 200)

  // Longer than one full retry window: a retry that survived the stop would
  // have respawned the child inside this window.
  await settleMs(2500)
  assert.equal(startedPids(log).length, 1, 'a stopped server must not be respawned')
  const row = await globalRow(handler, 'stopped-bridge')
  assert.equal(row.status, 'disconnected')

  dispose()
})

it('leaves a first connect that failed alone', async () => {
  resetState()
  // Aggressive settings: if a retry were armed at all, it would fire well
  // inside the window this test watches.
  const stub = await startHttpStub({ failInitialize: true })
  const { handler, dispose } = makeCtx()
  try {
    await configure(handler, {
      healthCheckIntervalMs: 1000,
      reconnectMaxDelayMs: 1000,
      reconnectMaxAttempts: 0,
      autoReconnect: true,
    })
    const created = await request(handler, 'POST', '/smkit/api/servers', {
      name: 'never-up',
      type: 'http',
      url: stub.url,
      authMode: 'none',
    })
    assert.equal(created.code, 201)

    const failed = await waitForGlobal(handler, 'never-up', (row) => row.status === 'error')
    assert.equal(stub.state.inits, 1, 'a connection that never came up must not be retried')

    await settleMs(2500)
    assert.equal(stub.state.inits, 1, 'nothing may keep knocking on an endpoint that never worked')
    assert.equal((await globalRow(handler, 'never-up')).status, 'error')
  } finally {
    dispose()
    await stub.close()
  }
})

it('never retries a server that still needs authentication', async () => {
  resetState()
  const stub = await startHttpStub()
  const { handler, dispose } = makeCtx()
  try {
    await configure(handler, {
      healthCheckIntervalMs: 1000,
      reconnectMaxDelayMs: 1000,
      reconnectMaxAttempts: 0,
      autoReconnect: true,
    })
    // OAuth with no tokens: the browser round trip has not happened yet.
    const created = await request(handler, 'POST', '/smkit/api/servers', {
      name: 'pending-auth',
      type: 'http',
      url: stub.url,
      authMode: 'oauth',
    })
    assert.equal(created.code, 201)
    assert.equal((await globalRow(handler, 'pending-auth')).status, 'needs-auth')

    await settleMs(2500)
    assert.equal(stub.state.inits, 0, 'a server waiting for its browser round trip must not be dialled')
    assert.equal((await globalRow(handler, 'pending-auth')).status, 'needs-auth')
  } finally {
    dispose()
    await stub.close()
  }
})

it('finds a dead-but-alive HTTP session with the health probe and rebuilds it', async () => {
  resetState()
  const stub = await startHttpStub()
  const { handler, dispose } = makeCtx()
  try {
    await configure(handler, {
      healthCheckIntervalMs: 1000,
      reconnectMaxDelayMs: 1000,
      reconnectMaxAttempts: 0,
      autoReconnect: true,
    })
    const created = await request(handler, 'POST', '/smkit/api/servers', {
      name: 'probe-http',
      type: 'http',
      url: stub.url,
      authMode: 'none',
    })
    assert.equal(created.code, 201)
    await waitForGlobal(handler, 'probe-http', (row) => row.status === 'connected')

    // The endpoint stays reachable; only its session is gone.
    stub.state.down = true
    const dropped = await waitForGlobal(
      handler,
      'probe-http',
      (row) => row.status === 'reconnecting' && row.error.includes('health check failed'),
    )
    assert.ok(dropped.row.error.includes('health check failed'), dropped.row.error)

    stub.state.down = false
    const revived = await waitForGlobal(handler, 'probe-http', (row) => row.status === 'connected')
    assert.equal(revived.row.toolCount, 1, 'the rebuilt connection must register its tool again')
  } finally {
    dispose()
    await stub.close()
  }
})

it('keeps a workspace retry alive across its own failures', async () => {
  resetState()
  const stub = await startHttpStub()
  const wsDir = mkdtempSync(join(tmpdir(), 'dsh-smkit-reconnect-ws-'))
  const { handler, agents, dispose } = makeWorkspaceCtx(wsDir)
  const read = () => workspaceRow(handler, wsDir, 'ws-probe')
  try {
    await configure(handler, {
      healthCheckIntervalMs: 1000,
      reconnectMaxDelayMs: 1000,
      reconnectMaxAttempts: 0,
      autoReconnect: true,
    })
    // Opening the workspace is what connects its servers.
    await agents.create({ setup: async () => {} })
    const created = await request(handler, 'POST', '/smkit/api/workspaces/servers', {
      path: wsDir,
      name: 'ws-probe',
      type: 'http',
      url: stub.url,
      authMode: 'none',
    })
    assert.equal(created.code, 200)
    await waitForRow(read, 'ws-probe', (row) => row.status === 'connected')

    // Every re-open fails while the endpoint stays down, so the retry has to
    // survive its own failures: the workspace path re-opens through a function
    // that must not cancel the entry it is retrying from (the user-facing
    // restart does cancel, and that is what keeps a stop winning).
    stub.state.down = true
    await waitForRow(
      read,
      'ws-probe',
      (row) => row.status === 'reconnecting' && row.error.includes('health check failed'),
      8_000,
    )
    const failed = await waitForRow(
      read,
      'ws-probe',
      (row) => row.status === 'reconnecting' && row.error.includes('reconnect failed'),
      8_000,
    )
    assert.match(failed.row.error, /attempt [2-9]/, failed.row.error)

    stub.state.down = false
    const revived = await waitForRow(read, 'ws-probe', (row) => row.status === 'connected', 10_000)
    assert.equal(revived.row.toolCount, 1, 'the rebuilt connection must register its tool again')
  } finally {
    dispose()
    rmSync(wsDir, { recursive: true, force: true })
    await stub.close()
  }
})

it('gives up once the retry budget is spent', async () => {
  resetState()
  const stub = await startHttpStub()
  const { handler, dispose } = makeCtx()
  try {
    await configure(handler, {
      healthCheckIntervalMs: 1000,
      reconnectMaxDelayMs: 1000,
      reconnectMaxAttempts: 1,
      autoReconnect: true,
    })
    const created = await request(handler, 'POST', '/smkit/api/servers', {
      name: 'give-up',
      type: 'http',
      url: stub.url,
      authMode: 'none',
    })
    assert.equal(created.code, 201)
    await waitForGlobal(handler, 'give-up', (row) => row.status === 'connected')

    stub.state.down = true
    const settled = await waitForGlobal(
      handler,
      'give-up',
      (row) => row.status === 'error' && row.error.includes('gave up'),
      10_000,
    )
    assert.ok(settled.row.error.includes('gave up after 1 reconnect attempts'), settled.row.error)

    // The budget is spent: no retry and no probe may keep knocking.
    const knocked = stub.state.lists
    await settleMs(2000)
    assert.equal(stub.state.lists, knocked, 'a spent budget must stop probing')
  } finally {
    dispose()
    await stub.close()
  }
})

/** The report the store must carry after every write above. */
it('reports the effective settings, defaults included', async () => {
  resetState()
  const { handler, dispose } = makeCtx()
  try {
    const initial = await request(handler, 'GET', '/smkit/api/settings')
    assert.deepEqual(initial.json, {
      onDemandToolInjection: false,
      toolCallTimeoutMs: 60_000,
      autoReconnect: true,
      reconnectMaxAttempts: 0,
      reconnectMaxDelayMs: 30_000,
      healthCheckIntervalMs: 30_000,
    })

    const written = await configure(handler, { reconnectMaxAttempts: 5, healthCheckIntervalMs: 0 })
    assert.equal(written.code, 200)
    assert.equal(written.json.reconnectMaxAttempts, 5)
    assert.equal(written.json.healthCheckIntervalMs, 0)

    // One bad field refuses the whole body: nothing partial may land.
    const refused = await configure(handler, { reconnectMaxDelayMs: 10, autoReconnect: false })
    assert.equal(refused.code, 400)
    assert.equal((await request(handler, 'GET', '/smkit/api/settings')).json.autoReconnect, true)

    // `null` per field restores the built-in default.
    const restored = await configure(handler, { reconnectMaxAttempts: null })
    assert.equal(restored.json.reconnectMaxAttempts, 0)
  } finally {
    dispose()
  }
})

