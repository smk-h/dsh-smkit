/**
 * The process monitor page's browser half: what it seats, what one sample
 * paints, and — the load-bearing part — what stops when the page goes away.
 *
 * The bundle runs in a VM with a hook harness and a stubbed `fetch`, the same
 * rig the debug page's suite uses; nothing is rendered and no DOM exists
 * (which is itself part of what the first case pins: the page must mount
 * without one). The interval stubs here *record*, because the feature's whole
 * promise is "one read per second while the page is open, nothing once it is
 * not": the unmount case asserts the cleanup the shell runs on a panel switch
 * really clears that clock.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** One full sample: the host, one MCP server (wrapper + child), one other. */
const SAMPLE = {
  sampledAt: 1_730_000_000_000,
  intervalMs: 1_000,
  platform: 'win32',
  hostPid: 4321,
  cores: 8,
  entries: [
    { pid: 4321, ppid: 100, name: 'node.exe', cmdline: 'dsh main', kind: 'host', cpuPct: 0.5, memBytes: 512 * 1024 * 1024, cpuMs: 74_000 },
    { pid: 5100, ppid: 4321, name: 'cmd.exe', cmdline: 'cmd /c npx srv.js', kind: 'mcp', mcpServerId: 'srv', cpuPct: 0.2, memBytes: 32 * 1024 * 1024, cpuMs: 12_000 },
    { pid: 5101, ppid: 5100, name: 'node.exe', cmdline: 'node srv.js', kind: 'mcp', mcpServerId: 'srv', cpuPct: 1.3, memBytes: 210 * 1024 * 1024, cpuMs: 48_000 },
    { pid: 5200, ppid: 4321, name: 'git.exe', cmdline: 'git status', kind: 'other', cpuPct: null, memBytes: 12 * 1024 * 1024, cpuMs: 300 },
  ],
  totals: { cpuPct: 2, memBytes: 766 * 1024 * 1024, count: 4 },
  meter: { cpuPct: 0.5, memBytes: 96 * 1024 * 1024, count: 2 },
}

/**
 * Mount the bundle and hand back the page component, its seats, a renderer
 * that keeps hook state across passes, and the interval ledger.
 */
function mount(handler) {
  const dictionaries = {}
  const registrations = []
  const effects = []
  const states = new Map()
  const intervals = []
  const clears = []
  const fetches = []
  /* Hooks are keyed by the component that owns them, the way React keys them
   * by position. */
  let hookIndex = 0
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
      fetches.push(path)
      return handler(path, options)
    },
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms })
      return 1000 + intervals.length
    },
    clearInterval: (id) => {
      clears.push(id)
    },
    setTimeout: () => 1,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
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
    const raw = dictionaries['process-monitor']?.en?.[key] ?? key
    return String(raw).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match))
  }

  const seat = (name, key) =>
    registrations.find(
      (entry) =>
        entry.options?.name === name &&
        (key === undefined || entry.options.key === key || entry.options.id === key),
    )

  /** Render the page, walking every node and collecting text. */
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
    hookPath = 'ProcessMonitorPage'
    const page = seat('main', 'smkit-process-monitor')?.component
    assert.ok(page, 'the feature must seat its page in the main column')
    walk(page({ t: translate }))
    return { nodes, text: text.join(' ') }
  }

  /** Run the effects one render collected, keeping their cleanups. */
  const runEffects = () => {
    const cleanups = []
    for (const effect of effects.splice(0)) cleanups.push(effect())
    return cleanups
  }

  return { registrations, seat, render, runEffects, translate, intervals, clears, fetches, dictionaries }
}

const sampleFetch = () => async (path) => {
  if (path === '/process-monitor/sample') return response(SAMPLE)
  return response({})
}

it('seats one page and the rail entry that opens it, under one id', () => {
  const app = mount(sampleFetch())
  const main = app.seat('main', 'smkit-process-monitor')
  const rail = app.seat('sidebar.panellist', 'smkit-process-monitor')
  assert.equal(main.options.locale, 'process-monitor')
  assert.equal(rail.options.locale, 'process-monitor')
  assert.equal(rail.options.order, 41, 'right after the debug page in the rail')
  assert.equal(typeof rail.options.label, 'function')
  assert.equal(rail.options.label(), 'Processes')
  assert.equal(typeof rail.component, 'function', 'the rail draws the glyph, not a label')
})

