/**
 * The debug page's host half: `POST /debug/call`, the notification ring, and
 * the one handshake field the page prints.
 *
 * What is worth pinning is the set of distinctions the page renders as different
 * things, so a later change cannot quietly collapse them:
 *
 * - a tool that reports `isError` is a *successful* request (`ok: false` in the
 *   body, HTTP 200) while a server that is not connected is a refusal (409) and
 *   an unknown tool name is a bad request (400);
 * - the arguments travel exactly as the page built them;
 * - `serverInfo` from `initialize` reaches `GET /servers`, because the rail
 *   prints "which build is this server" and nothing else carries it;
 * - the ring keeps a bounded, ordered history per server and can be cleared,
 *   and a frame whose parameters are enormous is flagged rather than stored.
 *
 * The MCP endpoint is a stubbed `fetch`: the assertions are about the JSON-RPC
 * traffic the plugin emits, which a socket-level test can only observe
 * indirectly.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// STATE_PATH is derived from homedir() when the module is evaluated, so point
// HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-debug-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME
mkdirSync(join(scratchHome, '.dsh'), { recursive: true })

const {
  apply,
  MAX_DEBUG_NOTIFICATIONS,
  clearNotifications,
  notificationsOf,
  recordNotification,
  serverInfoOf,
} = await import('../lib/index.js')
after(() => rmSync(scratchHome, { recursive: true, force: true }))

/** Minimal ctx: enough for apply() to mount its route without a real harness. */
function makeCtx(services = {}) {
  const routes = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: {
      register: () => () => {},
      restrict: () => () => {},
      guard: () => () => {},
      execute: async () => ({ content: [] }),
    },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: (name) => services[name],
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback === 'function' && names.includes('webServer')) {
        callback({
          webServer: ctx.webServer,
          get: (name) => services[name],
          effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
        })
      }
      return { dispose: () => {} }
    },
    effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  }
  apply(ctx)
  return { handler: routes[0]?.handler }
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
 * An MCP endpoint with two tools: one echoing its argument, one that reports
 * itself as failed — the two answers the page must render differently.
 * @returns the JSON-RPC payloads the plugin sent, and a restore.
 */
function stubMcpFetch() {
  const real = globalThis.fetch
  const sent = []
  globalThis.fetch = async (_url, options = {}) => {
    const payload = JSON.parse(String(options.body ?? '{}'))
    sent.push(payload)
    let result = {}
    if (payload.method === 'initialize') {
      result = {
        protocolVersion: '2025-03-26',
        capabilities: {},
        serverInfo: { name: 'debug-stub', version: '9.9.9' },
      }
    } else if (payload.method === 'tools/list') {
      result = {
        tools: [
          {
            name: 'echo',
            description: 'Echo the text back',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          },
          { name: 'fail', description: 'Always fails', inputSchema: { type: 'object' } },
        ],
      }
    } else if (payload.method === 'tools/call') {
      result = payload.params?.name === 'fail'
        ? { isError: true, content: [{ type: 'text', text: 'boom' }] }
        : { content: [{ type: 'text', text: `echo:${String(payload.params?.arguments?.text)}` }] }
    }
    return {
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }),
    }
  }
  return { sent, restore() { globalThis.fetch = real } }
}

/** Add one HTTP server through the real route and connect it. */
async function connectStub(handler, name) {
  const created = await request(handler, 'POST', '/smkit/api/servers', {
    name,
    type: 'http',
    url: 'http://127.0.0.1:9/mcp',
    authMode: 'none',
  })
  assert.equal(created.code, 201)
  const id = created.json.server.id
  const connected = await request(handler, 'POST', `/smkit/api/servers/${id}/connect`)
  assert.equal(connected.json.server.status, 'connected')
  return id
}

