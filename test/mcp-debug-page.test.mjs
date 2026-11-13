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
function mount(handler) {
  const dictionaries = {}
  const registrations = []
  const effects = []
  const calls = []
  const states = new Map()
  let hookIndex = 0
  let exported

  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial) => {
      const key = hookIndex++
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
        registrations.push({ options, component })
        return () => {}
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
        hookIndex = 0
        walk(node.type(node.props))
        hookIndex = saved
        return
      }
      for (const child of node.children ?? []) walk(child)
    }
    hookIndex = 0
    walk(page({ t: translate }))
    return { nodes, text: text.join(' ') }
  }

  const page = seat('main', 'smkit-mcp-debug')?.component
  assert.ok(page, 'the feature must seat its page in the main column')
  return { registrations, seat, render, translate, effects, calls, dictionaries }
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

it('refuses a missing required parameter without talking to the host', async () => {
  const app = mount(stubFetch())
  app.render()
  for (const effect of app.effects) effect()
  await settle()

  const row = app.render().nodes.find((node) => String(node.props?.className).includes('smkit-mcpdebug-tools-row'))
  row.props.onClick()
  await settle()

  const run = app.render().nodes.find(
    (node) => node.type === 'button' && String(node.props?.className).includes('smkit-mcpdebug-detail-run'),
  )
  run.props.onClick()
  await settle()

  assert.equal(
    app.calls.filter((entry) => entry.path === '/debug/call').length,
    0,
    'a required parameter left empty must not reach the host',
  )
  const after = app.render()
  assert.match(after.text, /Not sent/, 'the pane says the page refused, not the server')
  assert.match(after.text, /"text" is required/)
})

it('keeps a not-connected server selected and says why it has no tools', async () => {
  const app = mount(async (path) => {
    if (path === '/servers') return response(ONE_SERVER)
    if (path === '/workspaces') return response(DORMANT_WORKSPACES)
    if (path.startsWith('/debug/notifications')) return response({ notifications: [] })
    return response({})
  })
  app.render()
  for (const effect of app.effects) effect()
  await settle()

  const rows = () =>
    app.render().nodes.filter((node) => String(node.props?.className ?? '').includes('smkit-mcpdebug-servers-row'))
  const dormant = rows().find((row) => flatten(row).includes('dormant'))
  assert.ok(dormant, 'the dormant workspace server is listed with the live one')

  dormant.props.onClick()
  await settle()

  const after = app.render()
  const picked = after.nodes.find(
    (node) => String(node.props?.className ?? '').includes('smkit-mcpdebug-servers-row') && flatten(node).includes('dormant'),
  )
  assert.equal(picked.props['data-smkit-active'], 'true', 'the clicked row stays selected')
  assert.equal(
    after.nodes.filter(
      (node) =>
        String(node.props?.className ?? '').includes('smkit-mcpdebug-servers-row') &&
        flatten(node).includes('stub') &&
        node.props['data-smkit-active'] === 'true',
    ).length,
    0,
    'the live server is no longer the selected one',
  )
  assert.match(after.text, /This server is not connected/, 'the page names the reason instead of listing nothing')
  assert.equal(
    after.nodes.filter((node) => String(node.props?.className ?? '').includes('smkit-mcpdebug-tools-row')).length,
    0,
    'a server with no transport offers no tools to run',
  )
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
