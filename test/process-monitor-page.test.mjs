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
    { pid: 5100, ppid: 4321, name: 'cmd.exe', cmdline: 'cmd /c npx srv.js', kind: 'mcp', mcpServer: 'srv', cpuPct: 0.2, memBytes: 32 * 1024 * 1024, cpuMs: 12_000 },
    { pid: 5101, ppid: 5100, name: 'node.exe', cmdline: 'node srv.js', kind: 'mcp', mcpServer: 'srv', cpuPct: 1.3, memBytes: 210 * 1024 * 1024, cpuMs: 48_000 },
    { pid: 5200, ppid: 4321, name: 'git.exe', cmdline: 'git status', kind: 'other', cpuPct: null, memBytes: 12 * 1024 * 1024, cpuMs: 300 },
  ],
  totals: { cpuPct: 2, memBytes: 766 * 1024 * 1024, count: 4 },
  app: null,
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
  const layoutCalls = []
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
    // The layout service the More-menu row reaches through reflection.
    reflect: {
      get: (name) => (name === 'layout' ? { selectPanel: (id) => layoutCalls.push(id) } : undefined),
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

  return { registrations, seat, render, runEffects, translate, intervals, clears, fetches, dictionaries, layoutCalls }
}

const sampleFetch = () => async (path) => {
  if (path === '/process-monitor/sample') return response(SAMPLE)
  return response({})
}

it('seats the page in the main column and one row in the More menu — no rail icon', () => {
  const app = mount(sampleFetch())
  const main = app.seat('main', 'smkit-process-monitor')
  const menuRow = app.seat('sidebar.panellist.actions', 'smkit-process-monitor')
  assert.equal(main.options.locale, 'process-monitor')
  assert.ok(menuRow, 'the More-menu content seat holds the entry')
  assert.equal(menuRow.options.locale, 'process-monitor')
  assert.equal(typeof menuRow.component, 'function')
  assert.equal(app.seat('sidebar.panellist', 'smkit-process-monitor'), undefined, 'no launcher-strip icon of its own')
})

it('the More-menu row dismisses the menu and switches the panel on select', () => {
  const app = mount(sampleFetch())
  const menuRow = app.seat('sidebar.panellist.actions', 'smkit-process-monitor')
  const dismissed = []
  // Rendered directly: no hooks, and the plain-button fallback (the harness
  // has no MenuItemButton) is exactly the path this asserts.
  const node = menuRow.component({ t: app.translate, onDismiss: () => dismissed.push(true) })
  assert.equal(String(node.props.className), 'smkit-pm-page-menurow')
  assert.match(JSON.stringify(node), /Processes/, 'the row is named by the feature dictionary')
  node.props.onClick()
  assert.deepEqual(dismissed, [true], 'the menu closes on selection')
  assert.deepEqual(app.layoutCalls, ['smkit-process-monitor'], 'selectPanel switches to the page key')
})

it('carries the same key set in both dictionaries', () => {
  const app = mount(sampleFetch())
  const table = app.dictionaries['process-monitor']
  assert.ok(table?.zh && table?.en, 'the namespace is registered with both halves')
  assert.deepEqual(Object.keys(table.zh).sort(), Object.keys(table.en).sort())
})