it('calls a tool on the live connection and reports the server result verbatim', async () => {
  const stub = stubMcpFetch()
  try {
    const { handler } = makeCtx()
    const id = await connectStub(handler, 'stub-first')

    const answered = await request(handler, 'POST', '/smkit/api/debug/call', {
      id,
      tool: 'echo',
      arguments: { text: 'hello' },
    })
    assert.equal(answered.code, 200)
    assert.equal(answered.json.ok, true)
    assert.deepEqual(answered.json.result.content, [{ type: 'text', text: 'echo:hello' }])
    assert.equal(typeof answered.json.durationMs, 'number')
    assert.ok(answered.json.durationMs >= 0)

    // The arguments reached the wire exactly as the page built them — the page's
    // coercion is the browser half's business, this route must not re-do it.
    const call = stub.sent.filter((payload) => payload.method === 'tools/call').pop()
    assert.deepEqual(call.params, { name: 'echo', arguments: { text: 'hello' } })

    // A tool that reports its own failure is still a successful request.
    const failed = await request(handler, 'POST', '/smkit/api/debug/call', { id, tool: 'fail' })
    assert.equal(failed.code, 200)
    assert.equal(failed.json.ok, false)
    assert.deepEqual(failed.json.result, { isError: true, content: [{ type: 'text', text: 'boom' }] })
    assert.equal(failed.json.error, undefined, 'the server answered; there is no transport error to report')
  } finally {
    stub.restore()
  }
})

it('refuses an unknown tool, a non-object argument bag, and a disconnected server', async () => {
  const stub = stubMcpFetch()
  try {
    const { handler } = makeCtx()
    const id = await connectStub(handler, 'stub-second')

    const unknown = await request(handler, 'POST', '/smkit/api/debug/call', { id, tool: 'nope' })
    assert.equal(unknown.code, 400)
    assert.match(unknown.json.error, /nope/)

    for (const args of [[], 'text', 42]) {
      const refused = await request(handler, 'POST', '/smkit/api/debug/call', {
        id,
        tool: 'echo',
        arguments: args,
      })
      assert.equal(refused.code, 400, `arguments ${JSON.stringify(args)} must be refused`)
    }

    // `null` is "no arguments", the same thing as leaving the field out: a tool
    // that declares none is called with an empty object, not refused.
    const bare = await request(handler, 'POST', '/smkit/api/debug/call', {
      id,
      tool: 'echo',
      arguments: null,
    })
    assert.equal(bare.code, 200)

    const missing = await request(handler, 'POST', '/smkit/api/debug/call', { tool: 'echo' })
    assert.equal(missing.code, 400, 'a call without a server id names nothing to call')

    await request(handler, 'POST', `/smkit/api/servers/${id}/stop`)
    const stopped = await request(handler, 'POST', '/smkit/api/debug/call', { id, tool: 'echo' })
    assert.equal(stopped.code, 409, 'a stopped server is a refusal, not a tool failure')
  } finally {
    stub.restore()
  }
})

it('reports the server identity the handshake carried', async () => {
  const stub = stubMcpFetch()
  try {
    const { handler } = makeCtx()
    await connectStub(handler, 'stub-info')
    const listed = await request(handler, 'GET', '/smkit/api/servers')
    assert.deepEqual(listed.json.servers[0].serverInfo, { name: 'debug-stub', version: '9.9.9' })
  } finally {
    stub.restore()
  }
})

/** A runtime-shaped object: the ring only ever touches these two members. */
function fakeRuntime() {
  let seq = 1
  return { debugNotifications: new Map(), nextNotificationSeq: () => seq++ }
}

it('keeps a bounded, ordered notification ring per server', () => {
  const runtime = fakeRuntime()
  for (let index = 0; index < MAX_DEBUG_NOTIFICATIONS + 5; index += 1) {
    recordNotification(runtime, 'a', { method: 'notifications/message', params: { index } })
  }
  recordNotification(runtime, 'b', { method: 'notifications/progress' })
  // A response is not a notification: it carries no method and belongs nowhere.
  recordNotification(runtime, 'a', { id: 1, result: {} })

  const ring = notificationsOf(runtime, 'a')
  assert.equal(ring.length, MAX_DEBUG_NOTIFICATIONS, 'the ring is bounded')
  assert.deepEqual(ring[0].params, { index: 5 }, 'the oldest frames are the ones dropped')
  assert.deepEqual(ring.at(-1).params, { index: MAX_DEBUG_NOTIFICATIONS + 4 })
  assert.deepEqual(ring.map((entry) => entry.seq), [...ring.map((entry) => entry.seq)].sort((a, b) => a - b))
  assert.equal(notificationsOf(runtime, 'b').length, 1, 'servers keep their own rings')
  assert.equal(notificationsOf(runtime, 'unknown').length, 0)

  // The returned list is a copy: a page must not be able to edit the ring.
  ring.pop()
  assert.equal(notificationsOf(runtime, 'a').length, MAX_DEBUG_NOTIFICATIONS)

  clearNotifications(runtime, 'a')
  assert.equal(notificationsOf(runtime, 'a').length, 0)
})

