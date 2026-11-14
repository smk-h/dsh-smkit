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
// The plugin seats a few entries (the merged settings section, the conversation
// header's delete control and the OpenSpec button), so registrations are keyed
// by the entry id DSH itself addresses them by — a map keyed by slot name would
// keep whichever feature registered last.
function mount(fetch, language = 'en', options = {}) {
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
  let exported
  // Hooks live in slots keyed by WHERE the component that owns them sits, not by
  // a running count: a merged page whose panel swaps between three components
  // gives each of them fresh state at the same position, the way React remounts
  // a position whose component type changed, while a re-paint of the same tree
  // finds every value where it left it.
  let states = new Map()
  const instanceIds = new Map()
  let path = 'page'
  let hookIndex = 0
  let effects = []
  let capturing = false
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial) => {
      const key = `${path}#${hookIndex++}`
      if (!states.has(key)) states.set(key, typeof initial === 'function' ? initial() : initial)
      // A functional update computes from the value the slot holds, as React's
      // does; storing the updater itself would leave the next render comparing a
      // function against the state the code asked for.
      return [states.get(key), (value) => {
        states.set(key, typeof value === 'function' ? value(states.get(key)) : value)
      }]
    },
    // Only a render pass registers effects, and `paint` keeps the newest pass's
    // list, so a panel's poll is captured once per mount.
    useEffect: (effect) => { if (capturing) effects.push(effect) },
    useCallback: (callback) => callback,
  }
  runInNewContext(source, {
    window: {
      __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react) } },
      // `upstream: true` boots the graph the same way a profile that also loads
      // `dsh-mcp-manager` does — the stand-down reads this, not a package check.
      ...(options.upstream === true
        ? { __DSH_BOOT__: { entries: [{ id: 'dsh-mcp-manager' }, { id: '@smai-kit/dsh-smkit' }] } }
        : {}),
    },
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
  // The seat id moves to `smkit-settings` when the upstream manager is loaded
  // beside this plugin; either id names the same section here.
  const section = registrations.get('mcp-manager') ?? registrations.get('smkit-settings')
  // One render pass, depth first, each component called exactly once. Reading
  // the page and registering its hooks must be the same walk: the merged shell
  // owns state of its own (which tab is open) above the panel's. `frames`
  // records every component with the address its hooks were keyed under, which
  // is how a sub-view's form is re-rendered on the slots it owns.
  const render = (root, rootPath) => {
    const seen = []
    const strings = []
    const frames = []
    const idOf = (type) => {
      let id = instanceIds.get(type)
      if (id === undefined) {
        id = instanceIds.size + 1
        instanceIds.set(type, id)
      }
      return id
    }
    const walk = (node, owner, position) => {
      if (node === null || node === undefined) return
      if (typeof node === 'string') { strings.push(node); return }
      seen.push(node)
      if (typeof node.type === 'function') {
        const address = `${owner}>${position}#${idOf(node.type)}`
        frames.push({ node, address })
        const outerPath = path
        const outerHook = hookIndex
        path = address
        hookIndex = 0
        walk(node.type(node.props), address, 'r')
        path = outerPath
        hookIndex = outerHook
        return
      }
      let index = 0
      for (const child of node.children ?? []) walk(child, owner, `${position}/${index++}`)
    }
    const outerPath = path
    const outerHook = hookIndex
    path = rootPath
    hookIndex = 0
    // The root is the component whose tree is being read: it renders on the
    // address given to it, so re-rendering a form reaches the state the page
    // paint allocated for it.
    const tree = typeof root.type === 'function' ? root.type(root.props ?? {}) : root
    walk(tree, rootPath, 'r')
    path = outerPath
    hookIndex = outerHook
    return { nodes: seen, frames, text: strings.join(' ') }
  }
  let formAddress = 'page'
  let formNode = null
  return {
    get dictionaries() { return dictionaries },
    get spec() { return section.options },
    get registrations() { return registrations },
    get inject() { return exported.inject },
    effectLabels,
    dispose() { for (const dispose of disposers) dispose(); assert.equal(disposed, true) },
    setLocale(next) { language = next },
    /** One full render of the merged page, read as a user would: its text and
     * every node the pass drew, including what the open panel drew behind it. */
    paint() {
      // The pass that expands the panel is the one that registers its poll, so
      // each paint owns the effect list rather than accumulating across paints.
      effects = []
      capturing = true
      const pass = render({ type: section.component, props: {} }, 'page')
      capturing = false
      return pass
    },
    /** Click one of the merged page's tabs. Tabs are page-level, so this closes
     * any sub-view form the case had opened. */
    clickTab(label) {
      formNode = null
      this.click((node) => node.props?.role === 'tab' && node.children.some((child) => child === label))
    },
    /** Click (or otherwise drive) the first node a pass draws that matches. With
     * a sub-view's form open the pass is that form's own: the Advanced sub-view
     * hosts two forms and each has a Save button, so a page-wide search would
     * drive the wrong one. */
    click(match, act = (node) => node.props.onClick()) {
      const pass = () => (formNode ? this.renderForm() : this.paint())
      const found = pass().nodes.find(match)
      assert.ok(found, 'the page must offer the control the case drives')
      act(found)
      // Redraw after the click: the action can mount a different subtree (the
      // next tab's panel), and a case's follow-up `effects()` call must run what
      // the user now sees rather than what they clicked away from.
      pass()
    },
    /** Open the sub-view's form on its own hook slots: the page is painted once
     * to locate the form, and the form then renders on the address that walk gave
     * it. The section can render helper components alongside the form (e.g. the
     * header breadcrumb, which resolves to `null` here — the fake loader hands
     * back the react stub without `createPortal`), so `name` pins one specific
     * form for the sub-views that host more than one (Advanced renders the
     * reconnect form above the tool-call timeout). */
    openForm(name = null) {
      const frame = this.paint().frames.find(
        (entry) =>
          typeof entry.node.type === 'function' &&
          entry.node.props?.t != null &&
          (name === null || entry.node.type.name === name),
      )
      assert.ok(frame, `the page must render the ${name ?? ''} form`)
      formNode = frame.node
      formAddress = frame.address
      return { node: formNode, props: formNode.props, ...this.renderForm() }
    },
    /** One render of the form opened above, on the slots it owns. */
    renderForm() {
      capturing = true
      const pass = render({ type: formNode.type, props: formNode.props }, formAddress)
      capturing = false
      return pass
    },
    effects() { for (const effect of effects) effect(); effects = [] },
    reset() { states = new Map(); path = 'page'; hookIndex = 0 },
  }
}
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })
const settle = () => new Promise((resolve) => setImmediate(resolve))

