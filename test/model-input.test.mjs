/**
 * The model-input tab of Settings → 自定义设置, end to end at the seam it
 * depends on.
 *
 * Two suites, one per half, each driven with stubs standing exactly where the
 * harness's own services stand:
 *
 * - the host half is mounted through the real `apply()` against a stub context
 *   carrying `llm` and `settings`, and probed over its three API routes. What
 *   matters there is where a declaration is written: a route that lists its own
 *   models has to be edited inside that array — whole, with every other model's
 *   fields intact — while a catalog route is edited under `modelOverrides`, and
 *   "inherit" has to remove the declaration rather than store an empty list,
 *   which the adapter reads as no answer at all. The probe route answers it the
 *   host's own model-list interrogation would: same URL, same credential order,
 *   same reply shapes — and it keeps the modalities the host's reader drops.
 * - the browser half is the real bundle in a hook harness: a row has to show the
 *   modalities actually in force and whether they are stored, offer exactly the
 *   three states, and post the revision it was rendered from.
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

const scratch = mkdtempSync(join(tmpdir(), 'dsh-smkit-model-input-'))
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
function mountHost({ llm, settings, credentials, launchEnvironment }) {
  const routes = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools,
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    get: (name) => (
      name === 'llm' ? llm
        : name === 'settings' ? settings
          : name === 'credentials' ? credentials
            : name === 'launchEnvironment' ? launchEnvironment
              : undefined
    ),
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
      url: `/mcp-manager/api${path}`,
      headers: { host: '127.0.0.1:3080' },
      async *[Symbol.asyncIterator]() {
        if (body !== undefined) yield Buffer.from(JSON.stringify(body))
      },
    }
    route.handler(req, res)
  })
}

/** A declared gateway: configuration lists every model it serves. */
const STORED_MODELS = [
  { id: 'union-alpha', name: 'Union Alpha', input: ['text', 'image'], contextWindow: 262144 },
  { id: 'plain-model', name: 'Plain Model', contextWindow: 131072, maxTokens: 8192 },
  // A name this page has no control for: the vocabulary is the adapter's, and it
  // is declared extensible, so a hand-written `video` is a fact to keep, not an
  // error to clean up.
  { id: 'video-model', name: 'Video Model', input: ['text', 'video'] },
]

/** A catalog route: the shipped catalog describes it, so overrides address its models. */
const STORED_OVERRIDES = {
  'stored-claude': { input: ['text'] },
  'video-claude': { input: ['text', 'pdf'] },
}

/**
 * What the adapters resolved for each route, which is the answer including
 * catalog inheritance — the fact the page cannot recompute.
 */
const MODELS = {
  'openrouter-cm': [
    { provider: 'openrouter-cm', id: 'union-alpha', name: 'Union Alpha', inputModalities: ['text', 'image'] },
    { provider: 'openrouter-cm', id: 'plain-model', name: 'Plain Model', inputModalities: ['text', 'image'] },
    { provider: 'openrouter-cm', id: 'video-model', name: 'Video Model', inputModalities: ['text', 'video'] },
  ],
  'anthropic-gateway': [
    { provider: 'anthropic-gateway', id: 'stored-claude', name: 'Stored Claude', inputModalities: ['text'] },
    { provider: 'anthropic-gateway', id: 'catalog-claude', name: 'Catalog Claude', inputModalities: ['text', 'image'] },
    { provider: 'anthropic-gateway', id: 'video-claude', name: 'Video Claude', inputModalities: ['text', 'pdf'] },
  ],
  'deepseek-official': [
    { provider: 'deepseek-official', id: 'deepseek-chat', name: 'DeepSeek Chat', inputModalities: ['text'] },
  ],
  'declared-empty': [],
  // A stored list the adapter could never resolve: the page must not rewrite a
  // shape it does not understand.
  'broken-list': [
    { provider: 'broken-list', id: 'first-model', name: 'First Model', inputModalities: ['text'] },
  ],
  'no-address-route': [
    { provider: 'no-address-route', id: 'orphan', name: 'Orphan', inputModalities: ['text'] },
  ],
  // A gateway route whose configuration carries the endpoint a probe asks.
  'amd-gateway': [
    { provider: 'amd-gateway', id: 'vision-x', name: 'Vision X', inputModalities: ['text'] },
  ],
}

const PROVIDERS = Object.keys(MODELS).map(id => ({ id, name: id }))

/** Each route's settings address, as an adapter declares it. */
const DIRECTORY = [
  { provider: 'openrouter-cm', displayName: 'OpenRouter', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openrouter-cm'], declared: true },
  { provider: 'anthropic-gateway', displayName: 'Anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic-gateway'], declared: false },
  { provider: 'declared-empty', displayName: 'Declared Empty', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'declared-empty'], declared: true },
  { provider: 'broken-list', displayName: 'Broken List', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'broken-list'], declared: true },
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], declared: false },
  { provider: 'amd-gateway', displayName: 'AMD', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'amd-gateway'], declared: true },
]

/** An llm registry serving the routes above; each member is replaceable. */
function llmStub(overrides = {}) {
  return {
    listProviders: () => PROVIDERS,
    providerRetryPolicy: () => ({ mode: 'normal', maxRetries: 1, initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }),
    listConfigurableProviders: () => DIRECTORY,
    listModels: (provider) => Promise.resolve(MODELS[provider] ?? []),
    ...overrides,
  }
}

