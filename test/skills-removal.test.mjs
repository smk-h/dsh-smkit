/**
 * The skills feature's host half, offline: the narrow header reader, the root
 * layout, the walk (nesting, groups, disabled headers, links), the enable/disable
 * rename, the removal, and the four routes.
 *
 * The roots are real: `HOME`, `DSH_HOME` and `DSH_AGENTS_HOME` are redirected to
 * a scratch tree whose layout mirrors the harness's filesystem provider
 * (`<home>/.agents/skills`, `<home>/.dsh/skills`, `<project>/.dsh/skills`,
 * `<project>/.agents/skills` next to a `.git` entry, plus a flat `<name>.md`).
 * One skill is installed the way a machine usually installs them — a link (a
 * junction on Windows, where a bare symlink needs elevation) from a root to a
 * directory somewhere else entirely — because removing it must take the link
 * and leave the directory it points at alone.
 *
 * A test that writes creates what it writes first (or writes back what it
 * changed), so the fixtures the read-only checks assert on survive the ones that
 * run after them.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { it } from 'node:test'

const require = createRequire(import.meta.url)

const scratch = mkdtempSync(join(tmpdir(), 'dsh-smkit-skills-'))
process.env.HOME = scratch
process.env.USERPROFILE = scratch
process.env.DSH_HOME = join(scratch, '.dsh')
delete process.env.DSH_AGENTS_HOME
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }))

// Imported only after the environment is redirected: the roots are resolved per
// call, and a check running against the real `~` would not be this check.
const mod = await import(pathToFileURL(require.resolve('../lib/index.js')).href)

const logger = { info() {}, warn() {}, error() {} }

const agentsRoot = join(scratch, '.agents', 'skills')
const dshRoot = join(scratch, '.dsh', 'skills')
const project = join(scratch, 'work', 'app')
const projectDshRoot = join(project, '.dsh', 'skills')
const projectAgentsRoot = join(project, '.agents', 'skills')

/** One header file, written the way the harness accepts it. */
function writeHeader(file, header) {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, `---\n${header}\n---\n\nBody.\n`)
}

/** A bundle skill (`<dir>/SKILL.md`) in one root. */
function makeBundle(dir, name, header) {
  writeHeader(join(dir, name, 'SKILL.md'), header ?? `name: ${name}\ndescription: The ${name} skill`)
}

/** A flat skill (`<root>/<name>.md`). */
function makeFlat(root, name) {
  writeHeader(join(root, `${name}.md`), `name: ${name}\ndescription: The ${name} skill`)
}

mkdirSync(join(project, '.git'), { recursive: true })

// --- the shared agents home -------------------------------------------------
makeBundle(agentsRoot, 'demo')
makeFlat(agentsRoot, 'flat')
writeHeader(join(agentsRoot, 'off', 'SKILL.md.disabled'), 'name: off\ndescription: A disabled skill')
// `collection/` holds no SKILL.md of its own, so it is a group to descend into
// rather than a skill: `alpha` sits one level down, `gamma` two.
mkdirSync(join(agentsRoot, 'collection'), { recursive: true })
makeBundle(join(agentsRoot, 'collection'), 'alpha')
writeHeader(join(agentsRoot, 'collection', 'beta', 'SKILL.md.disabled'), 'name: beta\ndescription: A disabled nested skill')
makeBundle(join(agentsRoot, 'collection', 'deeper'), 'gamma')
writeHeader(join(agentsRoot, 'collection', 'loose.md'), 'name: loose\ndescription: A flat file below the root')
writeHeader(join(agentsRoot, 'broken', 'SKILL.md'), '# no frontmatter fields at all')
writeHeader(join(agentsRoot, 'notaskill', 'readme.md'), 'name: ignored\ndescription: not a skill file')
writeHeader(join(agentsRoot, '.hidden', 'SKILL.md'), 'name: hidden\ndescription: dot directories are skipped')
const elsewhere = join(scratch, 'elsewhere', 'through-a-link')
makeBundle(join(scratch, 'elsewhere'), 'through-a-link')
// A junction on Windows: a bare symlink there needs an elevated shell or
// Developer Mode, a junction needs neither, and the scan treats both as links.
symlinkSync(elsewhere, join(agentsRoot, 'through-a-link'), process.platform === 'win32' ? 'junction' : 'dir')

