/**
 * The debug page's browser half: what it seats, and what a call sends.
 *
 * Two things are worth pinning here, and neither is markup:
 *
 * - the pair of seats. A `main` page nobody can open, or a rail entry whose id
 *   names no `main` key, is a dead page that still looks wired up — so the two
 *   ids are asserted against each other, and against the label the rail shows.
 * - the request the run button makes. The page is the only place that turns a
 *   form (string values) into an `arguments` object, and the host re-sends what
 *   it is handed; a coercion bug here is a silently different tool call, which
 *   is exactly what a debug surface must not do.
 *
 * The bundle runs in a VM with a hook harness and a stubbed `fetch`; nothing is
 * rendered, and no DOM exists.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const ONE_SERVER = {
  servers: [
    {
      id: 'srv-1',
      name: 'stub',
      type: 'stdio',
      enabled: true,
      status: 'connected',
      toolCount: 1,
      serverInfo: { name: 'debug-stub', version: '9.9.9' },
      tools: [
        {
          name: 'echo',
          publicName: 'mcp__stub__echo',
          description: 'Echo the text back',
          parameters: {
            properties: {
              text: { type: 'string' },
              count: { type: 'number' },
              mode: { type: 'string', enum: ['fast', 'slow'] },
            },
            required: ['text'],
          },
        },
      ],
      error: '',
      command: 'node',
      args: ['stub.js'],
    },
  ],
}

const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** Every string under one node, flattened — how a case finds a row by its name. */
function flatten(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return (node.children ?? []).map(flatten).join(' ')
}

/** One workspace whose own server is configured but not connected. */
const DORMANT_WORKSPACES = {
  workspaces: [
    {
      path: '/proj/dormant',
      exclude: [],
      error: '',
      servers: [
        {
          id: 'ws-dormant',
          name: 'dormant',
          type: 'http',
          authMode: 'none',
          source: 'workspace',
          status: 'configured',
          toolCount: 0,
          tools: [],
          error: '',
        },
      ],
    },
  ],
}

/**
 * Mount the bundle and hand back the one page component, its seats, and a
 * renderer that keeps hook state across passes.
 */
function mount(handler, options = {}) {
  const dictionaries = {}
  const storage = new Map()
  // The seats are opt-in: a browser whose mirror was never written seats
  // nothing. Cases that need the page seed the mirror, `debugPage: false` seeds
  // it the other way, and `noCache: true` leaves storage untouched on purpose.
  if (options.noCache !== true) {
    storage.set('smkit.mcp-debug.enabled', options.debugPage === false ? 'false' : 'true')
  }
  const registrations = []
  const effects = []
  const calls = []
  const states = new Map()
  let hookIndex = 0
  /* Hooks are keyed by the component that owns them, the way React keys them by
   * position: the page and the settings section are separate roots here, and a
   * bare index would let one component read the other's state. */
  let hookPath = 'root'
  let exported

  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial) => {
      const key = `${hookPath}#${hookIndex++}`
      if (!states.has(key)) states.set(key, typeof initial === 'function' ? initial() : initial)
      return [
        states.get(key),
        (value) => {
          states.set(key, typeof value === 'function' ? value(states.get(key)) : value)
        },
      ]
    },
    useEffect: (effect) => {
      effects.push(effect)
    },
    useCallback: (callback) => callback,
  }

  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react) } } },
    fetch: async (url, options) => {
      const path = String(url).replace('/smkit/api', '')
      if (options?.body !== undefined) calls.push({ path, body: JSON.parse(options.body) })
      return handler(path, options)
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, String(value))
      },
      removeItem: (key) => {
        storage.delete(key)
      },
    },
  })

  exported.apply({
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') registrations.push({ dispose })
    },
    locale: {
      register(namespace, table) {
        dictionaries[namespace] = table
        return () => {}
      },
      bind: (namespace) => (key, values = {}) => {
        const tables = dictionaries[namespace] ?? {}
        const raw = tables.en?.[key] ?? key
        return String(raw).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match))
      },
    },
    slots: {
      inject: (_name, setup) => setup(),
      register: (options, component) => {
        const entry = { options, component }
        registrations.push(entry)
        return () => {
          const index = registrations.indexOf(entry)
          if (index >= 0) registrations.splice(index, 1)
        }
      },
    },
  })

  const translate = (key, values = {}) => {
    const raw = dictionaries['mcp-debug']?.en?.[key] ?? key
    return String(raw).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match))
  }

  const seat = (name, key) =>
    registrations.find(
      (entry) =>
        entry.options?.name === name &&
        (key === undefined || entry.options.key === key || entry.options.id === key),
    )

  /** Render the page, walking every component and collecting text and nodes. */
  const render = () => {
    const nodes = []
    const text = []
    const walk = (node) => {
      if (node === null || node === undefined) return
      if (typeof node === 'string' || typeof node === 'number') {
        text.push(String(node))
        return
      }
      nodes.push(node)
      if (typeof node.type === 'function') {
        const saved = hookIndex
        const savedPath = hookPath
        hookIndex = 0
        hookPath = node.type.name || 'anon'
        walk(node.type(node.props))
        hookIndex = saved
        hookPath = savedPath
        return
      }
      for (const child of node.children ?? []) walk(child)
    }
    hookIndex = 0
    hookPath = 'McpDebugPage'
    walk(page({ t: translate }))
    return { nodes, text: text.join(' ') }
  }

  const page = seat('main', 'smkit-mcp-debug')?.component
  // A profile whose cache says "off" — or says nothing at all — seats nothing,
  // which is the point of those cases; every other case needs the page.
  const expectsPage = options.noCache !== true && options.debugPage !== false
  if (expectsPage) assert.ok(page, 'the feature must seat its page in the main column')
  /** Render the merged settings section, the way the shell does. */
  const renderSection = () => {
    const section = registrations.find((entry) => entry.options?.name === 'settings.section')
    assert.ok(section, 'the settings section is seated')
    const nodes = []
    const text = []
    const walk = (node) => {
      if (node === null || node === undefined) return
      if (typeof node === 'string' || typeof node === 'number') {
        text.push(String(node))
        return
      }
      nodes.push(node)
      if (typeof node.type === 'function') {
        const saved = hookIndex
        const savedPath = hookPath
        hookIndex = 0
        hookPath = node.type.name || 'anon'
        walk(node.type(node.props))
        hookIndex = saved
        hookPath = savedPath
        return
      }
      for (const child of node.children ?? []) walk(child)
    }
    hookIndex = 0
    hookPath = 'SettingsSection'
    walk(section.component({}))
    return { nodes, text: text.join(' ') }
  }

  return { registrations, seat, render, renderSection, translate, effects, calls, dictionaries, storage }
}