it('carries the same key set in both dictionaries', () => {
  const app = mount(sampleFetch())
  const table = app.dictionaries['process-monitor']
  assert.ok(table?.zh && table?.en, 'the namespace is registered with both halves')
  assert.deepEqual(Object.keys(table.zh).sort(), Object.keys(table.en).sort())
})

it('paints the summary cards, the groups and every column of one sample', async () => {
  const app = mount(sampleFetch())
  app.render()
  app.runEffects()
  await settle()

  const { text } = app.render()
  assert.match(text, /Process resources/)
  assert.match(text, /4 processes/, 'the count comes from the totals')
  assert.match(text, /Host process/)
  assert.match(text, /MCP servers/)
  assert.match(text, /Other children/)
  // Cards: subtree totals and the host's own numbers.
  assert.match(text, /766 MB/)
  assert.match(text, /512 MB/)
  // Rows: names, the inherited mcp tag, a percentage and the null dash.
  assert.match(text, /cmd\.exe/)
  assert.match(text, /mcp:srv/)
  assert.match(text, /1\.3%/)
  assert.match(text, /—/, 'the first-window null prints a dash, not 0.0%')
  // Human totals: 74000 ms of CPU reads as a minute split, not raw ms.
  assert.match(text, /1m14s/)
  assert.match(text, /git status/, 'the command line column carries the row it explains')
  // One read per render cycle: the poll, and nothing else.
  assert.deepEqual(app.fetches.filter((path) => path === '/process-monitor/sample').length, 1)
  // The meter's own footprint is disclosed under the table, not hidden.
  assert.match(text, /sampler costs a further 0\.5% · 96 MB \(2 processes, not counted above\)/)
})

it('polls once per second while mounted and clears the clock on unmount', async () => {
  const app = mount(sampleFetch())
  app.render()
  const cleanups = app.runEffects()
  await settle()

  assert.equal(app.intervals.length, 1, 'exactly one interval per mount')
  assert.equal(app.intervals[0].ms, 1_000, 'the cadence comes from the shared contract')
  assert.deepEqual(app.clears, [], 'nothing is cleared while the page lives')

  // The shell unmounts a switched-away panel: the effect cleanups run.
  for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
  assert.ok(app.clears.includes(app.intervals[0] ? 1000 + 1 : -1), 'the poll clock is the thing that got cleared')
})

it('collapses a group by its header without losing the others', async () => {
  const app = mount(sampleFetch())
  app.render()
  app.runEffects()
  await settle()

  const head = app
    .render()
    .nodes.find(
      (node) =>
        node.type === 'button' && String(node.props?.className).includes('smkit-pm-page-group-head'),
    )
  assert.ok(head, 'a group renders a clickable header')

  // Group order is stable, so the first header is the host group; toggle it.
  head.props.onClick()
  await settle()
  const collapsed = app.render()
  assert.doesNotMatch(collapsed.text, /dsh main/, 'the collapsed group hides its rows')
  assert.match(collapsed.text, /MCP servers/, 'the other groups stay')
  assert.match(collapsed.text, /cmd\.exe/)
})

it('shows the warming line while the sampler starts, with no table', async () => {
  const warm = async (path) => {
    if (path === '/process-monitor/sample') {
      return response({
        ...SAMPLE,
        warmingUp: true,
        entries: [],
        totals: { cpuPct: 0, memBytes: 0, count: 0 },
        meter: null,
      })
    }
    return response({})
  }
  const app = mount(warm)
  app.render()
  app.runEffects()
  await settle()

  const { text } = app.render()
  assert.match(text, /sampler is starting/)
  assert.doesNotMatch(text, /node\.exe/, 'no rows are invented before data exists')
  assert.doesNotMatch(text, /sampler costs a further/, 'no footprint line before a frame exists')
})
