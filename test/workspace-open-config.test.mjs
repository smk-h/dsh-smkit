/**
 * The config-open routes: `POST /open-config` opens the global state file,
 * `POST /workspaces/open-config` the workspace's mcp.json — refuse
 * unregistered paths, create the file when absent, answer the on-disk path,
 * and never touch a file that already exists. The open itself is skipped via
 * DSH_SMKIT_SKIP_OPEN so a test run cannot pop a real editor window.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// STATE_PATH is derived from homedir() when the module is evaluated, so point
// HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-openconfig-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME // Windows: homedir() 读 USERPROFILE 而非 HOME
process.env.DSH_SMKIT_SKIP_OPEN = '1'
mkdirSync(join(scratchHome, '.dsh'), { recursive: true })

const { apply } = await import('../lib/index.js')
after(() => rmSync(scratchHome, { recursive: true, force: true }))

/**
 * Minimal ctx: route mounting plus an optional registered workspace path (the
 * same registry fallback `knownWorkspacePath` uses). No agents tier: the route
 * under test never rescans, so no workspace watchers are started.
 */
function makeCtx({ workspacePath } = {}) {
  const routes = []
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
      if (names.includes('webServer')) callback({ webServer: ctx.webServer, get: () => undefined, effect: (fn) => fn() })
      return { dispose: () => {} }
    },
    effect: (fn) => fn(),
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

it('refuses a request without a path', async () => {
  const { handler } = makeCtx()
  const r = await request(handler, 'POST', '/mcp-manager/api/workspaces/open-config', {})
  assert.equal(r.code, 400)
})

it('refuses a path that is not a registered workspace', async () => {
  const { handler } = makeCtx()
  const r = await request(handler, 'POST', '/mcp-manager/api/workspaces/open-config', { path: join(scratchHome, 'elsewhere') })
  assert.equal(r.code, 403)
})

it('opens the profile state file for the global tier', async () => {
  const { handler } = makeCtx()
  const r = await request(handler, 'POST', '/mcp-manager/api/open-config', {})
  assert.equal(r.code, 200)
  assert.equal(r.json.file, join(scratchHome, '.dsh', 'mcp-manager.json'))
  assert.ok(existsSync(r.json.file), 'a missing state file must be materialized before the open')
})

it('creates the config file when absent and answers its path', async () => {
  const wsDir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-smkit-openconfig-ws-')))
  const { handler } = makeCtx({ workspacePath: wsDir })

  const r = await request(handler, 'POST', '/mcp-manager/api/workspaces/open-config', { path: wsDir })
  assert.equal(r.code, 200)
  assert.equal(r.json.file, join(wsDir, '.dsh', 'dshmm', 'mcp.json'))
  assert.equal(readFileSync(r.json.file, 'utf8'), '{}\n', 'the created file must be the minimal valid config')
})

it('leaves an existing config file untouched', async () => {
  const wsDir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-smkit-openconfig-ws2-')))
  const file = join(wsDir, '.dsh', 'dshmm', 'mcp.json')
  mkdirSync(join(wsDir, '.dsh', 'dshmm'), { recursive: true })
  const existing = '{"mcpServers":{"local":{"type":"stdio","command":"node"}}}'
  writeFileSync(file, existing)
  const { handler } = makeCtx({ workspacePath: wsDir })

  const r = await request(handler, 'POST', '/mcp-manager/api/workspaces/open-config', { path: wsDir })
  assert.equal(r.code, 200)
  assert.equal(r.json.file, file)
  assert.ok(existsSync(file))
  assert.equal(readFileSync(file, 'utf8'), existing, 'an existing config must not be rewritten')
})