/** A settings provider that applies and records writes, like the real seam. */
function settingsStub(overrides = {}) {
  const writes = []
  const sections = new Map([
    ['llm-pi-ai', {
      user: {
        providers: {
          'openrouter-cm': { models: STORED_MODELS },
          'anthropic-gateway': { modelOverrides: STORED_OVERRIDES },
          'declared-empty': {},
          'broken-list': { models: ['not-an-object'] },
          'amd-gateway': {
            api: 'openai-completions',
            baseURL: 'https://listing.test/v1',
            apiKeyEnv: 'AMD_TEST_KEY',
            models: [{ id: 'vision-x', name: 'Vision X', input: ['text'] }],
          },
        },
      },
      revision: 4,
    }],
    ['llm-deepseek', { user: {}, revision: 2 }],
  ])
  return {
    writes,
    describe: () => [...sections].map(([ns, section]) => ({ ns, value: {}, user: section.user, revision: section.revision })),
    mutate: async (ns, ops, expectedRevision) => {
      writes.push({ ns, ops, expectedRevision })
      const section = sections.get(ns)
      if (section === undefined) throw new Error(`unknown namespace "${ns}"`)
      // The same compare-and-set the host applies: a caller that read revision
      // 3 may not write over the edit that moved the section to 4.
      if (expectedRevision !== undefined && expectedRevision !== section.revision) {
        throw Object.assign(new Error('the namespace moved'), { code: 'SETTINGS_CONFLICT' })
      }
      for (const op of ops) applyOp(section, op)
      section.revision += 1
    },
    ...overrides,
  }
}

/**
 * The host's `applyPathOp`, in miniature: an object-descending set or unset,
 * which is also why an array element can only be edited by sending the array
 * back whole.
 */
function applyOp(section, op) {
  section.user = applyPath(section.user, op.path, op)
}

function applyPath(target, path, op) {
  const [head, ...rest] = path
  if (head === undefined) return op.op === 'unset' ? {} : { ...op.value }
  if (rest.length === 0) {
    if (op.op === 'unset') {
      const { [head]: _gone, ...kept } = target
      return kept
    }
    return { ...target, [head]: op.value }
  }
  const child = target[head]
  if (typeof child !== 'object' || child === null || Array.isArray(child)) {
    // Unsetting through an absent path is already satisfied; setting through one
    // creates the intermediate objects it needs.
    if (op.op === 'unset') return target
    return { ...target, [head]: applyPath({}, rest, op) }
  }
  return { ...target, [head]: applyPath(child, rest, op) }
}

it('lists every route with the models it serves and what each one declares', async () => {
  const route = mountHost({ llm: llmStub(), settings: settingsStub() })
  const answered = await call(route, { method: 'GET', path: '/model-input/providers' })

  assert.equal(answered.code, 200)
  assert.equal(answered.payload.unavailable, undefined, 'both seams are mounted')
  const byId = new Map(answered.payload.providers.map((entry) => [entry.provider, entry]))

  const declared = byId.get('openrouter-cm')
  assert.equal(declared.displayName, 'OpenRouter', 'the directory names the route for configuration surfaces')
  assert.equal(declared.editable, true, 'a pi-ai route with a models list is writable here')
  assert.equal(declared.revision, 4, 'the revision rides along for stale-write detection')
  assert.deepEqual(declared.models[0], { id: 'union-alpha', name: 'Union Alpha', effective: ['text', 'image'], overridden: true })
  assert.equal(declared.models[1].overridden, false, 'a list entry that names no modalities inherits them')
  assert.deepEqual(declared.models[1].effective, ['text', 'image'], 'and the answer in force is still shown')
  assert.deepEqual(declared.models[2].effective, ['text'], 'a name this page has no control for is not an effective modality')
  assert.deepEqual(declared.models[2].other, ['video'], 'but it is reported as what the route stores')

  const catalog = byId.get('anthropic-gateway')
  assert.equal(catalog.editable, true, 'a catalog route is writable through its overrides')
  assert.deepEqual(catalog.models.map((model) => model.overridden), [true, false, true])

  const deepseek = byId.get('deepseek-official')
  assert.equal(deepseek.editable, false)
  assert.equal(deepseek.refusal, 'other-adapter', 'its adapter names a different field')
  assert.equal(deepseek.revision, 2, 'its own section still answers for it')
  assert.deepEqual(deepseek.models[0].effective, ['text'], 'the modality in force is still reported')

  const orphan = byId.get('no-address-route')
  assert.equal(orphan.refusal, 'no-address')
  assert.equal(orphan.settingsNs, undefined, 'nowhere to write without an address')
  assert.equal(orphan.editable, false)

  const empty = byId.get('declared-empty')
  assert.equal(empty.editable, false)
  assert.equal(empty.refusal, 'no-store', 'a declared route with no models list stores them nowhere this page may write')

  const broken = byId.get('broken-list')
  assert.equal(broken.refusal, 'no-store', 'a models list this page cannot read is not rewritten behind the user')
  assert.equal(broken.models.length, 1, 'and its models are still listed')
})

it('keeps the list readable and reports which seam is missing', async () => {
  const route = mountHost({ llm: llmStub(), settings: undefined })
  const listed = await call(route, { method: 'GET', path: '/model-input/providers' })
  assert.equal(listed.payload.unavailable, 'settings')
  assert.equal(listed.payload.providers.length, 7, 'the routes themselves come from the llm registry')
  assert.equal(listed.payload.providers[0].editable, false, 'nothing is writable without the settings seam')

  const refused = await call(route, {
    method: 'POST',
    path: '/model-input/modalities',
    body: { provider: 'openrouter-cm', model: 'plain-model', modalities: ['text'] },
  })
  assert.equal(refused.code, 503)
  assert.equal(refused.payload.code, 'input/unavailable')
})

