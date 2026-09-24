/**
 * The model-retry tab of Settings → 自定义设置, end to end at the seam it
 * depends on.
 *
 * Two suites, one per half, each driven with stubs standing exactly where the
 * harness's own services stand:
 *
 * - the host half is mounted through the real `apply()` against a stub context
 *   carrying `llm` and `settings`, and probed over its two API routes. What
 *   matters there is that this plugin never writes a file: a save has to reach
 *   the settings seam as a *path-addressed* edit of the owning route's profile,
 *   and a refusal has to reach the page as a code it can act on.
 * - the browser half is the real bundle in a hook harness: the list has to show
 *   the policy actually in force (defaults materialized, stored vs inherited
 *   marked), the form has to seed from it, and a save has to carry the revision
 *   it was rendered from, so a concurrent edit is refused instead of
 *   overwritten.
 *
 * `HOME`/`DSH_HOME` are redirected to a scratch directory first: the MCP
 * feature mounts in the same `apply()` and reads its own state file.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const require = createRequire(import.meta.url)

const scratch = mkdtempSync(join(tmpdir(), 'dsh-smkit-retry-'))
process.env.HOME = scratch
process.env.USERPROFILE = process.env.HOME
process.env.DSH_HOME = join(scratch, '.dsh')
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }))

const mod = await import(pathToFileURL(require.resolve('../lib/index.js')).href)
const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/* ------------------------------------------------------------------ the host */

const tools = {
  register: () => () => {},
  restrict: () => () => {},
  guard: () => () => {},
  schemas: () => [],
  get: () => undefined,
  execute: async () => ({ content: [] }),
}

/** Mount the plugin against a context whose `llm`/`settings` are the given stubs. */
function mountHost({ llm, settings }) {
  const routes = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools,
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: (name) => (name === 'llm' ? llm : name === 'settings' ? settings : undefined),
    on: () => () => {},
    inject: (names, callback) => {
      if (typeof callback === 'function' && names.includes('webServer')) {
        callback({
          webServer: ctx.webServer,
          get: () => undefined,
          effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
        })
      }
      return { dispose: () => {} }
    },
    effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
  }
  mod.apply(ctx)
  return routes[0]
}

/** One request through the prefix route, answered in full. */
function call(route, { method, path, body }) {
  return new Promise((resolve) => {
    const res = {
      code: 0,
      payload: undefined,
      writeHead(code) { this.code = code },
      end(chunk) { this.payload = chunk === undefined ? undefined : JSON.parse(chunk); resolve(this) },
    }
    const req = {
      method,
      url: `/smkit/api${path}`,
      headers: { host: '127.0.0.1:3080' },
      async *[Symbol.asyncIterator]() {
        if (body !== undefined) yield Buffer.from(JSON.stringify(body))
      },
    }
    route.handler(req, res)
  })
}

const RESOLVED_BIGMODEL = {
  mode: 'normal',
  maxRetries: 300,
  retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'],
  initialDelayMs: 10000,
  maxDelayMs: 10000,
  jitterRatio: 0,
}

const RESOLVED_OFFICIAL = {
  mode: 'normal',
  maxRetries: 5,
  retryableCodes: ['RATE_LIMIT'],
  initialDelayMs: 500,
  maxDelayMs: 10000,
  jitterRatio: 0.1,
}

const PROVIDERS = [
  { id: 'bigmodel', name: 'bigmodel' },
  { id: 'deepseek-official', name: 'deepseek-official' },
]

/** Each route's settings address, as an adapter declares it. */
const DIRECTORY = [
  { provider: 'bigmodel', displayName: 'BigModel', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'bigmodel'] },
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
]

/** An llm registry serving the two routes above; each member is replaceable. */
function llmStub(overrides = {}) {
  return {
    listProviders: () => PROVIDERS,
    providerRetryPolicy: (provider) => (provider === 'bigmodel' ? RESOLVED_BIGMODEL : RESOLVED_OFFICIAL),
    listConfigurableProviders: () => DIRECTORY,
    ...overrides,
  }
}

/**
 * A settings provider that records writes. The pi-ai route stores its own
 * policy — including a hand-written code list, which is the part a form cannot
 * express and must not drop.
 */