it('stands its MCP half down when dsh-mcp-manager shares the boot graph', () => {
  const app = mount(async () => response({}), 'en', { upstream: true })
  assert.equal(app.dictionaries.mcp, undefined, 'the upstream manager owns the `mcp` namespace')
  assert.ok(app.dictionaries.skills, 'the remaining settings pages keep their copy')
  assert.ok(
    !app.effectLabels.includes('smkit: mcp-command/dictionaries'),
    'the `/mcp` picker stands down with the rest of the MCP half',
  )
  assert.equal(
    app.spec.id,
    'smkit-settings',
    'the seat id moves: the upstream manager seats itself as `mcp-manager`',
  )
  // The strip's labels sit inside each tab's children, so read them as text.
  const pass = app.paint()
  const tabText = pass.nodes
    .filter((node) => node.props?.role === 'tab')
    .map((node) => JSON.stringify(node.children))
    .join(' | ')
  assert.ok(tabText.includes('Skills'), `the section still offers its remaining pages: ${tabText}`)
  assert.ok(!tabText.includes('MCP'), `the MCP page is gone: another manager owns it: ${tabText}`)
})

it('registers a balanced dictionary per namespace, with effect cleanup and every seat', () => {
  const app = mount(async () => response({}))
  for (const namespace of ['platform', 'smkit', 'mcp', 'session-delete', 'custom-settings', 'skills', 'local-cache', 'notify', 'openspec', 'theme-center', 'tab-menu', 'markdown-outline', 'line-jump', 'selection-quote', 'explorer', 'input-history', 'mcp-debug']) {
    assert.deepEqual(
      Object.keys(app.dictionaries[namespace].zh).sort(),
      Object.keys(app.dictionaries[namespace].en).sort(),
      namespace + ': zh and en must carry the same key set',
    )
  }
  // One seat for all three settings pages: the merged section, whose own
  // namespace carries its label and whose tabs reach into the pages'.
  assert.equal(app.spec.name, 'settings.section')
  assert.equal(app.spec.locale, 'smkit')
  assert.equal(app.spec.label(), 'SMKIT')
  assert.equal(
    app.spec.id,
    'mcp-manager',
    'the merged page keeps the seat id the MCP page has always used',
  )
  assert.ok(app.inject.includes('locale'))
  assert.ok(app.inject.includes('sessions'), 'the header delete control needs the client session store')
  // The second seat: the conversation header's delete control, which carries no
  // nav label and binds the same dictionary.
  const header = app.registrations.get('smkit-session-delete')
  assert.equal(header.options.name, 'conversation.session.header.utilities')
  assert.equal(header.options.locale, 'session-delete')
  // The third: the OpenSpec control, in the same conversation-header utilities
  // list as the delete control and just before it.
  const openSpec = app.registrations.get('smkit-openspec')
  assert.equal(openSpec.options.name, 'conversation.session.header.utilities')
  assert.equal(openSpec.options.locale, 'openspec')
  assert.ok(openSpec.options.order < header.options.order, 'it sits beside, not on, the delete control')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  assert.deepEqual(app.effectLabels, [
    'smkit: platform/dictionaries',
    // The platform's own other watch: the tab strip's scrolling, armed once for
    // the document rather than by each strip (see `platform/ui/tabs-scroll`).
    'smkit: tab strip scrolling',
    'smkit: session-delete/dictionaries',
    // The notify feature: its dictionary (it sits before the merged settings
    // in the feature list) and its focus heartbeat, the one effect that runs
    // outside the settings dialog.
    'smkit: notify/dictionaries',
    'smkit: smkit/dictionaries',
    'smkit: mcp/dictionaries',
    'smkit: skills/dictionaries',
    'smkit: custom-settings/dictionaries',
    'smkit: local-cache/dictionaries',
    // The session-manager page's own dictionary, seated by the merged section
    // like the pages above it.
    'smkit: session-manager/dictionaries',
    // The `/mcp` picker's dictionary (search box, group heading, row copy).
    'smkit: mcp-command/dictionaries',
    // The debug page's dictionary. It sits after the picker's because its seat
    // takes no service at mount: a panel id in the main column and a rail entry
    // are declarations the shell reads when it draws its own chrome.
    'smkit: mcp-debug/dictionaries',
    // The process monitor page: its dictionary only — the page's poll and its
    // clock belong to the page's own mount, not to the entry (see
    // `features/process-monitor`).
    'smkit: process-monitor/dictionaries',
    'smkit: openspec/dictionaries',
    'smkit: theme-center/dictionaries',
    // The right sidebar's tab menu: its dictionary only — the batch rows are
    // built when the seat opens the card (see `features/tab-menu`).
    'smkit: tab-menu/dictionaries',
    // The Markdown outline: its dictionary, then the watch that hangs the
    // table of contents on each host preview body (see
    // `features/markdown-outline`).
    'smkit: markdown-outline/dictionaries',
    // The go-to-line box: its dictionary only — the keystroke and the box are
    // armed by the watch registered below (see `features/line-jump`).
    'smkit: line-jump/dictionaries',
    // The preview's selection popup: its dictionary only — the gesture and the
    // floating button are armed by the watch registered below (see
    // `features/selection-quote`).
    'smkit: selection-quote/dictionaries',
    // The code outline: its dictionary, then the watch that hangs the panel on
    // the host's preview (see `features/outline`).
    'smkit: outline/dictionaries',
    // The tree's menu: its dictionary, then the contextmenu watch that draws
    // the shell's menu for the host's rows (see `features/explorer-menu`).
    'smkit: explorer/dictionaries',
    // The tree's fold-everything control: its dictionary, then the watch that
    // hangs the button on the neighbour's file window (see
    // `features/explorer-collapse`).
    'smkit: explorer-collapse/dictionaries',
    // The composer's `/mcp` history: its (empty) dictionary, then the one
    // keydown listener that answers ↑ / ↓ (see `features/input-history`).
    'smkit: input-history/dictionaries',
    'smkit: notify/heartbeat',
    // The web-delivery subscriber: the second notification path for remote
    // hosts, holding one event-stream open for the host's pushed decisions.
    'smkit: notify/web-delivery',
    'smkit: merged settings nav row',
    // The `/mcp` picker's decoration of the host command. This harness
    // publishes no `commandUi` service, so the effect resolves to the
    // stand-down disposer — the label is still the registration's own.
    'smkit: mcp/command panel',
    // The debug page's gate: one subscription, so the switch on the MCP page can
    // seat or unseat the page without a restart.
    'smkit: mcp-debug/gate',
    // The theme center's mount-time half: the swap element, the saved mode and
    // theme, and the programmatic API — all before the settings row renders.
    'smkit: theme-center/restore',
    // And the layer above it: the palette panel's saved color edits, which must
    // survive a theme switch and so ride an effect of their own.
    'smkit: theme-center/palette overrides',
    // The other axis out: the card workbench skin, restored at mount onto an
    // attribute of its own so it survives whatever the theme does.
    'smkit: theme-center/workbench',
    // The outline's watch: one document observer for preview bodies, one per
    // body for its own re-renders, and the outline bar each of them carries.
    'smkit: markdown-outline/preview',
    // The go-to-line watch: one capture-phase keydown, one pointermove for
    // picking the preview, and the box it draws on Ctrl+G.
    'smkit: line-jump/preview',
    // The selection popup's watch: a mouse-up that ends a selection, the
    // dispatch table that dismisses the button, and the press that writes the
    // quoted block into the composer draft.
    'smkit: selection-quote/preview',
    // The code outline's watch: one document observer for previews, the toggle
    // it hangs in each header, and the panel it opens on demand.
    'smkit: outline/preview',
    // The tree's menu: its dictionary, then the fallback watch that draws the
    // shell's menu for the host's rows (see `features/explorer-menu`). The
    // contributions to the shell's shared menu are not here: this harness has
    // no `contextMenus` service, so they register on a host that has one.
    'smkit: explorer/menu',
    // The fold-everything button's watch: one document observer for the
    // neighbour's file windows, and the button it inserts beside each search
    // box (the shell's own seat needs no watch — see `features/explorer-collapse`).
    'smkit: explorer/collapse-all',
    // The composer's `/mcp` history: one capture-phase keydown listener, and
    // nothing drawn (see `features/input-history`).
    'smkit: input history',
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
  // The client reads no locale and no user agent: both are the host's business
  // (language comes from the shell, the notify panel's browser address from
  // the request's own user agent). The guard names those banned reads rather
  // than the whole `navigator` object, because one member is legitimate here —
  // the Clipboard API the notify panel copies a settings address with.
  assert.doesNotMatch(
    source,
    /STRINGS|translator|systemLanguage|navigator\.(language|languages|userLanguage|userAgent|platform)|settings\/language|mm_language/,
  )
  app.dispose()
})

it('seats the strip scroll buttons with the platform copy', () => {
  const app = mount(async () => response({}))
  // The strip is one row that scrolls (`platform/ui/Tabs`): the two buttons
  // that move it belong to the strip, not to the page seated in it, so their
  // names come from the platform dictionary rather than from any one page's.
  const arrows = app
    .paint()
    .nodes.filter((node) => node.props?.['data-smkit-tabs-arrow'] !== undefined)
  assert.deepEqual(
    arrows.map((node) => [node.props['data-smkit-tabs-arrow'], node.props['aria-label']]),
    [
      ['start', 'Scroll the tabs left'],
      ['end', 'Scroll the tabs right'],
    ],
    'one button per direction, in row order, each named by the platform dictionary',
  )
})

it('binds the shell copy and each panel copy, and follows locale changes', async () => {
  const calls = []
  const app = mount(async (url) => { calls.push(url); return response({}) })
  // The merged shell reads its label and tab names from its own namespace, the
  // open panel from the `mcp` one — the seat binds the shell, not the page.
  assert.match(app.paint().text, /SMKIT/)
  assert.match(app.paint().text, /MCP servers/)
  app.effects()
  await settle()
  app.setLocale('zh')
  assert.match(app.paint().text, /MCP 服务器/)
  // The section's own name is the product name in both languages.
  assert.match(app.paint().text, /SMKIT/)
  assert.equal(calls.filter((url) => url.endsWith('/settings')).length, 1)
  assert.ok(calls.every((url) => !url.includes('/settings/language')))
  // The tabs are the three pages, and the panel swaps with the selected one.
  // Each panel polls when it mounts, so a tab switch is followed by the pass
  // that runs the newly mounted panel's effects.
  app.setLocale('en')
  app.clickTab('Skills')
  app.effects()
  await settle()
  assert.match(app.paint().text, /Skills/)
  app.clickTab('Custom settings')
  app.effects()
  await settle()
  assert.match(app.paint().text, /Model retry/)
})

it('renders English list, add form, and stdio fields', async () => {
  const app = mount(async () => response({}))
  assert.match(app.paint().text, /MCP servers/)
  app.click((node) => node.props['aria-label'] === 'Add MCP server')
  const form = app.openForm()
  assert.match(form.text, /Authentication method/)
  assert.match(form.text, /Headers from environment variables/)
  app.click(
    (node) => node.type === 'select' && node.props.value === 'http',
    (node) => node.props.onChange({ target: { value: 'stdio' } }),
  )
  assert.match(app.renderForm().text, /Command \(executable\)/)
  assert.match(app.renderForm().text, /Environment variables/)
})

it('opens the Advanced sub-view and posts the tool-call timeout', async () => {
  const calls = []
  const app = mount(async (url, options) => {
    calls.push({ url: String(url), body: options?.body })
    return String(url).endsWith('/settings')
      ? response({ onDemandToolInjection: false, toolCallTimeoutMs: 60_000 })
      : response({ toolCallTimeoutMs: 120_000 })
  })
  app.effects()
  await settle()

  app.click((node) => node.type === 'button' && node.children.includes('Advanced'))
  // The sub-view's form is seeded from the value the poll reported.
  const form = app.openForm('ToolTimeoutForm')
  assert.equal(form.node.props.current, 60_000)

  app.click(
    (node) => node.props['aria-label'] === 'Tool call timeout (ms)',
    (node) => node.props.onChange({ target: { value: '120000' } }),
  )
  app.click((node) => node.type === 'button' && node.children.includes('Save'))
  await settle()

  const written = calls.find((call) => call.url.endsWith('/settings/tool-timeout'))
  assert.ok(written, 'the form must post its draft to the settings route')
  assert.deepEqual(JSON.parse(written.body), { timeoutMs: 120_000 })
})

it('posts the reconnect settings, and nulls every field to restore their defaults', async () => {
  const calls = []
  const app = mount(async (url, options) => {
    calls.push({ url: String(url), body: options?.body })
    return String(url).endsWith('/settings')
      ? response({
          onDemandToolInjection: false,
          toolCallTimeoutMs: 60_000,
          autoReconnect: true,
          reconnectMaxAttempts: -1,
          reconnectMaxDelayMs: 30_000,
          healthCheckIntervalMs: 30_000,
        })
      : response({ autoReconnect: true, reconnectMaxAttempts: 5, reconnectMaxDelayMs: 30_000, healthCheckIntervalMs: 0 })
  })
  app.effects()
  await settle()

  app.click((node) => node.type === 'button' && node.children.includes('Advanced'))
  // The Advanced sub-view's first form is the reconnect block, seeded from the
  // values the poll reported.
  const form = app.openForm('ReconnectForm')
  assert.equal(form.node.props.current.autoReconnect, true)
  assert.equal(form.node.props.current.reconnectMaxAttempts, -1)
  assert.equal(form.node.props.current.healthCheckIntervalMs, 30_000)

  app.click(
    (node) => node.props['aria-label'] === 'Max reconnect attempts',
    (node) => node.props.onChange({ target: { value: '5' } }),
  )
  app.click(
    (node) => node.props['aria-label'] === 'Health check interval (ms)',
    (node) => node.props.onChange({ target: { value: '0' } }),
  )
  app.click((node) => node.type === 'button' && node.children.includes('Save'))
  await settle()

  const written = calls.filter((call) => call.url.endsWith('/settings/reconnect')).pop()
  assert.ok(written, 'the form must post to the reconnect route')
  assert.deepEqual(JSON.parse(written.body), {
    autoReconnect: true,
    reconnectMaxAttempts: 5,
    reconnectMaxDelayMs: 30_000,
    healthCheckIntervalMs: 0,
  })

  // "Restore default" clears every stored value: one null per field.
  app.click((node) => node.type === 'button' && node.children.includes('Restore default'))
  await settle()
  const restored = calls.filter((call) => call.url.endsWith('/settings/reconnect')).pop()
  assert.deepEqual(JSON.parse(restored.body), {
    autoReconnect: null,
    reconnectMaxAttempts: null,
    reconnectMaxDelayMs: null,
    healthCheckIntervalMs: null,
  })
})

it('offers a no-auth HTTP mode and hides the token field when selected', async () => {
  const app = mount(async () => response({}))
  app.click((node) => node.props['aria-label'] === 'Add MCP server')
  const form = app.openForm()

  const selectWithValue = (value) =>
    app.renderForm().nodes.find((node) => node.type === 'select' && node.props.value === value)
  const authSelect = selectWithValue('oauth')
  assert.ok(authSelect, 'the authentication-method select renders')
  assert.deepEqual(authSelect.children.map((option) => option.props.value), ['oauth', 'static', 'none'])
  assert.match(app.renderForm().text, /No auth \(server needs no credentials\)/)
  assert.doesNotMatch(app.renderForm().text, /Bearer token environment variable/)

  // Static still asks for the env var name...
  authSelect.props.onChange({ target: { value: 'static' } })
  assert.match(app.renderForm().text, /Bearer token environment variable/)

  // ...while no-auth hides the credential field entirely.
  selectWithValue('static').props.onChange({ target: { value: 'none' } })
  const none = app.renderForm()
  assert.match(none.text, /No auth \(server needs no credentials\)/)
  assert.doesNotMatch(none.text, /Bearer token environment variable/)
})