it('flags an oversized frame instead of storing its parameters', () => {
  const runtime = fakeRuntime()
  recordNotification(runtime, 'a', {
    method: 'notifications/message',
    params: { data: 'x'.repeat(20_000) },
  })
  const [entry] = notificationsOf(runtime, 'a')
  assert.equal(entry.truncated, true)
  assert.equal(entry.params, undefined, 'a truncated frame carries no parameters at all')
})

it('reads only the two handshake fields it prints', () => {
  assert.deepEqual(serverInfoOf({ serverInfo: { name: 'x', version: '1.0.0' } }), { name: 'x', version: '1.0.0' })
  assert.deepEqual(serverInfoOf({ serverInfo: { name: 'x' } }), { name: 'x' })
  assert.equal(serverInfoOf({ serverInfo: {} }), undefined)
  assert.equal(serverInfoOf({ serverInfo: 'x' }), undefined)
  assert.equal(serverInfoOf(undefined), undefined)
})

it('keeps the id of a workspace server stable while the workspace is not open', async () => {
  // A workspace nobody has opened is reported from its on-disk config, and the
  // page addresses a row by id. An id minted per read made the page lose the
  // row it had just selected three seconds later — the "click a server that is
  // not connected and the selection jumps back to the first one" report.
  const project = join(scratchHome, 'dormant-project')
  mkdirSync(join(project, '.dsh', 'dshmm'), { recursive: true })
  writeFileSync(
    join(project, '.dsh', 'dshmm', 'mcp.json'),
    JSON.stringify({ mcpServers: { dormant: { type: 'http', url: 'http://127.0.0.1:9/mcp', authMode: 'none' } } }),
  )
  const { handler } = makeCtx({ workspaceRegistry: { list: () => [{ path: project }] } })

  const read = async () => {
    const answered = await request(handler, 'GET', '/smkit/api/workspaces')
    assert.equal(answered.code, 200)
    return answered.json.workspaces.flatMap((workspace) => workspace.servers).find((server) => server.name === 'dormant')
  }

  const first = await read()
  const second = await read()
  assert.ok(first, 'the dormant workspace still reports the server it configured')
  assert.equal(first.status, 'configured')
  assert.equal(first.toolCount, 0)
  assert.ok(first.id.startsWith('ws-'), `a workspace row carries a workspace id (${first.id})`)
  assert.equal(first.id, second.id, 'two reads of one config must answer the same id')
})

it('keeps the debug page switch in the profile, on unless it was turned off', async () => {
  const { handler } = makeCtx()
  const initial = await request(handler, 'GET', '/smkit/api/settings')
  assert.equal(initial.code, 200)
  assert.equal(initial.json.debugPageEnabled, true, 'an untouched profile keeps the page')

  const refused = await request(handler, 'POST', '/smkit/api/settings/debug-page', { enabled: 'no' })
  assert.equal(refused.code, 400)

  const off = await request(handler, 'POST', '/smkit/api/settings/debug-page', { enabled: false })
  assert.equal(off.code, 200)
  assert.equal(off.json.debugPageEnabled, false)
  assert.equal((await request(handler, 'GET', '/smkit/api/settings')).json.debugPageEnabled, false)

  // A later mount reads the stored choice rather than the default.
  const remounted = makeCtx()
  assert.equal(
    (await request(remounted.handler, 'GET', '/smkit/api/settings')).json.debugPageEnabled,
    false,
  )

  const on = await request(handler, 'POST', '/smkit/api/settings/debug-page', { enabled: true })
  assert.equal(on.json.debugPageEnabled, true)
})
