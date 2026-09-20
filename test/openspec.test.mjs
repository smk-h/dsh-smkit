/**
 * The OpenSpec feature's host half, offline: what one workspace's footprint is,
 * and what removing it takes.
 *
 * The fixtures are a real scratch tree shaped the way `openspec init` writes:
 * the store (`specs/`, `changes/`, `config.yaml`, and a change's own delta
 * spec, which is the deepest thing the layout nests), the skill directories a
 * few tools leave in `.agents/skills`, `.claude/skills` and `.github/skills`,
 * the `opsx` command namespace and the flat `opsx-*.md` command files, plus two
 * entries that must survive both the listing and the delete — a skill that does
 * not carry the generated prefix, and one whose name merely contains
 * `openspec` further in.
 *
 * The checks are ordered: the reads come first, the write last, so the
 * fixtures are still on disk for the assertions about them.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { it } from 'node:test'

const require = createRequire(import.meta.url)

const scratch = mkdtempSync(join(tmpdir(), 'dsh-smkit-openspec-'))
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }))

// Imported from the built host half, the way the other host suites do.
const mod = await import(pathToFileURL(require.resolve('../lib/index.js')).href)

const logger = { info() {}, warn() {}, error() {} }

const project = join(scratch, 'work', 'app')
const nested = join(project, 'packages', 'gui')
const unattached = join(scratch, 'work', 'plain')

/** Write one file, creating the directory chain above it. */
function write(file, text = 'body\n') {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}

// --- the store ---------------------------------------------------------------
mkdirSync(join(project, '.git'), { recursive: true })
write(join(project, 'openspec', 'config.yaml'), 'profile: core\n')
write(join(project, 'openspec', 'specs', 'auth', 'spec.md'))
write(join(project, 'openspec', 'specs', 'billing', 'spec.md'))
write(join(project, 'openspec', 'changes', 'add-login', 'proposal.md'))
// The layout's deepest shape: a change's own delta spec.
write(join(project, 'openspec', 'changes', 'add-login', 'specs', 'auth', 'spec.md'))

