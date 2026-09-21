/**
 * The OpenSpec feature's host half, offline: what one workspace's footprint is,
 * and what removing it or handing it to git takes.
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
 * git itself is never run here: the ignore action is driven by a scripted runner
 * that answers the three questions per target from sets of paths, so a test can
 * assert what git was asked *and* what it was not, and the files the action
 * writes are the assertion's subject rather than a side effect of a real repo.
 *
 * The checks are ordered: the reads come first, the write last, so the
 * fixtures are still on disk for the assertions about them.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

// --- the update: a two-command chain, streamed ------------------------------

// Fresh roots: the delete test above took `project/openspec` away, and the
// chain's step 2 keys off whether a store is present, so the two cases need
// their own roots that were never touched.
const storeRoot = join(scratch, 'upd', 'store')
mkdirSync(join(storeRoot, '.git'), { recursive: true })
write(join(storeRoot, 'openspec', 'config.yaml'), 'profile: core\n')
const bareRoot = join(scratch, 'upd', 'bare')
mkdirSync(join(bareRoot, '.git'), { recursive: true })

/**
 * A scripted {@link OpenSpecUpdateRunner}: one entry per command, in order.
 * Each may emit lines and override the run's verdict; the default is a clean
 * exit-0. Records how each command was actually spawned.
 */
function scriptedRunner(script) {
  const runs = []
  let index = 0
  const run = async (command, args, options, onLine) => {
    const entry = script[index] ?? {}
    runs.push({ command, args: [...args], cwd: options.cwd, env: options.env, timeoutMs: options.timeoutMs })
    index += 1
    for (const line of entry.lines ?? []) onLine(line)
    return { notFound: false, timedOut: false, exitCode: 0, ...entry.result }
  }
  return { run, runs }
}

/** Run `updateOpenSpec` against a script, collecting every emitted event. */
async function collectUpdate(cwd, script) {
  const events = []
  const { run, runs } = scriptedRunner(script)
  await mod.updateOpenSpec(cwd, { logger, run }, (event) => events.push(event))
  return { events, runs }
}

/** The emitted line texts, in order — the running commentary minus the frames. */
const lineTexts = (events) =>
  events.filter((event) => event.type === 'line').map((event) => event.text)

it('upgrades the tool then refreshes the store, at the project root, streaming both', async () => {
  const { events, runs } = await collectUpdate(storeRoot, [
    { lines: [{ type: 'line', stream: 'out', text: 'changed 1 package in 4s' }] },
    { lines: [{ type: 'line', stream: 'out', text: 'Refreshed instruction files' }] },
  ])

  assert.equal(runs.length, 2, 'both commands of the chain run')
  assert.equal(runs[0].command, 'npm')
  assert.deepEqual(runs[0].args, ['update', '-g', '@fission-ai/openspec'])
  assert.equal(runs[0].cwd, storeRoot)
  assert.equal(runs[0].env.NO_COLOR, '1')
  assert.equal(runs[0].env.npm_config_progress, 'false', 'no animated progress bar over a pipe')
  assert.equal(runs[0].env.npm_config_update_notifier, 'false')
  assert.equal(runs[0].timeoutMs, 180_000, 'the registry-bound step gets the long budget')
  assert.equal(runs[1].command, 'openspec')
  assert.deepEqual(runs[1].args, ['update'])
  assert.equal(runs[1].env.OPENSPEC_TELEMETRY, '0', 'the refresh reuses the CLI-safe env')
  assert.equal(runs[1].timeoutMs, 60_000, 'and the short local budget')

  assert.deepEqual(lineTexts(events), [
    '$ npm update -g @fission-ai/openspec',
    'changed 1 package in 4s',
    '$ openspec update',
    'Refreshed instruction files',
  ], 'each command is echoed before its own output')
  assert.deepEqual(events.at(-1), { type: 'done', status: 'ok', exitCode: 0 })
})

it('skips the store refresh where there is no openspec/ directory', async () => {
  const { events, runs } = await collectUpdate(bareRoot, [{}])
  assert.equal(runs.length, 1, 'a bare workspace still gets the tool upgraded, and only that')
  assert.ok(lineTexts(events).some((text) => text.includes('instruction-file refresh skipped')))
  assert.deepEqual(events.at(-1), { type: 'done', status: 'ok', exitCode: 0 }, 'a skip is not a failure')
})