it('paints the summary cards, the tree and every column of one sample', async () => {
  const app = mount(sampleFetch())
  app.render()
  app.runEffects()
  await settle()

  const { nodes, text } = app.render()
  assert.match(text, /Process resources/)
  assert.match(text, /Live/, 'the header carries the sampling pulse badge')
  assert.match(text, /4 processes · 1 s\/sample · 8-core normalized/, 'the meta line carries count and cadence')
  assert.doesNotMatch(text, /Subtree CPU mix/, 'the composition card is gone; the KPI cards are the overview band')
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

  // The tree: the host, then its children by CPU desc (cmd before the idle
  // git), and the server indented one level deeper under the wrapper.
  const cells = (className) =>
    nodes.filter((node) => String(node.props?.className) === className)
  assert.deepEqual(
    cells('smkit-pm-page-pid').map((node) => node.children[0]),
    [4321, 5100, 5101, 5200],
  )
  assert.deepEqual(
    cells('smkit-pm-page-name').map((node) => node.props.style?.paddingLeft),
    ['0px', '14px', '28px', '14px'],
    'one indent step per ppid hop',
  )
  assert.equal(
    nodes.filter((node) => node.type === 'button' && String(node.props?.className) === 'smkit-pm-page-twist').length,
    2,
    'only the two rows with children are expandable',
  )

  // One read per render cycle: the poll, and nothing else.
  assert.deepEqual(app.fetches.filter((path) => path === '/process-monitor/sample').length, 1)
  // The meter's own footprint is disclosed under the table, not hidden.
  assert.match(text, /sampler costs a further\s+0\.5% · 96 MB\s+\(2 processes, not counted above\)/)
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

it('collapses a process subtree by its twisty, leaving the rest of the tree', async () => {
  const app = mount(sampleFetch())
  app.render()
  app.runEffects()
  await settle()

  const twisty = app
    .render()
    .nodes.find((node) => node.type === 'button' && String(node.props?.className) === 'smkit-pm-page-twist')
  assert.ok(twisty, 'the host row can be expanded and collapsed')

  twisty.props.onClick()
  await settle()
  const collapsed = app.render()
  const pids = collapsed.nodes
    .filter((node) => String(node.props?.className) === 'smkit-pm-page-pid')
    .map((node) => node.children[0])
  assert.deepEqual(pids, [4321], 'collapsing the host takes its whole branch with it')
  assert.match(collapsed.text, /dsh main/, 'the collapsed row itself stays')
  assert.match(
    collapsed.text,
    /4 processes · 1 s\/sample/,
    'the header keeps counting what was sampled, not what the fold left visible',
  )
})

it('joins the application group into the same tree and keeps the reconciliation line', async () => {
  const withApp = async (path) => {
    if (path !== '/process-monitor/sample') return response({})
    return response({
      ...SAMPLE,
      app: {
        rootPid: 100,
        rootName: 'node.exe',
        entries: [
          // The GUI main process (the host's parent) and the renderer drawing
          // this page: same tree, different scope.
          { pid: 100, ppid: 5, name: 'node.exe', cmdline: 'dsh --app-main', kind: 'app', cpuPct: 0.1, memBytes: 40 * 1024 * 1024, cpuMs: 4_000 },
          { pid: 4300, ppid: 100, name: 'node.exe', cmdline: 'dsh --type=renderer', kind: 'app', cpuPct: 1.5, memBytes: 300 * 1024 * 1024, cpuMs: 9_000 },
        ],
        totals: { cpuPct: 2.6, memBytes: 1_066 * 1024 * 1024, count: 5 },
      },
    })
  }
  const app = mount(withApp)
  app.render()
  app.runEffects()
  await settle()

  const { nodes, text } = app.render()
  // One tree: the app root on top, the host and the renderer below it, the MCP
  // wrapper one hop further down — no separate group card.
  const pids = nodes
    .filter((node) => String(node.props?.className) === 'smkit-pm-page-pid')
    .map((node) => node.children[0])
  assert.deepEqual(pids, [100, 4300, 4321, 5100, 5101, 5200])
  const indents = nodes
    .filter((node) => String(node.props?.className) === 'smkit-pm-page-name')
    .map((node) => node.props.style?.paddingLeft)
  assert.deepEqual(indents, ['0px', '14px', '14px', '28px', '42px', '28px'])
  assert.doesNotMatch(text, /Application processes/, 'the scope is the tree, not a separate card')

  // The reconciliation line keeps naming scope, numbers and the memory metric.
  assert.match(text, /Whole application \(GUI included\)/)
  assert.match(text, /5 processes · 2\.6% · 1\.0 GB/, 'the app count includes the host the subtree already counts')
  assert.match(text, /Task Manager/)
  // The dsh totals are untouched by the app group.
  assert.match(text, /766 MB/)
  assert.match(text, /6 processes · 1 s\/sample/, 'the header counts the rows on screen')
})

it('prints the dedicated working set and keeps the working set one hover away', async () => {
  const withPrivate = async (path) => {
    if (path !== '/process-monitor/sample') return response({})
    return response({
      ...SAMPLE,
      entries: [
        { ...SAMPLE.entries[0], memBytes: 512 * 1024 * 1024, memPrivateBytes: 300 * 1024 * 1024 },
        ...SAMPLE.entries.slice(1),
      ],
      totals: { ...SAMPLE.totals, memBytes: 766 * 1024 * 1024, memPrivateBytes: 500 * 1024 * 1024 },
    })
  }
  const app = mount(withPrivate)
  app.render()
  app.runEffects()
  await settle()

  const { text, nodes } = app.render()
  assert.match(text, /500 MB/, 'the dsh total card prints the dedicated sum, the figure Task Manager shows')
  assert.match(text, /300 MB/, 'so does the host card')
  const titled = nodes.filter(
    (node) => String(node.props?.className) === 'smkit-pm-page-mem' && node.props?.title !== undefined,
  )
  assert.ok(
    titled.some((node) => /Working set 512 MB/.test(String(node.props.title))),
    'the working set stays available on the memory cell',
  )
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