function settingsStub(overrides = {}) {
  const writes = []
  return {
    writes,
    describe: () => [
      {
        ns: 'llm-pi-ai',
        value: { providers: { bigmodel: {} } },
        user: { providers: { bigmodel: { retryPolicy: { mode: 'normal', maxRetries: 300, retryableCodes: ['RATE_LIMIT'] } } } },
        revision: 7,
      },
      { ns: 'llm-deepseek', value: {}, revision: 2 },
    ],
    mutate: async (ns, ops, expectedRevision) => { writes.push({ ns, ops, expectedRevision }) },
    ...overrides,
  }
}

it('lists every registered route with the policy in force and where it is stored', async () => {
  const route = mountHost({ llm: llmStub(), settings: settingsStub() })
  const answered = await call(route, { method: 'GET', path: '/llm-retry/routes' })

  assert.equal(answered.code, 200)
  assert.equal(answered.payload.unavailable, undefined, 'both seams are mounted')
  const [bigmodel, official] = answered.payload.routes
  assert.equal(bigmodel.provider, 'bigmodel')
  assert.equal(bigmodel.displayName, 'BigModel', 'the directory names the route for configuration surfaces')
  assert.deepEqual(bigmodel.settingsPath, ['providers', 'bigmodel'])
  assert.equal(bigmodel.editable, true)
  assert.equal(bigmodel.overridden, true, 'the pi-ai route stores its own policy')
  assert.equal(bigmodel.revision, 7, 'the revision rides along for stale-write detection')
  assert.equal(bigmodel.policy.maxRetries, 300)
  assert.equal(bigmodel.policy.initialDelayMs, 10000)
  assert.equal(bigmodel.policy.jitterRatio, 0)
  assert.deepEqual(bigmodel.policy.retryableCodes, RESOLVED_BIGMODEL.retryableCodes, 'the effective code set is shown')

  assert.equal(official.settingsPath.length, 0, 'a single-route adapter stores the policy at its section root')
  assert.equal(official.overridden, false, 'a route that inherits defaults is not marked custom')
  assert.equal(official.revision, 2)
  assert.equal(official.policy.maxDelayMs, 10000, 'defaults reach the page materialized')
})

it('keeps the list readable and reports which seam is missing', async () => {
  const route = mountHost({ llm: llmStub(), settings: undefined })
  const listed = await call(route, { method: 'GET', path: '/llm-retry/routes' })
  assert.equal(listed.payload.unavailable, 'settings')
  assert.equal(listed.payload.routes.length, 2, 'the routes themselves come from the llm registry')
  assert.equal(listed.payload.routes[0].editable, false, 'nothing is writable without the settings seam')

  const refused = await call(route, {
    method: 'POST',
    path: '/llm-retry/policy',
    body: { provider: 'bigmodel', policy: null },
  })
  assert.equal(refused.code, 503)
  assert.equal(refused.payload.code, 'retry/unavailable')
})

it('shows the policies read-only on a host that publishes no configuration directory', async () => {
  // A harness older than the directory still serves retry policies; saying
  // "no llm service" there would be wrong, and saying nothing would hide them.
  const route = mountHost({
    llm: {
      listProviders: () => PROVIDERS,
      providerRetryPolicy: (provider) => (provider === 'bigmodel' ? RESOLVED_BIGMODEL : RESOLVED_OFFICIAL),
    },
    settings: settingsStub(),
  })
  const listed = await call(route, { method: 'GET', path: '/llm-retry/routes' })

  assert.equal(listed.payload.unavailable, undefined, 'the policies are readable without the directory')
  assert.equal(listed.payload.routes.length, 2)
  assert.equal(listed.payload.routes[0].policy.maxRetries, 300, 'the policy in force is still shown')
  assert.equal(listed.payload.routes[0].editable, false)
  assert.equal(listed.payload.routes[0].settingsNs, undefined, 'nowhere to write without an address')
})