it('tells a missing npm, a timeout and a failed upgrade apart', async () => {
  const missing = await collectUpdate(storeRoot, [{ result: { notFound: true, exitCode: null } }])
  assert.equal(missing.runs.length, 1, 'with no npm there is nothing to refresh either')
  assert.deepEqual(missing.events.at(-1), { type: 'done', status: 'npm-missing', exitCode: null })
  assert.ok(lineTexts(missing.events).some((text) => text.includes('command not found on PATH')))

  const timedOut = await collectUpdate(storeRoot, [{ result: { timedOut: true, exitCode: null } }])
  assert.deepEqual(timedOut.events.at(-1), { type: 'done', status: 'timeout', exitCode: null })

  const failed = await collectUpdate(storeRoot, [{ result: { exitCode: 1 } }])
  assert.deepEqual(failed.events.at(-1), { type: 'done', status: 'failed', exitCode: 1 })
  assert.equal(failed.runs.length, 1, 'a failed upgrade never reaches the refresh')
})

it('classifies the refresh step on its own', async () => {
  const badRefresh = await collectUpdate(storeRoot, [{}, { result: { exitCode: 2 } }])
  assert.deepEqual(badRefresh.events.at(-1), { type: 'done', status: 'failed', exitCode: 2 })

  const refreshTimeout = await collectUpdate(storeRoot, [{}, { result: { timedOut: true } }])
  assert.deepEqual(refreshTimeout.events.at(-1), { type: 'done', status: 'timeout', exitCode: null })

  const missingCli = await collectUpdate(storeRoot, [{}, { result: { notFound: true, exitCode: null } }])
  assert.deepEqual(missingCli.events.at(-1), { type: 'done', status: 'failed', exitCode: null },
    'the store is there but the CLI vanished mid-upgrade: still a failure')
})

/**
 * One call against the handler for the streaming route. The fake `res` records
 * the SSE headers and every `write`, and resolves only once `end` closes the
 * stream — which is the `done` frame the orchestrator emits.
 */
async function streamHandle(method, rest, body, deps) {
  let settle
  const answered = new Promise((resolve) => { settle = resolve })
  const chunks = []
  let code = 0
  let headers
  const res = {
    writeHead(status, hdrs) { code = status; headers = hdrs },
    write(chunk) { chunks.push(chunk) },
    end(chunk) { if (chunk !== undefined) chunks.push(chunk); settle({ code, headers, raw: chunks.join('') }) },
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
  const claimed = await mod.handleOpenSpec(req, res, facts, deps)
  assert.equal(claimed, true, 'the update route must claim its own request')
  return answered
}

/** Parse an SSE body into the events it carried. */
function sseEvents(raw) {
  return raw
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)))
}

it('answers the update route as an event stream that ends on the done frame', async () => {
  const { run } = scriptedRunner([
    { lines: [{ type: 'line', stream: 'out', text: 'changed 1 package' }] },
    {},
  ])
  const answered = await streamHandle('POST', '/openspec/update', { cwd: storeRoot }, { logger, runUpdate: run })
  assert.equal(answered.code, 200)
  assert.match(answered.headers['Content-Type'], /text\/event-stream/, 'the type DSH never gzips')
  const events = sseEvents(answered.raw)
  assert.deepEqual(events.at(0), { type: 'line', stream: 'out', text: '$ npm update -g @fission-ai/openspec' })
  assert.ok(events.some((event) => event.text === 'changed 1 package'), 'each line is its own frame')
  assert.deepEqual(events.at(-1), { type: 'done', status: 'ok', exitCode: 0 })
  assert.ok(answered.raw.endsWith('\n\n'), 'every frame, including the last, is terminated')
})

it('refuses a relative cwd on the update route with a plain 400', async () => {
  const { runs } = scriptedRunner([])
  const answered = await streamHandle('POST', '/openspec/update', { cwd: 'work/app' }, { logger, runUpdate: async () => { throw new Error('must not run') } })
  assert.equal(answered.code, 400, 'a cwd the host cannot resolve is rejected before the stream opens')
  assert.deepEqual(runs, [])
  assert.match(answered.raw, /absolute workspace path/)
})

// --- the .gitignore action: git answers, the nearest file records -----------

