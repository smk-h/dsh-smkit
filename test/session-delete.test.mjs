/**
 * `POST /mcp-manager/api/sessions/delete`: the session delete composed from the
 * two lifecycle operations the harness does offer — the workspace registry's
 * archive set (which hides a session everywhere) and removing the session's own
 * artifact directory — plus the `api-session/removed` frame that makes the
 * browser drop the sidebar row without a reload.
 *
 * The suite drives the real route with stub DSH services, so it covers what the
 * harness contracts actually guarantee: the resolution order of the session
 * directory (backend root → harness home → project scan), the refusal codes, and
 * the "never remove anything that is not this session's own directory" guard.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, it } from 'node:test'

// STATE_PATH is derived from homedir() when the module is evaluated, so point
// HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-session-delete-'))
process.env.HOME = scratchHome
process.env.USERPROFILE = process.env.HOME // Windows: homedir() 读 USERPROFILE 而非 HOME
process.env.DSH_HOME = join(scratchHome, '.dsh')
mkdirSync(process.env.DSH_HOME, { recursive: true })

const { apply, encodeSegment, projectKey } = await import('../lib/index.js')
after(() => rmSync(scratchHome, { recursive: true, force: true }))

/** A scratch session root, plus one materialized session directory inside it. */
function makeSession({ id, cwd, root }) {
  const dir = join(root, projectKey(cwd), encodeSegment(id))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.jsonl'), '{"type":"session"}\n')
  return dir
}

/**
 * Mount the plugin with stub services. `sessions`, `agents` and
 * `workspaceRegistry` are only supplied when the case needs them, which is what
 * proves the delete degrades instead of requiring them.
 */
function makeCtx({ persistence, sessions, agents, registry, storageBackend, spillStore, removes }) {
  const routes = []
  const services = {
    ...(persistence === undefined ? {} : { sessionPersistence: persistence }),
    ...(sessions === undefined ? {} : { sessions }),
    ...(agents === undefined ? {} : { agents }),
    ...(registry === undefined ? {} : { workspaceRegistry: registry }),
    ...(storageBackend === undefined ? {} : { 'storage.backend.json': storageBackend }),
    ...(spillStore === undefined ? {} : { spillStore }),
  }
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { register: () => () => {}, restrict: () => () => {}, guard: () => () => {}, schemas: () => [], get: () => undefined, execute: async () => ({ content: [] }) },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: (name) => services[name],
    emit: (event, ...args) => { if (removes !== undefined) removes.push({ event, args }) },
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback === 'function' && names.includes('webServer')) {
        callback({ webServer: ctx.webServer, get: () => undefined, effect: (fn) => fn() })
      }
      return { dispose: () => {} }
    },
    effect: (fn) => fn(),
  }
  apply(ctx)
  return routes[0].handler
}

/** Call the mounted route with a minimal req/res pair. */
async function request(handler, body) {
  const payload = [Buffer.from(JSON.stringify(body))]
  const req = {
    method: 'POST',
    url: '/mcp-manager/api/sessions/delete',
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

it('deletes the session directory and announces the removal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-root-'))
  const cwd = join(scratchHome, 'project-a')
  const dir = makeSession({ id: 'session-1', cwd, root })
  const sibling = makeSession({ id: 'session-2', cwd, root })
  const archived = []
  const removes = []
  const handler = makeCtx({
    persistence: { root, stat: async (id) => (id === 'session-1' ? { header: { id, cwd } } : undefined) },
    registry: { archiveSession: async (id) => { archived.push(id) } },
    removes,
  })

  const r = await request(handler, { sessionId: 'session-1' })
  assert.equal(r.code, 200)
  assert.equal(r.json.deleted, true)
  assert.equal(r.json.live, false, 'a session with no live instance is not reported as live')
  assert.equal(r.json.archived, false, 'a detached session needs no archive tombstone')
  assert.deepEqual(r.json.removed, [dir])
  assert.equal(existsSync(dir), false, 'the session directory must be gone')
  assert.equal(existsSync(sibling), true, 'only the addressed session may be removed')
  assert.deepEqual(archived, [], 'its artifacts were the whole footprint, so nothing is archived')
  assert.deepEqual(removes, [{ event: 'api-session/removed', args: ['session-1'] }])
})

