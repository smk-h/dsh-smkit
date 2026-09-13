import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const clientDir = new URL('../src/client/', import.meta.url)

/** Every source file under src/client, recursively. */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(new URL(`${entry.name}/`, dir)) : [new URL(entry.name, dir)],
  )
}

/** The only modules allowed to contain Han literals. */
const I18N_MODULE = /[/\\]i18n[/\\]/

// Run the real module factory with a tiny hook harness; no browser or dependencies.
// The plugin seats several entries (Settings → MCP, Settings → 模型重试, and the
// conversation header's delete control), two of them in the same slot, so
// registrations are keyed by the entry id DSH itself addresses them by — a map
// keyed by slot name would keep whichever feature registered last.
function mount(fetch, language = 'en') {
  let disposed = false
  const dictionaries = {}
  const effectLabels = []
  const registrations = new Map()
  // Resolve one key inside one namespace, the way DSH's bound `t` does: the
  // resolved language first, English as the fallback, the key itself last.
  const translate = (namespace, key, values = {}) => {
    const tables = dictionaries[namespace] ?? {}
    const raw = tables[language]?.[key] ?? tables.en?.[key] ?? key
    return String(raw).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match))
  }
  const t = (key, values) => translate('mcp', key, values)
  let exported
  let states = [], cursor = 0, effects = [], initialized = false
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial) => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = value }]
    },
    useEffect: (effect) => { if (!initialized) effects.push(effect) },
    useCallback: (callback) => callback,
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react) } } },
    fetch,
    setInterval: () => 1,
    clearInterval: () => {},
  })
  const disposers = []
  exported.apply({
    effect(fn, label) { effectLabels.push(label); disposers.push(fn()) },
    locale: {
      register(ns, table) {
        dictionaries[ns] = table
        return () => { disposed = true }
      },
      bind: (ns) => (key, values) => translate(ns, key, values),
    },
    slots: {
      inject: (_name, cb) => cb(),
      register: (options, component) => { registrations.set(options.id, { options, component }) },
    },
  })
  const section = registrations.get('mcp-manager')
  return {
    get dictionaries() { return dictionaries },
    get spec() { return section.options },
    get registrations() { return registrations },
    get inject() { return exported.inject },
    effectLabels,
    dispose() { for (const dispose of disposers) dispose(); assert.equal(disposed, true) },
    setLocale(next) { language = next },
    render(component = section.component, props = { t }) {
      cursor = 0
      return component(props)
    },
    effects() { initialized = true; for (const effect of effects) effect(); effects = [] },
    reset() { states = [] },
  }
}
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })
const settle = () => new Promise((resolve) => setImmediate(resolve))
function nodes(tree) {
  return tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : []
}
// Expands function components while walking: the section delegates parts of its
// tree to child components (the key/value editors, the status pills), and their
// text only appears once the component is called, the way React would.
const text = (tree) =>
  typeof tree === 'string'
    ? tree
    : typeof tree?.type === 'function'
      ? text(tree.type(tree.props))
      : tree?.children?.map(text).join(' ') ?? ''
// The add view's form: the first function node that takes the translator. The
// section can render helper components ahead of the form (e.g. the header
// breadcrumb, which resolves to `null` in this harness — the fake `require`
// hands back the react stub without `createPortal`), so "first function node"
// alone is not a form locator.
const content = (tree) =>
  nodes(tree).find((node) => typeof node.type === 'function' && node.props?.t != null)