// --- the harness home: its own view, never merged with the shared one -------
makeBundle(dshRoot, 'only-dsh')

// --- a project's two roots --------------------------------------------------
makeBundle(projectDshRoot, 'proj-dsh')
makeBundle(projectAgentsRoot, 'proj-agents')

it('reads the flat header fields a skill file is written with', () => {
  const read = (header) => mod.readSkillFrontmatter(`---\n${header}\n---\n\nBody\n`)
  assert.deepEqual(read('name: demo\ndescription: A bundle'), {
    name: 'demo',
    description: 'A bundle',
    whenToUse: '',
    modelInvocable: true,
    userInvocable: true,
  })
  assert.equal(read('name: demo\ndescription: "Quoted: with a colon"').description, 'Quoted: with a colon')
  assert.equal(read("name: demo\ndescription: 'Single quoted'").description, 'Single quoted')
  // A `#` after whitespace is a YAML comment, exactly as the harness's parser reads it.
  assert.equal(read('name: demo\ndescription: Drops a comment # like this').description, 'Drops a comment')
  assert.equal(read('name: demo\ndescription: >\n  A folded\n  description').description, 'A folded description')
  assert.equal(read('name: demo\ndescription: |\n  Literal\n  lines').description, 'Literal\nlines')
  assert.equal(read('name: demo\ndescription: Demo\nwhenToUse: When demoing').whenToUse, 'When demoing')
  assert.equal(read('name: demo\ndescription: Demo\ndisable-model-invocation: true').modelInvocable, false)
  assert.equal(read('name: demo\ndescription: Demo\nuser-invocable: false').userInvocable, false)
})

it('refuses a header the harness would refuse', () => {
  const read = (raw) => mod.readSkillFrontmatter(raw)
  assert.equal(read('name: demo\ndescription: Demo'), null, 'no frontmatter block')
  assert.equal(read('---\nname: demo\n---\n\nBody\n'), null, 'no description')
  assert.equal(read('---\ndescription: Demo\n---\n\nBody\n'), null, 'no name')
  assert.equal(read('---\nname: Not_Kebab\ndescription: Demo\n---\n\nBody\n'), null, 'an invalid name')
  assert.equal(read('---\nname: demo\ndescription: Demo'), null, 'an unterminated block')
})

it('derives the roots each source maps to', () => {
  const user = { source: 'user-dsh', cwd: '' }
  assert.equal(mod.rootOf(user.source, user.cwd), dshRoot)
  assert.equal(mod.rootOf('user-agents', ''), agentsRoot)
  assert.equal(mod.rootOf('project-dsh', project), projectDshRoot)
  assert.equal(mod.rootOf('project-agents', project), projectAgentsRoot)
  assert.equal(mod.rootOf('project-dsh', ''), null, 'a project root needs a project')
  assert.equal(mod.rootOf('bundled', ''), null, 'a source this page does not manage')
  // The project root is the nearest ancestor carrying `.git`, not the cwd.
  assert.equal(mod.rootOf('project-dsh', join(project, 'nested')), projectDshRoot)
})

it('refuses a sibling of a root that merely shares its prefix', () => {
  assert.ok(mod.isInsideRoot(agentsRoot, join(agentsRoot, 'demo', 'SKILL.md')))
  assert.ok(mod.isInsideRoot(agentsRoot, agentsRoot))
  assert.ok(!mod.isInsideRoot(agentsRoot, join(scratch, '.agents', 'skills-old', 'demo')))
  assert.ok(!mod.isInsideRoot(agentsRoot, join(scratch, '.agents')))
  assert.ok(!mod.isInsideRoot(agentsRoot, scratch))
})

