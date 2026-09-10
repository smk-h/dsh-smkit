/**
 * Offline verification for dsh-smkit — run by `pnpm verify` and `prepack`,
 * after the build has emitted `lib/index.js` (tsc, host half) and
 * `lib/client.js` (tsdown, browser half).
 *
 * Checks, in mounting order:
 *   1. the host half imports cleanly and exports `name` + function-form `apply`
 *      + the `tools` injection;
 *   2. `apply()` mounts its API route on a stub webserver and `GET /ping`
 *      answers;
 *   3. the bundle patch and manifest wiring still point at this package;
 *   4. the browser half loads through `window.__ModuleLoader__.load`, registers
 *      balanced `zh`/`en` dictionaries and seats the `settings.section` slot.
 *
 * Exits non-zero with a clear message on any failure, so `prepack` can never
 * ship a broken build. `HOME` and `DSH_HOME` are redirected to a scratch
 * directory first: no check may touch a real `~/.dsh`.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

const failure = (message) => {
  console.error(`verify: ${message}`)
  process.exit(1)
}

const scratch = mkdtempSync(join(tmpdir(), 'dsh-smkit-verify-'))
process.env.HOME = scratch
process.env.USERPROFILE = process.env.HOME // Windows: homedir() 读 USERPROFILE 而非 HOME
process.env.DSH_HOME = join(scratch, '.dsh')
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }))

/** 1. The build must exist and import cleanly, exporting the plugin surface. */
let mod
try {
  mod = await import(pathToFileURL(require.resolve('../lib/index.js')).href)
} catch (error) {
  failure(`cannot import lib/index.js — run \`pnpm build\` first: ${error?.stack ?? error}`)
}
assert.equal(mod.name, 'mcp-manager', 'the plugin must export name = "mcp-manager"')
assert.equal(typeof mod.apply, 'function', 'the plugin must export a function-form apply()')
assert.ok(
  Array.isArray(mod.inject) && mod.inject.includes('tools'),
  'the host half must inject the tools service',
)

/** 2. Mount the route on a stub webserver and probe the liveness endpoint. */
function hostCtx() {
  const routes = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { register: () => () => {}, restrict: () => () => {}, guard: () => () => {}, schemas: () => [], get: () => undefined, execute: async () => ({ content: [] }) },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: () => undefined,
    on: () => () => {},
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
  mod.apply(ctx)
  return routes
}

const routes = hostCtx()
assert.equal(routes.length, 1, 'apply() must mount exactly one prefix route')
assert.equal(routes[0].path, '/mcp-manager', 'the route must live under /mcp-manager')

const probe = await new Promise((resolve) => {
  const res = {
    code: 0,
    body: '',
    writeHead(code) { this.code = code },
    end(chunk) { this.body = chunk ?? ''; resolve(this) },
  }
  const req = {
    method: 'GET',
    url: '/mcp-manager/api/ping',
    headers: { host: '127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() {},
  }
  routes[0].handler(req, res)
})
assert.equal(probe.code, 200, 'GET /mcp-manager/api/ping must answer 200')
assert.equal(JSON.parse(probe.body).ok, true, 'the ping probe must report ok')

/** 3. The bundle patch + manifest must still point at this package. */
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
assert.ok(patch.includes(`name: '${pkg.name}'`), 'cordis.patch.yml must insert the package by name')
assert.ok(pkg.dsh.bundle.patch === './cordis.patch.yml', 'package.json must declare dsh.bundle.patch')
assert.equal(pkg.dsh.client.platform, 'web', 'the client half must target the web platform')
assert.equal(pkg.exports['./client'], './lib/client.js', 'package.json must export the client bundle')

/** 4. The browser half must load and seat itself through the client runtime. */
const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const dictionaries = {}
let slotSpec = null
let clientExports = null

runInNewContext(clientSource, {
  window: {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        assert.equal(id, pkg.name, 'the client bundle id must be the package name')
        clientExports = factory(() => ({
          createElement() {},
          useState: (value) => [value, () => {}],
          useEffect() {},
          useCallback: (callback) => callback,
        }))
      },
    },
  },
  fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
  setInterval: () => 1,
  clearInterval: () => {},
})

assert.equal(typeof clientExports?.apply, 'function', 'the client bundle must export apply()')
assert.ok(clientExports.inject.includes('locale'), 'the client half must inject the locale service')

clientExports.apply({
  effect(fn) { fn() },
  locale: {
    register(namespace, table) { dictionaries[namespace] = table; return () => {} },
    bind: (namespace) => (key) => dictionaries[namespace]?.[key] ?? key,
  },
  slots: {
    inject: (_name, callback) => callback(),
    register: (spec) => { slotSpec = spec },
  },
})
assert.deepEqual(
  Object.keys(dictionaries.mcp.zh).sort(),
  Object.keys(dictionaries.mcp.en).sort(),
  'the zh and en dictionaries must carry the same key set',
)
assert.equal(slotSpec?.name, 'settings.section', 'the client half must seat the settings section slot')
assert.equal(slotSpec?.id, 'mcp-manager', 'the slot entry id must stay mcp-manager')
assert.equal(slotSpec?.locale, 'mcp', 'the slot entry must bind the mcp locale namespace')

console.log('verify: ok — dsh-smkit builds, mounts its API route, and seats Settings → MCP.')