it('registers a balanced dictionary per namespace, with effect cleanup and every seat', () => {
  const app = mount(async () => response({}))
  for (const namespace of ['platform', 'mcp', 'session-delete', 'llm-retry']) {
    assert.deepEqual(
      Object.keys(app.dictionaries[namespace].zh).sort(),
      Object.keys(app.dictionaries[namespace].en).sort(),
      namespace + ': zh and en must carry the same key set',
    )
  }
  assert.equal(app.spec.name, 'settings.section')
  assert.equal(app.spec.locale, 'mcp')
  assert.equal(app.spec.label(), 'MCP')
  assert.ok(app.inject.includes('locale'))
  assert.ok(app.inject.includes('sessions'), 'the header delete control needs the client session store')
  // The second seat: the conversation header's delete control, which carries no
  // nav label and binds the same dictionary.
  const header = app.registrations.get('mcp-manager-session-delete')
  assert.equal(header.options.name, 'conversation.session.header.utilities')
  assert.equal(header.options.locale, 'session-delete')
  // The third: the retry policy page, the second entry of the settings section
  // slot. Its own entry id is what keeps the two pages from replacing each
  // other in the shell's nav.
  const retry = app.registrations.get('mcp-manager-llm-retry')
  assert.equal(retry.options.name, 'settings.section')
  assert.equal(retry.options.locale, 'llm-retry')
  assert.equal(retry.options.label(), 'Model retry')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  assert.deepEqual(app.effectLabels, [
    'dsh-mcp-manager: platform/dictionaries',
    'dsh-mcp-manager: mcp/dictionaries',
    'dsh-mcp-manager: settings nav row',
    'dsh-mcp-manager: session-delete/dictionaries',
    'dsh-mcp-manager: llm-retry/dictionaries',
  ])
  // Every key a component asks for must exist in one of the registered
  // dictionaries: business copy in its feature's namespace, the dialog's shared
  // button labels in the platform one.
  const known = new Set(
    Object.values(app.dictionaries).flatMap((dictionary) => Object.keys(dictionary.en)),
  )
  for (const key of [...source.matchAll(/\bt\(\s*["']([\w-]+)["']/g)].map((match) => match[1])) {
    assert.ok(known.has(key), 'no dictionary declares ' + key)
  }
  // Every user-visible string resolves through `t`, so no module outside the
  // dictionaries may carry a Han literal. This scans the SOURCES rather than
  // the bundle: the bundler owns module order and text layout, so a
  // position-based check on the artifact would be testing the build rather
  // than the code (and did break when the bundler changed).
  for (const file of walk(clientDir)) {
    if (!/\.tsx?$/.test(file.pathname) || I18N_MODULE.test(file.pathname)) continue
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\p{Script=Han}/u, file.pathname)
  }
  assert.doesNotMatch(source, /STRINGS|translator|systemLanguage|navigator|settings\/language|mm_language/)
  app.dispose()
})

it('renders the injected t and follows locale changes without plugin language requests', async () => {
  const calls = []
  const app = mount(async (url) => { calls.push(url); return response({}) })
  let tree = app.render()
  assert.match(text(tree), /MCP servers/)
  app.effects(); await settle()
  app.setLocale('zh')
  tree = app.render()
  assert.match(text(tree), /MCP 服务器/)
  assert.equal(calls.filter((url) => url.endsWith('/settings')).length, 1)
  assert.ok(calls.every((url) => !url.includes('/settings/language')))
  // An arbitrary standard-seat translator reaches the content and nested forms.
  tree = app.render(undefined, { t: (key) => 'seat:' + key })
  assert.match(text(tree), /seat:servers/)
  nodes(tree).find((node) => node.props['aria-label'] === 'seat:addServer').props.onClick()
  const form = content(app.render(undefined, { t: (key) => 'seat:' + key }))
  assert.equal(form.props.t('save'), 'seat:save')
})

it('renders English list, add form, and stdio fields using the same translator', async () => {
  const app = mount(async () => response({}))
  let tree = app.render()
  assert.match(text(tree), /MCP servers/)
  nodes(tree).find((node) => node.props['aria-label'] === 'Add MCP server').props.onClick()
  tree = app.render()
  assert.match(text(tree), /Add MCP server/)
  const form = content(tree)
  app.reset()
  tree = app.render(form.type, form.props)
  assert.match(text(tree), /Authentication method/)
  assert.match(text(tree), /Headers from environment variables/)
  nodes(tree).find((node) => node.type === 'select' && node.props.value === 'http').props.onChange({ target: { value: 'stdio' } })
  tree = app.render(form.type, form.props)
  assert.match(text(tree), /Command \(executable\)/)
  assert.match(text(tree), /Environment variables/)
})

it('offers a no-auth HTTP mode and hides the token field when selected', async () => {
  const app = mount(async () => response({}))
  let tree = app.render()
  nodes(tree).find((node) => node.props['aria-label'] === 'Add MCP server').props.onClick()
  tree = app.render()
  const form = content(tree)
  app.reset()
  tree = app.render(form.type, form.props)

  const authSelect = nodes(tree).find((node) => node.type === 'select' && node.props.value === 'oauth')
  assert.ok(authSelect, 'the authentication-method select renders')
  assert.deepEqual(authSelect.children.map((option) => option.props.value), ['oauth', 'static', 'none'])
  assert.match(text(tree), /No auth \(server needs no credentials\)/)
  assert.doesNotMatch(text(tree), /Bearer token environment variable/)

  // Static still asks for the env var name...
  authSelect.props.onChange({ target: { value: 'static' } })
  tree = app.render(form.type, form.props)
  assert.match(text(tree), /Bearer token environment variable/)

  // ...while no-auth hides the credential field entirely.
  nodes(tree).find((node) => node.type === 'select' && node.props.value === 'static').props.onChange({ target: { value: 'none' } })
  tree = app.render(form.type, form.props)
  assert.match(text(tree), /No auth \(server needs no credentials\)/)
  assert.doesNotMatch(text(tree), /Bearer token environment variable/)
})