// --- the tool integrations ---------------------------------------------------
write(join(project, '.agents', 'skills', 'openspec-propose', 'SKILL.md'), '---\nname: openspec-propose\n---\n')
write(join(project, '.agents', 'skills', 'openspec-apply-change', 'SKILL.md'), '---\nname: openspec-apply-change\n---\n')
// The CLI's own ownership marker: neither a skill nor a command, and the file
// that would bring both back on the next `openspec update`.
write(join(project, '.agents', 'skills', '.openspec-target'), 'agents\n')
write(join(project, '.agents', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n')
write(join(project, '.claude', 'skills', 'openspec-explore', 'SKILL.md'), '---\nname: openspec-explore\n---\n')
write(join(project, '.claude', 'skills', 'my-openspec-notes', 'SKILL.md'), '---\nname: my-openspec-notes\n---\n')
write(join(project, '.claude', 'commands', 'opsx', 'propose.md'), 'propose\n')
write(join(project, '.cursor', 'commands', 'opsx-apply.md'), 'apply\n')
write(join(project, '.github', 'skills', 'openspec-verify-change', 'SKILL.md'), '---\nname: openspec-verify-change\n---\n')

/** The group whose directory one request names, or `undefined`. */
const groupOf = (view, rel) => view.artifacts.find((group) => group.rel === rel)

it('reads the store, its layout parts and the tree below them', async () => {
  const view = await mod.inspectOpenSpec(project)

  assert.equal(view.initialized, true, 'an openspec/ directory is the whole answer')
  assert.equal(view.root, project, 'the project root is the nearest ancestor carrying .git')
  assert.equal(view.store.rel, 'openspec')
  assert.equal(view.truncated, false, 'an ordinary store is measured whole')

  const parts = Object.fromEntries(view.store.parts.map((part) => [part.name, part]))
  assert.equal(parts.specs.exists, true)
  assert.equal(parts.specs.required, true, 'the layout is incomplete without it')
  assert.equal(parts.changes.exists, true)
  assert.equal(parts.changes.required, true)
  assert.equal(parts['config.yaml'].kind, 'file')
  assert.equal(parts['config.yaml'].required, true)
  assert.equal(parts['project.md'].exists, false, 'a part an earlier CLI never wrote is still reported')
  assert.equal(parts['project.md'].required, false, 'but its absence is not a gap')
  assert.equal(parts['AGENTS.md'].required, false)
  // A part answers one question — is the layout's entry on disk — and carries
  // nothing about what is under it: that is the tree's answer, and shipping it
  // twice would be two answers that can disagree.
  assert.deepEqual(
    Object.keys(parts.specs).sort(),
    ['exists', 'kind', 'name', 'rel', 'required'],
  )
  assert.equal(view.store.files, 5, 'every file below the store is counted, however deep')
  assert.equal(view.store.dirs, 7, 'and every directory below it but the store itself')

  const names = view.store.tree.map((node) => node.name)
  assert.deepEqual(names, ['changes', 'specs', 'config.yaml'], 'directories first, then files')
  const change = view.store.tree[0].children[0]
  assert.equal(change.rel, 'openspec/changes/add-login')
  assert.deepEqual(
    change.children.map((node) => node.name),
    ['specs', 'proposal.md'],
    'the delta spec nests under the change and is drawn',
  )
})

it('finds each integration by prefix, and folds a shared directory into one group', async () => {
  const view = await mod.inspectOpenSpec(project)
  const rels = view.artifacts.map((group) => group.rel).sort()
  assert.deepEqual(rels, ['.agents/skills', '.claude/commands', '.claude/skills', '.cursor/commands', '.github/skills'])

  const shared = groupOf(view, '.agents/skills')
  assert.equal(shared.kind, 'skills')
  assert.deepEqual(shared.tools, ['agents', 'codex', 'zed'], 'every tool that writes there names it')
  assert.deepEqual(
    shared.entries.map((entry) => entry.name).filter((name) => name !== '.openspec-target'),
    ['openspec-apply-change', 'openspec-propose'],
    'only the generated prefix, and only it',
  )
  const markerEntry = shared.entries.find((entry) => entry.name === '.openspec-target')
  assert.ok(markerEntry, 'the ownership marker goes with them: it is the file that would bring them back')
  assert.equal(markerEntry.marker, true, 'and it says what it is, so the panel need not file it among the skills')
  assert.equal(markerEntry.kind, 'file')
  const propose = shared.entries.find((entry) => entry.name === 'openspec-propose')
  assert.equal(propose.kind, 'dir')
  assert.equal(propose.marker, false, 'a generated skill is not the marker')
  assert.ok(propose.bytes > 0, 'a skill directory is measured, not just listed')

  // `demo` does not carry the prefix and `my-openspec-notes` merely contains
  // it: neither is OpenSpec's to remove, and both are counted as staying.
  assert.equal(shared.entries.some((entry) => entry.name === 'demo'), false)
  assert.equal(groupOf(view, '.claude/skills').entries.length, 1)
  assert.equal(shared.keptCount, 1, 'demo shares the directory and is left alone')
  assert.equal(groupOf(view, '.claude/skills').keptCount, 1, 'a name that merely contains openspec is its own')
  assert.equal(groupOf(view, '.cursor/commands').keptCount, 0, 'a directory with nothing else keeps nothing')

  const namespace = groupOf(view, '.claude/commands')
  assert.equal(namespace.kind, 'commands')
  assert.deepEqual(namespace.entries.map((entry) => entry.name), ['opsx'], 'the namespace directory itself')
  assert.equal(namespace.entries[0].kind, 'dir')
  assert.deepEqual(
    groupOf(view, '.cursor/commands').entries.map((entry) => entry.name),
    ['opsx-apply.md'],
    'a flat command file is listed by its own name',
  )

  assert.equal(view.totalEntries, 8, 'the store counts once, plus one per generated entry')
  assert.ok(view.totalBytes > 0)
})

it('derives the project root from a workspace directory below it', async () => {
  const view = await mod.inspectOpenSpec(nested)
  assert.equal(view.root, project, 'openspec init writes at the repository root, not at the workspace')
  assert.equal(view.initialized, true)
})

it('answers a workspace that never initialised OpenSpec with an empty footprint', async () => {
  mkdirSync(unattached, { recursive: true })
  const view = await mod.inspectOpenSpec(unattached)

  assert.equal(view.initialized, false)
  assert.equal(view.store, undefined)
  assert.deepEqual(view.artifacts, [])
  assert.equal(view.totalEntries, 0)
  assert.equal(view.totalBytes, 0)
})

/** Mount the plugin on a stub context, the way `verify.mjs` does. */
function mount() {
  const routes = []
  const ctx = {
    logger,
    tools: {
      register: () => () => {},
      restrict: () => () => {},
      guard: () => () => {},
      schemas: () => [],
      get: () => undefined,
      execute: async () => ({ content: [] }),
    },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: () => undefined,
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback === 'function' && names.includes('webServer')) {
        callback({
          webServer: ctx.webServer,
          get: ctx.get,
          effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
        })
      }
      return { dispose: () => {} }
    },
    effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  }
  mod.apply(ctx)
  assert.equal(routes.length, 1, 'apply() must mount exactly one prefix route')
  return routes[0]
}