it('shows the policies read-only on a host that publishes no configuration directory', async () => {
  const route = mountHost({
    llm: llmStub({ listConfigurableProviders: undefined }),
    settings: settingsStub(),
  })
  const listed = await call(route, { method: 'GET', path: '/model-input/providers' })

  assert.equal(listed.payload.unavailable, undefined, 'the models are readable without the directory')
  assert.equal(listed.payload.providers[0].refusal, 'no-address')
  assert.equal(listed.payload.providers[0].models.length, 3, 'what each route serves still comes from the registry')
})

it('lists routes without models rather than dropping them', async () => {
  const route = mountHost({
    llm: llmStub({ listModels: undefined }),
    settings: settingsStub(),
  })
  const listed = await call(route, { method: 'GET', path: '/model-input/providers' })
  const declared = listed.payload.providers.find((entry) => entry.provider === 'openrouter-cm')

  assert.deepEqual(declared.models, [])
  assert.equal(declared.editable, false)
  assert.equal(declared.refusal, 'no-model-list', 'the reason reads differently from an empty route')
})

/**
 * The keys pi-ai's model schema accepts on a stored model entry. Anything else
 * is refused by the adapter, which is what a partial write looks like from there.
 */
const MODEL_KEYS = ['id', 'name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'compat']

/** Assert every recorded write carries models the adapter's schema would accept. */
function assertWritesAreStorable(writes) {
  for (const write of writes) {
    for (const op of write.ops) {
      // A write that addresses a modality list directly carries only names; one
      // that replaces a model's whole entry may only carry keys the adapter
      // resolves — anything else it refuses with `unknown key "..."`.
      if (op.op !== 'set' || op.path[op.path.length - 1] === 'input') continue
      const entries = Array.isArray(op.value) ? op.value : [op.value]
      for (const model of entries) {
        assert.deepEqual(
          Object.keys(model).filter((key) => !MODEL_KEYS.includes(key)),
          [],
          'a stored model may only carry keys the adapter resolves',
        )
      }
    }
  }
}

it('edits a declared route inside its own models list, leaving the other models intact', async () => {
  const settings = settingsStub()
  const route = mountHost({ llm: llmStub(), settings })
  const answered = await call(route, {
    method: 'POST',
    path: '/model-input/modalities',
    body: { provider: 'openrouter-cm', model: 'plain-model', modalities: ['text', 'image'], revision: 4 },
  })

  assert.equal(answered.code, 200)
  assert.deepEqual(settings.writes, [{
    ns: 'llm-pi-ai',
    ops: [{
      // The path editor cannot address an array element, so the whole list goes
      // back — and every other entry has to come back unchanged.
      op: 'set',
      path: ['providers', 'openrouter-cm', 'models'],
      value: [
        STORED_MODELS[0],
        { id: 'plain-model', name: 'Plain Model', contextWindow: 131072, maxTokens: 8192, input: ['text', 'image'] },
        STORED_MODELS[2],
      ],
    }],
    expectedRevision: 4,
  }])
  assertWritesAreStorable(settings.writes)
  assert.equal(answered.payload.provider.editable, true, 'the answer carries the route as it now stands')
  assert.equal(answered.payload.provider.models[1].overridden, true)
})

it('removes a declaration from the list without emptying it, so the model inherits', async () => {
  const settings = settingsStub()
  const route = mountHost({ llm: llmStub(), settings })
  await call(route, {
    method: 'POST',
    path: '/model-input/modalities',
    body: { provider: 'openrouter-cm', model: 'union-alpha', modalities: null, revision: 4 },
  })

  const [write] = settings.writes
  assert.equal(write.ops[0].op, 'set', 'the list itself stays; only the field goes')
  assert.deepEqual(write.ops[0].value, [
    { id: 'union-alpha', name: 'Union Alpha', contextWindow: 262144 },
    STORED_MODELS[1],
    STORED_MODELS[2],
  ])
  assert.equal(JSON.stringify(write.ops[0].value).includes('"input":[]'), false, 'an empty list would mean no answer at all')
})

it('leaves a modality name it has no box for in the list it rewrites', async () => {
  const settings = settingsStub()
  const route = mountHost({ llm: llmStub(), settings })

  await call(route, {
    method: 'POST',
    path: '/model-input/modalities',
    body: { provider: 'openrouter-cm', model: 'video-model', modalities: ['text', 'image'], revision: 4 },
  })
  await call(route, {
    method: 'POST',
    path: '/model-input/modalities',
    body: { provider: 'anthropic-gateway', model: 'video-claude', modalities: ['text'] },
  })

  assert.deepEqual(settings.writes.map(write => write.ops[0].value), [
    [
      STORED_MODELS[0],
      STORED_MODELS[1],
      { id: 'video-model', name: 'Video Model', input: ['text', 'image', 'video'] },
    ],
    ['text', 'pdf'],
  ], 'the two boxes this page draws are written; a name it does not know rides along')
  assertWritesAreStorable(settings.writes)
})

it('writes a catalog route under its overrides, and inherits by removing the entry', async () => {
  const settings = settingsStub()
  const route = mountHost({ llm: llmStub(), settings })

  await call(route, {
    method: 'POST',
    path: '/model-input/modalities',
    body: { provider: 'anthropic-gateway', model: 'catalog-claude', modalities: ['text'] },
  })
  await call(route, {
    method: 'POST',
    path: '/model-input/modalities',
    body: { provider: 'anthropic-gateway', model: 'stored-claude', modalities: null },
  })

  assert.deepEqual(settings.writes.map((write) => write.ops), [
    [{ op: 'set', path: ['providers', 'anthropic-gateway', 'modelOverrides', 'catalog-claude', 'input'], value: ['text'] }],
    [{ op: 'unset', path: ['providers', 'anthropic-gateway', 'modelOverrides', 'stored-claude'] }],
  ])
  assertWritesAreStorable(settings.writes)
})

it('accepts a reset from a model that never declared, because it changes nothing', async () => {
  // The row shows the action whether or not it stores a declaration, so the host
  // has to answer the redundant one without refusing: an unset of an absent path
  // is already satisfied, and a rebuilt list that drops an absent field is the
  // same list.
  const settings = settingsStub()
  const route = mountHost({ llm: llmStub(), settings })

  const listed = await call(route, {
    method: 'POST',
    path: '/model-input/modalities',
    body: { provider: 'openrouter-cm', model: 'plain-model', modalities: null },
  })
  const catalog = await call(route, {
    method: 'POST',
    path: '/model-input/modalities',
    body: { provider: 'anthropic-gateway', model: 'catalog-claude', modalities: null },
  })

  assert.equal(listed.code, 200, 'a route that stores its models in a list takes it')
  assert.equal(catalog.code, 200, 'and so does a catalog route under its overrides')
  assert.deepEqual(settings.writes.map((write) => write.ops), [
    [{ op: 'set', path: ['providers', 'openrouter-cm', 'models'], value: STORED_MODELS }],
    [{ op: 'unset', path: ['providers', 'anthropic-gateway', 'modelOverrides', 'catalog-claude'] }],
  ])
  assertWritesAreStorable(settings.writes)
})

it('refuses a write it cannot serve, before anything is persisted', async () => {
  const settings = settingsStub()
  const route = mountHost({ llm: llmStub(), settings })

  const cases = [
    [['image'], 'a list without text could serve no request'],
    [['text', 'text'], 'a repeated modality'],
    [['text', 'video'], 'a modality the request gate does not take'],
    ['text', 'a bare string is not a list'],
    [undefined, 'an absent field is not the same fact as inherit'],
  ]
  for (const [modalities, named] of cases) {
    const refused = await call(route, {
      method: 'POST',
      path: '/model-input/modalities',
      body: { provider: 'openrouter-cm', model: 'plain-model', modalities },
    })
    assert.equal(refused.code, 400, named)
    assert.equal(refused.payload.code, 'input/invalid-modalities', named)
  }

  // A target this page may not address is named by its own code, so the page
  // can tell "pick another model" from "this route is not yours to edit".
  const refused = [
    [{ provider: 'deepseek-official', model: 'deepseek-chat', modalities: ['text'] }, 400, 'input/not-editable', /llm-deepseek/],
    [{ provider: 'broken-list', model: 'first-model', modalities: ['text'] }, 400, 'input/not-editable', /nowhere/],
    [{ provider: 'no-address-route', model: 'orphan', modalities: ['text'] }, 400, 'input/not-editable', /no settings address/],
    [{ provider: 'nobody', model: 'plain-model', modalities: ['text'] }, 404, 'input/unknown-provider', /nobody/],
    [{ provider: 'openrouter-cm', model: 'not-listed', modalities: ['text'] }, 404, 'input/unknown-model', /not-listed/],
    [{ provider: 'declared-empty', model: 'anything', modalities: ['text'] }, 404, 'input/unknown-model', /does not serve/],
  ]
  for (const [body, status, code, message] of refused) {
    const answer = await call(route, { method: 'POST', path: '/model-input/modalities', body })
    assert.equal(answer.code, status, `${code}: ${JSON.stringify(body)}`)
    assert.equal(answer.payload.code, code, JSON.stringify(body))
    assert.match(answer.payload.error, message, JSON.stringify(body))
  }
  assert.deepEqual(settings.writes, [], 'a refused write never reaches the settings seam')
})

it('maps a moved settings section onto a code the page can act on', async () => {
  const moved = settingsStub({
    mutate: async () => {
      throw Object.assign(new Error('the namespace moved'), { code: 'SETTINGS_CONFLICT' })
    },
  })
  const conflict = await call(mountHost({ llm: llmStub(), settings: moved }), {
    method: 'POST',
    path: '/model-input/modalities',
    body: { provider: 'openrouter-cm', model: 'plain-model', modalities: ['text'], revision: 3 },
  })
  assert.equal(conflict.code, 409)
  assert.equal(conflict.payload.code, 'input/conflict')
})

it('leaves an unclaimed path to the prefix route', async () => {
  const route = mountHost({ llm: llmStub(), settings: settingsStub() })
  const answered = await call(route, { method: 'GET', path: '/model-input/modalities' })
  assert.equal(answered.code, 404, 'a GET on the write path is not claimed')
})

/* ------------------------------------------------------------- the endpoint probe */

/**
 * Install a fake `fetch` for one probe case, recording every call.
 * @param handler - answers the request; anything thrown travels as a network failure.
 * @returns the recorded calls and a `restore` that puts the real `fetch` back.
 */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return handler(url, options)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

/** A listing reply, in the shape a supported endpoint answers with. */
const listing = (body, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(body) })

