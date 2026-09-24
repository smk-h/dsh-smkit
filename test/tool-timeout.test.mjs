/**
 * The global MCP tool-call timeout (`Settings → MCP → 高级`).
 *
 * Three things have to hold together, so they are asserted end to end rather
 * than per module: the settings route accepts only a sane write and reports the
 * effective value, the state file keeps exactly what was written, and a
 * `tools/call` that outlives the value is actually ended by the transport.
 *
 * The transport case runs against a stubbed `fetch` rather than a real server:
 * the assertion is about the signal the timeout aborts, which a socket-level
 * test can only observe indirectly (and a request that is never answered leaves
 * handles behind).
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// STATE_PATH is derived from homedir() when the module is evaluated, so point
// HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-timeout-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME // Windows: homedir() 读 USERPROFILE 而非 HOME
mkdirSync(join(scratchHome, '.dsh'), { recursive: true })
const statePath = join(scratchHome, '.dsh', 'mcp-manager.json')

const { apply, effectiveToolCallTimeoutMs, normalizeToolCallTimeoutMs } = await import('../lib/index.js')
after(() => rmSync(scratchHome, { recursive: true, force: true }))

/** The state file as it stands, or `null` when nothing was ever written. */
function persistedState() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

/** Minimal ctx: enough for apply() to mount its route without a real harness.
 * `register` captures the tool definitions so a test can call the real one. */
function makeCtx() {
  const routes = []
  const definitions = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: {
      register: (definition) => { definitions.push(definition); return () => {} },
      restrict: () => () => {},
      guard: () => () => {},
      execute: async () => ({ content: [] }),
    },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: () => undefined,
    on: () => () => {},
    // The plugin injects `webServer` lazily (it is optional), so hand the
    // callback a child ctx exposing the stubbed webserver.
    inject: (names, callback) => {
      if (typeof callback === 'function' && names.includes('webServer')) {
        callback({
          webServer: ctx.webServer,
          get: () => undefined,
          effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
        })
      }
      return { dispose: () => {} }
    },
    effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  }
  apply(ctx)
  return { routes, handler: routes[0]?.handler, definitions }
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

const settingsOf = (handler) => request(handler, 'GET', '/smkit/api/settings')

/**
 * An MCP endpoint that answers the connect phase and then never answers
 * `tools/call`: the client's own timeout is the only thing that can end it.
 * @returns the observed `tools/call` signal, filled once that request is made.
 */
function stubMcpFetch() {
  const real = globalThis.fetch
  const observed = { signal: null, aborted: false }
  globalThis.fetch = (url, options = {}) => {
    const payload = JSON.parse(String(options.body ?? '{}'))
    if (payload.method === 'tools/call') {
      observed.signal = options.signal ?? null
      return new Promise((resolve, reject) => {
        // Belt and braces: if the timeout were ever dropped, the call would hang
        // and take the whole test file with it. The guard is unref'd so it keeps
        // no process alive on its own.
        const guard = setTimeout(
          () => reject(new Error('fetch stub: tools/call was never aborted')),
          20_000,
        )
        guard.unref?.()
        options.signal?.addEventListener('abort', () => {
          clearTimeout(guard)
          observed.aborted = true
          reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
        })
      })
    }
    const result =
      payload.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'silent', version: '1' } }
        : payload.method === 'tools/list'
          ? { tools: [{ name: 'slow', description: 'never answers', inputSchema: { type: 'object' } }] }
          : {}
    return Promise.resolve({
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }),
    })
  }
  return { observed, restore() { globalThis.fetch = real } }
}

