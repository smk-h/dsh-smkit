/**
 * The Skills page, driven through the real client bundle in a hook harness.
 *
 * What is checked is the page's shape as a user meets it: the first answer is
 * the merged user view (names, descriptions, a nested skill's group, a disabled
 * skill's marker) shown under two tabs, the picker offers the user side as one
 * entry and every project as one entry named the way the session list names it,
 * a project's two skill directories show as two tabs over one request's answer,
 * the switch posts the state it shows, the detail dialog opens straight from
 * the row's data, and both writes address the skill by name, root, project and
 * group — never by a path the page invented.
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
    absentRoots: [],
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
      skill({
        name: 'restricted',
        description: 'Only the model may reach it',
        source: 'user-dsh',
        userInvocable: false,
        path: `${USER_ROOT}/restricted/SKILL.md`,
        realPath: `${USER_ROOT}/restricted/SKILL.md`,
      }),
    ],
    skipped: 1,
    complete: true,
  },
  'user-agents': {
    source: 'user-agents',
    root: AGENTS_ROOT,
    roots: [AGENTS_ROOT],
    absentRoots: [],
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
    absentRoots: [PROJECT_AGENTS],
    skills: [
      skill({
        name: 'proj-in-dsh',
        description: 'From the project’s own .dsh',
        source: 'project-dsh',
        scope: 'project',
        path: `${PROJECT_DSH}/proj-in-dsh/SKILL.md`,
        realPath: `${PROJECT_DSH}/proj-in-dsh/SKILL.md`,
      }),
    ],
    skipped: 0,
    complete: true,
  },
}

/** The merged user view: both homes in rank order, answered for `GET /skills`. */
VIEWS.user = {
  source: 'user',
  root: '/home/user/.dsh',
  roots: [USER_ROOT, AGENTS_ROOT],
  absentRoots: [],
  skills: [...VIEWS['user-dsh'].skills, ...VIEWS['user-agents'].skills],
  skipped: 1,
  complete: true,
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
    return response(VIEWS[scope === null ? 'user' : decodeURIComponent(scope[1])])
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
      return [states[index], (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value
      }]
    },
    useEffect: (effect) => { if (capturing) effects.set(effectSlot++, effect) },
    useCallback: (callback) => callback,
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react) } } },
    fetch: stubFetch(calls),
    setInterval: () => 1,
    clearInterval: () => {},
    // The refresh button schedules the end of the busy floor it holds. Nothing
    // here runs a clock — what is asserted about it is the click, which is what
    // opens the face — so the timer only has to exist.
    setTimeout: () => 1,
    clearTimeout: () => {},
  })
  exported.apply({
    effect(fn) { fn() },
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => { registrations.set(options.id, component) },
    },
  })
  const section = registrations.get('mcp-manager')
  assert.ok(section, 'the merged settings section must be registered')
  return {
    calls,
    render() {
      cursor = 0
      effectSlot = 0
      capturing = true
      const tree = section()
      const shellSlots = cursor
      // One expansion pass: the section delegates its body to the open panel, so
      // that is where the page's own effects register. The cursor then returns to
      // the shell's slots, which is where every later walk restarts from.
      nodes(tree)
      cursor = shellSlots
      rendered = cursor
      capturing = false
      return tree
    },
    /** Open one of the merged section's tabs — the section keeps a tab strip
     * above the page, and this suite drives the skills page behind it. */
    openTab(label) {
      cursor = 0
      const tree = section()
      const shellSlots = cursor
      const tab = nodes(tree).find(
        (node) => node.props?.role === 'tab' && node.children.includes(label),
      )
      assert.ok(tab, `the merged section must offer the ${label} tab`)
      tab.props.onClick()
      // The panel that was mounted is gone: its slots are dropped, so the panel
      // that replaces it starts its own state fresh, as React would.
      states.length = shellSlots
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
  // The page lives on a tab of the merged section now; this suite drives it
  // there first, the way a user opens it.
  app.openTab('tabSkills')
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

  // The default view is the merged user side, answered without the page naming
  // a root: two tabs, the harness home's active.
  assert.equal(app.calls[0].url, '/mcp-manager/api/skills')
  const listed = view()
  assert.match(listed, /demo/)
  assert.match(listed, /A demo bundle/)
  assert.match(listed, /collection/, 'a nested skill shows its group')
  assert.match(listed, /disabled/, 'and a disabled one shows that instead of hiding')
  assert.match(listed, /skipped/)
  assert.doesNotMatch(listed, /agents-only/, 'the other home waits behind its tab')
  // The section's own tab strip sits above the page; the page's strips label
  // their tabs with plain text, the section's pair each label with a glyph.
  const isPageTab = (node) => node.props?.role === 'tab' && typeof node.children[0] === 'string'
  const userTabs = () => app.walk(() => findAll(tree, isPageTab))
  assert.deepEqual(
    userTabs().map((node) => node.children[0]),
    ['~/.dsh', '~/.agents'],
  )
  assert.deepEqual(userTabs().map((node) => node.props['aria-selected']), [true, false])
  assert.equal(trigger().props['data-tip'], `${USER_ROOT} · ${AGENTS_ROOT}`, 'the user entry is selected')
  assert.equal(view().includes(USER_ROOT), true, 'and the active directory is named')

  // The menu: the user side is one entry carrying both homes, and every project
  // is one entry named the way the session list names it.
  trigger().props.onClick()
  again()
  assert.deepEqual(
    options().map((node) => node.props['data-tip']),
    [`${USER_ROOT} · ${AGENTS_ROOT}`, PROJECT],
  )
  const menu = view()
  assert.match(menu, /scopeUser/, 'the user side is one entry, named plainly')
  assert.match(menu, /scopeProject/)
  assert.match(menu, /My App/, 'a project is labelled with its stored title')
  // Close the menu again: the strip below it is what the next steps drive.
  trigger().props.onClick()
  again()

  // The other tab moves the page to the shared home — its rows, its path line —
  // without another request: the strip only narrows the answer in hand.
  const callsBeforeTab = app.calls.length
  userTabs()[1].props.onClick()
  again()
  assert.deepEqual(userTabs().map((node) => node.props['aria-selected']), [false, true])
  assert.match(view(), /agents-only/)
  assert.doesNotMatch(view(), /A demo bundle/)
  assert.equal(view().includes(AGENTS_ROOT), true, 'the path line follows the active tab')
  assert.equal(app.calls.length, callsBeforeTab, 'switching tabs reads nothing')

  // …and back to the harness home, whose rows the writes below address.
  userTabs()[0].props.onClick()
  again()
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

  // The invocation line reads both flags: `user-invocable: false` with the model
  // side untouched is the model's alone, not "both".
  pickAll((node) => node.props?.className === 'sk_open')[2].props.onClick()
  again()
  assert.match(view(), /detailInvocation invocationModel/)
  pick((node) => node.props?.['aria-label'] === 'close').props.onClick()
  again()

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

  // The toolbar's refresh button is the poll's own read, on demand: the same
  // pair of requests, without waiting out the timer or reloading the page. At
  // rest it is the refresh arrow…
  const refreshButton = () => pick((node) => node.props?.['aria-label'] === 'refresh')
  /** How many elements the button's glyph draws, expanded as React would. */
  const glyphOf = (button) => {
    const icon = button.children[0]
    return icon.type(icon.props).children.length
  }
  assert.equal(glyphOf(refreshButton()), 4, 'the arrow is the resting glyph')
  const callsBeforeRefresh = app.calls.length
  refreshButton().props.onClick()
  again()
  // …and the click answers itself: the button is busy and locked before the host
  // has answered anything, showing the platform's spinner instead of the arrow.
  // A read that comes back in a millisecond would otherwise pass as a flicker.
  assert.equal(refreshButton().props['data-busy'], 'true')
  assert.equal(refreshButton().props.disabled, true, 'and it does not take a second click')
  assert.equal(glyphOf(refreshButton()), 1, 'the arrow gives way to the spinner arc')
  await settle()
  assert.equal(app.calls.length, callsBeforeRefresh + 2, 'a refresh reads the view and the menu')
  assert.match(app.calls.at(-2).url, /\/skills(\?|$)/)
  assert.match(app.calls.at(-1).url, /\/skills\/workspaces$/)
  again()

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

  // A project is one entry, and selecting it asks for the project as a whole —
  // one request — and shows its two directories as two tabs, the first active.
  await select(1)
  assert.equal(trigger().props['data-tip'], PROJECT)
  assert.equal(app.calls.some((call) => call.url.includes(`project=${encodeURIComponent(PROJECT)}`)), true)
  const tabs = () => app.walk(() => findAll(tree, isPageTab))
  assert.deepEqual(
    tabs().map((node) => node.children[0]),
    ['.dsh', '.agents'],
  )
  assert.deepEqual(tabs().map((node) => node.props['aria-selected']), [true, false])
  let projectView = view()
  assert.match(projectView, /proj-in-dsh/)
  assert.doesNotMatch(projectView, /proj-in-agents/, 'the other directory waits behind its tab')
  assert.equal(projectView.includes(PROJECT_DSH), true, 'the path line names the active directory')
  assert.equal(projectView.includes(PROJECT_AGENTS), false)

  // The other tab is the directory that does not exist yet: the tab stays up —
  // the layout is the harness's — and the empty state says not installed, with
  // the path line still naming where skills would go. No new request: the
  // strip only narrows the answer in hand.
  const callsBeforeProjectTab = app.calls.length
  tabs()[1].props.onClick()
  again()
  assert.deepEqual(tabs().map((node) => node.props['aria-selected']), [false, true])
  projectView = view()
  assert.match(projectView, /emptyAbsent/, 'the absent directory says not installed')
  assert.doesNotMatch(projectView, /proj-in-agents/)
  assert.equal(projectView.includes(PROJECT_AGENTS), true, 'and still names where it would be')
  assert.equal(app.calls.length, callsBeforeProjectTab, 'switching tabs reads nothing')
})