const probe = (route, body) => call(route, { method: 'POST', path: '/model-input/discover', body })

it('asks the route its own endpoint about a model, with the route its own key', async () => {
  const probeFetch = stubFetch(() => listing({
    data: [
      { id: 'other-model', architecture: { input_modalities: ['text', 'image'] } },
      { id: 'vision-x', architecture: { input_modalities: ['text', 'image', 'video'] } },
    ],
  }))
  try {
    const route = mountHost({
      llm: llmStub(),
      settings: settingsStub(),
      credentials: { resolve: async (ref) => (ref === 'AMD_TEST_KEY' ? { value: 'stored-key' } : undefined) },
    })
    const answered = await probe(route, { provider: 'amd-gateway', model: 'vision-x' })

    assert.equal(answered.code, 200)
    assert.deepEqual(answered.payload, { modalities: ['text', 'image'] }, 'the reply is narrowed to what this page can declare')
    assert.equal(probeFetch.calls.length, 1)
    assert.equal(probeFetch.calls[0].url, 'https://listing.test/v1/models', 'the listing URL follows the host rule: base plus /models')
    assert.equal(probeFetch.calls[0].options.method, 'GET')
    assert.equal(probeFetch.calls[0].options.headers.get('authorization'), 'Bearer stored-key', 'the credential store is the first stop, as it is for the adapter')
    assert.equal(JSON.stringify(answered.payload).includes('stored-key'), false, 'the key never rides the answer')
  } finally {
    probeFetch.restore()
  }
})

