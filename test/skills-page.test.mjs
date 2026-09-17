/**
 * The Skills page, driven through the real client bundle in a hook harness.
 *
 * What is checked is the page's shape as a user meets it: the first answer is
 * rendered (names, descriptions, a nested skill's group, a disabled skill's
 * marker), the picker offers the two user homes separately and every project as
 * one entry named the way the session list names it, a project answers with the
 * skills of its own directories merged (each row marked with the one it came
 * from), the switch posts the state it shows, the detail dialog opens straight
 * from the row's data, and both writes address the skill by name, root, project
 * and group — never by a path the page invented.
 *
 * The translator is the identity, so every assertion about copy names the
 * dictionary key; the names, paths and descriptions below come from the fetch
 * stub, which is what the page is supposed to render verbatim.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const PROJECT = '/work/app'
const PROJECT_DSH = `${PROJECT}/.dsh/skills`
const PROJECT_AGENTS = `${PROJECT}/.agents/skills`
const USER_ROOT = '/home/user/.dsh/skills'
const AGENTS_ROOT = '/home/user/.agents/skills'
const DEMO_PATH = `${USER_ROOT}/demo/SKILL.md`
const LINK_PATH = `${USER_ROOT}/collection/linked/SKILL.md.disabled`
const LINK_REAL = '/home/user/.smskills/linked/SKILL.md'

/** The `t` this suite renders with: identity, so assertions name the key. */
const t = (key) => key

const settle = () => new Promise((resolve) => setImmediate(resolve))
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

/** The menu the stubbed host serves: two user roots, one project. */
const SCOPES = {
  userRoots: [
    { source: 'user-dsh', scope: 'global', path: USER_ROOT, label: '~/.dsh/skills' },
    { source: 'user-agents', scope: 'global', path: AGENTS_ROOT, label: '~/.agents/skills' },
  ],
  workspaces: [{ path: PROJECT, title: 'My App' }],
}

/** One skill row, with only the fields the page reads. */
function skill(fields) {
  return {
    scope: 'global',
    rel: '',
    enabled: true,
    modelInvocable: true,
    userInvocable: true,
    linked: false,
    ...fields,
  }
}

const VIEWS = {
  'user-dsh': {
    source: 'user-dsh',
    root: USER_ROOT,
    roots: [USER_ROOT],
    skills: [
      skill({
        name: 'demo',
        description: 'A demo bundle',
        source: 'user-dsh',
        path: DEMO_PATH,
        realPath: DEMO_PATH,
      }),
      skill({
        name: 'linked',
        description: 'Installed through a link',
        source: 'user-dsh',
        rel: 'collection',
        enabled: false,
        modelInvocable: false,
        linked: true,
        path: LINK_PATH,
        realPath: LINK_REAL,
      }),
    ],
    skipped: 1,
    complete: true,
  },
  'user-agents': {
    source: 'user-agents',
    root: AGENTS_ROOT,
    roots: [AGENTS_ROOT],
    skills: [
      skill({
        name: 'agents-only',
        description: 'Only in the shared home',
        source: 'user-agents',
        path: `${AGENTS_ROOT}/agents-only/SKILL.md`,
        realPath: `${AGENTS_ROOT}/agents-only/SKILL.md`,
      }),
    ],
    skipped: 0,
    complete: true,
  },
  project: {
    source: 'project',
    root: PROJECT,
    roots: [PROJECT_DSH, PROJECT_AGENTS],
    skills: [
      skill({
        name: 'proj-in-dsh',
        description: 'From the project’s own .dsh',
        source: 'project-dsh',
        scope: 'project',
        path: `${PROJECT_DSH}/proj-in-dsh/SKILL.md`,
        realPath: `${PROJECT_DSH}/proj-in-dsh/SKILL.md`,
      }),
      skill({
        name: 'proj-in-agents',
        description: 'From the project’s .agents',
        source: 'project-agents',
        scope: 'project',
        path: `${PROJECT_AGENTS}/proj-in-agents/SKILL.md`,
        realPath: `${PROJECT_AGENTS}/proj-in-agents/SKILL.md`,
      }),
    ],
    skipped: 0,
    complete: true,
  },
}

/** URL-routed fetch stub, recording every call (body included). */
function stubFetch(calls) {
  return async (rawUrl, options = {}) => {
    const url = String(rawUrl)
    const method = options.method ?? 'GET'
    const body = options.body === undefined ? undefined : JSON.parse(String(options.body))
    calls.push({ url, method, body })
    if (url.includes('/skills/workspaces')) return response(SCOPES)
    if (method === 'POST') return response({ name: body.name, enabled: body.enabled })
    if (method === 'DELETE') return response({ name: url.match(/\/skills\/([^?]+)/)[1] })
    if (/[?&]project=/.test(url)) return response(VIEWS.project)
    const scope = /[?&]source=([^&]+)/.exec(url)
    return response(VIEWS[scope === null ? 'user-dsh' : decodeURIComponent(scope[1])])
  }
}