/** A stub that answers the three GETs and records the call. */
function stubFetch(answer = { content: [{ type: 'text', text: 'echo:hi' }] }) {
  return async (path) => {
    if (path === '/servers') return response(ONE_SERVER)
    if (path === '/workspaces') return response({ workspaces: [] })
    if (path.startsWith('/debug/notifications')) return response({ notifications: [] })
    if (path === '/debug/call') return response({ ok: true, durationMs: 3, result: answer })
    return response({})
  }
}

it('seats one page and the rail entry that opens it, under one id', () => {
  const app = mount(stubFetch())
  const main = app.seat('main', 'smkit-mcp-debug')
  const rail = app.seat('sidebar.panellist', 'smkit-mcp-debug')
  assert.equal(main.options.locale, 'mcp-debug')
  assert.equal(rail.options.locale, 'mcp-debug')
  assert.equal(typeof rail.options.label, 'function')
  assert.equal(rail.options.label(), 'MCP debug', 'the rail entry is named by the feature dictionary')
  assert.equal(
    typeof rail.component,
    'function',
    'the rail draws the glyph, not a label: its component is the icon',
  )
})

it('lists the connected server, its tools, and the server identity', async () => {
  const app = mount(stubFetch())
  app.render()
  for (const effect of app.effects) effect()
  await settle()
  const { text } = app.render()
  assert.match(text, /MCP debug/)
  assert.match(text, /stub/)
  assert.match(text, /echo/)
  assert.match(text, /Echo the text back/)
  assert.match(text, /9\.9\.9/, 'the handshake version reaches the rail')
})

it('sends the form as one arguments object and renders the answer', async () => {
  const app = mount(stubFetch())
  app.render()
  for (const effect of app.effects) effect()
  await settle()

  // Pick the tool from the middle column.
  const row = app.render().nodes.find((node) => String(node.props?.className).includes('smkit-mcpdebug-tools-row'))
  assert.ok(row, 'the tool list must draw a row')
  row.props.onClick()
  await settle()

  // The form has one control per declared parameter.
  const textField = app.render().nodes.find((node) => node.type === 'input' && node.props['aria-label'] === 'text')
  assert.ok(textField, 'the required string parameter renders an input')
  textField.props.onChange({ target: { value: 'hi' } })

  const run = app.render().nodes.find(
    (node) => node.type === 'button' && String(node.props?.className).includes('smkit-mcpdebug-detail-run'),
  )
  assert.ok(run, 'the run button must render')
  run.props.onClick()
  await settle()

  const call = app.calls.find((entry) => entry.path === '/debug/call')
  assert.ok(call, 'the run button must post to the call route')
  assert.deepEqual(call.body, { id: 'srv-1', tool: 'echo', arguments: { text: 'hi' } })

  const after = app.render()
  assert.match(after.text, /echo:hi/, "the server's content block is shown as text")
  assert.match(after.text, /OK/, 'the answer is marked successful')
  assert.match(after.text, /3 ms/, 'the duration the host measured is shown')
})

