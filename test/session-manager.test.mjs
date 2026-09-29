/**
 * The session manager's two routes, driven through the real plugin mount with
 * stub DSH services:
 *
 * - `GET /smkit/api/sessions/manager` — the listing the tab renders: the
 *   workspace projection (title, path, accounting order), the archive set,
 *   and one row per visible session with the metadata the page needs. The
 *   population rules are what the assertions pin: attached sessions merge
 *   over the persisted corpus, subagent children and blank placeholders are
 *   dropped, unaccounted sessions trail ungrouped, and every service the
 *   listing reads may be absent without failing it.
 * - `POST /smkit/api/sessions/delete-batch` — the single delete run per id:
 *   one refused session (a mid-turn agent) among deletable ones must not
 *   fail the batch, every success still announces itself on the event bus,
 *   and a malformed body is refused before any delete runs.
 */
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

// STATE_PATH is derived from homedir() when the module is evaluated, so point
// HOME at a scratch directory *before* the dynamic import below.
const scratchHome = mkdtempSync(join(tmpdir(), 'dsh-smkit-session-manager-'))
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

/** One projection-cache document: the rows the listing reads, others omitted. */
function writeProjCache(storageRoot, id, rows) {
  const dir = join(storageRoot, 'session_projcache', 'sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ version: 7, record: { rows } }))
}

/**
 * Mount the plugin with stub services. `sessions`, `agents`, `workspaceRegistry`
 * and the storage backend are only supplied when the case needs them, which is
 * what proves the listing (and the batch delete) degrades instead of requiring
 * them.
 */
function makeCtx({ persistence, sessions, agents, registry, storageBackend, removes } = {}) {
  const routes = []
  const services = {
    ...(persistence === undefined ? {} : { sessionPersistence: persistence }),
    ...(sessions === undefined ? {} : { sessions }),
    ...(agents === undefined ? {} : { agents }),
    ...(registry === undefined ? {} : { workspaceRegistry: registry }),
    ...(storageBackend === undefined ? {} : { 'storage.backend.json': storageBackend }),
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
async function request(handler, method, url, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    url,
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

it('lists the sidebar population with workspace accounting and the archive set', async () => {
  const storageRoot = join(scratchHome, 'storages')
  writeProjCache(storageRoot, 's-cold-1', {
    title: { val: 'Fix login flow' },
    sessionListMetadata: { val: { blank: false, lastPromptAt: 1_700_000_100_000 } },
  })
  writeProjCache(storageRoot, 's-blank-meta', {
    sessionListMetadata: { val: { blank: true } },
  })
  writeProjCache(storageRoot, 's-ungrouped', { title: { val: 'Stray session' } })

  const handler = makeCtx({
    persistence: {
      list: async () => [
        { header: { id: 's-cold-1', cwd: '/work/app', createdAt: 1_700_000_000_000 }, sizeBytes: 2048 },
        { header: { id: 's-cold-2', cwd: '/work/other', createdAt: 1_690_000_000_000 }, sizeBytes: 512 },
        { header: { id: 's-archived', cwd: '/work/app' } },
        { header: { id: 's-sub', origin: 'subagent', cwd: '/work/app' } },
        { header: { id: 's-blank-meta', cwd: '/work/app' } },
        { header: { id: 's-ungrouped', cwd: '/nowhere/stray' } },
      ],
    },
    sessions: {
      list: () => [
        { header: { id: 's-live', cwd: '/work/app', createdAt: 1_710_000_000_000 }, seq: 3 },
        { header: { id: 's-blank-seq', cwd: '/work/app' }, seq: 0 },
      ],
    },
    agents: { get: (id) => (id === 's-live' ? { status: 'running' } : undefined) },
    registry: {
      list: () => [
        { id: 'w1', path: '/work/app', title: 'My App', sessionIds: ['s-live', 's-cold-1', 's-archived', 's-sub', 's-blank-meta'] },
        { id: 'w2', path: '/work/other', title: 'Other', sessionIds: ['s-cold-2'] },
      ],
      archivedSessionIds: ['s-archived'],
    },
    storageBackend: { root: storageRoot },
  })

  const r = await request(handler, 'GET', '/smkit/api/sessions/manager')
  assert.equal(r.code, 200)
  assert.deepEqual(r.json.workspaces, [
    { workspaceId: 'w1', path: '/work/app', title: 'My App' },
    { workspaceId: 'w2', path: '/work/other', title: 'Other' },
  ])
  assert.deepEqual(r.json.archivedSessionIds, ['s-archived'])

  const byId = new Map(r.json.sessions.map((s) => [s.sessionId, s]))
  // Six persisted rows plus two live ones go in; three come out.
  assert.deepEqual(
    [...byId.keys()].sort(),
    ['s-archived', 's-cold-1', 's-cold-2', 's-live', 's-ungrouped'].sort(),
  )
  // A row's size is the dialog's own total: the session has no artifact
  // directory here, so what remains is its projection-cache document.
  const cacheDoc = (id) => join(storageRoot, 'session_projcache', 'sessions', `${id}.json`)
  assert.deepEqual(byId.get('s-live'), {
    sessionId: 's-live',
    workspaceId: 'w1',
    live: true,
    running: true,
    cwd: '/work/app',
    createdAt: 1_710_000_000_000,
    sizeBytes: 0,
  })
  assert.deepEqual(byId.get('s-cold-1'), {
    sessionId: 's-cold-1',
    title: 'Fix login flow',
    workspaceId: 'w1',
    live: false,
    running: false,
    cwd: '/work/app',
    createdAt: 1_700_000_000_000,
    lastPromptAt: 1_700_000_100_000,
    sizeBytes: statSync(cacheDoc('s-cold-1')).size,
  })
  assert.equal(byId.get('s-archived').workspaceId, 'w1', 'an archived session keeps its workspace accounting')
  assert.equal(byId.get('s-ungrouped').workspaceId, undefined, 'an unaccounted session trails ungrouped')
  assert.equal(byId.get('s-ungrouped').title, 'Stray session')
})

it('measures a row the way the delete dialog does: log dir plus cache row', async () => {
  // The row's number and the dialog's total used to be two different figures
  // (the persistence snapshot's current-generation log file versus the whole
  // measured footprint), and neither matched the other. The listing now runs
  // the dialog's own measurement, so one session reads one size everywhere.
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-measure-'))
  const cwd = join(scratchHome, 'measure-project')
  const dir = makeSession({ id: 's-measured', cwd, root })
  appendFileSync(join(dir, 'session.jsonl'), 'x'.repeat(1_000))
  const storageRoot = join(scratchHome, 'storages')
  writeProjCache(storageRoot, 's-measured', { title: { val: 'Measured session' } })
  const cacheDoc = join(storageRoot, 'session_projcache', 'sessions', 's-measured.json')

  const handler = makeCtx({
    persistence: { root, list: async () => [{ header: { id: 's-measured', cwd } }] },
    sessions: {
      list: () => [{ header: { id: 's-measured', cwd, createdAt: 1_710_000_000_000 }, seq: 9 }],
    },
    registry: {
      list: () => [{ id: 'w1', path: cwd, title: 'Measured', sessionIds: ['s-measured'] }],
    },
    storageBackend: { root: storageRoot },
  })

  const r = await request(handler, 'GET', '/smkit/api/sessions/manager')
  assert.equal(r.code, 200)
  assert.equal(r.json.sessions.length, 1)
  const expected = statSync(join(dir, 'session.jsonl')).size + statSync(cacheDoc).size
  assert.equal(r.json.sessions[0].sizeBytes, expected, 'log directory and cache row, the dialog\'s own total')
  assert.equal(r.json.sessions[0].live, true, 'the measurement does not care whether the session is attached')
})

it('keeps listing when the registry, the title service or the cache are absent', async () => {
  const handler = makeCtx({
    persistence: {
      list: async () => [{ header: { id: 's-only', cwd: '/work/app' }, sizeBytes: 10 }],
    },
  })
  const r = await request(handler, 'GET', '/smkit/api/sessions/manager')
  assert.equal(r.code, 200)
  assert.deepEqual(r.json.workspaces, [])
  assert.deepEqual(r.json.archivedSessionIds, [])
  assert.equal(r.json.sessions.length, 1)
  assert.equal(r.json.sessions[0].sessionId, 's-only')
  assert.equal(r.json.sessions[0].workspaceId, undefined)
  assert.equal(r.json.sessions[0].title, undefined)
})

it('deletes a batch one session at a time and reports each outcome', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-batch-'))
  const cwd = join(scratchHome, 'batch-project')
  const gone = makeSession({ id: 'batch-gone', cwd, root })
  const kept = makeSession({ id: 'batch-kept', cwd, root })
  const removes = []
  const handler = makeCtx({
    persistence: {
      root,
      list: async () => [
        { header: { id: 'batch-gone', cwd } },
        { header: { id: 'batch-kept', cwd } },
      ],
      stat: async (id) => ({ header: { id, cwd } }),
    },
    sessions: { get: (id) => (id === 'batch-kept' ? { header: { id, cwd } } : undefined) },
    agents: { get: (id) => (id === 'batch-kept' ? { status: 'running' } : undefined) },
    registry: { archiveSession: async () => {} },
    removes,
  })

  const r = await request(handler, 'POST', '/smkit/api/sessions/delete-batch', {
    sessionIds: ['batch-gone', 'batch-kept', 'batch-gone'],
  })
  assert.equal(r.code, 200)
  assert.equal(r.json.deleted, 1)
  assert.equal(r.json.failed, 1, 'a repeated id is deleted once, not failed twice')
  assert.deepEqual(r.json.results, [
    { sessionId: 'batch-gone', ok: true },
    { sessionId: 'batch-kept', ok: false, code: 'session/running', message: r.json.results[1].message },
  ])
  assert.equal(existsSync(gone), false, 'the accepted delete removed the directory')
  assert.equal(existsSync(kept), true, 'the refused delete left its directory alone')
  assert.deepEqual(
    removes,
    [{ event: 'api-session/removed', args: ['batch-gone'] }],
    'each success still announces itself, one frame per session',
  )
})

it('refuses a malformed batch before deleting anything', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-bad-'))
  const dir = makeSession({ id: 'batch-intact', cwd: join(scratchHome, 'p'), root })
  const handler = makeCtx({
    persistence: {
      root,
      list: async () => [{ header: { id: 'batch-intact', cwd: join(scratchHome, 'p') } }],
      stat: async (id) => ({ header: { id, cwd: join(scratchHome, 'p') } }),
    },
    registry: { archiveSession: async () => {} },
  })

  for (const body of [undefined, {}, { sessionIds: 'batch-intact' }, { sessionIds: [123] }, { sessionIds: [''] }]) {
    const r = await request(handler, 'POST', '/smkit/api/sessions/delete-batch', body)
    assert.equal(r.code, 400, `a ${body === undefined ? 'missing' : 'malformed'} body must be refused`)
  }
  assert.equal(existsSync(dir), true, 'a refused batch must not touch the filesystem')
})

it('never lists a session it has deleted, though the harness still holds it live', async () => {
  // The tombstone case: a live session cannot be un-registered from the
  // harness, so the delete archives it into the registry's archive set and
  // removes its artifacts. The listing must read that state as "gone" — not
  // file the session under the archived view a user just cleaned it out of.
  const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-sessions-tomb-'))
  const cwd = join(scratchHome, 'tomb-project')
  const dir = makeSession({ id: 'tomb-gone', cwd, root })
  const archived = []
  const handler = makeCtx({
    persistence: {
      root,
      list: async () => [{ header: { id: 'tomb-gone', cwd }, sizeBytes: 42 }],
      stat: async (id) => ({ header: { id, cwd } }),
    },
    sessions: { get: (id) => ({ header: { id, cwd } }) },
    registry: {
      list: () => [{ id: 'w1', path: cwd, title: 'Tomb', sessionIds: ['tomb-gone'] }],
      archiveSession: async (id) => { archived.push(id) },
      get archivedSessionIds() { return [...archived] },
    },
  })

  const listed = await request(handler, 'GET', '/smkit/api/sessions/manager')
  assert.equal(listed.json.sessions.length, 1, 'the session lists before its delete')

  const batch = await request(handler, 'POST', '/smkit/api/sessions/delete-batch', { sessionIds: ['tomb-gone'] })
  assert.equal(batch.json.deleted, 1)
  assert.equal(existsSync(dir), false, 'the artifacts are gone from disk')
  assert.deepEqual(archived, ['tomb-gone'], 'the hiding tombstone is still written')

  const after = await request(handler, 'GET', '/smkit/api/sessions/manager')
  assert.deepEqual(after.json.sessions, [], 'the deleted session reads as gone, not archived')
  assert.deepEqual(after.json.archivedSessionIds, ['tomb-gone'], 'the registry tombstone is echoed unchanged')
})