/** Flatten a rendered tree, expanding function components the way React does. */
function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return []
  if (typeof tree.type === 'function') return [tree, ...nodes(tree.type(tree.props))]
  return [tree, ...(tree.children ?? []).flatMap(nodes)]
}

/** Every string in a tree, for assertions about what a user can read. */
const text = (tree) =>
  typeof tree === 'string'
    ? tree
    : typeof tree?.type === 'function'
      ? text(tree.type(tree.props))
      : (tree?.children ?? []).map(text).join(' ')

/** The one node whose props match a predicate. */
function find(tree, matches) {
  const found = nodes(tree).find(matches)
  assert.ok(found, 'expected a matching node')
  return found
}

/** All nodes whose props match a predicate, in render order. */
function findAll(tree, matches) {
  return nodes(tree).filter(matches)
}

/**
 * Mount the real bundle and the skills section on a hook harness.
 *
 * Two harness details carry the suite:
 *
 * - **state slots** are the `useState` calls in render order, so a component's
 *   state survives a re-render, and a *walk* of the tree (which re-invokes the
 *   row components) must start at the cursor the last render left — that is what
 *   `walk` resets;
 * - **effects** are captured per render and run by `effects()`, once per render
 *   pass. React would re-run only the effects whose dependencies changed; this
 *   page's effects are an idempotent poll, an idempotent selection fallback and
 *   a document-level tip watch, so running the newest version of each after a
 *   state change is what React does for the ones that changed and one extra poll
 *   for the ones that did not.
 */
function mount() {
  const calls = []
  const registrations = new Map()
  let exported
  let states = []
  let cursor = 0
  let rendered = 0
  let effectSlot = 0
  let capturing = false
  let effects = new Map()
  const react = {
    createElement: (type, props, ...children) => {
      const kids = children.flat(Infinity)
      return { type, props: { ...props, children: kids }, children: kids }
    },
    useState: (initial) => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = value }]
    },
    useEffect: (effect) => { if (capturing) effects.set(effectSlot++, effect) },
    useCallback: (callback) => callback,
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react) } } },
    fetch: stubFetch(calls),
    setInterval: () => 1,
    clearInterval: () => {},
  })
  exported.apply({
    effect(fn) { fn() },
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => { registrations.set(options.id, component) },
    },
  })
  const section = registrations.get('mcp-manager-skills')
  assert.ok(section, 'the skills section must be registered')
  return {
    calls,
    render() {
      cursor = 0
      effectSlot = 0
      capturing = true
      const tree = section({ t })
      rendered = cursor
      capturing = false
      return tree
    },
    /** Walk a rendered tree from the hook position its render ended on. */
    walk(read) {
      cursor = rendered
      capturing = false
      return read()
    },
    effects() {
      const pending = [...effects.values()]
      effects.clear()
      for (const effect of pending) effect()
    },
  }
}