it('finds the directory through the harness home when the backend reports no root', async () => {
  const defaultRoot = join(process.env.DSH_HOME, 'sessions')
  const cwd = join(scratchHome, 'project-b')
  const dir = makeSession({ id: 'session-home', cwd, root: defaultRoot })
  const handler = makeCtx({
    persistence: { stat: async (id) => (id === 'session-home' ? { header: { id, cwd } } : undefined) },
  })

  const r = await request(handler, { sessionId: 'session-home' })
  assert.equal(r.code, 200)
  assert.equal(existsSync(dir), false)
})

it('scans the project directories when the header carries no cwd', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-root-'))
  const dir = makeSession({ id: 'session-cwdless', cwd: join(scratchHome, 'project-c'), root })
  const handler = makeCtx({
    persistence: { root, stat: async (id) => (id === 'session-cwdless' ? { header: { id } } : undefined) },
  })

  const r = await request(handler, { sessionId: 'session-cwdless' })
  assert.equal(r.code, 200)
  assert.equal(existsSync(dir), false)
})

it('prefers the backend\u2019s own artifact path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-root-'))
  const cwd = join(scratchHome, 'project-d')
  const dir = makeSession({ id: 'session-resolved', cwd, root })
  const handler = makeCtx({
    persistence: {
      stat: async (id) => ({ header: { id, cwd: join(scratchHome, 'a-different-cwd') } }),
      resolveCurrentLog: async () => join(dir, 'session.jsonl'),
    },
  })

  const r = await request(handler, { sessionId: 'session-resolved' })
  assert.equal(r.code, 200)
  assert.equal(existsSync(dir), false, 'the backend-named directory wins over the rebuilt path')
})

it('refuses an unknown session without touching the filesystem', async () => {
  const handler = makeCtx({ persistence: { stat: async () => undefined } })
  const r = await request(handler, { sessionId: 'ghost' })
  assert.equal(r.code, 404)
  assert.equal(r.json.code, 'session/not-found')
})

it('refuses a session whose agent is running', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-root-'))
  const cwd = join(scratchHome, 'project-e')
  const dir = makeSession({ id: 'session-running', cwd, root })
  const archived = []
  const removes = []
  const handler = makeCtx({
    persistence: { root, stat: async (id) => ({ header: { id, cwd } }) },
    sessions: { get: (id) => (id === 'session-running' ? { header: { id, cwd } } : undefined) },
    agents: { get: (id) => (id === 'session-running' ? { status: 'running' } : undefined) },
    registry: { archiveSession: async (id) => { archived.push(id) } },
    removes,
  })

  const r = await request(handler, { sessionId: 'session-running' })
  assert.equal(r.code, 409)
  assert.equal(r.json.code, 'session/running')
  assert.equal(existsSync(dir), true, 'a refused delete must leave the log alone')
  assert.deepEqual(archived, [], 'a refused delete must not archive either')
  assert.deepEqual(removes, [], 'a refused delete must not announce a removal')
})

it('refuses a subagent session — its parent catalog owns it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-root-'))
  const cwd = join(scratchHome, 'project-f')
  const dir = makeSession({ id: 'child-1', cwd, root })
  const handler = makeCtx({
    persistence: { root, stat: async (id) => ({ header: { id, cwd, origin: 'subagent' } }) },
  })

  const r = await request(handler, { sessionId: 'child-1' })
  assert.equal(r.code, 400)
  assert.equal(r.json.code, 'session/subagent')
  assert.equal(existsSync(dir), true)
})

it('archives an attached session before removing its data', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-root-'))
  const cwd = join(scratchHome, 'project-g')
  const dir = makeSession({ id: 'session-live', cwd, root })
  const archived = []
  const removes = []
  const handler = makeCtx({
    persistence: { root, stat: async () => undefined },
    sessions: { get: (id) => (id === 'session-live' ? { header: { id, cwd } } : undefined) },
    agents: { get: () => ({ status: 'idle' }) },
    registry: { archiveSession: async (id) => { archived.push(id) } },
    removes,
  })

  const r = await request(handler, { sessionId: 'session-live' })
  assert.equal(r.code, 200)
  assert.equal(r.json.live, true, 'a live session is reported so the UI can expect the tombstone')
  assert.equal(r.json.archived, true)
  assert.equal(existsSync(dir), false)
  assert.deepEqual(archived, ['session-live'], 'the archive set is the only thing that hides a live session')
  assert.deepEqual(removes, [{ event: 'api-session/removed', args: ['session-live'] }])
})