const route = mount()

/** One API call against the mounted route, answered as `{ status, body }`. */
async function call(method, path, body) {
  let settle
  const answered = new Promise((resolve) => { settle = resolve })
  const res = {
    code: 0,
    body: '',
    writeHead(code) { this.code = code },
    end(chunk) { this.body = chunk ?? ''; settle(this) },
  }
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    url: `/mcp-manager/api${path}`,
    headers: { host: '127.0.0.1:3080' },
    async*[Symbol.asyncIterator]() { yield* payload },
  }
  await route.handler(req, res)
  const response = await answered
  return { status: response.code, body: JSON.parse(response.body || '{}') }
}

it('serves one workspace over the read route, and refuses a cwd that is not a path', async () => {
  const answered = await call('GET', `/openspec?cwd=${encodeURIComponent(project)}`)
  assert.equal(answered.status, 200)
  assert.equal(answered.body.initialized, true)
  assert.equal(answered.body.store.rel, 'openspec')

  const relative = await call('GET', '/openspec?cwd=work%2Fapp')
  assert.equal(relative.status, 400, 'a relative cwd names nothing the host could inspect')

  const missing = await call('GET', '/openspec')
  assert.equal(missing.status, 400)
})

it('removes the store and every generated entry through the route, and nothing else', async () => {
  const started = await call('POST', '/openspec/delete', { cwd: project })
  assert.equal(started.status, 200)
  assert.deepEqual(started.body.failed, [], 'nothing in this fixture is out of reach')
  assert.ok(started.body.removed.includes('openspec'), 'the store goes in one piece')
  assert.ok(started.body.removed.includes('.agents/skills/openspec-propose'))
  assert.ok(started.body.removed.includes('.claude/commands/opsx'))
  assert.ok(
    started.body.removed.includes('.agents/skills/.openspec-target'),
    'the ownership marker goes too, or the next openspec update would bring the skills back',
  )
  assert.ok(started.body.bytes > 0, 'what was removed is measured')

  assert.equal(existsSync(join(project, 'openspec')), false)
  assert.equal(existsSync(join(project, '.agents', 'skills', 'openspec-propose')), false)
  assert.equal(existsSync(join(project, '.agents', 'skills', '.openspec-target')), false)
  assert.equal(existsSync(join(project, '.cursor', 'commands', 'opsx-apply.md')), false)
  // Only the entries, never the directories they sit in: `.agents/skills` and
  // `.claude/commands` are shared with everything else the machine keeps there.
  assert.equal(existsSync(join(project, '.agents', 'skills')), true, 'a shared directory is never a target')
  assert.equal(existsSync(join(project, '.claude', 'commands')), true)
  // The two entries the prefix check must not have claimed.
  assert.equal(existsSync(join(project, '.agents', 'skills', 'demo', 'SKILL.md')), true)
  assert.equal(existsSync(join(project, '.claude', 'skills', 'my-openspec-notes', 'SKILL.md')), true)

  const after = await mod.inspectOpenSpec(project)
  assert.equal(after.initialized, false)
  assert.deepEqual(after.artifacts, [])

  // A second delete is a clean no-op: there is nothing to refuse, and nothing
  // to report as failed either.
  const again = await call('POST', '/openspec/delete', { cwd: project })
  assert.equal(again.status, 200)
  assert.deepEqual(again.body.removed, [])
  assert.deepEqual(again.body.failed, [])

  const refused = await call('POST', '/openspec/delete', { cwd: '' })
  assert.equal(refused.status, 400)
  assert.equal(existsSync(join(project, '.agents', 'skills', 'demo', 'SKILL.md')), true, 'a refused delete touches nothing')
})

