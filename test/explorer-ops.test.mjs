/**
 * `POST /smkit/api/explorer/create-folder` and `.../create-file`: the two rows
 * the explorer menu opens, driven through the real operations and the real
 * handler.
 *
 * What is worth pinning is what the port promises:
 *
 * - the name is ONE storable segment: separators, `.`/`..`, the characters
 *   Windows refuses and its reserved device names are all refused as shape
 *   errors, before any filesystem call;
 * - a folder is one level, a file is empty, and neither is created recursively;
 * - an existing destination is refused and never truncated — a file, a folder,
 *   or a dangling symlink occupying the name;
 * - the parent must be an absolute directory path; a file or a missing path is
 *   refused with the code the editor turns into its own sentence;
 * - the handler maps those refusals onto 400 / 409 and answers `{ path }` on
 *   success.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

const { createEntry, nameProblem } = await import('../lib/host/features/explorer-ops/fs.js')
const { createExplorerHandlers } = await import('../lib/host/features/explorer-ops/api.js')

const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-explorer-ops-'))
after(() => rmSync(root, { recursive: true, force: true }))

/** Symlink creation needs privileges on Windows; the link case skips there. */
const canSymlink = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'dsh-smkit-explorer-ops-probe-'))
  try {
    symlinkSync(probe, join(probe, 'link'))
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()

/** A fresh directory for one case. */
function scratch(name) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

it('refuses every name that is not one storable segment', () => {
  for (const name of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'a?b', 'a*b', 'a\u0001b']) {
    assert.notEqual(nameProblem(name), undefined, `${JSON.stringify(name)} must be refused`)
  }
  for (const name of ['con', 'CON', 'nul', 'NUL.txt', 'com1', 'lpt9', 'aux.tar.gz']) {
    assert.notEqual(nameProblem(name), undefined, `${name} is a reserved device name`)
  }
  for (const name of ['notes.md', '.gitignore', '新建文件夹', 'com10', 'lpt0', 'a b']) {
    assert.equal(nameProblem(name), undefined, `${JSON.stringify(name)} must be accepted`)
  }
})

it('creates one folder, non-recursively', async () => {
  const dir = scratch('folder')
  const outcome = await createEntry('folder', dir, 'new-folder')
  assert.equal(outcome.ok, true)
  assert.equal(outcome.path, join(dir, 'new-folder'))
  assert.equal(statSync(join(dir, 'new-folder')).isDirectory(), true)
  // One level only: a name carrying a separator never reaches mkdir.
  assert.equal((await createEntry('folder', dir, 'a/b')).code, 'explorer/invalid-name')
  assert.equal(existsSync(join(dir, 'a')), false)
})

it('creates one EMPTY file', async () => {
  const dir = scratch('file')
  const outcome = await createEntry('file', dir, 'notes.md')
  assert.equal(outcome.ok, true)
  assert.equal(readFileSync(join(dir, 'notes.md'), 'utf8'), '')
})

it('refuses an existing destination instead of clobbering it', async () => {
  const dir = scratch('exists')
  writeFileSync(join(dir, 'taken.txt'), 'original')
  mkdirSync(join(dir, 'taken-dir'))
  for (const name of ['taken.txt', 'taken-dir']) {
    const outcome = await createEntry('file', dir, name)
    assert.equal(outcome.ok, false)
    assert.equal(outcome.code, 'explorer/exists')
  }
  assert.equal(readFileSync(join(dir, 'taken.txt'), 'utf8'), 'original', 'the file was not truncated')
})

it('refuses a dangling symlink at the destination', { skip: !canSymlink }, async () => {
  const dir = scratch('dangling')
  symlinkSync(join(dir, 'missing.txt'), join(dir, 'dangling.txt'))
  const outcome = await createEntry('file', dir, 'dangling.txt')
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, 'explorer/exists')
})

it('refuses a parent that is not an absolute directory', async () => {
  const dir = scratch('parent')
  writeFileSync(join(dir, 'plain.txt'), 'x')
  for (const [where, expected] of [
    [join(dir, 'plain.txt'), 'explorer/not-directory'],
    [join(dir, 'missing'), 'explorer/not-directory'],
    ['relative/dir', 'explorer/not-directory'],
  ]) {
    const outcome = await createEntry('file', where, 'x.txt')
    assert.equal(outcome.ok, false, `${where} must be refused`)
    assert.equal(outcome.code, expected)
  }
  assert.equal(existsSync(join(dir, 'x.txt')), false)
})

/** One request whose body is `body`, as the route receives it. */
function request(method, url, body) {
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body))
    },
  }
}

/** A response that records what the handler wrote. */
function response() {
  return {
    status: 0,
    payload: undefined,
    writeHead(code) { this.status = code },
    end(text) { this.payload = JSON.parse(text) },
    setHeader() {},
  }
}

/** Drive the feature's handler list for one request. */
async function call(method, rest, body) {
  const res = response()
  const facts = { url: new URL(`http://localhost/smkit/api${rest}`), rest, origin: 'http://localhost', idMatch: null }
  for (const handle of createExplorerHandlers()) {
    if (await handle(request(method, `/smkit/api${rest}`, body), res, facts)) {
      return { claimed: true, status: res.status, body: res.payload }
    }
  }
  return { claimed: false }
}

it('answers 200 with the new path', async () => {
  const dir = scratch('route-ok')
  const folder = await call('POST', '/explorer/create-folder', { path: dir, name: 'made' })
  assert.equal(folder.claimed, true)
  assert.equal(folder.status, 200)
  assert.equal(folder.body.path, join(dir, 'made'))
  const file = await call('POST', '/explorer/create-file', { path: dir, name: 'made.md' })
  assert.equal(file.status, 200)
  assert.equal(existsSync(join(dir, 'made.md')), true)
})

it('maps a refusal onto its own status and keeps the code stable', async () => {
  const dir = scratch('route-refusals')
  writeFileSync(join(dir, 'taken.txt'), 'x')
  const conflict = await call('POST', '/explorer/create-file', { path: dir, name: 'taken.txt' })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.code, 'explorer/exists')
  const shape = await call('POST', '/explorer/create-file', { path: dir, name: 'a/b' })
  assert.equal(shape.status, 400)
  assert.equal(shape.body.code, 'explorer/invalid-name')
  const parent = await call('POST', '/explorer/create-folder', { path: join(dir, 'taken.txt'), name: 'x' })
  assert.equal(parent.status, 400)
  assert.equal(parent.body.code, 'explorer/not-directory')
})

it('refuses a body without a path or a name, and leaves other routes alone', async () => {
  const empty = await call('POST', '/explorer/create-file', { path: '', name: 'x' })
  assert.equal(empty.status, 400)
  assert.equal(empty.body.code, 'explorer/invalid-name')
  const unnamed = await call('POST', '/explorer/create-folder', { path: '/tmp', name: '   ' })
  assert.equal(unnamed.status, 400)
  assert.equal((await call('POST', '/sessions/delete', {})).claimed, false)
  assert.equal((await call('GET', '/explorer/create-file', {})).claimed, false, 'creating is POST only')
})
