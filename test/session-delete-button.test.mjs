/**
 * The Session-header delete control's behaviour, driven through the real client
 * bundle in a hook harness: click → preview → confirm → `POST /sessions/delete`,
 * then the landing state.
 *
 * Two things are worth testing here beyond "the numbers are rendered":
 *
 * - the dialog's facts come from the host's dry run (`GET /sessions/preview`),
 *   fetched when the dialog opens, so the user sees what will go before deciding;
 * - the landing state. A successful delete removes the session the header
 *   belongs to, so "stay where you are" is impossible; what the user expects is
 *   the workspace they were already working in, which is what DSH's own New
 *   Session button does.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** The `t` this suite renders with: identity, so assertions name the key. */
const t = (key) => key

const settle = () => new Promise((resolve) => setImmediate(resolve))

/** Detach one recorded value from the bundle's VM realm so it compares by shape. */
const plain = (value) => JSON.parse(JSON.stringify(value))

/** One HTTP answer in the shape the client's `api()` helper expects. */
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

/**
 * Flatten a rendered tree, expanding function components the way React would —
 * the confirmation dialog is one, and its buttons only exist once it is called.
 * The components in this tree (the dialog, the icon) are hook-free; the
 * control's own hook state is owned by the caller's explicit renders.
 */
function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return []
  if (typeof tree.type === 'function') return [tree, ...nodes(tree.type(tree.props))]
  return [tree, ...(tree.children ?? []).flatMap(nodes)]
}

/** Every string rendered in a tree, for assertions about what a user can read. */
const texts = (tree) => nodes(tree).flatMap(node => node.children ?? []).filter(child => typeof child === 'string')

/** The rendered button carrying a given aria-label. */
function button(tree, label) {
  const found = nodes(tree).find((node) => node.props?.['aria-label'] === label)
  assert.ok(found, `expected a button labelled ${label}`)
  return found
}

/** The confirmation dialog's destructive action. */
function confirmButton(tree) {
  const found = nodes(tree).find((node) => node.props?.className === 'mm_btn danger')
  assert.ok(found, 'expected the confirmation dialog')
  return found
}

/**
 * Mount the real client bundle with a hook harness and mount the header slot.
 * @param options - URL-routed fetch stub, the session/workspace state the selectors read, an optional create override, and the platform modules the bundle may require.
 * @returns the render/click helpers plus the recorded calls.
 */
function mount({ fetch, session, workspace, create, primitives }) {
  const calls = []
  const registrations = new Map()
  let exported
  let states = [], cursor = 0
  const react = {
    // Children land in `props` as well as in the element's own slot, the way
    // React delivers them: a component in the tree (the shell's tooltip, when a
    // case supplies one) renders what it was handed by reading `props.children`.
    createElement: (type, props, ...children) => {
      const kids = children.flat(Infinity)
      return { type, props: { ...props, children: kids }, children: kids }
    },
    useState: (initial) => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = value }]
    },
    useEffect: () => {},
    useCallback: (callback) => callback,
  }
  // The bundle's `require` resolves platform module-table ids. Only `react` is
  // always there: an id the case does not supply is absent, which is exactly
  // how the control's two fallbacks (no react-dom, no ui-primitives) are reached.
  const modules = {
    'react': react,
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory((id) => modules[id]) } } },
    fetch: async (url, options) => {
      calls.push({ url, body: options?.body === undefined ? undefined : JSON.parse(options.body) })
      return fetch(url)
    },
    setInterval: () => 1,
    clearInterval: () => {},
  })
  const created = []
  const opened = []
  const cleared = []
  let refreshed = 0
  const ctx = {
    effect(fn) { fn() },
    locale: {
      register: () => () => {},
      bind: () => t,
    },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => { registrations.set(options.name, component) },
    },
    sessions: {
      create: create ?? (async (options) => { created.push(options); return 'created-1' }),
      open: (id) => { opened.push(id) },
      clear: () => { cleared.push(true) },
      refresh: async () => { refreshed += 1 },
    },
  }
  exported.apply(ctx)
  const SessionDelete = registrations.get('conversation.session.header.utilities')
  assert.equal(typeof SessionDelete, 'function', 'the header slot must seat the delete control')
  const props = {
    sessionId: 's1',
    t,
    useSessions: (selector) => selector(session),
    useWorkspaces: (selector) => selector(workspace),
  }
  return {
    calls, created, opened, cleared,
    get refreshed() { return refreshed },
    /** Render once (the harness reuses its state cells, so this advances hooks). */
    render() {
      cursor = 0
      return SessionDelete(props)
    },
    /**
     * Click the control and let the host answer. The dry run is fetched before
     * the dialog opens, so the resolved tree is the dialog's first frame.
     */
    async ask() {
      button(this.render(), 'deleteSession').props.onClick()
      await settle()
      return this.render()
    },
    /** Click through the dialog and let the requests settle. */
    async confirm() {
      confirmButton(await this.ask()).props.onClick()
      await settle()
      return this.render()
    },
  }
}