it('walks a root: bundles, flat files, groups, disabled headers, links', async () => {
  const scan = await mod.scanRoot(agentsRoot, 'user-agents', logger)
  const byKey = new Map(scan.skills.map((skill) => [`${skill.rel}/${skill.name}`, skill]))
  assert.deepEqual(
    [...byKey.keys()].sort(),
    [
      '/demo',
      '/flat',
      '/off',
      '/through-a-link',
      'collection/alpha',
      'collection/beta',
      'collection/deeper/gamma',
    ].sort(),
  )
  assert.equal(scan.skipped, 1, 'the headerless directory is counted, the readme and the hidden one are not')
  assert.equal(scan.complete, true)

  const demo = byKey.get('collection/alpha')
  assert.equal(demo.kind, 'bundle')
  assert.equal(demo.rel, 'collection', 'the group directory is recorded, not walked into as a group')
  assert.equal(demo.enabled, true)
  assert.equal(demo.path, join(agentsRoot, 'collection', 'alpha', 'SKILL.md'))
  assert.equal(demo.target, join(agentsRoot, 'collection', 'alpha'), 'a bundle is removed as its directory')

  const nested = byKey.get('collection/deeper/gamma')
  assert.equal(nested.rel, 'collection/deeper', 'groups nest')

  const beta = byKey.get('collection/beta')
  assert.equal(beta.enabled, false)
  assert.equal(beta.path, join(agentsRoot, 'collection', 'beta', 'SKILL.md.disabled'))
  assert.equal(beta.target, join(agentsRoot, 'collection', 'beta'))

  const off = byKey.get('/off')
  assert.equal(off.enabled, false)
  assert.equal(off.kind, 'bundle')

  const flat = byKey.get('/flat')
  assert.equal(flat.kind, 'flat')
  assert.equal(flat.rel, '')
  assert.equal(flat.path, join(agentsRoot, 'flat.md'))
  assert.equal(flat.target, flat.path, 'a flat skill is removed as its file')

  const linked = byKey.get('/through-a-link')
  assert.equal(linked.linked, true)
  assert.equal(linked.path, join(agentsRoot, 'through-a-link', 'SKILL.md'), 'the path stays the one the root holds')
  assert.equal(linked.realPath, join(elsewhere, 'SKILL.md'), 'the real path is where it lives')

  assert.equal(byKey.has('/loose'), false, 'a flat file below the root is not a skill')
})

it('lists one root at a time, and never merges the two user roots', async () => {
  const shared = await mod.listRoot(agentsRoot, 'user-agents', logger)
  assert.equal(shared.root, agentsRoot)
  assert.deepEqual(shared.roots, [agentsRoot], 'a user view reads exactly one directory')
  assert.deepEqual([...new Set(shared.skills.map((skill) => skill.source))], ['user-agents'])
  assert.deepEqual([...new Set(shared.skills.map((skill) => skill.scope))], ['global'])
  assert.equal(shared.skipped, 1)

  const harness = await mod.listRoot(dshRoot, 'user-dsh', logger)
  assert.deepEqual(harness.skills.map((skill) => skill.name), ['only-dsh'])

  const projectView = await mod.listRoot(projectDshRoot, 'project-dsh', logger)
  assert.deepEqual(projectView.skills.map((skill) => skill.name), ['proj-dsh'])
  assert.equal(projectView.skills[0].scope, 'project')
})

it('plans a removal only inside the root the entry came from', () => {
  const entry = {
    name: 'demo',
    kind: 'bundle',
    rel: '',
    path: join(agentsRoot, 'demo', 'SKILL.md'),
    target: join(agentsRoot, 'demo'),
  }
  assert.deepEqual(mod.planRemoval(entry, agentsRoot), { target: join(agentsRoot, 'demo'), kind: 'bundle' })
  assert.deepEqual(
    mod.planRemoval({ ...entry, kind: 'flat', path: join(agentsRoot, 'demo.md'), target: join(agentsRoot, 'demo.md') }, agentsRoot),
    { target: join(agentsRoot, 'demo.md'), kind: 'flat' },
  )
  assert.equal(mod.planRemoval({ ...entry, target: join(scratch, 'elsewhere', 'demo') }, agentsRoot), null, 'outside the root')
  assert.equal(mod.planRemoval({ ...entry, target: agentsRoot }, agentsRoot), null, 'the root itself')
  assert.equal(mod.planRemoval({ ...entry, target: join(agentsRoot, '..', 'skills') }, agentsRoot), null, 'a traversing target')
  assert.equal(mod.planRemoval(entry, projectDshRoot), null, 'another root')
})