it('falls back to the launch environment, and asks unauthenticated when neither has a key', async () => {
  const withEnv = stubFetch(() => listing({ data: [{ id: 'vision-x', architecture: { input_modalities: ['text', 'image'] } }] }))
  process.env.AMD_TEST_KEY = 'env-key'
  try {
    const route = mountHost({ llm: llmStub(), settings: settingsStub() })
    const answered = await probe(route, { provider: 'amd-gateway', model: 'vision-x' })
    assert.equal(answered.code, 200)
    assert.equal(withEnv.calls[0].options.headers.get('authorization'), 'Bearer env-key', 'with no credential store mounted, the environment answers')

    delete process.env.AMD_TEST_KEY
    const bare = stubFetch(() => listing({ models: { 'vision-x': { name: 'Vision X', architecture: { input_modalities: ['image', 'text'] } } } }))
    try {
      // The enriched `models` map is keyed by the endpoint-facing id; order in
      // the reply is not the order the page writes.
      const unauthenticated = await probe(route, { provider: 'amd-gateway', model: 'vision-x' })
      assert.equal(unauthenticated.code, 200)
      assert.deepEqual(unauthenticated.payload, { modalities: ['text', 'image'] })
      assert.equal(bare.calls[0].options.headers.get('authorization'), null, 'a route no key was found for is still asked — deployment headers may carry its auth')
    } finally {
      bare.restore()
    }
  } finally {
    withEnv.restore()
  }
})

it('refuses to ask where the host would not ask, and says which half stopped it', async () => {
  const probeFetch = stubFetch(() => listing({ data: [] }))
  try {
    const route = mountHost({ llm: llmStub(), settings: settingsStub() })

    const cases = [
      // A catalog route with no endpoint stated: pi-ai would resolve it from
      // its own baseURL detection, and this page cannot ask a URL it cannot name.
      [{ provider: 'openrouter-cm', model: 'union-alpha' }, 400, 'input/discover-unsupported', /no baseURL/],
      [{ provider: 'deepseek-official', model: 'deepseek-chat' }, 400, 'input/not-editable', /no pi-ai configuration/],
      [{ provider: 'no-address-route', model: 'orphan' }, 400, 'input/not-editable', /no pi-ai configuration/],
      [{ provider: 'nobody', model: 'vision-x' }, 404, 'input/unknown-provider', /nobody/],
      [{ provider: 'amd-gateway', model: '' }, 400, 'input/unknown-model', /model must name/],
    ]
    for (const [body, status, code, message] of cases) {
      const answer = await probe(route, body)
      assert.equal(answer.code, status, `${code}: ${JSON.stringify(body)}`)
      assert.equal(answer.payload.code, code, JSON.stringify(body))
      assert.match(answer.payload.error, message, JSON.stringify(body))
    }

    // A protocol whose listing the host's own reader cannot parse is refused
    // without a call, exactly as the Models page refuses it.
    const oddSection = {
      ns: 'llm-pi-ai',
      value: {},
      revision: 4,
      user: { providers: { 'amd-gateway': { api: 'google-generative', baseURL: 'https://gemini.test', models: [] } } },
    }
    const odd = mountHost({
      llm: llmStub(),
      settings: settingsStub({ describe: () => [oddSection, { ns: 'llm-deepseek', value: {}, user: {}, revision: 2 }] }),
    })
    const protocol = await probe(odd, { provider: 'amd-gateway', model: 'vision-x' })
    assert.equal(protocol.code, 400)
    assert.equal(protocol.payload.code, 'input/discover-unsupported')
    assert.match(protocol.payload.error, /google-generative/)

    assert.equal(probeFetch.calls.length, 0, 'every refusal above happens before the network')
  } finally {
    probeFetch.restore()
  }
})

it('passes the refusals the endpoint itself answers with, worded but not invented', async () => {
  const probeFetch = stubFetch((url) => {
    if (url.includes('listing.test')) return listing({ data: [{ id: 'text-only', architecture: { input_modalities: ['text'] } }] })
    throw Object.assign(new Error('route dns'), {})
  })
  try {
    // A directory that answers, but not about this model; then every way a
    // request can fail short of that.
    const route = mountHost({ llm: llmStub(), settings: settingsStub() })
    const missing = await probe(route, { provider: 'amd-gateway', model: 'vision-x' })
    assert.equal(missing.code, 404)
    assert.equal(missing.payload.code, 'input/discover-no-model')
    assert.match(missing.payload.error, /does not list model "vision-x"/)

    const refused = [
      [() => listing({ error: 'nope' }, false, 401), 502, 'input/discover-failed', /answered 401; check the API key/],
      [() => ({ ok: true, status: 200, text: async () => 'not json at all' }), 502, 'input/discover-failed', /did not answer with JSON/],
      [() => { throw new Error('socket hang up') }, 502, 'input/discover-failed', /could not reach/],
      [() => listing({ data: [{ id: 'vision-x', architecture: { input_modalities: ['image'] } }] }), 404, 'input/discover-no-model', /no text input/],
      [() => listing({ data: [{ id: 'vision-x', name: 'Vision X' }] }), 404, 'input/discover-no-model', /no input modalities/],
    ]
    for (const [answer, status, code, message] of refused) {
      probeFetch.calls.length = 0
      globalThis.fetch = answer
      const bad = await probe(route, { provider: 'amd-gateway', model: 'vision-x' })
      assert.equal(bad.code, status, `${code}: ${message}`)
      assert.equal(bad.payload.code, code, message.source)
      assert.match(bad.payload.error, message, message.source)
    }
  } finally {
    probeFetch.restore()
  }
})