it('refuses to remove anything that is not OpenSpec\u2019s own entry', () => {
  const skillsDir = join(project, '.agents', 'skills')
  const commandsDir = join(project, '.claude', 'commands')
  const outsideDir = join(scratch, 'elsewhere')
  /** One entry target, from the directory it claims to have been found in. */
  const entry = (dir, rel, name, kind) => ({
    path: join(dir, name),
    rel: `${rel}/${name}`,
    bytes: 0,
    parent: dir,
    kind,
  })

  assert.equal(
    mod.removalRefusal(project, entry(skillsDir, '.agents/skills', 'openspec-propose', 'skills')),
    null,
    'a generated skill directory is OpenSpec\u2019s own',
  )
  assert.equal(
    mod.removalRefusal(project, entry(commandsDir, '.claude/commands', 'opsx', 'commands')),
    null,
    'and so is a generated command namespace',
  )
  assert.equal(
    mod.removalRefusal(project, entry(skillsDir, '.agents/skills', '.openspec-target', 'skills')),
    null,
    'and so is the CLI\u2019s ownership marker, which carries neither prefix',
  )
  assert.equal(
    mod.removalRefusal(project, { path: join(project, 'openspec'), rel: 'openspec', bytes: 0, parent: null, kind: 'store' }),
    null,
    'the store is the one directory that goes whole',
  )

  // The rule the whole scope rests on: a shared directory's other material is
  // refused even when something hands it over as a target.
  assert.ok(
    mod.removalRefusal(project, entry(skillsDir, '.agents/skills', 'demo', 'skills')),
    'a skill that is not OpenSpec\u2019s is refused',
  )
  assert.ok(
    mod.removalRefusal(project, entry(skillsDir, '.agents/skills', 'my-openspec-notes', 'skills')),
    'a name that merely contains openspec is refused',
  )
  assert.ok(
    mod.removalRefusal(project, entry(commandsDir, '.claude/commands', 'review.md', 'commands')),
    'a command that is not opsx is refused',
  )
  assert.ok(
    mod.removalRefusal(project, { path: join(project, 'openspec-old'), rel: 'openspec-old', bytes: 0, parent: null, kind: 'store' }),
    'only the store\u2019s own name is the store',
  )
  assert.ok(
    mod.removalRefusal(
      project,
      { path: join(skillsDir, 'nested', 'openspec-x'), rel: '.agents/skills/nested/openspec-x', bytes: 0, parent: skillsDir, kind: 'skills' },
    ),
    'a descendant of the directory is not the entry the directory listed',
  )
  assert.ok(
    mod.removalRefusal(project, entry(outsideDir, 'elsewhere', 'openspec-x', 'skills')),
    'a directory outside the project root is refused',
  )
  assert.ok(
    mod.removalRefusal(
      project,
      { path: join(skillsDir, 'openspec-x'), rel: 'openspec-x', bytes: 0, parent: skillsDir, kind: 'skills' },
    ),
    'two spellings that disagree are a mismatch, not a target',
  )
})

/** One refusable run: `initOpenSpec` with a runner that fails the given way. */
const failingRun = (patch) => async () => {
  throw Object.assign(new Error(String(patch.code ?? patch.signal ?? 'failed')), patch)
}