it('switches a skill between enabled and disabled by renaming its header', async () => {
  const address = { name: 'demo', source: 'user-agents', cwd: '', rel: '' }

  const off = await mod.setSkillEnabled(address, false, logger)
  assert.deepEqual(off, { status: 200, body: { name: 'demo', enabled: false } })
  assert.ok(!existsSync(join(agentsRoot, 'demo', 'SKILL.md')), 'the harness no longer sees a skill here')
  assert.ok(existsSync(join(agentsRoot, 'demo', 'SKILL.md.disabled')))

  const listed = await mod.listRoot(agentsRoot, 'user-agents', logger)
  assert.equal(listed.skills.find((skill) => skill.name === 'demo').enabled, false, 'and the page still lists it')

  const again = await mod.setSkillEnabled(address, false, logger)
  assert.equal(again.status, 200, 'asking for the state that already holds is a no-op success')

  const on = await mod.setSkillEnabled(address, true, logger)
  assert.deepEqual(on, { status: 200, body: { name: 'demo', enabled: true } })
  assert.ok(existsSync(join(agentsRoot, 'demo', 'SKILL.md')), 'and back on')

  // A flat skill renames its own file, a nested one is addressed by its group.
  const flat = await mod.setSkillEnabled({ name: 'flat', source: 'user-agents', cwd: '', rel: '' }, false, logger)
  assert.equal(flat.status, 200)
  assert.ok(existsSync(join(agentsRoot, 'flat.md.disabled')))
  assert.equal((await mod.setSkillEnabled({ name: 'flat', source: 'user-agents', cwd: '', rel: '' }, true, logger)).status, 200)

  const nested = await mod.setSkillEnabled(
    { name: 'gamma', source: 'user-agents', cwd: '', rel: 'collection/deeper' },
    false,
    logger,
  )
  assert.equal(nested.status, 200)
  assert.ok(existsSync(join(agentsRoot, 'collection', 'deeper', 'gamma', 'SKILL.md.disabled')))
  assert.equal(
    (await mod.setSkillEnabled({ name: 'gamma', source: 'user-agents', cwd: '', rel: 'collection/deeper' }, true, logger)).status,
    200,
  )
})

it('refuses a switch it cannot address', async () => {
  assert.equal((await mod.setSkillEnabled({ name: 'demo', source: 'user-agents', cwd: '', rel: 'gone' }, false, logger)).status, 404)
  assert.equal((await mod.setSkillEnabled({ name: 'absent', source: 'user-agents', cwd: '', rel: '' }, false, logger)).status, 404)
  assert.equal((await mod.setSkillEnabled({ name: 'demo', source: 'bundled', cwd: '', rel: '' }, false, logger)).status, 400)
  assert.equal((await mod.setSkillEnabled({ name: 'demo', source: 'project-dsh', cwd: '', rel: '' }, false, logger)).status, 400)
  assert.equal((await mod.setSkillEnabled({ name: 'demo', source: 'user-agents', cwd: '', rel: '../..' }, false, logger)).status, 400)
  assert.equal((await mod.setSkillEnabled({ name: 'demo', source: 'user-agents', cwd: '', rel: '/etc' }, false, logger)).status, 400)

  // Both headers at once is a state the page reports instead of guessing about.
  mkdirSync(join(agentsRoot, 'demo'), { recursive: true })
  writeFileSync(join(agentsRoot, 'demo', 'SKILL.md.disabled'), '---\nname: demo\ndescription: The demo skill\n---\n')
  const conflicted = await mod.setSkillEnabled({ name: 'demo', source: 'user-agents', cwd: '', rel: '' }, false, logger)
  assert.equal(conflicted.status, 409)
  rmSync(join(agentsRoot, 'demo', 'SKILL.md.disabled'), { force: true })
})

