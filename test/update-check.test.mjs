/**
 * The manual update check (`Settings → SMKIT` → 检查更新).
 *
 * Three things have to hold, because they are what the button promises:
 *
 * 1. **The comparison** — a newer patch/minor/major is an update, the same
 *    version is not, and a prerelease sorts before its release.
 * 2. **The refusals** — an unreachable registry is an `error`, not "up to
 *    date", so the page never claims the plugin is current on a bad network.
 * 3. **The handover** — an update comes with the exact command that installs
 *    it, named for the profile the host runs, and the Desktop (whose profile
 *    belongs to the Electron app) gets no command at all.
 *
 * The registry is stubbed at `fetch`, so nothing here touches npm; `HOME` is
 * redirected to a scratch directory first because mounting the plugin wires
 * the MCP feature, which reads a state file under it.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, it } from 'node:test'

/** The running version, read rather than remembered: a release bump must not
 * turn these cases red. */
const pkg = createRequire(import.meta.url)('../package.json')

const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-update-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME // Windows: homedir() 读 USERPROFILE 而非 HOME
process.env.DSH_HOME = join(scratchHome, '.dsh')
after(() => rmSync(scratchHome, { recursive: true, force: true }))

const { apply, checkForUpdate, compareVersions, installCommand, registryLatestUrl } = await import(
  '../lib/index.js'
)

/** The real `fetch`, restored after every stubbed call. */
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Answer every registry read with one canned body. */
function stubRegistry(body, ok = true) {
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return { ok, status: ok ? 200 : 503, json: async () => body }
  }
  return calls
}

it('orders versions the way the button reads them', () => {
  assert.equal(compareVersions('1.16.0', '1.15.0'), 1)
  assert.equal(compareVersions('1.15.0', '1.16.0'), -1)
  assert.equal(compareVersions('1.15.0', '1.15.0'), 0)
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1)
  // A prerelease belongs before the release it precedes.
  assert.equal(compareVersions('1.16.0-rc.1', '1.16.0'), -1)
  assert.equal(compareVersions('1.16.0', '1.16.0-rc.1'), 1)
  // Unparsable input is "no opinion", never a surprise update.
  assert.equal(compareVersions('latest', '1.15.0'), 0)
})

it('builds the scoped registry URL npm accepts', () => {
  assert.equal(
    registryLatestUrl('@smai-kit/dsh-smkit'),
    'https://registry.npmjs.org/@smai-kit%2Fdsh-smkit/latest',
  )
  assert.equal(
    registryLatestUrl('dsh-smkit', 'https://registry.example.com/'),
    'https://registry.example.com/dsh-smkit/latest',
  )
})

it('names the profile and the version in the install command', () => {
  assert.equal(
    installCommand('web', '@smai-kit/dsh-smkit', '1.16.0'),
    'dsh plugin --profile web add @smai-kit/dsh-smkit@1.16.0',
  )
})

it('reports a newer release as an update', async () => {
  const calls = stubRegistry({ version: '1.16.0' })
  const view = await checkForUpdate({ current: '1.15.0', packageName: '@smai-kit/dsh-smkit' })

  assert.deepEqual(view, { current: '1.15.0', latest: '1.16.0', hasUpdate: true })
  assert.deepEqual(calls, ['https://registry.npmjs.org/@smai-kit%2Fdsh-smkit/latest'])
})

it('reports the running version as current', async () => {
  stubRegistry({ version: '1.15.0' })
  const view = await checkForUpdate({ current: '1.15.0', packageName: 'dsh-smkit' })

  assert.equal(view.hasUpdate, false)
  assert.equal(view.latest, '1.15.0')
  assert.equal(view.error, undefined)
})

it('reports an unreachable registry as an error, not as "latest"', async () => {
  globalThis.fetch = async () => {
    throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org')
  }
  const view = await checkForUpdate({ current: '1.15.0', packageName: 'dsh-smkit' })

  assert.equal(view.hasUpdate, false)
  assert.equal(view.latest, null)
  assert.match(view.error, /ENOTFOUND/)
})

it('reports a non-2xx registry answer as an error', async () => {
  stubRegistry({}, false)
  const view = await checkForUpdate({ current: '1.15.0', packageName: 'dsh-smkit' })

  assert.equal(view.hasUpdate, false)
  assert.match(view.error, /503/)
})

/**
 * Mount the plugin on a stub host and ask its own route, which is where the
 * command is attached: the check module knows versions, the route knows the
 * profile.
 */
function probe(profile) {
  const routes = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { register: () => () => {}, restrict: () => () => {}, guard: () => () => {}, schemas: () => [], get: () => undefined, execute: async () => ({ content: [] }) },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: (name) => (name === 'profileContext' ? { name: profile } : undefined),
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
  apply(ctx)
  assert.equal(routes.length, 1, 'the plugin mounts one prefix route')
  return async (path) =>
    new Promise((resolve) => {
      const res = {
        code: 0,
        body: '',
        writeHead(code) { this.code = code },
        end(chunk) { this.body = chunk ?? ''; resolve({ code: this.code, body: JSON.parse(this.body) }) },
      }
      const req = {
        method: 'GET',
        url: path,
        headers: { host: '127.0.0.1:3080' },
        async *[Symbol.asyncIterator]() {},
      }
      routes[0].handler(req, res)
    })
}

it('hands the web host a profile-named install command', async () => {
  stubRegistry({ version: '9.9.9' })
  const get = probe('web')

  const answer = await get('/smkit/api/update/check')
  assert.equal(answer.code, 200)
  assert.equal(answer.body.hasUpdate, true)
  assert.equal(answer.body.installCommand, 'dsh plugin --profile web add @smai-kit/dsh-smkit@9.9.9')
})

it('gives the Desktop no command, and no command when nothing is newer', async () => {
  stubRegistry({ version: '9.9.9' })
  const desktop = await probe('desktop')('/smkit/api/update/check')
  assert.equal(desktop.body.hasUpdate, true)
  assert.equal(desktop.body.installCommand, undefined, 'the Desktop owns its profile: `dsh plugin --profile desktop` is refused')

  // The registry answering the running version is the "nothing newer" case.
  stubRegistry({ version: pkg.version })
  const current = await probe('web')('/smkit/api/update/check')
  assert.equal(current.body.hasUpdate, false)
  assert.equal(current.body.installCommand, undefined)
})