it('runs the CLI at the project root, with an environment that cannot prompt', async () => {
  const seen = []
  const outcome = await mod.initOpenSpec(nested, {
    logger,
    run: async (command, args, options) => {
      seen.push({ command, args: [...args], cwd: options.cwd, env: options.env })
      return { stdout: 'Created openspec/\n', stderr: 'warning: nothing\n' }
    },
  })

  assert.equal(outcome.status, 200)
  assert.equal(outcome.body.ok, true)
  // `agents` is the vendor-neutral target — the one that writes `.agents/skills`,
  // which is a project root DSH itself loads skills from. `--force` is what
  // keeps the legacy-file question from becoming a prompt no one can answer.
  assert.equal(seen[0].command, 'openspec')
  assert.deepEqual(seen[0].args, ['init', '--tools', 'agents', '--force'])
  assert.equal(seen[0].cwd, project, 'init writes at the repository root, not at the workspace it was opened from')
  assert.equal(outcome.body.command, mod.OPENSPEC_INIT_COMMAND_LINE)
  assert.equal(seen[0].env.OPENSPEC_NO_ANIMATION, '1')
  assert.equal(seen[0].env.OPENSPEC_NO_UPDATE_CHECK, '1')
  assert.equal(seen[0].env.OPENSPEC_TELEMETRY, '0')
  assert.equal(seen[0].env.NO_COLOR, '1')
  assert.equal(outcome.body.output, 'Created openspec/\nwarning: nothing', 'both streams are reported')
})

it('tells a missing CLI, a timeout and a refusal apart', async () => {
  const missing = await mod.initOpenSpec(project, { logger, run: failingRun({ code: 'ENOENT', stdout: '', stderr: '' }) })
  assert.equal(missing.status, 503, 'the CLI is not installed: nothing the request itself got wrong')
  assert.equal(missing.body.code, 'openspec/not-installed')

  const timedOut = await mod.initOpenSpec(project, { logger, run: failingRun({ killed: true, signal: 'SIGTERM' }) })
  assert.equal(timedOut.status, 504)
  assert.equal(timedOut.body.code, 'openspec/timeout')

  const refused = await mod.initOpenSpec(project, {
    logger,
    run: failingRun({ code: 1, stdout: '', stderr: 'a newer OpenSpec CLI is required\n' }),
  })
  assert.equal(refused.status, 502)
  assert.equal(refused.body.code, 'openspec/failed')
  assert.equal(refused.body.error, 'a newer OpenSpec CLI is required', 'the CLI\u2019s own words are the actionable text')
})

/** One call against the exported handler, with deps a test controls. */
async function handle(method, rest, body, deps) {
  let settle
  const answered = new Promise((resolve) => { settle = resolve })
  const res = {
    code: 0,
    body: '',
    writeHead(code) { this.code = code },
    end(chunk) { this.body = chunk ?? ''; settle(this) },
  }
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    url: `/mcp-manager/api${rest}`,
    headers: { host: '127.0.0.1:3080' },
    async*[Symbol.asyncIterator]() { yield* payload },
  }
  const facts = {
    url: new URL(`http://localhost/mcp-manager/api${rest}`),
    rest: rest.split('?')[0],
    origin: 'http://localhost',
    idMatch: null,
  }
  assert.equal(await mod.handleOpenSpec(req, res, facts, deps), true, 'the OpenSpec handler must claim its own routes')
  const response = await answered
  return { status: response.code, body: JSON.parse(response.body || '{}') }
}

it('runs the CLI through the route, and refuses a cwd that is not a path', async () => {
  const runs = []
  const deps = {
    logger,
    run: async (command, args, options) => {
      runs.push({ command, args: [...args], cwd: options.cwd })
      return { stdout: 'ok\n', stderr: '' }
    },
  }

  const refused = await handle('POST', '/openspec/init', { cwd: 'work/app' }, deps)
  assert.equal(refused.status, 400)
  assert.deepEqual(runs, [], 'nothing is spawned for a cwd the host cannot resolve')

  const started = await handle('POST', '/openspec/init', { cwd: project }, deps)
  assert.equal(started.status, 200)
  assert.equal(runs[0].command, 'openspec')
  assert.deepEqual(runs[0].args, ['init', '--tools', 'agents', '--force'])
  assert.equal(runs[0].cwd, project)
})