it('removes a link as a link, and never what it points at', async () => {
  const removed = await mod.removeSkill({ name: 'through-a-link', source: 'user-agents', cwd: '', rel: '' }, logger)
  assert.equal(removed.status, 200)
  assert.ok(!existsSync(join(agentsRoot, 'through-a-link')), 'the link goes')
  assert.ok(existsSync(join(elsewhere, 'SKILL.md')), 'the directory it pointed at stays')
})

it('removes a bundle, a flat skill and a nested one, each as itself', async () => {
  // The name alone is not an address: a nested skill needs its group.
  assert.equal((await mod.removeSkill({ name: 'alpha', source: 'user-agents', cwd: '', rel: '' }, logger)).status, 404)
  assert.equal(
    (await mod.removeSkill({ name: 'alpha', source: 'user-agents', cwd: '', rel: 'collection' }, logger)).status,
    200,
  )
  assert.ok(!existsSync(join(agentsRoot, 'collection', 'alpha')), 'the bundle directory goes with the skill')

  assert.equal((await mod.removeSkill({ name: 'flat', source: 'user-agents', cwd: '', rel: '' }, logger)).status, 200)
  assert.ok(!existsSync(join(agentsRoot, 'flat.md')), 'a flat skill takes only its file')
  assert.ok(existsSync(agentsRoot), 'the root itself stays')

  const projectEntry = await mod.removeSkill({ name: 'proj-dsh', source: 'project-dsh', cwd: project, rel: '' }, logger)
  assert.equal(projectEntry.status, 200)
  assert.ok(!existsSync(join(projectDshRoot, 'proj-dsh')))

  assert.equal((await mod.removeSkill({ name: 'flat', source: 'user-agents', cwd: '', rel: '' }, logger)).status, 404, 'and it is gone')
})

/* ------------------------------------------------------------- the scope menu */

it('reads a project as one view, merging the roots that exist there', async () => {
  const both = join(scratch, 'work', 'both')
  mkdirSync(join(both, '.git'), { recursive: true })
  makeBundle(join(both, '.dsh', 'skills'), 'from-dsh')
  makeBundle(join(both, '.agents', 'skills'), 'from-agents')

  const view = await mod.listProject(both, logger)
  assert.equal(view.source, 'project')
  assert.equal(view.root, both, 'the view is named by the project, not by a root')
  assert.deepEqual(
    view.roots,
    [join(both, '.dsh', 'skills'), join(both, '.agents', 'skills')],
    'both of the project’s directories exist, in rank order',
  )
  assert.deepEqual(view.absentRoots, [])
  assert.deepEqual(
    view.skills.map((skill) => [skill.name, skill.source]),
    [['from-dsh', 'project-dsh'], ['from-agents', 'project-agents']],
    'and each row still says which of the two it came from',
  )
  assert.deepEqual([...new Set(view.skills.map((skill) => skill.scope))], ['project'])

  // A project with only one of the two directories still names both — the tabs
  // are the layout, not a survey of what happens to be installed — and the
  // absent one is reported, which is what its "not installed" tab is keyed by.
  const oneRoot = join(scratch, 'work', 'one')
  mkdirSync(join(oneRoot, '.git'), { recursive: true })
  makeBundle(join(oneRoot, '.dsh', 'skills'), 'only-here')
  const single = await mod.listProject(oneRoot, logger)
  assert.deepEqual(single.roots, [join(oneRoot, '.dsh', 'skills'), join(oneRoot, '.agents', 'skills')])
  assert.deepEqual(single.absentRoots, [join(oneRoot, '.agents', 'skills')])
  assert.deepEqual(single.skills.map((skill) => skill.name), ['only-here'])

  // And a project with neither still carries both roots, all of them absent.
  const empty = await mod.listProject(join(scratch, 'work', 'bare'), logger)
  assert.deepEqual(empty.roots, [join(empty.root, '.dsh', 'skills'), join(empty.root, '.agents', 'skills')])
  assert.deepEqual(empty.absentRoots, empty.roots)
  assert.deepEqual(empty.skills, [])
  assert.equal(empty.complete, true)
})