it('refuses an attached session when no archive set could hide it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-root-'))
  const cwd = join(scratchHome, 'project-attached')
  const dir = makeSession({ id: 'session-attached', cwd, root })
  const removes = []
  const handler = makeCtx({
    persistence: { root, stat: async () => undefined },
    sessions: { get: (id) => (id === 'session-attached' ? { header: { id, cwd } } : undefined) },
    removes,
  })

  const r = await request(handler, { sessionId: 'session-attached' })
  assert.equal(r.code, 409)
  assert.equal(r.json.code, 'session/attached')
  assert.equal(existsSync(dir), true, 'a delete that cannot hide the session must not run at all')
  assert.deepEqual(removes, [])
})

it('removes the projection cache row and nothing beside it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-root-'))
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-smkit-storages-'))
  const cwd = join(scratchHome, 'project-h')
  makeSession({ id: 'session-cache', cwd, root })
  const tableDir = join(storageRoot, 'session_projcache', 'sessions')
  mkdirSync(tableDir, { recursive: true })
  const own = join(tableDir, 'session-cache.json')
  const backup = join(tableDir, 'session-cache.json.bak.202601010000')
  const other = join(tableDir, 'session-other.json')
  writeFileSync(own, '{}')
  writeFileSync(backup, '{}')
  writeFileSync(other, '{}')
  const handler = makeCtx({
    persistence: { root, stat: async (id) => ({ header: { id, cwd } }) },
    storageBackend: { root: storageRoot },
  })

  const r = await request(handler, { sessionId: 'session-cache' })
  assert.equal(r.code, 200)
  assert.equal(existsSync(own), false)
  assert.equal(existsSync(backup), false)
  assert.equal(existsSync(other), true, 'another session\u2019s cache row must survive')
})

it('removes the session\u2019s spilled tool-output directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-root-'))
  const spillRoot = mkdtempSync(join(tmpdir(), 'dsh-smkit-spill-'))
  const cwd = join(scratchHome, 'project-spill')
  makeSession({ id: 'session-spill', cwd, root })
  // The local spill backend names one directory per session after sha256(id).
  const spillName = (id) => `session-${createHash('sha256').update(id).digest('hex').slice(0, 12)}`
  const own = join(spillRoot, spillName('session-spill'))
  const other = join(spillRoot, spillName('session-other'))
  mkdirSync(own, { recursive: true })
  mkdirSync(other, { recursive: true })
  writeFileSync(join(own, '012345-read.txt'), 'spilled tool output')
  const handler = makeCtx({
    persistence: { root, stat: async (id) => ({ header: { id, cwd } }) },
    spillStore: { root: spillRoot },
  })

  const r = await request(handler, { sessionId: 'session-spill' })
  assert.equal(r.code, 200)
  assert.equal(existsSync(own), false, 'the session\u2019s spilled output must go with it')
  assert.equal(existsSync(other), true, 'another session\u2019s spill directory must survive')
  assert.deepEqual(r.json.removed, [join(root, projectKey(cwd), encodeSegment('session-spill')), own])
})

it('answers 503 when the deployment mounts no session persistence', async () => {
  const handler = makeCtx({})
  const r = await request(handler, { sessionId: 'session-1' })
  assert.equal(r.code, 503)
  assert.equal(r.json.code, 'session/unavailable')
})

it('rejects a request without a session id', async () => {
  const handler = makeCtx({ persistence: { stat: async () => undefined } })
  const r = await request(handler, {})
  assert.equal(r.code, 404)
  assert.equal(r.json.code, 'session/not-found')
})

it('leaves no trace when an attached session never materialized', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-root-'))
  const cwd = join(scratchHome, 'project-i')
  const archived = []
  const handler = makeCtx({
    persistence: { root, stat: async () => undefined },
    sessions: { get: (id) => (id === 'session-unmaterialized' ? { header: { id, cwd } } : undefined) },
    registry: { archiveSession: async (id) => { archived.push(id) } },
  })

  const r = await request(handler, { sessionId: 'session-unmaterialized' })
  assert.equal(r.code, 200)
  assert.deepEqual(r.json.removed, [], 'a created-but-empty session has no directory to remove')
  assert.deepEqual(archived, ['session-unmaterialized'], 'the hiding half still runs')
})

it('keeps the delete working when a backend refuses to read the header', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-root-'))
  const cwd = join(scratchHome, 'project-j')
  const dir = makeSession({ id: 'session-broken', cwd, root })
  const handler = makeCtx({
    persistence: {
      root,
      stat: async () => { throw new Error('foreign format generation') },
    },
  })

  const r = await request(handler, { sessionId: 'session-broken' })
  assert.equal(r.code, 404, 'an unreadable artifact reports the same miss a listing shows')
  assert.equal(existsSync(dir), true, 'and is never removed on a guess')
})
