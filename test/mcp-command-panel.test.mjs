/**
 * The `/mcp` picker: what it lists, how it groups, and what a pick submits.
 *
 * The panel is the client half of the host command, so what is worth pinning is
 * the scope and the command line rather than any markup:
 *
 * - the session's own workspace servers come first, then the global ones it
 *   does not exclude; another workspace's servers and a disconnected server
 *   never appear;
 * - every tool row completes `/mcp help <public name>`, and every tool also gets
 *   a call row whose line starts from that call's minimum: bare with a trailing
 *   space when nothing is required, a placeholder JSON object when something is;
 * - a help pick submits that line through the session binding; a call pick only
 *   writes it into the composer, because the optional arguments are the
 *   reader's to fill in;
 * - a host with no command UI gets no decoration at all.
 *
 * The bundle runs in a VM with the hooks it asks for; nothing is rendered.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** One wire answer the panel reads. */
function response(body) {
  return { ok: true, status: 200, json: async () => body }
}

/** The two views the panel reads, shaped like `/smkit/api/*` answers. */
const SERVERS = {
  servers: [
    {
      id: '1',
      name: 'context7',
      type: 'http',
      enabled: true,
      status: 'connected',
      toolCount: 1,
      tools: [{
        name: 'resolve-library-id',
        publicName: 'mcp__context7__resolve-library-id',
        description: 'Resolves a package/product name to a Context7 library ID',
        parameters: { properties: { libraryName: { type: 'string' } }, required: ['libraryName'] },
      }],
      error: '',
    },
    {
      id: '2',
      name: 'board',
      type: 'stdio',
      enabled: true,
      status: 'connected',
      toolCount: 1,
      tools: [{
        name: 'serial_list',
        publicName: 'mcp__board__serial_list',
        description: 'List serial ports',
        parameters: { properties: {}, required: [] },
      }],
      error: '',
    },
    {
      id: '3',
      name: 'excluded',
      type: 'http',
      enabled: true,
      status: 'connected',
      toolCount: 1,
      tools: [{ name: 'hidden', publicName: 'mcp__excluded__hidden', description: '', parameters: {} }],
      error: '',
    },
    {
      id: '4',
      name: 'offline',
      type: 'http',
      enabled: true,
      status: 'disconnected',
      toolCount: 0,
      tools: [],
      error: '',
    },
  ],
}

const WORKSPACES = {
  workspaces: [
    {
      path: '/work/proj',
      servers: [{
        id: 'w1',
        name: 'local',
        type: 'stdio',
        authMode: '',
        source: 'workspace',
        status: 'connected',
        toolCount: 1,
        tools: [{
          name: 'ping',
          publicName: 'mcp__local__ping',
          description: 'Ping the device',
          parameters: { properties: { count: { type: 'number' } }, required: [] },
        }],
        error: '',
      }],
      exclude: ['excluded'],
      error: '',
    },
    {
      path: '/work/other',
      servers: [{
        id: 'w2',
        name: 'other',
        type: 'stdio',
        authMode: '',
        source: 'workspace',
        status: 'connected',
        toolCount: 1,
        tools: [{ name: 'do', publicName: 'mcp__other__do', description: '', parameters: {} }],
        error: '',
      }],
      exclude: [],
      error: '',
    },
  ],
}

/**
 * Mount the bundle against a hook harness.
 * @param options - `commandUi: false` mounts a host without the service,
 *   `'late'` mounts one that publishes it after the plugin (the real order);
 *   `submitted` collects the lines the picker submits.
 * @returns the decorations the bundle hung, the effect labels, and the pending
 *   injections the late case resolves by hand.
 */
function mount({ commandUi, submitted = [] } = {}) {
  const decorations = []
  const effectLabels = []
  const disposers = []
  const dictionaries = {}
  const cwdById = { s1: '/work/proj', s2: '/work/unknown' }
  let exported
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => ({ createElement: () => null })) } } },
    fetch: async (url) => {
      const path = String(url).replace('/smkit/api', '')
      if (path === '/servers') return response(SERVERS)
      if (path === '/workspaces') return response(WORKSPACES)
      return response({})
    },
    setInterval: () => 1,
    clearInterval: () => {},
    // The caret restore schedules one frame; the harness has no DOM, so it
    // resolves synchronously into the "no textarea" branch and returns.
    requestAnimationFrame: (fn) => fn(),
  })
  const services = {
    commandUi: commandUi === false || commandUi === 'late' ? undefined : {
      decorate(decoration) {
        decorations.push(decoration)
        return () => {}
      },
    },
  }
  const pending = []
  const drafts = []
  const sessions = {
    list: { getSnapshot: () => ({ byId: Object.fromEntries(Object.entries(cwdById).map(([id, cwd]) => [id, { cwd }])) }) },
    binding: (id) => ({
      session: {
        command: async (line) => { submitted.push({ id, line }) },
      },
    }),
    scope: () => ({}),
  }
  services.conversation = {
    input: {
      for: () => ({
        state: { getSnapshot: () => ({ draft: '' }) },
        setDraft: (text) => { drafts.push(text) },
      }),
    },
  }
  const deliver = (scope) => {
    services.commandUi = {
      decorate(decoration) {
        decorations.push(decoration)
        return () => {}
      },
    }
    for (const callback of pending.splice(0)) callback(scope)
  }
  exported.apply({
    effect(fn, label) {
      effectLabels.push(label)
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    locale: {
      register(ns, table) { dictionaries[ns] = table; return () => {} },
      bind: (ns) => (key) => String(dictionaries[ns]?.en?.[key] ?? key),
    },
    slots: { inject: (_name, cb) => cb(), register: () => () => {} },
    reflect: { get: (name) => services[name] },
    sessions,
    inject(deps, callback) { pending.push(callback) },
  })
  return {
    decorations,
    effectLabels,
    drafts,
    /** Publish the service the way the shell does, after the plugin mounted. */
    resolveLate() {
      deliver({
        effect(fn) { fn(); return () => {} },
        reflect: { get: (name) => services[name] },
        sessions,
      })
    },
    dispose() { for (const dispose of disposers) dispose() },
  }
}