it('offers the two user roots and one entry per project, with the stored titles', async () => {
  mkdirSync(join(scratch, '.dsh', 'storages'), { recursive: true })
  writeFileSync(
    join(scratch, '.dsh', 'storages', 'workspace.json'),
    JSON.stringify({
      tables: {
        workspaces: {
          'id-1': { path: project, title: 'My Renamed App', sessionIds: [] },
          'id-2': { path: join(scratch, 'work', 'other'), title: '', sessionIds: [] },
        },
      },
    }),
  )
  const services = {
    get: (name) =>
      name === 'workspaceRegistry'
        ? { list: () => [{ path: project }, { path: join(scratch, 'work', 'other') }] }
        : undefined,
  }
  const scopes = await mod.listSkillScopes(services)
  assert.deepEqual(
    scopes.userRoots.map((root) => [root.source, root.scope, root.label]),
    [
      ['user-dsh', 'global', '~/.dsh/skills'],
      ['user-agents', 'global', '~/.agents/skills'],
    ],
  )
  assert.equal(scopes.userRoots[0].path, dshRoot)

  assert.equal(scopes.workspaces.length, 2)
  const [first, second] = scopes.workspaces
  assert.deepEqual(Object.keys(first).sort(), ['path', 'title'], 'a project is one entry, not one per root')
  assert.equal(first.path, project)
  assert.equal(first.title, 'My Renamed App', 'the stored title wins over the folder name')
  assert.equal(second.title, 'other', 'a workspace with no title falls back to its folder name')
})

it('offers no project scope when the composition has no workspace registry', async () => {
  const scopes = await mod.listSkillScopes({ get: () => undefined })
  assert.equal(scopes.workspaces.length, 0)
  assert.equal(scopes.userRoots.length, 2)
})

/* ----------------------------------------------------------------- the routes */