const sessionState = (overrides = {}) => ({ ids: ['s1'], byId: { s1: { cwd: '/ws/app', title: '分析一下' } }, current: 's1', ...overrides })
const workspaceState = (items = [{ workspaceId: 'w1', path: '/ws/app', sessionIds: ['s1'] }], archived = []) =>
  ({ items, archivedSessionIds: archived, state: 'idle', phase: 'ready', error: null })

/** A host dry run shaped like `SessionPreview`. */
const previewBody = {
  sessionId: 's1',
  cwd: '/ws/app',
  createdAt: 1_760_000_000_000,
  log: { path: '/home/u/.dsh/sessions/--ws-app--/s1', bytes: 1_572_864, files: 3 },
  cache: { path: '/home/u/.dsh/storages/session_projcache/sessions/s1.json', bytes: 4096, files: 1 },
  spill: { path: '/tmp/dsh-spill-a1b2c3/session-9f8e7d', bytes: 20_480, files: 2 },
  totalBytes: 1_597_696,
}

/**
 * The two endpoints the control uses, split by URL so a case can make exactly
 * one of them fail: the dry run and the delete answer the same refusal codes,
 * and mixing them up would let a test pass for the wrong reason.
 */
const routing = ({ preview = { body: previewBody }, remove = { body: { deleted: true } } } = {}) =>
  (url) => {
    const answer = url.includes('/sessions/preview') ? preview : remove
    return response(answer.body, answer.ok ?? true, answer.status ?? 200)
  }

it('wears the shell\u2019s own hover bubble, positioned by the shell', () => {
  // The bubble is the platform primitives module's `Tooltip` — the component
  // DSH's own header buttons use. Only the *request* for it is this control's
  // business (which label, which side, how long a hover delay); where the
  // bubble lands at a viewport edge is the shell component's own fit pass, and
  // its behaviour is covered where it lives, not here.
  const seen = []
  const Tooltip = (props) => {
    seen.push(props)
    return { type: 'span', props: { className: 'stub_bubbleHost' }, children: props.children }
  }
  const app = mount({
    fetch: routing({}),
    session: sessionState(),
    workspace: workspaceState(),
    primitives: { Tooltip },
  })
  // Walking the tree is what invokes the stubbed component — the harness
  // expands function elements only while flattening, exactly as React would
  // while rendering.
  const control = button(app.render(), 'deleteSession')

  assert.equal(seen.length, 1, 'the anchor is handed to the shell\u2019s bubble exactly once')
  assert.equal(seen[0].label, 'deleteSession', 'the bubble names the action')
  assert.equal(seen[0].side, 'bottom', 'it hangs under the control, like the shell\u2019s header buttons')
  assert.equal(seen[0].delayMs, 500, 'the same hover delay those buttons use')
  assert.equal(control.props.title, undefined, 'no native bubble stacked underneath it')
})

it('falls back to the browser\u2019s own bubble when the platform has no primitives', () => {
  const app = mount({ fetch: routing({}), session: sessionState(), workspace: workspaceState() })
  const control = button(app.render(), 'deleteSession')

  assert.equal(control.props.title, 'deleteSession', 'the hover hint survives without the styled bubble')
  assert.equal(control.props.disabled, false, 'and the control itself is unaffected')
})

it('shows the session\u2019s identity and disk footprint before confirming', async () => {
  const app = mount({ fetch: routing({}), session: sessionState(), workspace: workspaceState() })
  const shown = await app.ask()
  const text = texts(shown).join(' | ')

  assert.equal(app.calls[0].url, '/mcp-manager/api/sessions/preview?sessionId=s1', 'the dialog opens by asking the host')
  assert.ok(text.includes('sessionInfoId') && text.includes('s1'), 'the session id is shown')
  assert.ok(text.includes('分析一下'), 'the row\u2019s title is shown')
  assert.ok(text.includes('/ws/app'), 'the working directory is shown')
  assert.ok(text.includes('/home/u/.dsh/sessions/--ws-app--/s1'), 'where the data lives is shown')
  assert.ok(text.includes('1.5 MB'), 'the log store is measured, not estimated')
  assert.ok(text.includes('20 KB'), 'the spill store is itemized')
  assert.ok(text.includes('4.0 KB'), 'the projection cache is itemized')
  assert.equal(confirmButton(shown).props.disabled, false, 'a healthy session leaves the action available')
})