it('writes a policy as a path-addressed edit, gathering the flat form fields back into backoff', async () => {
  const settings = settingsStub()
  const route = mountHost({ llm: llmStub(), settings })
  const answered = await call(route, {
    method: 'POST',
    path: '/llm-retry/policy',
    body: {
      provider: 'bigmodel',
      revision: 7,
      // The flat shape the form posts…
      policy: { mode: 'normal', maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 2000, jitterRatio: 0.2 },
    },
  })

  assert.equal(answered.code, 200)
  assert.deepEqual(settings.writes, [{
    ns: 'llm-pi-ai',
    ops: [{
      op: 'set',
      path: ['providers', 'bigmodel', 'retryPolicy'],
      // …and the nested shape the adapter stores and resolves.
      value: {
        mode: 'normal',
        maxRetries: 3,
        backoff: { initialDelayMs: 1000, maxDelayMs: 2000, jitterRatio: 0.2 },
        // Not editable on the page, and the write replaces the whole object:
        // dropping it would silently widen the route back to the default set.
        retryableCodes: ['RATE_LIMIT'],
      },
    }],
    expectedRevision: 7,
  }])
  assertWritesAreStorable(settings.writes)
  assert.equal(answered.payload.route.provider, 'bigmodel', 'the answer carries the route as it now stands')
})

/**
 * The keys `resolveRetryPolicy` accepts — its `NORMAL_POLICY_KEYS` and
 * `BACKOFF_KEYS`. Anything else in a written policy is refused by the adapter
 * with `unknown key "..."`, which is exactly what a flat policy (the delays at
 * the top level, `backoff` missing) looks like from there.
 */
const POLICY_KEYS = ['mode', 'maxRetries', 'retryableCodes', 'backoff']
const BACKOFF_KEYS = ['initialDelayMs', 'maxDelayMs', 'jitterRatio']

/** Assert every recorded write carries an object the adapter's schema would accept. */
function assertWritesAreStorable(writes) {
  for (const write of writes) {
    for (const op of write.ops) {
      if (op.op !== 'set') continue
      assert.deepEqual(
        Object.keys(op.value).filter((key) => !POLICY_KEYS.includes(key)),
        [],
        'a stored policy may only carry keys the adapter resolves',
      )
      assert.deepEqual(
        Object.keys(op.value.backoff ?? {}).filter((key) => !BACKOFF_KEYS.includes(key)),
        [],
        'and its delays live under backoff',
      )
    }
  }
}

it('stores an unbounded policy without a count, still under the nested backoff', async () => {
  const settings = settingsStub()
  const route = mountHost({ llm: llmStub(), settings })
  const answered = await call(route, {
    method: 'POST',
    path: '/llm-retry/policy',
    body: {
      provider: 'bigmodel',
      policy: { mode: 'always', initialDelayMs: 500, maxDelayMs: 30000, jitterRatio: 0.2 },
    },
  })

  assert.equal(answered.code, 200)
  assert.deepEqual(settings.writes[0].ops[0].value, {
    mode: 'always',
    backoff: { initialDelayMs: 500, maxDelayMs: 30000, jitterRatio: 0.2 },
    // Carried through every save, including a mode switch: `always` ignores the
    // list, and keeping it is what restores a hand-written one on the way back.
    retryableCodes: ['RATE_LIMIT'],
  })
  assertWritesAreStorable(settings.writes)
})

it('resets a route by unsetting its stored policy, at that route’s own path', async () => {
  const settings = settingsStub()
  const route = mountHost({ llm: llmStub(), settings })

  await call(route, { method: 'POST', path: '/llm-retry/policy', body: { provider: 'bigmodel', policy: null, revision: 7 } })
  await call(route, { method: 'POST', path: '/llm-retry/policy', body: { provider: 'deepseek-official', policy: null } })

  assert.deepEqual(settings.writes.map((write) => write.ops), [
    [{ op: 'unset', path: ['providers', 'bigmodel', 'retryPolicy'] }],
    [{ op: 'unset', path: ['retryPolicy'] }],
  ])
  assert.equal(settings.writes[0].expectedRevision, 7)
  assert.equal(settings.writes[1].expectedRevision, undefined, 'a caller without a revision writes unconditionally')
})