/** Mount the plugin on a stub context, the way `verify.mjs` does. */
function mount() {
  const routes = []
  const ctx = {
    logger,
    tools: { register: () => () => {}, restrict: () => () => {}, guard: () => () => {}, schemas: () => [], get: () => undefined, execute: async () => ({ content: [] }) },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: (name) => (name === 'workspaceRegistry' ? { list: () => [{ path: project }] } : undefined),
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

it('answers one root per request, and refuses a root it does not manage', async () => {
  const shared = await call('GET', '/skills?source=user-agents')
  assert.equal(shared.status, 200)
  assert.equal(shared.body.root, agentsRoot)
  assert.deepEqual(
    [...new Set(shared.body.skills.map((skill) => skill.source))],
    ['user-agents'],
  )
  assert.ok(shared.body.skills.some((skill) => skill.rel === 'collection'), 'nested skills are served with their group')

  const harness = await call('GET', '/skills?source=user-dsh')
  assert.deepEqual(harness.body.skills.map((skill) => skill.name), ['only-dsh'])

  const projectView = await call('GET', `/skills?source=project-agents&cwd=${encodeURIComponent(project)}`)
  assert.deepEqual(projectView.body.skills.map((skill) => skill.name), ['proj-agents'])

  // A project is asked for as a project: one answer, merged roots, and the
  // workspace itself named as the view.
  const merged = await call('GET', `/skills?project=${encodeURIComponent(project)}`)
  assert.equal(merged.status, 200)
  assert.equal(merged.body.source, 'project')
  assert.equal(merged.body.root, project)
  assert.ok(
    merged.body.skills.every((skill) => skill.scope === 'project'),
    'a project view only ever carries that project’s skills',
  )
  assert.deepEqual(merged.body.roots.includes(projectAgentsRoot), true)
  assert.equal((await call('GET', '/skills?project=relative/dir')).status, 400)
  assert.equal((await call('GET', '/skills?project=')).status, 200, 'an empty value is not a project')

  // A read may name no root: it then answers with the merged user view, so a
  // page that has not fetched the menu yet still lands on the tabs. Writing
  // never has that luxury — the delete below requires a source.
  const fallback = await call('GET', '/skills')
  assert.equal(fallback.status, 200)
  assert.equal(fallback.body.source, 'user')
  assert.equal(fallback.body.root, join(scratch, '.dsh'))
  assert.deepEqual(fallback.body.roots, [dshRoot, agentsRoot])
  assert.deepEqual(fallback.body.absentRoots, [])
  assert.ok(
    fallback.body.skills.every((skill) => skill.scope === 'global'),
    'the user view only ever carries the two homes’ skills',
  )

  assert.equal((await call('GET', '/skills?source=bundled')).status, 400, 'an unknown source')
  assert.equal((await call('GET', '/skills?source=project-dsh')).status, 400, 'a project root needs a project')
  assert.equal((await call('GET', '/skills?source=project-dsh&cwd=relative/dir')).status, 400)

  const scopes = await call('GET', '/skills/workspaces')
  assert.equal(scopes.status, 200)
  assert.equal(scopes.body.userRoots.length, 2)
  assert.deepEqual(scopes.body.workspaces.map((ws) => ws.path), [project])
})

it('switches a skill through the route', async () => {
  const address = { name: 'only-dsh', source: 'user-dsh', cwd: '', rel: '' }
  const off = await call('POST', '/skills/enabled', { ...address, enabled: false })
  assert.equal(off.status, 200)
  assert.deepEqual(off.body, { name: 'only-dsh', enabled: false })
  assert.ok(existsSync(join(dshRoot, 'only-dsh', 'SKILL.md.disabled')))

  const on = await call('POST', '/skills/enabled', { ...address, enabled: true })
  assert.equal(on.status, 200)
  assert.ok(existsSync(join(dshRoot, 'only-dsh', 'SKILL.md')))

  assert.equal((await call('POST', '/skills/enabled', { ...address })).status, 400, 'no state to move to')
  assert.equal((await call('POST', '/skills/enabled', { ...address, enabled: 'yes' })).status, 400, 'a state that is not a boolean')
  assert.equal((await call('POST', '/skills/enabled', { ...address, name: 'Bad_Name', enabled: false })).status, 400)
  assert.equal((await call('POST', '/skills/enabled', { ...address, source: 'nope', enabled: false })).status, 400)
  assert.equal((await call('POST', '/skills/enabled', { ...address, name: 'absent', enabled: false })).status, 404)
})

it('refuses every removal it cannot address', async () => {
  assert.equal((await call('DELETE', '/skills/demo')).status, 400, 'a source is required')
  assert.equal((await call('DELETE', '/skills/Bad_Name?source=user-agents')).status, 400)
  assert.equal((await call('DELETE', '/skills/proj-agents?source=user-agents')).status, 404, 'another root')
  assert.equal((await call('DELETE', '/skills/proj-agents?source=project-agents')).status, 400, 'a project root needs a project')
  assert.equal((await call('DELETE', '/skills/proj-agents?source=project-agents&cwd=relative')).status, 400)
  assert.equal((await call('DELETE', '/skills/absent?source=user-agents')).status, 404)
  assert.equal((await call('DELETE', '/skills/demo?source=user-agents&rel=..%2F..')).status, 400, 'a traversing group')
  assert.ok(existsSync(join(projectAgentsRoot, 'proj-agents', 'SKILL.md')), 'nothing was touched')
})

it('removes through the route, by name, root and group', async () => {
  const removed = await call(
    'DELETE',
    `/skills/proj-agents?source=project-agents&cwd=${encodeURIComponent(project)}`,
  )
  assert.equal(removed.status, 200)
  assert.deepEqual(removed.body, { name: 'proj-agents' })
  assert.ok(!existsSync(join(projectAgentsRoot, 'proj-agents')))

  const nested = await call(
    'DELETE',
    `/skills/gamma?source=user-agents&rel=${encodeURIComponent('collection/deeper')}`,
  )
  assert.equal(nested.status, 200)
  assert.ok(!existsSync(join(agentsRoot, 'collection', 'deeper', 'gamma')))
})
