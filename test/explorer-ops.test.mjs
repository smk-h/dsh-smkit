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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

const { createEntry, deleteEntry, nameProblem, renameEntry } = await import('../lib/host/features/explorer-ops/fs.js')
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

/* ------------------------------------------------------------------ rename */

it('renames a file in place, keeping its bytes', async () => {
  const dir = scratch('rename-file')
  writeFileSync(join(dir, 'notes.md'), '# notes\n')
  const outcome = await renameEntry(join(dir, 'notes.md'), 'renamed.md')
  assert.equal(outcome.ok, true)
  assert.equal(outcome.path, join(dir, 'renamed.md'))
  assert.equal(existsSync(join(dir, 'notes.md')), false)
  assert.equal(readFileSync(join(dir, 'renamed.md'), 'utf8'), '# notes\n')
})

it('renames a directory with everything inside it', async () => {
  const dir = scratch('rename-dir')
  mkdirSync(join(dir, 'old', 'deep'), { recursive: true })
  writeFileSync(join(dir, 'old', 'deep', 'inner.txt'), 'x')
  const outcome = await renameEntry(join(dir, 'old'), 'new')
  assert.equal(outcome.ok, true)
  assert.equal(readFileSync(join(dir, 'new', 'deep', 'inner.txt'), 'utf8'), 'x')
  assert.equal(existsSync(join(dir, 'old')), false)
})

it('treats the unchanged name as a no-op', async () => {
  const dir = scratch('rename-same')
  writeFileSync(join(dir, 'same.txt'), 'x')
  const outcome = await renameEntry(join(dir, 'same.txt'), 'same.txt')
  assert.equal(outcome.ok, true)
  assert.equal(outcome.path, join(dir, 'same.txt'))
  assert.equal(readFileSync(join(dir, 'same.txt'), 'utf8'), 'x')
})

it('changes only the letter case of a name', async () => {
  const dir = scratch('rename-case')
  writeFileSync(join(dir, 'case.txt'), 'x')
  const outcome = await renameEntry(join(dir, 'case.txt'), 'CASE.txt')
  assert.equal(outcome.ok, true)
  assert.equal(outcome.path, join(dir, 'CASE.txt'))
  // The stored spelling is the one asked for — on a case-insensitive volume the
  // destination "exists" as the source itself, and that is not a conflict.
  const names = readdirSync(dir)
  assert.equal(names.includes('CASE.txt'), true)
  assert.equal(names.filter((name) => name.toLowerCase() === 'case.txt').length, 1)
})

it('refuses a rename onto another entry, and onto a dangling link', { skip: !canSymlink }, async () => {
  const dir = scratch('rename-exists')
  writeFileSync(join(dir, 'a.txt'), 'a')
  writeFileSync(join(dir, 'b.txt'), 'b')
  symlinkSync(join(dir, 'missing.txt'), join(dir, 'dangling.txt'))
  for (const name of ['b.txt', 'dangling.txt']) {
    const outcome = await renameEntry(join(dir, 'a.txt'), name)
    assert.equal(outcome.ok, false, `${name} is taken`)
    assert.equal(outcome.code, 'explorer/exists')
  }
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'a', 'the source was not touched')
  assert.equal(readFileSync(join(dir, 'b.txt'), 'utf8'), 'b', 'nor was the entry in the way')
})

it('refuses a rename of something that is gone, of a bad name, and of a root', async () => {
  const dir = scratch('rename-refusals')
  const missing = await renameEntry(join(dir, 'missing.txt'), 'x.txt')
  assert.equal(missing.code, 'explorer/missing')
  writeFileSync(join(dir, 'a.txt'), 'a')
  const shape = await renameEntry(join(dir, 'a.txt'), 'x/y.txt')
  assert.equal(shape.code, 'explorer/invalid-name')
  const relative = await renameEntry('relative/a.txt', 'b.txt')
  assert.equal(relative.code, 'explorer/refused')
  const filesystemRoot = await renameEntry('/', 'root-renamed')
  assert.equal(filesystemRoot.code, 'explorer/refused')
})

/* ------------------------------------------------------------------ delete */

it('deletes a file', async () => {
  const dir = scratch('delete-file')
  writeFileSync(join(dir, 'gone.txt'), 'x')
  const outcome = await deleteEntry(join(dir, 'gone.txt'))
  assert.equal(outcome.ok, true)
  assert.equal(existsSync(join(dir, 'gone.txt')), false)
})

it('deletes a directory with everything inside it', async () => {
  const dir = scratch('delete-dir')
  mkdirSync(join(dir, 'tree', 'deep'), { recursive: true })
  writeFileSync(join(dir, 'tree', 'deep', 'inner.txt'), 'x')
  const outcome = await deleteEntry(join(dir, 'tree'))
  assert.equal(outcome.ok, true)
  assert.equal(existsSync(join(dir, 'tree')), false)
})

it('deletes the link, not what it points at', { skip: !canSymlink }, async () => {
  const dir = scratch('delete-link')
  writeFileSync(join(dir, 'target.txt'), 'keep me')
  symlinkSync(join(dir, 'target.txt'), join(dir, 'link.txt'))
  const outcome = await deleteEntry(join(dir, 'link.txt'))
  assert.equal(outcome.ok, true)
  assert.equal(existsSync(join(dir, 'link.txt')), false)
  assert.equal(readFileSync(join(dir, 'target.txt'), 'utf8'), 'keep me', 'the target survives')
})

it('refuses to delete something gone, a relative path, and a filesystem root', async () => {
  const dir = scratch('delete-refusals')
  assert.equal((await deleteEntry(join(dir, 'missing'))).code, 'explorer/missing')
  assert.equal((await deleteEntry('relative/x')).code, 'explorer/refused')
  assert.equal((await deleteEntry('/')).code, 'explorer/refused')
})

/* ------------------------------------------------------------------ routes */

it('renames and deletes over the wire, with the receipt and the refusals', async () => {
  const dir = scratch('route-mutations')
  writeFileSync(join(dir, 'from.txt'), 'x')
  writeFileSync(join(dir, 'taken.txt'), 'x')

  const renamed = await call('POST', '/explorer/rename', { path: join(dir, 'from.txt'), name: 'to.txt' })
  assert.equal(renamed.status, 200)
  assert.equal(renamed.body.path, join(dir, 'to.txt'))

  const conflict = await call('POST', '/explorer/rename', { path: join(dir, 'to.txt'), name: 'taken.txt' })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.code, 'explorer/exists')

  const removed = await call('POST', '/explorer/delete', { path: join(dir, 'to.txt') })
  assert.equal(removed.status, 200)
  assert.equal(existsSync(join(dir, 'to.txt')), false)

  const gone = await call('POST', '/explorer/delete', { path: join(dir, 'to.txt') })
  assert.equal(gone.status, 404)
  assert.equal(gone.body.code, 'explorer/missing')

  const noName = await call('POST', '/explorer/rename', { path: join(dir, 'taken.txt'), name: '  ' })
  assert.equal(noName.status, 400)
  assert.equal(noName.body.code, 'explorer/invalid-name')
})