it('asks an Anthropic route at its root and reads its reply by the same rule', async () => {
  const probeFetch = stubFetch(() => listing({ data: [{ id: 'vision-x', architecture: { input_modalities: ['image', 'text'] } }] }))
  try {
    // The host treats the configured base as a prefix and normalizes only the
    // one trailing `/v1` for this protocol's listing path.
    const section = {
      ns: 'llm-pi-ai',
      value: {},
      revision: 4,
      user: {
        providers: {
          'amd-gateway': {
            api: 'anthropic-messages',
            baseURL: 'https://claude.test/v1',
            apiKeyEnv: 'AMD_TEST_KEY',
            models: [{ id: 'vision-x', name: 'Vision X', input: ['text'] }],
          },
        },
      },
    }
    const route = mountHost({
      llm: llmStub(),
      settings: settingsStub({ describe: () => [section, { ns: 'llm-deepseek', value: {}, user: {}, revision: 2 }] }),
      credentials: { resolve: async () => ({ value: 'stored-key' }) },
    })
    const answered = await probe(route, { provider: 'amd-gateway', model: 'vision-x' })

    assert.equal(answered.code, 200)
    assert.deepEqual(answered.payload, { modalities: ['text', 'image'] }, 'the canonical order is this page\'s, not the reply\'s')
    assert.equal(probeFetch.calls[0].url, 'https://claude.test/v1/models?limit=1000')
    assert.equal(probeFetch.calls[0].options.headers.get('x-api-key'), 'stored-key')
    assert.equal(probeFetch.calls[0].options.headers.get('anthropic-version'), '2023-06-01')
    assert.equal(probeFetch.calls[0].options.headers.get('authorization'), null, 'this protocol carries its key in its own header')
  } finally {
    probeFetch.restore()
  }
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
  const collected = [tree]
  for (const child of tree.children ?? []) {
    if (child !== null && typeof child === 'object' && typeof child.type === 'function') {
      collected.push(child, ...flatten(child.type(child.props)))
    } else {
      collected.push(...flatten(child))
    }
  }
  return collected
}

/** Every string rendered in one flattened tree, for what a user can read. */
const texts = (flat) => flat.flatMap((node) => node.children ?? []).filter((child) => typeof child === 'string')

const openRouterProvider = {
  provider: 'openrouter-cm',
  displayName: 'OpenRouter',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'openrouter-cm'],
  editable: true,
  revision: 4,
  models: [
    { id: 'union-alpha', name: 'Union Alpha', effective: ['text', 'image'], overridden: true },
    { id: 'plain-model', name: 'Plain Model', effective: ['text'], overridden: false },
    { id: 'catalog-vision', name: 'Catalog Vision', effective: ['text', 'image'], overridden: false },
    { id: 'video-model', name: 'Video Model', effective: ['text', 'image'], overridden: true, other: ['video'] },
  ],
}

const deepSeekProvider = {
  provider: 'deepseek-official',
  displayName: 'DeepSeek',
  settingsNs: 'llm-deepseek',
  settingsPath: [],
  editable: false,
  refusal: 'other-adapter',
  revision: 2,
  models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', effective: ['text'], overridden: false }],
}

/**
 * URL-routed answers for the endpoints the page uses. `list` is the body the
 * read answers with; `save` and `discover` are whole answers (body plus
 * status), because a case has to be able to make exactly that call fail.
 */
const routing = ({ list, save, discover } = {}) => (url) => {
  // The shell opens on the retry tab, so that read has to answer too: the two
  // panels share the harness's hook cells across a tab switch.
  if (url.endsWith('/llm-retry/routes')) return response({ routes: [] })
  if (url.endsWith('/model-input/providers')) return response(list ?? { providers: [] })
  if (url.endsWith('/model-input/discover')) {
    return response(discover?.body ?? { modalities: ['text', 'image'] }, discover?.ok ?? true, discover?.status ?? 200)
  }
  if (url.endsWith('/model-input/modalities')) {
    return response(save?.body ?? { provider: openRouterProvider }, save?.ok ?? true, save?.status ?? 200)
  }
  return response({}, false, 404)
}

/**
 * Mount the real client bundle with a hook harness and take the settings page
 * that seats the model-input tab (the section component the slot was handed),
 * already opened on that tab.
 * @param options - the URL-routed fetch stub.
 * @returns `calls` (every request the page made) and `render()`.
 */
function mountClient({ fetch }) {
  const calls = []
  const registrations = new Map()
  let exported
  const states = []
  let cursor = 0
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
  const Section = registrations.get('mcp-manager-custom-settings')
  assert.equal(typeof Section, 'function', 'the settings page must be seated under its own entry id')

  const render = () => {
    cursor = 0
    const flat = flatten(Section({ t }))
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
  }
  return {
    calls,
    render,
    /**
     * Open every provider card. One render per card: a toggle reads the list of
     * open cards its own render drew, so two clicks from one render would leave
     * only the last card open.
     */
    expandAll() {
      for (let guard = 0; guard < 20; guard += 1) {
        const view = render()
        const closed = view.flat.find(node => node.type === 'button' && node.props?.['aria-expanded'] === false)
        if (closed === undefined) return view
        closed.props.onClick()
      }
      throw new Error('no card opened; the disclosure is not a button')
    },
    /** One render on the model-input tab, with every card open and read. */
    async open() {
      render()
      await settle()
      render().button('tabModelInput').props.onClick()
      render()
      // The panel mounts on that render and sends its first read from it, so the
      // answer has one more tick to travel.
      await settle()
      this.expandAll()
      return render()
    },
  }
}