it('reports the built-in 60 s timeout until a profile stores one', async () => {
  const { handler } = makeCtx()
  const settings = await settingsOf(handler)
  assert.equal(settings.code, 200)
  assert.equal(settings.json.toolCallTimeoutMs, 60_000)

  // The read path ignores a value the bounds reject, without rewriting the file.
  assert.equal(effectiveToolCallTimeoutMs({}), 60_000)
  assert.equal(effectiveToolCallTimeoutMs({ toolCallTimeoutMs: 1_000 }), 1_000)
  assert.equal(effectiveToolCallTimeoutMs({ toolCallTimeoutMs: 999 }), 60_000)
  assert.equal(effectiveToolCallTimeoutMs({ toolCallTimeoutMs: '5000' }), 60_000)
  assert.equal(normalizeToolCallTimeoutMs(1_000), 1_000)
  assert.equal(normalizeToolCallTimeoutMs(1_800_001), undefined)
  assert.equal(normalizeToolCallTimeoutMs(1.5), undefined)
})

it('refuses a timeout outside the bounds and keeps the stored one', async () => {
  const { handler } = makeCtx()
  for (const body of [
    { timeoutMs: 999 },
    { timeoutMs: 1_800_001 },
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 1.5 },
    { timeoutMs: '60000' },
    {},
  ]) {
    const refused = await request(handler, 'POST', '/smkit/api/settings/tool-timeout', body)
    assert.equal(refused.code, 400, JSON.stringify(body) + ' must be refused')
  }
  assert.equal((await settingsOf(handler)).json.toolCallTimeoutMs, 60_000)
  assert.equal(persistedState()?.toolCallTimeoutMs, undefined, 'a refused write must not reach the file')
})

it('stores a timeout, reports it, and clears back to the default', async () => {
  const { handler } = makeCtx()

  const written = await request(handler, 'POST', '/smkit/api/settings/tool-timeout', { timeoutMs: 120_000 })
  assert.equal(written.code, 200)
  assert.equal(written.json.toolCallTimeoutMs, 120_000)
  assert.equal(persistedState().toolCallTimeoutMs, 120_000)
  assert.equal((await settingsOf(handler)).json.toolCallTimeoutMs, 120_000)

  // A later mount reads the stored value rather than the default.
  const remounted = makeCtx()
  assert.equal((await settingsOf(remounted.handler)).json.toolCallTimeoutMs, 120_000)

  const cleared = await request(handler, 'POST', '/smkit/api/settings/tool-timeout', { timeoutMs: null })
  assert.equal(cleared.code, 200)
  assert.equal(cleared.json.toolCallTimeoutMs, 60_000)
  assert.equal('toolCallTimeoutMs' in persistedState(), false, 'clearing must remove the key')
})

it('ends a tools/call that outlives the configured timeout', async () => {
  const stub = stubMcpFetch()
  try {
    const { handler, definitions } = makeCtx()

    const configured = await request(handler, 'POST', '/smkit/api/settings/tool-timeout', { timeoutMs: 1_000 })
    assert.equal(configured.code, 200)

    const created = await request(handler, 'POST', '/smkit/api/servers', {
      name: 'silent',
      type: 'http',
      url: 'http://127.0.0.1:9/mcp',
      authMode: 'none',
    })
    assert.equal(created.code, 201)
    const connected = await request(handler, 'POST', `/smkit/api/servers/${created.json.server.id}/connect`)
    assert.equal(connected.json.server.status, 'connected')

    const slow = definitions.find((definition) => definition.mcpRawName === 'slow')
    assert.ok(slow, 'the stub tool must be registered')

    const startedAt = Date.now()
    await assert.rejects(slow.execute({}, {}), 'a tools/call past the timeout must reject')
    const elapsed = Date.now() - startedAt
    assert.ok(stub.observed.aborted, 'the timeout must abort the in-flight request')
    assert.equal(stub.observed.signal?.aborted, true, 'the signal fetch received is the one the timeout aborted')
    assert.ok(elapsed >= 900, `the call must survive until the timeout (${elapsed} ms)`)
    assert.ok(elapsed < 10_000, `the call must not run to the transport default (${elapsed} ms)`)
  } finally {
    stub.restore()
  }
})