it('only renders the dialog once the facts are in, so opening it cannot reflow', async () => {
  const app = mount({ fetch: routing({}), session: sessionState(), workspace: workspaceState() })

  // Click: the dry run starts, and nothing is on screen yet — a placeholder
  // dialog that the facts then replace is what made the card grow a frame after
  // it appeared (the "flash").
  button(app.render(), 'deleteSession').props.onClick()
  const duringRead = nodes(app.render()).filter(node => node.props?.className === 'mm_overlay')
  assert.deepEqual(duringRead, [], 'the dialog waits for the host rather than showing a placeholder')

  await settle()
  const shown = app.render()
  assert.ok(texts(shown).includes('1.5 MB'), 'its first frame already carries the measured facts')
  assert.equal(
    nodes(shown).some(node => node.props?.className === 'mm_sessionInfoPending'),
    false,
    'no pending block is ever rendered',
  )
})

it('reports a refusal from the dry run and locks the action', async () => {
  const app = mount({
    fetch: routing({
      preview: {
        body: { error: 'session "s1" is running', code: 'session/running' },
        ok: false,
        status: 409,
      },
    }),
    session: sessionState(),
    workspace: workspaceState(),
  })
  const shown = await app.ask()

  assert.ok(texts(shown).includes('deleteSessionRunning'), 'the refusal is localized in the dialog')
  assert.equal(confirmButton(shown).props.disabled, true, 'a refused delete cannot be confirmed')
})

it('deletes, then starts the next session in the deleted session\u2019s workspace', async () => {
  const app = mount({ fetch: routing({}), session: sessionState(), workspace: workspaceState() })
  await app.confirm()

  assert.deepEqual(plain(app.calls[1]), { url: '/mcp-manager/api/sessions/delete', body: { sessionId: 's1' } })
  assert.deepEqual(plain(app.created), [{ workspaceId: 'w1' }], 'the replacement lands in the same workspace')
  assert.deepEqual(app.opened, ['created-1'], 'and becomes the current session')
  assert.deepEqual(app.cleared, [], 'the user never sees the empty workspace-picker state')
  assert.equal(app.refreshed, 1)
})

it('falls back to the deleted session\u2019s directory when no workspace accounts for it', async () => {
  const app = mount({ fetch: routing({}), session: sessionState(), workspace: workspaceState([]) })
  await app.confirm()

  assert.deepEqual(plain(app.created), [{ cwd: '/ws/app' }])
  assert.deepEqual(app.opened, ['created-1'])
})

it('clears to the no-session state when the session has neither workspace nor directory', async () => {
  const app = mount({
    fetch: routing({}),
    session: sessionState({ byId: { s1: {} } }),
    workspace: workspaceState([]),
  })
  await app.confirm()

  assert.deepEqual(plain(app.created), [])
  assert.deepEqual(app.cleared, [true])
})

it('keeps the dialog open with the host\u2019s refusal and starts nothing', async () => {
  const app = mount({
    fetch: routing({
      remove: {
        body: { error: 'session "s1" is running', code: 'session/running' },
        ok: false,
        status: 409,
      },
    }),
    session: sessionState(),
    workspace: workspaceState(),
  })
  const shown = await app.confirm()

  assert.ok(texts(shown).includes('deleteSessionRunning'), 'the refusal is localized inside the dialog')
  assert.deepEqual(plain(app.created), [])
  assert.deepEqual(app.opened, [])
  assert.deepEqual(app.cleared, [])
  assert.equal(app.refreshed, 0)
})

it('falls back to the no-session state when the Host refuses the new session', async () => {
  const app = mount({
    fetch: routing({}),
    session: sessionState(),
    workspace: workspaceState(),
    create: async () => { throw new Error('workspace/not-found') },
  })
  await app.confirm()

  assert.deepEqual(app.opened, [], 'a refused create never becomes current')
  assert.deepEqual(app.cleared, [true], 'the deleted session must not stay selected')
  assert.equal(app.refreshed, 1)
})

it('still offers the delete when the dry run itself fails', async () => {
  const app = mount({
    fetch: () => { throw new Error('network down') },
    session: sessionState(),
    workspace: workspaceState(),
  })
  const shown = await app.ask()

  assert.ok(texts(shown).includes('sessionInfoFailed'), 'the failed read is reported, not hidden')
  assert.equal(confirmButton(shown).props.disabled, false, 'the host re-validates; a failed read does not block')
})