/** The box one model's one modality is drawn as. */
const chip = (view, model, key) => view.labelled(`${model} · ${key}`)
/** Whether one model's row offers to reset itself to dsh's own answer. */
const hasInherit = (view, model) => view.flat.some(node => node.props?.['aria-label'] === `${model} · choiceInherit`)
/** Whether one model's row offers to ask the endpoint what the model takes. */
const hasAutoDetect = (view, model) => view.flat.some(node => node.props?.['aria-label'] === `${model} · autoFetch`)
/** The state dot one model's row wears, so a case can name the colour it paints. */
const dot = (view, model) => {
  const found = view.flat.find((node) => {
    const label = node.props?.['aria-label']
    return typeof label === 'string' && label.startsWith(`${model} · modelStatus`)
  })
  assert.ok(found, `expected a state dot on model "${model}"`)
  return found
}

it('gives every model a row of boxes showing what it takes', async () => {
  const app = mountClient({ fetch: routing({ list: { providers: [openRouterProvider, deepSeekProvider] } }) })
  const view = await app.open()

  assert.ok(view.text.includes('tabModelInput'), 'the strip lists the area as its own tab')
  assert.equal(app.calls[0].url, '/mcp-manager/api/llm-retry/routes', 'the shell opens on the retry tab, which polls first')
  assert.ok(
    app.calls.some((request) => request.url === '/mcp-manager/api/model-input/providers'),
    'the tab asks the host for the model lists when it opens',
  )
  assert.ok(
    ['union-alpha', 'plain-model', 'catalog-vision'].every(model => view.text.includes(model)),
    'every model of an open card is listed',
  )
  for (const model of openRouterProvider.models.map(entry => entry.id)) {
    assert.equal(chip(app.render(), model, 'modalityText').props.checked, true, '文本 is ticked on every row')
    assert.equal(chip(app.render(), model, 'modalityText').props.disabled, true, 'and cannot be unticked')
  }
  assert.equal(chip(view, 'union-alpha', 'modalityImage').props.checked, true, 'a declared vision model is ticked')
  assert.equal(chip(view, 'plain-model', 'modalityImage').props.checked, false, 'a text-only model is not')
  assert.equal(chip(view, 'catalog-vision', 'modalityImage').props.checked, true, 'nor is a model the catalog says takes images')
  assert.equal(view.text.includes('stateDeclared'), false, 'no row narrates where its answer comes from')
  assert.equal(view.text.includes('stateInherited'), false, 'neither does it name the state it is not in')
  assert.equal(dot(view, 'OpenRouter').props['data-state'], 'active', 'a route with any stored declaration wears the blue dot')
  assert.equal(dot(view, 'DeepSeek').props['data-state'], 'idle', 'a route none of whose models was written wears the grey one')
  assert.ok(hasInherit(view, 'union-alpha'), 'a row with a stored declaration can be reset')
  assert.ok(hasInherit(view, 'plain-model'), 'and so can one that never had one, which the reset leaves as it is')
  assert.equal(dot(view, 'union-alpha').props['data-state'], 'active', 'the row this page wrote wears the blue dot')
  assert.equal(dot(view, 'plain-model').props['data-state'], 'idle', 'the row it never wrote wears the grey one')
})

it('shows a modality it has no box for as its own locked chip', async () => {
  const app = mountClient({ fetch: routing({ list: { providers: [openRouterProvider] } }) })
  const view = await app.open()

  assert.equal(chip(view, 'video-model', 'video').props.checked, true, 'the name the route stores is on the row')
  assert.equal(chip(view, 'video-model', 'video').props.disabled, true, 'and this page cannot change it')
})

it('writes a ticked box as one model-scoped edit, with the revision it read', async () => {
  const app = mountClient({ fetch: routing({ list: { providers: [openRouterProvider] } }) })
  await app.open()
  chip(app.render(), 'catalog-vision', 'modalityImage').props.onChange({ target: { checked: false } })
  await settle()

  const posted = app.calls.filter((request) => request.url.endsWith('/model-input/modalities'))
  assert.deepEqual(plain(posted.map((request) => request.body)), [{
    provider: 'openrouter-cm',
    model: 'catalog-vision',
    modalities: ['text'],
    revision: 4,
  }], 'unticking the box states text only')

  chip(app.render(), 'plain-model', 'modalityImage').props.onChange({ target: { checked: true } })
  await settle()
  const ticked = app.calls.filter((request) => request.url.endsWith('/model-input/modalities')).at(-1)
  assert.deepEqual(plain(ticked.body), {
    provider: 'openrouter-cm',
    model: 'plain-model',
    modalities: ['text', 'image'],
    revision: 4,
  }, 'ticking it states both, in the order the adapter reads them')
})

it('asks the host to remove a declaration when the row goes back to the catalog', async () => {
  const app = mountClient({ fetch: routing({ list: { providers: [openRouterProvider] } }) })
  await app.open()
  app.render().labelled('union-alpha · choiceInherit').props.onClick()
  await settle()

  const posted = app.calls.filter((request) => request.url.endsWith('/model-input/modalities'))
  assert.deepEqual(plain(posted[0].body), {
    provider: 'openrouter-cm',
    model: 'union-alpha',
    modalities: null,
    revision: 4,
  }, 'inherit is a write of its own, not an empty list')
})