it('marks an empty required parameter red instead of sending, and clears it when filled', async () => {
  const app = mount(stubFetch())
  app.render()
  for (const effect of app.effects) effect()
  await settle()

  const row = app.render().nodes.find((node) => String(node.props?.className).includes('smkit-mcpdebug-tools-row'))
  row.props.onClick()
  await settle()

  const run = () =>
    app.render().nodes.find(
      (node) => node.type === 'button' && String(node.props?.className).includes('smkit-mcpdebug-detail-run'),
    )
  const field = () =>
    app.render().nodes.find((node) => node.props?.className === 'smkit-mcpdebug-detail-field')
  const message = () =>
    app.render().nodes.find((node) => node.props?.className === 'smkit-mcpdebug-detail-field-error')

  assert.equal(field().props['data-smkit-invalid'], undefined, 'an untouched field carries no mark')
  run().props.onClick()
  await settle()

  assert.equal(
    app.calls.filter((entry) => entry.path === '/debug/call').length,
    0,
    'a required parameter left empty must not reach the host',
  )
  assert.equal(field().props['data-smkit-invalid'], 'true', 'the offending field is marked')
  assert.match(flatten(message()), /"text" is required/, 'the reason sits under the field')
  assert.match(app.render().text, /No call yet/, 'nothing was recorded as a call')

  // Typing a value clears the mark — the page drops the entry on that change.
  app.render().nodes.find((node) => node.type === 'input' && node.props['aria-label'] === 'text').props.onChange(
    { target: { value: 'hi' } },
  )
  await settle()
  assert.equal(field().props['data-smkit-invalid'], undefined, 'the mark goes away with the value')
  assert.equal(message(), undefined)
  assert.match(app.render().text, /No call yet/)

  // ...and the same button now sends.
  run().props.onClick()
  await settle()
  assert.equal(app.calls.filter((entry) => entry.path === '/debug/call').length, 1)
})

it('marks which parameter editor is in force', async () => {
  const app = mount(stubFetch())
  app.render()
  for (const effect of app.effects) effect()
  await settle()

  const row = app.render().nodes.find((node) => String(node.props?.className).includes('smkit-mcpdebug-tools-row'))
  row.props.onClick()
  await settle()

  const modes = () =>
    app.render().nodes.filter(
      (node) => node.type === 'button' && String(node.props?.className ?? '').includes('smkit-ui-button') && node.props['aria-pressed'] !== undefined,
    )
  const pressed = () => modes().filter((node) => node.props['aria-pressed'] === true).map((node) => node.props['data-smkit-active'])

  const form = modes().find((node) => flatten(node).trim() === 'Form')
  const raw = modes().find((node) => flatten(node).trim() === 'JSON')
  assert.ok(form && raw, 'both editors are offered')
  assert.equal(form.props['data-smkit-active'], 'true', 'the form is the one in force when a tool is picked')
  assert.equal(raw.props['data-smkit-active'], undefined)
  assert.deepEqual(pressed(), ['true'], 'exactly one half is marked pressed')

  raw.props.onClick()
  await settle()
  const switched = modes()
  const rawNow = switched.find((node) => flatten(node).trim() === 'JSON')
  const formNow = switched.find((node) => flatten(node).trim() === 'Form')
  assert.equal(rawNow.props['data-smkit-active'], 'true', 'the JSON half is marked instead')
  assert.equal(formNow.props['data-smkit-active'], undefined)
  assert.deepEqual(
    switched.filter((node) => node.props['aria-pressed'] === true).map((node) => flatten(node).trim()),
    ['JSON'],
  )
  const box = app.render().nodes.find((node) => node.type === 'textarea')
  assert.ok(box, 'the raw editor is a textarea')
  assert.deepEqual(JSON.parse(box.props.value), {}, 'the box is seeded from the form, which is still empty')
})