it('refuses a policy the adapter could not serve, before anything is persisted', async () => {
  const settings = settingsStub()
  const route = mountHost({ llm: llmStub(), settings })

  const cases = [
    [{ mode: 'normal', maxRetries: -1, initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }, 'maxRetries'],
    [{ mode: 'normal', maxRetries: 1, initialDelayMs: 5000, maxDelayMs: 1000, jitterRatio: 0 }, 'initialDelayMs'],
    [{ mode: 'normal', maxRetries: 1, initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 2 }, 'jitterRatio'],
    [{ mode: 'sometimes', initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }, 'mode'],
    ['not-an-object', 'object'],
  ]
  for (const [policy, named] of cases) {
    const refused = await call(route, { method: 'POST', path: '/llm-retry/policy', body: { provider: 'bigmodel', policy } })
    assert.equal(refused.code, 400, `expected a refusal for ${JSON.stringify(policy)}`)
    assert.equal(refused.payload.code, 'retry/invalid-policy')
    assert.match(refused.payload.error, new RegExp(named))
  }
  assert.deepEqual(settings.writes, [], 'a refused policy never reaches the settings seam')
})

it('maps a moved settings section and an unwritable route onto codes the page can act on', async () => {
  const moved = settingsStub({
    mutate: async () => {
      throw Object.assign(new Error('the namespace moved'), { code: 'SETTINGS_CONFLICT' })
    },
  })
  const conflict = await call(mountHost({ llm: llmStub(), settings: moved }), {
    method: 'POST',
    path: '/llm-retry/policy',
    body: { provider: 'bigmodel', policy: null, revision: 6 },
  })
  assert.equal(conflict.code, 409)
  assert.equal(conflict.payload.code, 'retry/conflict')

  // A route the registry serves with no declared address: there is nowhere to
  // write, and saying so beats a write that lands somewhere else.
  const undeclared = mountHost({
    llm: llmStub({ listConfigurableProviders: () => [DIRECTORY[1]] }),
    settings: settingsStub(),
  })
  const refused = await call(undeclared, {
    method: 'POST',
    path: '/llm-retry/policy',
    body: { provider: 'bigmodel', policy: null },
  })
  assert.equal(refused.code, 400)
  assert.equal(refused.payload.code, 'retry/not-editable')

  const unknown = await call(mountHost({ llm: llmStub(), settings: settingsStub() }), {
    method: 'POST',
    path: '/llm-retry/policy',
    body: { provider: 'nobody', policy: null },
  })
  assert.equal(unknown.code, 404)
  assert.equal(unknown.payload.code, 'retry/unknown-provider')
})

it('leaves an unclaimed path to the prefix route', async () => {
  const route = mountHost({ llm: llmStub(), settings: settingsStub() })
  const answered = await call(route, { method: 'GET', path: '/llm-retry/policy' })
  assert.equal(answered.code, 404, 'a GET on the write path is not claimed')
})

/* -------------------------------------------------------------- the browser */

/** The `t` this suite renders with: identity, so assertions name the key. */
const t = (key) => key

const settle = () => new Promise((resolve) => setImmediate(resolve))
const plain = (value) => JSON.parse(JSON.stringify(value))
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

/**
 * Every rendered node, invoking each function-typed child exactly once — the
 * way React would while rendering, and exactly once so a second traversal of
 * the same render cannot shift a component's hook cells.
 */
function flatten(tree) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return []
  // A component is a node to draw wherever it stands — including as the tree this
  // walk was handed. The merged section delegates its open page to a component
  // of that page's own, so the node that arrives can be the component itself.
  if (typeof tree.type === 'function') return [tree, ...flatten(tree.type(tree.props))]
  const collected = [tree]
  for (const child of tree.children ?? []) collected.push(...flatten(child))
  return collected
}

/** Every string rendered in one flattened tree, for what a user can read. */
const texts = (flat) => flat.flatMap((node) => node.children ?? []).filter((child) => typeof child === 'string')

const bigModelRoute = {
  provider: 'bigmodel',
  displayName: 'BigModel',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'bigmodel'],
  editable: true,
  overridden: true,
  revision: 7,
  policy: { ...RESOLVED_BIGMODEL },
}

const officialRoute = {
  provider: 'deepseek-official',
  displayName: 'DeepSeek',
  settingsNs: 'llm-deepseek',
  settingsPath: [],
  editable: false,
  overridden: false,
  revision: 2,
  policy: { ...RESOLVED_OFFICIAL },
}