it('turns the dot grey again once the row has been reset', async () => {
  // The dot is the host's answer, not a flag the click sets, so this case holds a
  // list that changes when the write lands: the read after the reset has to be
  // what repaints the row.
  const model = { id: 'union-alpha', name: 'Union Alpha', effective: ['text', 'image'] }
  let stored = true
  const app = mountClient({
    fetch: (url) => {
      if (url.endsWith('/llm-retry/routes')) return response({ routes: [] })
      if (url.endsWith('/model-input/modalities')) {
        stored = false
        return response({ provider: { ...openRouterProvider, models: [{ ...model, overridden: false }] } })
      }
      return response({ providers: [{ ...openRouterProvider, models: [{ ...model, overridden: stored }] }] })
    },
  })
  const view = await app.open()
  assert.equal(dot(view, 'union-alpha').props['data-state'], 'active', 'the stored declaration paints the blue dot')

  app.render().labelled('union-alpha · choiceInherit').props.onClick()
  await settle()

  assert.equal(dot(app.render(), 'union-alpha').props['data-state'], 'idle', 'and the read after the reset paints grey')
})

it('shows the localized message for a refused write, and reads the row again', async () => {
  const app = mountClient({
    fetch: routing({
      list: { providers: [openRouterProvider] },
      save: { body: { error: 'the settings section changed', code: 'input/conflict' }, ok: false, status: 409 },
    }),
  })
  await app.open()
  chip(app.render(), 'catalog-vision', 'modalityImage').props.onChange({ target: { checked: false } })
  await settle()

  assert.ok(app.render().text.includes('conflict'), 'the code is localized rather than echoed')
  assert.equal(
    chip(app.render(), 'catalog-vision', 'modalityImage').props.checked,
    true,
    'a refused write leaves the row on what the host reports',
  )
})

it('names the reason a foreign route is read-only, and keeps its boxes inert', async () => {
  const app = mountClient({ fetch: routing({ list: { providers: [deepSeekProvider] } }) })
  const view = await app.open()

  assert.ok(view.text.includes('refusalOtherAdapter'), 'the reader learns which adapter owns the route')
  assert.equal(chip(view, 'deepseek-chat', 'modalityImage').props.disabled, true)
  assert.equal(view.labelled('deepseek-chat · modalityImage').props.checked, false, 'the fact is still shown')
  assert.equal(hasInherit(view, 'deepseek-chat'), false, 'a route that cannot be written offers no reset either')
  assert.equal(hasAutoDetect(view, 'deepseek-chat'), false, 'and no capability check')
  assert.equal(dot(view, 'deepseek-chat').props['data-state'], 'idle', 'the dot still says where that row stands')
  assert.equal(app.calls.some((request) => request.url.endsWith('/model-input/modalities')), false, 'nothing is posted')
})

it('reports the seam a deployment does not mount', async () => {
  const app = mountClient({ fetch: routing({ list: { providers: [], unavailable: 'settings' } }) })
  const view = await app.open()

  assert.ok(view.text.includes('modelUnavailableSettings'), 'the missing half is named')
  assert.equal(view.text.includes('modelEmpty'), false, 'an unavailable list is not reported as an empty one')
})

it('auto-detect writes what the route\'s endpoint reported, for that model alone', async () => {
  const app = mountClient({
    fetch: routing({
      list: { providers: [openRouterProvider] },
      discover: { body: { modalities: ['text', 'image'] } },
    }),
  })
  await app.open()
  app.render().labelled('plain-model · autoFetch').props.onClick()
  await settle()

  const asked = app.calls.filter((request) => request.url.endsWith('/model-input/discover'))
  assert.deepEqual(plain(asked.map((request) => request.body)), [{ provider: 'openrouter-cm', model: 'plain-model' }],
    'the check names one route and one model')
  const posted = app.calls.filter((request) => request.url.endsWith('/model-input/modalities'))
  assert.deepEqual(plain(posted.map((request) => request.body)), [{
    provider: 'openrouter-cm',
    model: 'plain-model',
    modalities: ['text', 'image'],
    revision: 4,
  }], 'the answer lands as the same model-scoped write a ticked box makes, revision and all')
  assert.ok(app.render().text.includes('detectImage'), 'and the row says what the check answered')
})

it('a check that answers text only states that answer, so a quiet box is a seen result', async () => {
  const app = mountClient({
    fetch: routing({
      list: { providers: [openRouterProvider] },
      discover: { body: { modalities: ['text'] } },
    }),
  })
  await app.open()
  app.render().labelled('plain-model · autoFetch').props.onClick()
  await settle()

  const posted = app.calls.filter((request) => request.url.endsWith('/model-input/modalities'))
  assert.equal(plain(posted[0].body.modalities).join('+'), 'text', 'text only is still a written answer')
  assert.ok(app.render().text.includes('detectTextOnly'), 'the row says the check succeeded and found no image')
})

it('a failed capability check says why, in the page\'s words, and writes nothing', async () => {
  const app = mountClient({
    fetch: routing({
      list: { providers: [openRouterProvider] },
      discover: { body: { error: 'the endpoint does not list model "plain-model"', code: 'input/discover-no-model' }, ok: false, status: 404 },
    }),
  })
  await app.open()
  app.render().labelled('plain-model · autoFetch').props.onClick()
  await settle()

  assert.ok(app.render().text.includes('discoverNoModel'), 'the code is localized rather than echoed')
  assert.equal(
    app.calls.some((request) => request.url.endsWith('/model-input/modalities')),
    false,
    'a check that brought no answer leaves the row untouched',
  )
})