it('lists one scope, opens a row, switches it and removes it by address', async () => {
  const app = mount()
  // React's order: the first render registers the effects, the effects issue
  // the poll, and the next render sees its answer.
  let tree = app.render()
  app.effects()
  await settle()
  tree = app.render()

  const view = () => app.walk(() => text(tree))
  const pick = (matches) => app.walk(() => find(tree, matches))
  const pickAll = (matches) => app.walk(() => findAll(tree, matches))
  const again = () => { tree = app.render() }
  const trigger = () => pick((node) => node.props?.['aria-haspopup'] === 'listbox')
  const options = () => app.walk(() => nodes(tree).filter((node) => node.props?.role === 'option'))
  /** Select a scope from the menu and let the page poll its answer. */
  const select = async (index) => {
    // The menu is a toggle: only open it when it is closed.
    if (options().length === 0) {
      trigger().props.onClick()
      again()
    }
    options()[index].props.onClick()
    again()
    app.effects()
    await settle()
    again()
  }

  // The default view: the harness home, answered without the page naming a root.
  assert.equal(app.calls[0].url, '/mcp-manager/api/skills')
  const listed = view()
  assert.match(listed, /demo/)
  assert.match(listed, /A demo bundle/)
  assert.match(listed, /collection/, 'a nested skill shows its group')
  assert.match(listed, /disabled/, 'and a disabled one shows that instead of hiding')
  assert.match(listed, /skipped/)
  assert.equal(trigger().props['data-tip'], USER_ROOT, 'the answered root is selected')
  assert.equal(view().includes(USER_ROOT), true, 'and the directory it read is named')

  // The menu: the two user homes are separate entries, and every project is one
  // entry named the way the session list names it.
  trigger().props.onClick()
  again()
  assert.deepEqual(
    options().map((node) => node.props['data-tip']),
    [USER_ROOT, AGENTS_ROOT, PROJECT],
  )
  const menu = view()
  assert.match(menu, /scopeUser/)
  assert.match(menu, /scopeProject/)
  assert.match(menu, /~\/\.dsh\/skills/)
  assert.match(menu, /~\/\.agents\/skills/)
  assert.match(menu, /My App/, 'a project is labelled with its stored title')

  // Picking another home moves the page to it, and its list is that home's.
  await select(1)
  assert.equal(trigger().props['data-tip'], AGENTS_ROOT)
  assert.match(view(), /agents-only/)
  assert.doesNotMatch(view(), /A demo bundle/)

  // …and back.
  await select(0)
  assert.equal(trigger().props['data-tip'], USER_ROOT)
  assert.match(view(), /A demo bundle/)

  // Clicking a row opens its dialog from the row's own data — no fetch for it.
  const before = app.calls.length
  pickAll((node) => node.props?.className === 'sk_open')[1].props.onClick()
  again()
  const detail = view()
  assert.match(detail, /detailStatus statusDisabled/)
  assert.match(detail, /detailInvocation invocationUser/)
  assert.match(detail, /detailRoot/)
  assert.match(detail, new RegExp(LINK_PATH.replaceAll('/', '\\/')))
  assert.match(detail, new RegExp(LINK_REAL.replaceAll('/', '\\/')))
  assert.equal(app.calls.length, before, 'the dialog reads nothing')
  pick((node) => node.props?.['aria-label'] === 'close').props.onClick()
  again()
  assert.doesNotMatch(view(), /detailDescription/)

  // The switch posts the state it is moving to, with the skill's full address.
  const switchButton = () => pickAll((node) => node.props?.role === 'switch')[1]
  assert.equal(switchButton().props['aria-checked'], false)
  switchButton().props.onClick()
  await settle()
  const toggled = app.calls.filter((call) => call.method === 'POST').pop()
  assert.deepEqual(toggled.body, {
    name: 'linked',
    source: 'user-dsh',
    cwd: '',
    rel: 'collection',
    enabled: true,
  })
  again()
  assert.equal(switchButton().props['aria-checked'], true, 'the switch shows what the click asked for')

  // The search narrows the list, and the empty state stands in for it.
  pick((node) => node.props?.['aria-label'] === 'search').props.onChange({ target: { value: 'nothing' } })
  again()
  assert.match(view(), /searchEmpty/)
  pick((node) => node.props?.['aria-label'] === 'clearSearch').props.onClick()
  again()
  assert.doesNotMatch(view(), /searchEmpty/)

  // The remove button confirms with the facts, then deletes by name, root and
  // group — the host re-resolves all of them inside that one root.
  pickAll((node) => node.props?.['aria-label'] === 'remove')[0].props.onClick()
  again()
  const confirm = view()
  assert.match(confirm, /removeSkill/)
  assert.match(confirm, new RegExp(DEMO_PATH.replaceAll('/', '\\/')))
  pick((node) => node.props?.className === 'mm_btn danger').props.onClick()
  await settle()
  const deleted = app.calls.filter((call) => call.method === 'DELETE').pop()
  assert.match(deleted.url, /\/skills\/demo\?/)
  assert.match(deleted.url, /source=user-dsh/)
  assert.match(deleted.url, /rel=$/)
  again()
  assert.doesNotMatch(view(), /A demo bundle/, 'the row leaves at once')

  // A project is one entry, and selecting it lists that project's own skills —
  // both of its directories, each row marked with the one it came from.
  await select(2)
  assert.equal(trigger().props['data-tip'], PROJECT)
  const projectView = view()
  assert.match(projectView, /proj-in-dsh/)
  assert.match(projectView, /proj-in-agents/)
  assert.match(projectView, /\.dsh/, 'a merged view marks which directory a row came from')
  assert.match(projectView, /\.agents/)
  assert.equal(projectView.includes(PROJECT_DSH), true, 'and names every directory it read')
  assert.equal(projectView.includes(PROJECT_AGENTS), true)
  assert.equal(app.calls.some((call) => call.url.includes(`project=${encodeURIComponent(PROJECT)}`)), true)
})