// Each case gets its own repository: the action writes, and a second case
// reading a directory the first one left behind would be testing the fixtures
// rather than the code. (`project` is no longer usable either — the delete test
// above took its footprint away.)
function ignoreRepo(name) {
  const root = join(scratch, 'ignore', name)
  mkdirSync(join(root, '.git'), { recursive: true })
  write(join(root, 'openspec', 'config.yaml'), 'profile: core\n')
  write(join(root, 'openspec', 'specs', 'auth', 'spec.md'))
  write(join(root, '.agents', 'skills', 'openspec-propose', 'SKILL.md'), '---\nname: openspec-propose\n---\n')
  write(join(root, '.agents', 'skills', '.openspec-target'), 'agents\n')
  write(join(root, '.agents', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n')
  return root
}


/**
 * A scripted {@link GitRunner}: `rev-parse` always names {@link root}, and the
 * three per-target questions are answered from sets of repo-relative paths —
 * `ignored` for `check-ignore` hits, `tracked` for `ls-files` output. Every call
 * is recorded, so a test can say what git was *not* asked.
 */
function scriptedGit(root, { ignored = [], tracked = [], rmFails = false } = {}) {
  const calls = []
  const hit = (set, rel) => set.includes(rel)
  const runGit = async (args, options) => {
    calls.push({ args: [...args], cwd: options.cwd })
    const [command, ...rest] = args
    const rel = rest.at(-1)
    if (command === 'rev-parse') return { code: root === null ? 128 : 0, stdout: root === null ? '' : `${root}\n`, stderr: '' }
    if (command === 'check-ignore') return { code: hit(ignored, rel) ? 0 : 1, stdout: hit(ignored, rel) ? `${rel}\n` : '', stderr: '' }
    if (command === 'ls-files') return { code: 0, stdout: hit(tracked, rel) ? `${rel}/file.md\n` : '', stderr: '' }
    if (command === 'rm') {
      if (rmFails) return { code: 128, stdout: '', stderr: "fatal: something's in the way\n" }
      return { code: 0, stdout: `rm '${rel}/file.md'\n`, stderr: '' }
    }
    throw new Error(`unexpected git call: ${args.join(' ')}`)
  }
  return { runGit, calls }
}

/** The ignore answer for one workspace, through the route with a scripted git. */
async function ignore(cwd, script) {
  const answered = await handle('POST', '/openspec/gitignore', { cwd }, { logger, ...script })
  assert.equal(answered.status, 200, 'the action answers in a 200, including when it refuses')
  return answered.body
}

/** One entry of the answer, by the path the panel lists it under. */
const resultFor = (body, rel) => body.results.find((result) => result.rel === rel)

it('writes each line into the ignore file next to what it hides', async () => {
  const root = ignoreRepo('once')
  const script = scriptedGit(root)
  const body = await ignore(root, script)

  assert.equal(body.repo, true)
  assert.deepEqual(
    body.results.map((result) => result.rel),
    ['openspec', '.agents/skills/.openspec-target', '.agents/skills/openspec-propose'],
    'the store first, then every generated entry of every shared directory',
  )
  // The store hides its contents with one wide line, in its own file — and
  // excepts the file doing the hiding, so the rule stays visible to git and can
  // be committed rather than living on one machine only.
  assert.deepEqual(resultFor(body, 'openspec').patterns, ['*', '!.gitignore'])
  assert.equal(resultFor(body, 'openspec').ignoreFile, 'openspec/.gitignore')
  // A shared directory's file names one entry per line it carries — and a
  // directory needs its trailing slash, which a plain file must not have.
  assert.equal(resultFor(body, '.agents/skills/openspec-propose').ignoreFile, '.agents/skills/.gitignore')
  assert.deepEqual(resultFor(body, '.agents/skills/openspec-propose').patterns, ['openspec-propose/'])
  assert.deepEqual(resultFor(body, '.agents/skills/.openspec-target').patterns, ['.openspec-target'])
  assert.ok(body.results.every((result) => result.listed && !result.alreadyListed && !result.untracked))

  assert.deepEqual(body.files, ['openspec/.gitignore', '.agents/skills/.gitignore'])
  const storeFile = readFileSync(join(root, 'openspec', '.gitignore'), 'utf8')
  assert.equal(storeFile, '# Added by dsh-smkit: OpenSpec\n*\n!.gitignore\n')
  const shared = readFileSync(join(root, '.agents', 'skills', '.gitignore'), 'utf8')
  assert.ok(shared.includes('openspec-propose/'), 'the skill directory')
  assert.ok(shared.includes('.openspec-target'), 'and the ownership marker, in the file they share')
  assert.ok(!shared.includes('demo'), 'the line never widens past the entries it speaks for')
  assert.equal(existsSync(join(root, '.gitignore')), false, 'the project\u2019s own file is not this plugin\u2019s scratch pad')

  // git was asked each question, at the repository root it named.
  assert.deepEqual(script.calls[0], { args: ['rev-parse', '--show-toplevel'], cwd: root })
  assert.deepEqual(script.calls[1], { args: ['check-ignore', '--', 'openspec'], cwd: root })
  assert.ok(script.calls.some((call) => call.args.join(' ') === 'ls-files -- .agents/skills/openspec-propose'))
  assert.ok(!script.calls.some((call) => call.args[0] === 'rm'), 'nothing tracked was not untracked')
})

it('untracks what sits in the index before listing it', async () => {
  const root = ignoreRepo('tracked')
  const script = scriptedGit(root, { tracked: ['openspec'] })
  const body = await ignore(join(root, 'openspec'), script)

  const store = resultFor(body, 'openspec')
  assert.equal(store.untracked, true, 'the index held it, so ignoring alone would have changed nothing')
  assert.equal(store.listed, true, 'and only then does the line go in')
  const rm = script.calls.find((call) => call.args[0] === 'rm')
  assert.deepEqual(rm.args, ['rm', '-r', '--cached', '--', 'openspec'], 'the working tree is left alone')
  assert.equal(existsSync(join(root, 'openspec', 'config.yaml')), true)
  // A workspace directory below the root addresses the same repository: the
  // paths git is handed are repo-relative, which is what makes them safe.
  assert.equal(script.calls.at(0).cwd, resolve(join(root, 'openspec')), 'the probe runs where the panel is standing')
  assert.equal(rm.cwd, root, 'and the repair runs at the root git named')
})

it('reports an entry git already ignores without touching a file', async () => {
  const root = ignoreRepo('partial')
  const script = scriptedGit(root, { ignored: ['openspec', '.agents/skills/openspec-propose'] })
  const body = await ignore(root, script)

  assert.equal(resultFor(body, 'openspec').ignored, true)
  assert.equal(resultFor(body, '.agents/skills/openspec-propose').ignored, true)
  assert.equal(resultFor(body, '.agents/skills/.openspec-target').listed, true, 'the rest still gets its line')
  assert.equal(body.files.length, 1)
  // check-ignore exits on the first answer: no `ls-files`, no `rm`.
  assert.ok(!script.calls.some((call) => call.args[0] === 'ls-files' && call.args[2] === 'openspec'))
  assert.ok(!script.calls.some((call) => call.args[0] === 'rm'))
})

it('writes a missing line once, and never repeats one already there', async () => {
  const root = ignoreRepo('twice')
  const first = await ignore(root, scriptedGit(root))
  const before = readFileSync(join(root, '.agents', 'skills', '.gitignore'), 'utf8')

  // The second press asks the same questions and gets the same git answers (the
  // scripted runner does not learn what was just written); the file itself is
  // what stops the line from being added twice.
  const again = await ignore(root, scriptedGit(root))
  assert.equal(again.files, undefined, 'nothing was written, so there is nothing to name')
  assert.ok(again.results.every((result) => result.alreadyListed && !result.listed))
  assert.equal(readFileSync(join(root, '.agents', 'skills', '.gitignore'), 'utf8'), before, 'byte for byte')
  assert.equal(first.files.length, 2)
})

it('keeps going when git refuses to untrack, and says so per entry', async () => {
  const root = ignoreRepo('refusal')
  const script = scriptedGit(root, { tracked: ['openspec'], rmFails: true })
  const body = await ignore(root, script)

  const store = resultFor(body, 'openspec')
  assert.equal(store.listed, false, 'an entry still in the index would make the line a lie')
  assert.match(store.error, /something's in the way/, 'git\u2019s own words travel')
  assert.equal(resultFor(body, '.agents/skills/openspec-propose').listed, true, 'and the rest of the footprint is still handled')
  assert.equal(existsSync(join(root, 'openspec', '.gitignore')), false)
})

it('gates the whole action on the repository being there at all', async () => {
  const root = ignoreRepo('gate')
  const notARepo = { runGit: async () => ({ code: 128, stdout: '', stderr: 'fatal: not a git repository\n' }) }
  assert.deepEqual(await ignore(root, notARepo), { repo: false, reason: 'not-a-repo', results: [] })

  // A missing `git` is its own answer: the one is an install step, the other is
  // the situation.
  const noGit = { runGit: async () => { throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) } }
  assert.deepEqual(await ignore(root, noGit), { repo: false, reason: 'no-git', results: [] })

  assert.equal(existsSync(join(root, 'openspec', '.gitignore')), false, 'outside a repo nothing is written at all')
  assert.equal(existsSync(join(root, '.agents', 'skills', '.gitignore')), false)

  const refused = await handle('POST', '/openspec/gitignore', { cwd: 'ignore/gate' }, {
    logger,
    runGit: async () => { throw new Error('a cwd the host cannot resolve must not reach git') },
  })
  assert.equal(refused.status, 400)
})