it('seats nothing in a browser whose cache says the page is off', async () => {
  const app = mount(stubFetch(), { debugPage: false })
  await settle()
  // Scoped to this page's own id: other features seat their own `main` pages
  // (the process monitor is one), and the gate only ever removes this one.
  assert.equal(
    app.registrations.filter((entry) => entry.options?.name === 'main' && entry.options?.key === 'smkit-mcp-debug').length,
    0,
    'no page',
  )
  assert.equal(
    app.registrations.filter((entry) => entry.options?.name === 'sidebar.panellist' && entry.options?.id === 'smkit-mcp-debug').length,
    0,
    'no rail entry either',
  )
  assert.equal(
    app.calls.filter((entry) => entry.path === '/settings').length,
    0,
    'the gate is answered from storage: mounting must not cost a request',
  )
})

it('seats nothing on a first install, and picks the page up when settings report it on', async () => {
  let stored = true
  const app = mount(async (path) => {
    if (path === '/settings') {
      return response({ onDemandToolInjection: false, debugPageEnabled: stored, toolCallTimeoutMs: 60_000 })
    }
    if (path === '/servers') return response({ servers: [] })
    if (path === '/workspaces') return response({ workspaces: [] })
    return response({})
  }, { noCache: true })
  await settle()
  const seats = () => ({
    main: app.registrations.filter((entry) => entry.options?.name === 'main' && entry.options?.key === 'smkit-mcp-debug').length,
    rail: app.registrations.filter((entry) => entry.options?.name === 'sidebar.panellist' && entry.options?.id === 'smkit-mcp-debug').length,
  })
  assert.deepEqual(seats(), { main: 0, rail: 0 }, 'the page is opt-in: no mirror means no seats')

  // Opening Settings → MCP polls the host, whose answer is the source of truth.
  app.renderSection()
  for (const effect of app.effects) effect()
  await settle()
  assert.deepEqual(seats(), { main: 1, rail: 1 }, 'a profile that keeps the page gets both seats back')
  assert.equal(app.storage.get('smkit.mcp-debug.enabled'), 'true', 'and the mirror is written for the next load')
})

it('takes both seats away when the settings switch is turned off, and puts them back', async () => {
  let stored = true
  const app = mount(async (path, options) => {
    if (path === '/settings/debug-page') {
      stored = JSON.parse(options.body).enabled === true
      return response({ debugPageEnabled: stored })
    }
    if (path === '/settings') {
      return response({ onDemandToolInjection: false, debugPageEnabled: stored, toolCallTimeoutMs: 60_000 })
    }
    if (path === '/servers') return response({ servers: [] })
    if (path === '/workspaces') return response({ workspaces: [] })
    return response({})
  })
  await settle()
  const seats = () => ({
    // This page's pair only — other features seat their own (the process
    // monitor is one) and the switch must not touch those.
    main: app.registrations.filter((entry) => entry.options?.name === 'main' && entry.options?.key === 'smkit-mcp-debug').length,
    rail: app.registrations.filter((entry) => entry.options?.name === 'sidebar.panellist' && entry.options?.id === 'smkit-mcp-debug').length,
  })
  assert.deepEqual(seats(), { main: 1, rail: 1 }, 'the mirror says on, so both seats are there')

  // Render the merged settings section and drive its debug-page switch. The
  // switch lives in the Advanced sub-view: the list is one scope's servers,
  // and a plugin-wide switch belongs to none of them.
  const switchFor = () =>
    app
      .renderSection()
      .nodes.find((node) => node.type === 'button' && node.props['aria-label'] === 'MCP debug page')
  app.renderSection()
  for (const effect of app.effects) effect()
  await settle()

  const advanced = app
    .renderSection()
    .nodes.find(
      (node) =>
        node.type === 'button' &&
        String(node.props?.className ?? '').includes('smkit-mcp-section-toolbar-action'),
    )
  assert.ok(advanced, 'the toolbar offers the Advanced sub-view')
  advanced.props.onClick()

  const toggle = switchFor()
  assert.ok(toggle, 'the MCP page offers the switch')
  assert.equal(toggle.props['aria-checked'], true, 'it reports the stored value')
  toggle.props.onClick()
  await settle()
  await settle()

  const written = app.calls.find((entry) => entry.path === '/settings/debug-page')
  assert.deepEqual(written?.body, { enabled: false }, 'the switch writes the stored value')
  assert.deepEqual(seats(), { main: 0, rail: 0 }, 'the page and its rail entry are gone without a restart')
  assert.equal(app.storage.get('smkit.mcp-debug.enabled'), 'false', 'and the next load reads it without a request')

  // And back on.
  const again = switchFor()
  assert.ok(again, 'the switch is still there (the settings page is not the debug page)')
  again.props.onClick()
  await settle()
  await settle()
  assert.deepEqual(seats(), { main: 1, rail: 1 }, 'turning it back on restores both')
  assert.equal(app.storage.get('smkit.mcp-debug.enabled'), 'true')
})
