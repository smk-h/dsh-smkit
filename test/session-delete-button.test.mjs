/**
 * The Session-header delete control's behaviour, driven through the real client
 * bundle in a hook harness: click → confirm → `POST /sessions/delete`, then the
 * landing state.
 *
 * The landing state is the point of this suite. A successful delete removes the
 * session the header belongs to, so "stay where you are" is impossible; what the
 * user expects is the workspace they were already working in. DSH's own New
 * Session button does exactly that (`ui-workspace`'s `startSession` prefers the
 * current session's workspace), so the control reproduces it with the two
 * standard selector hooks every slot entry receives: the deleted session's
 * workspace id and directory are read before the delete, then handed to
 * `sessions.create` and opened.
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
 * @param options - fetch stub, the session/workspace state the selectors read, and an optional create override.
 * @returns the render/click helpers plus the recorded service calls.
 */
function mount({ fetch, session, workspace, create }) {
  const calls = []
  const registrations = new Map()
  const stub = {
    id: 's1',
    ok: true,
    status: 200,
    body: { deleted: true, sessionId: 's1', live: false, archived: true, removed: [] },
  }
  let exported
  let states = [], cursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial) => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = value }]
    },
    useEffect: () => {},
    useCallback: (callback) => callback,
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react) } } },
    fetch: async (url, options) => {
      calls.push({ url, body: options?.body === undefined ? undefined : JSON.parse(options.body) })
      return fetch(stub)
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
    /** Click the control, then re-render so the confirmation dialog appears. */
    ask() {
      button(this.render(), 'deleteSession').props.onClick()
      return this.render()
    },
  }
}

const sessionState = (overrides = {}) => ({ ids: ['s1'], byId: { s1: { cwd: '/ws/app' } }, current: 's1', ...overrides })
const workspaceState = (items = [{ workspaceId: 'w1', path: '/ws/app', sessionIds: ['s1'] }], archived = []) =>
  ({ items, archivedSessionIds: archived, state: 'idle', phase: 'ready', error: null })

it('deletes, then starts the next session in the deleted session\u2019s workspace', async () => {
  const app = mount({
    fetch: () => ({ ok: true, status: 200, json: async () => ({ deleted: true }) }),
    session: sessionState(),
    workspace: workspaceState(),
  })
  confirmButton(app.ask()).props.onClick()
  await settle()

  assert.deepEqual(app.calls, [{ url: '/mcp-manager/api/sessions/delete', body: { sessionId: 's1' } }])
  assert.deepEqual(plain(app.created), [{ workspaceId: 'w1' }], 'the replacement lands in the same workspace')
  assert.deepEqual(app.opened, ['created-1'], 'and becomes the current session')
  assert.deepEqual(app.cleared, [], 'the user never sees the empty workspace-picker state')
  assert.equal(app.refreshed, 1)
})

it('falls back to the deleted session\u2019s directory when no workspace accounts for it', async () => {
  const app = mount({
    fetch: () => ({ ok: true, status: 200, json: async () => ({ deleted: true }) }),
    session: sessionState(),
    workspace: workspaceState([]),
  })
  confirmButton(app.ask()).props.onClick()
  await settle()

  assert.deepEqual(plain(app.created), [{ cwd: '/ws/app' }])
  assert.deepEqual(app.opened, ['created-1'])
})

it('clears to the no-session state when the session has neither workspace nor directory', async () => {
  const app = mount({
    fetch: () => ({ ok: true, status: 200, json: async () => ({ deleted: true }) }),
    session: sessionState({ byId: { s1: {} } }),
    workspace: workspaceState([]),
  })
  confirmButton(app.ask()).props.onClick()
  await settle()

  assert.deepEqual(plain(app.created), [])
  assert.deepEqual(app.cleared, [true])
})

it('keeps the dialog open with the host\u2019s refusal and starts nothing', async () => {
  const app = mount({
    fetch: () => ({ ok: false, status: 409, json: async () => ({ error: 'session "s1" is running', code: 'session/running' }) }),
    session: sessionState(),
    workspace: workspaceState(),
  })
  let tree = app.ask()
  confirmButton(tree).props.onClick()
  await settle()

  tree = app.render()
  assert.ok(
    nodes(tree).some((node) => node.children?.includes('deleteSessionRunning')),
    'the refusal is localized inside the dialog',
  )
  assert.deepEqual(plain(app.created), [])
  assert.deepEqual(app.opened, [])
  assert.deepEqual(app.cleared, [])
  assert.equal(app.refreshed, 0)
})

it('falls back to the no-session state when the Host refuses the new session', async () => {
  const app = mount({
    fetch: () => ({ ok: true, status: 200, json: async () => ({ deleted: true }) }),
    session: sessionState(),
    workspace: workspaceState(),
    create: async () => { throw new Error('workspace/not-found') },
  })
  confirmButton(app.ask()).props.onClick()
  await settle()

  assert.deepEqual(app.opened, [], 'a refused create never becomes current')
  assert.deepEqual(app.cleared, [true], 'the deleted session must not stay selected')
  assert.equal(app.refreshed, 1)
})