/**
 * URL-routed answers for the two endpoints the page uses. `list` is the body the
 * read answers with; `save` is a whole answer (body plus status), because a case
 * has to be able to make exactly the write fail.
 */
const routing = ({ list, save } = {}) => (url) => {
  if (url.endsWith('/llm-retry/routes')) return response(list ?? { routes: [] })
  if (url.endsWith('/llm-retry/policy')) {
    return response(save?.body ?? { route: bigModelRoute }, save?.ok ?? true, save?.status ?? 200)
  }
  return response({}, false, 404)
}

/**
 * Mount the real client bundle with a hook harness and open the merged settings
 * section on the page that carries the retry tab.
 * @param options - the URL-routed fetch stub.
 * @returns `calls` (every request the page made) and `render()`.
 */
function mountClient({ fetch }) {
  const calls = []
  const registrations = new Map()
  let exported
  const states = []
  let cursor = 0
  // Reading the section for its tab strip mounts the default panel as well; with
  // `muting` on, the requests it issues are dropped, because an answer that
  // arrived after the switch would write into the slots the opened panel owns.
  let muting = false
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
    // Effects run inline: this harness re-renders by calling the component
    // again, so an effect that never ran would leave the page without its poll.
    useEffect: (effect) => { effect() },
    useCallback: (callback) => callback,
  }
  const modules = { react }
  runInNewContext(clientSource, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory((id) => modules[id]) } } },
    fetch: async (url, options) => {
      if (muting) return new Promise(() => {})
      calls.push({ url, body: options?.body === undefined ? undefined : JSON.parse(options.body) })
      return fetch(url)
    },
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
  const Section = registrations.get('mcp-manager')
  assert.equal(typeof Section, 'function', 'the merged settings section must be seated')
  /** Open one of the merged section's tabs. The section mounts only the tab it
   * shows, so a case that reads this page has to be on it before the first
   * render; the pass that finds the tab is muted, since it mounts the default
   * panel on the way there. */
  const openTab = (id) => {
    cursor = 0
    muting = true
    const tree = Section()
    const tab = flatten(tree).find((node) => node.props?.role === 'tab' && node.props?.key === id)
    muting = false
    assert.ok(tab, `the section must offer the ${id} tab`)
    tab.props.onClick()
    // The panel that was mounted is gone; its slots go with it, so the panel
    // that replaces it starts its own state fresh.
    states.length = 1
  }
  // Every case here drives the retry tab, which sits on this page of the section.
  openTab('custom')
  return {
    calls,
    /** One render, flattened: safe to traverse as often as a case needs. */
    render() {
      cursor = 0
      const flat = flatten(Section())
      return {
        flat,
        text: texts(flat).join(' | '),
        labelled(label) {
          const found = flat.find((node) => node.props?.['aria-label'] === label)
          assert.ok(found, `expected an element labelled ${label}`)
          return found
        },
        button(label) {
          const found = flat.find((node) => node.type === 'button' && (node.children ?? []).includes(label))
          assert.ok(found, `expected a button labelled ${label}`)
          return found
        },
      }
    },
  }
}

it('renders the policy in force for every route, and what it stores', async () => {
  const app = mountClient({ fetch: routing({ list: { routes: [bigModelRoute, officialRoute] } }) })
  app.render()
  await settle()
  const view = app.render()

  assert.equal(app.calls[0].url, '/smkit/api/llm-retry/routes', 'the page asks the host first')
  assert.ok(view.text.includes('tabRetry'), 'the page opens on the retry tab')
  assert.ok(view.text.includes('bigmodel') && view.text.includes('deepseek-official'), 'both routes are listed')
  assert.ok(view.text.includes('policyCustom'), 'the route with a stored policy is marked custom')
  assert.ok(view.text.includes('policyDefault'), 'the route inheriting defaults is marked default')
  assert.ok(view.text.includes('summaryRetries'), 'the summary counts the attempts in force')
  assert.ok(view.text.includes('summaryFixedDelay'), 'and reports a fixed interval as fixed')
  assert.ok(view.text.includes('summaryJitter'), 'and mentions jitter only when there is one')
  assert.ok(view.text.includes('readOnly'), 'a route with nowhere to write says so')
  assert.equal(view.button('edit').props.disabled, false, 'the editable route offers its form')
})

