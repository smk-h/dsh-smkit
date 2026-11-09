/**
 * The plugin's HTTP surface sits behind DSH's own admission fence.
 *
 * Every route under `/smkit` is served by one prefix route, and whoever can
 * reach the port could otherwise read or rewrite MCP configuration through it.
 * DSH already answers that question for its native routes with
 * `ctx.connection.requestRejection(request)` — no session 401, Host/Origin
 * mismatch 403 — so this surface asks the same service:
 *
 * - 401/403 from the fence reject the request before any handler runs;
 * - a host without the service answers 503 rather than degrading to anonymous
 *   access;
 * - a request with no socket never crossed a network boundary (the unit
 *   harness, an in-process caller), so it is not subject to the fence;
 * - the OAuth redirect is exempt from the session requirement — the IdP
 *   navigates the browser there without a DSH cookie, and the callback handler
 *   verifies the flow `state` itself.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// The plugin reads its state file from homedir() at mount time.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-fence-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = scratchHome
mkdirSync(join(scratchHome, '.dsh'), { recursive: true })
after(() => rmSync(scratchHome, { recursive: true, force: true }))

const { apply } = await import('../lib/index.js')

/** One response the prefix route wrote. */
function makeRes() {
  const res = {
    code: 0,
    body: '',
    headers: {},
    writeHead(code, headers) {
      res.code = code
      if (headers) Object.assign(res.headers, headers)
    },
    end(chunk) {
      res.body = chunk === undefined ? '' : String(chunk)
    },
  }
  return res
}

/**
 * Mount the plugin against a webserver stub, with an optional `connection`
 * service whose verdict the test chooses.
 *
 * @param options.verdict - what `requestRejection` answers; `'absent'` omits
 *   the service entirely, `undefined` admits the request.
 * @returns the mounted route handler.
 */
function mount({ verdict } = {}) {
  const routes = []
  const disposers = []
  const collect = (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  const connection = verdict === 'absent'
    ? undefined
    : { requestRejection: () => verdict }
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
    get: (name) => (name === 'connection' ? connection : undefined),
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback !== 'function') return { dispose: () => {} }
      if (names.includes('webServer')) {
        callback({ webServer: ctx.webServer, get: ctx.get, effect: collect })
      }
      return { dispose: () => {} }
    },
    effect: collect,
  }
  apply(ctx)
  return { handler: routes[0]?.handler, dispose: () => { for (const fn of disposers.reverse()) fn() } }
}

/** Drive the route the way a webserver does. */
async function call(handler, path, { socket = {}, headers = {} } = {}) {
  const res = makeRes()
  const req = { method: 'GET', url: path, headers, socket }
  await handler(req, res)
  return res
}

it('rejects an unauthenticated request with 401 before any handler runs', async (t) => {
  const mounted = mount({ verdict: 401 })
  t.after(mounted.dispose)
  const res = await call(mounted.handler, '/smkit/api/servers')
  assert.equal(res.code, 401)
  assert.match(res.body, /connection fence/)
})

it('rejects a foreign Host/Origin with 403', async (t) => {
  const mounted = mount({ verdict: 403 })
  t.after(mounted.dispose)
  const res = await call(mounted.handler, '/smkit/api/servers', { headers: { origin: 'http://evil.example' } })
  assert.equal(res.code, 403)
})

it('answers 503 when the host exposes no connection service', async (t) => {
  const mounted = mount({ verdict: 'absent' })
  t.after(mounted.dispose)
  const res = await call(mounted.handler, '/smkit/api/servers')
  assert.equal(res.code, 503, 'fail closed rather than serve the API anonymously')
  assert.match(res.body, /connection service/)
})

it('serves the API once the fence admits the request', async (t) => {
  const mounted = mount({ verdict: undefined })
  t.after(mounted.dispose)
  const res = await call(mounted.handler, '/smkit/api/servers')
  assert.equal(res.code, 200)
  assert.deepEqual(JSON.parse(res.body), { servers: [] })
})

it('does not fence an in-process call that never crossed a socket', async (t) => {
  // The unit harness calls the handler directly with no socket; that caller
  // already runs inside the host, so there is nothing to authenticate.
  const mounted = mount({ verdict: 401 })
  t.after(mounted.dispose)
  const res = makeRes()
  await mounted.handler({ method: 'GET', url: '/smkit/api/servers', headers: {} }, res)
  assert.equal(res.code, 200)
})

it('lets the OAuth redirect through, because the IdP navigates without a cookie', async (t) => {
  const mounted = mount({ verdict: 401 })
  t.after(mounted.dispose)
  const res = await call(mounted.handler, '/smkit/callback/unknown-id')
  assert.equal(res.code, 200, 'the callback handler answers its own page')
  assert.match(res.body, /No MCP server config matches this callback/)
})