/** The one decoration this feature hangs on the host command. */
async function decorate(commandUi) {
  const app = mount({ commandUi })
  const decoration = app.decorations.find((candidate) => candidate.name === 'mcp')
  assert.ok(decoration, 'the panel decorates the host /mcp command')
  return { app, decoration }
}

it('completes every tool with help, and a call that starts from its own minimum', async () => {
  const { decoration } = await decorate()
  assert.equal(decoration.available({ sessionId: 's1' }), true)
  const rows = await decoration.ui.options({ sessionId: 's1' }, new AbortController().signal)
  const ids = rows.map((row) => row.id)

  assert.equal(rows[0].id, '/mcp list', 'the list command leads the panel')
  assert.ok(ids.includes('/mcp help mcp__context7__resolve-library-id'))
  assert.ok(
    ids.includes('/mcp call mcp__context7__resolve-library-id {"libraryName":"…"}'),
    'a required parameter arrives as a parseable placeholder, the same shape the help sheet prints',
  )
  assert.ok(
    ids.includes('/mcp call mcp__board__serial_list '),
    'a parameterless tool gets the bare call, caret after the space',
  )
  assert.ok(ids.includes('/mcp help mcp__local__ping'))
  assert.ok(ids.includes('/mcp call mcp__local__ping '))
})

it('scopes the rows to the session workspace and the global tier it allows', async () => {
  const { decoration } = await decorate()
  const rows = await decoration.ui.options({ sessionId: 's1' }, new AbortController().signal)
  const labels = new Set(rows.map((row) => row.group?.label))
  const ids = rows.map((row) => row.id)

  assert.ok(labels.has('local'), "the session's own workspace server is listed")
  assert.ok(labels.has('context7'), 'the shared tier is listed too')
  assert.ok(!labels.has('excluded'), 'a workspace exclusion hides the global server')
  assert.ok(!labels.has('offline'), 'a disconnected server contributes no row')
  assert.ok(!ids.some((id) => id.includes('mcp__other__')), "another workspace's server never appears")
  assert.ok(
    rows.findIndex((row) => row.group?.label === 'local')
      < rows.findIndex((row) => row.group?.label === 'context7'),
    'workspace servers are grouped before the shared ones',
  )

  const unknown = await decoration.ui.options({ sessionId: 's2' }, new AbortController().signal)
  const unknownLabels = new Set(unknown.map((row) => row.group?.label))
  assert.ok(!unknownLabels.has('local'), 'a session outside the workspace sees only the shared tier')
})

it('submits the picked row through the session binding', async () => {
  const submitted = []
  const decoration = mount({ submitted }).decorations.find((candidate) => candidate.name === 'mcp')
  const rows = await decoration.ui.options({ sessionId: 's1' }, new AbortController().signal)
  const pick = rows.find((row) => row.id === '/mcp help mcp__local__ping')
  decoration.ui.onSelect(pick, { sessionId: 's1' })
  assert.deepEqual(submitted, [{ id: 's1', line: '/mcp help mcp__local__ping' }])
})

it('completes a call row instead of running it', async () => {
  const submitted = []
  const app = mount({ submitted })
  const decoration = app.decorations.find((candidate) => candidate.name === 'mcp')
  const rows = await decoration.ui.options({ sessionId: 's1' }, new AbortController().signal)
  const call = rows.find((row) => row.id.startsWith('/mcp call mcp__board__serial_list'))
  assert.ok(call, 'the parameterless tool carries a call row')

  decoration.ui.onSelect(call, { sessionId: 's1' })
  assert.deepEqual(
    app.drafts,
    ['/mcp call mcp__board__serial_list '],
    'the row writes the whole line, trailing space included, and stops there',
  )
  assert.deepEqual(submitted, [], 'nothing is executed until the reader presses Enter')
})

it('waits for a command UI service the shell publishes after the plugin', () => {
  const app = mount({ commandUi: 'late' })
  assert.equal(app.decorations.length, 0, 'nothing is hung before the service exists')
  app.resolveLate()
  assert.equal(app.decorations.length, 1, 'the late service still gets the very same decoration')
  assert.equal(app.decorations[0].name, 'mcp')
})

it('stands down on a host without the command UI service', () => {
  const app = mount({ commandUi: false })
  assert.equal(app.decorations.length, 0, 'no service, no decoration — the command keeps working from the keyboard')
  assert.ok(app.effectLabels.includes('smkit: mcp/command panel'))
})