it('seats every area as a tab, and swaps the panel with the tab', async () => {
  const app = mountClient({ fetch: routing({ list: { routes: [bigModelRoute] } }) })
  app.render()
  await settle()
  const open = app.render()
  assert.ok(open.text.includes('sectionLabel'), 'the page names itself above the strip')
  assert.ok(open.text.includes('tabRetry') && open.text.includes('tabOther'), 'both areas have a tab')
  assert.ok(open.text.includes('heading'), 'the retry tab is the one open')

  app.render().button('tabOther').props.onClick()
  const swapped = app.render()
  assert.ok(swapped.text.includes('plannedToolCalls'), 'the other tab lists what is planned')
  assert.ok(
    swapped.text.includes('agent-loop · maxParallelToolCalls'),
    'and where each planned value lives in dsh',
  )
  assert.equal(swapped.text.includes('countRoutes'), false, 'the retry panel is gone while it is closed')
})

it('seeds the form from the policy in force and posts the revision it read', async () => {
  const app = mountClient({ fetch: routing({ list: { routes: [bigModelRoute] } }) })
  app.render()
  await settle()
  app.render().button('edit').props.onClick()

  const form = app.render()
  assert.equal(form.labelled('maxRetries').props.value, '300')
  assert.equal(form.labelled('initialDelayMs').props.value, '10000')
  assert.equal(form.labelled('jitterRatio').props.value, '0')

  form.labelled('initialDelayMs').props.onChange({ target: { value: '2000' } })
  app.render().button('save').props.onClick()
  await settle()

  const posted = app.calls.filter((request) => request.url.endsWith('/llm-retry/policy'))
  assert.deepEqual(plain(posted), [{
    url: '/smkit/api/llm-retry/policy',
    body: {
      provider: 'bigmodel',
      policy: { mode: 'normal', maxRetries: 300, initialDelayMs: 2000, maxDelayMs: 10000, jitterRatio: 0 },
      revision: 7,
    },
  }])
  assert.equal(app.render().text.includes('editTitle'), false, 'a successful save leaves the form')
})

it('resets a route by asking the host to remove what it stores', async () => {
  const app = mountClient({ fetch: routing({ list: { routes: [bigModelRoute] } }) })
  app.render()
  await settle()
  app.render().button('edit').props.onClick()
  app.render().button('reset').props.onClick()
  await settle()

  const posted = app.calls.filter((request) => request.url.endsWith('/llm-retry/policy'))
  assert.deepEqual(plain(posted[0].body), { provider: 'bigmodel', policy: null, revision: 7 })
})

it('answers its own invalid input without asking the host', async () => {
  const app = mountClient({ fetch: routing({ list: { routes: [bigModelRoute] } }) })
  app.render()
  await settle()
  app.render().button('edit').props.onClick()
  app.render().labelled('maxRetries').props.onChange({ target: { value: 'abc' } })
  app.render().button('save').props.onClick()
  await settle()

  assert.ok(app.render().text.includes('invalidMaxRetries'), 'the field is named in the form')
  assert.deepEqual(app.calls.filter((request) => request.url.endsWith('/llm-retry/policy')), [], 'nothing was sent')
})

it('shows the localized message for a refused write, and keeps the form open', async () => {
  const app = mountClient({
    fetch: routing({
      list: { routes: [bigModelRoute] },
      save: { body: { error: 'the settings section changed', code: 'retry/conflict' }, ok: false, status: 409 },
    }),
  })
  app.render()
  await settle()
  app.render().button('edit').props.onClick()
  app.render().button('save').props.onClick()
  await settle()

  const view = app.render()
  assert.ok(view.text.includes('conflict'), 'the code is localized rather than echoed')
  assert.ok(view.text.includes('editTitle'), 'the form stays open so the draft can be re-sent')
})

it('reports the seam a deployment does not mount', async () => {
  const app = mountClient({ fetch: routing({ list: { routes: [], unavailable: 'settings' } }) })
  app.render()
  await settle()
  const view = app.render()

  assert.ok(view.text.includes('unavailableSettings'), 'the missing half is named')
  assert.equal(view.text.includes('empty'), false, 'an unavailable list is not reported as an empty one')
})
