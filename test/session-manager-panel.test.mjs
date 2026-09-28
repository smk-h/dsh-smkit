/**
 * The session-manager panel, driven through the real client bundle on the
 * merged section's hook harness: open the tab, read the listing the host
 * serves, select rows, confirm a batch delete, and read the report.
 *
 * What is pinned is the shape a user meets: workspace groups with their
 * accounting counts, the ungrouped tail, the archive set one sub-tab away,
 * the toolbar's tri-state select-all and armed delete, the confirm dialog
 * carrying the rows it is confirming (captured at open time, not re-derived),
 * the POST's body, and per-session refusals reported without failing the
 * batch. The translator is the identity, so every copy assertion names the
 * dictionary key; titles and paths come from the fetch stub, which is what
 * the page is supposed to render verbatim.
 *
 * Harness discipline (same as `skills-page.test.mjs`): every tree read goes
 * through `app.walk`, which resets the hook cursor to where the last render
 * ended — a bare read would re-execute the panel's component slot with a
 * misaligned cursor and read garbage state.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** The `t` this suite renders with: identity, so assertions name the key. */
const t = (key) => key

const settle = () => new Promise((resolve) => setImmediate(resolve))

/** One HTTP answer in the shape the client's `api()` helper expects. */
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

/** One session row with only the fields the panel reads. */
function session(fields) {
  return { live: false, running: false, ...fields }
}

/** The listing the stubbed host serves. */
const LIST = {
  workspaces: [{ workspaceId: 'w1', path: '/work/app', title: 'My App' }],
  sessions: [
    session({ sessionId: 's-1', title: 'Session one', workspaceId: 'w1', live: true, running: true, sizeBytes: 640 * 1024 }),
    session({ sessionId: 's-2', title: 'Session two', workspaceId: 'w1', sizeBytes: 1024 }),
    session({ sessionId: 's-stray', cwd: '/nowhere/stray' }),
    session({ sessionId: 's-arch', title: 'Archived one', workspaceId: 'w1' }),
  ],
  archivedSessionIds: ['s-arch'],
}

/** Flatten a rendered tree, expanding function components the way React does. */
function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return []
  if (typeof tree.type === 'function') return [tree, ...nodes(tree.type(tree.props))]
  return [tree, ...(tree.children ?? []).flatMap(nodes)]
}

/** Every string in a tree, for assertions about what a user can read. */
const text = (tree) =>
  typeof tree === 'string'
    ? tree
    : typeof tree?.type === 'function'
      ? text(tree.type(tree.props))
      : (tree?.children ?? []).map(text).join(' ')

/** All nodes whose props match a predicate, in render order. */
const findAll = (tree, matches) => nodes(tree).filter(matches)

/**
 * Mount the real bundle and the merged section on a hook harness; the caller
 * opens the session-manager tab the way a user does.
 */
function mount(routes) {
  const calls = []
  const registrations = new Map()
  let exported
  let states = []
  let cursor = 0
  let rendered = 0
  let effectSlot = 0
  let capturing = false
  let effects = new Map()
  const react = {
    createElement: (type, props, ...children) => {
      const kids = children.flat(Infinity)
      return { type, props: { ...props, children: kids }, children: kids }
    },
    useState: (initial) => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value
      }]
    },
    useEffect: (effect) => { if (capturing) effects.set(effectSlot++, effect) },
    useCallback: (callback) => callback,
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react) } } },
    fetch: async (rawUrl, options = {}) => {
      const url = String(rawUrl)
      const method = options.method ?? 'GET'
      const body = options.body === undefined ? undefined : JSON.parse(String(options.body))
      calls.push({ url, method, body })
      const answer = routes(url, method, body)
      assert.ok(answer !== undefined, `the suite must route ${method} ${url}`)
      return answer
    },
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
  })
  exported.apply({
    effect(fn) { fn() },
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => { registrations.set(options.id, component) },
    },
  })
  const section = registrations.get('mcp-manager')
  assert.ok(section, 'the merged settings section must be registered')
  return {
    calls,
    openTab(label) {
      cursor = 0
      const tree = section()
      const shellSlots = cursor
      const tab = nodes(tree).find(
        (node) => node.props?.role === 'tab' && node.children.includes(label),
      )
      assert.ok(tab, `the merged section must offer the ${label} tab`)
      tab.props.onClick()
      states.length = shellSlots
    },
    render() {
      cursor = 0
      effectSlot = 0
      capturing = true
      const tree = section()
      const shellSlots = cursor
      nodes(tree)
      cursor = shellSlots
      rendered = cursor
      capturing = false
      return tree
    },
    /** Walk a rendered tree from the hook position its render ended on. */
    walk(read) {
      cursor = rendered
      capturing = false
      return read()
    },
    effects() {
      const pending = [...effects.values()]
      effects.clear()
      for (const effect of pending) effect()
    },
  }
}

/**
 * Open the tab, let the first read land, and hand back read helpers that all
 * go through `walk` (cursor discipline).
 */
async function opened(routes) {
  const app = mount(routes)
  app.openTab('tabSessions')
  let tree = app.render()
  app.effects()
  await settle()
  tree = app.render()
  const again = () => { tree = app.render() }
  const read = () => app.walk(() => text(tree))
  const picks = (matches) => app.walk(() => findAll(tree, matches))
  return { app, again, read, picks }
}

/** The row checkboxes, select-all first. */
const checkboxes = (picks) => picks((node) => node.props?.type === 'checkbox')

/** The toolbar's delete action (no `aria-busy`), not the dialog's confirm. */
const toolbarDelete = (picks) =>
  picks((node) => node.props?.className === 'smkit-ui-button danger' && node.props?.['aria-busy'] === undefined)[0]

/** The confirmation dialog's destructive action, carrying its own `aria-busy`. */
const dialogConfirm = (picks) =>
  picks((node) => node.props?.className === 'smkit-ui-button danger' && node.props?.['aria-busy'] !== undefined)[0]

/** Tick one row checkbox by the session title the user reads. */
function check(picks, label, checked) {
  const box = picks((node) => node.props?.type === 'checkbox' && node.props?.['aria-label'] === label)[0]
  assert.ok(box, `expected a checkbox labelled ${label}`)
  box.props.onChange({ target: { checked } })
}

it('groups the active view by workspace, trails the ungrouped and hides archived rows', async () => {
  const page = await opened((url, method) => {
    if (method === 'GET' && url.includes('/sessions/manager')) return response(LIST)
  })
  const shown = page.read()
  // Workspace groups, in registry order, with the ungrouped tail after them.
  assert.ok(shown.includes('My App'), 'the workspace title renders')
  assert.ok(shown.includes('Session one') && shown.includes('Session two'), 'both accounted rows render')
  assert.ok(shown.includes('ungrouped'), 'the ungrouped group renders under its own key')
  assert.ok(shown.includes('untitledSession'), 'a session without a title says so')
  assert.ok(!shown.includes('Archived one'), 'the archived session stays out of the active view')
  assert.ok(shown.includes('badgeRunning'), 'the running session wears its badge')
  // One select-all plus one checkbox per active row.
  assert.equal(checkboxes(page.picks).length, 4)
})

it('arms the batch from a selection and posts exactly the checked ids', async () => {
  const page = await opened((url, method) => {
    if (method === 'GET' && url.includes('/sessions/manager')) return response(LIST)
    if (method === 'POST' && url.includes('/sessions/delete-batch')) {
      return response({ results: [{ sessionId: 's-1', ok: true }], deleted: 1, failed: 0 })
    }
  })
  const { app, again, read, picks } = page

  // An unselected toolbar is inert.
  assert.equal(toolbarDelete(picks).props.disabled, true)

  // Checking one row arms the summary and the delete.
  check(picks, 'Session one', true)
  again()
  assert.ok(read().includes('selectedSummary'), 'the selection summary renders')
  assert.equal(toolbarDelete(picks).props.disabled, false)

  // The dialog captures its rows at open time and names them. The rows read
  // through their title spans: the panel behind the dialog still renders its
  // own rows, so whole-tree text cannot tell the two apart.
  toolbarDelete(picks).props.onClick()
  again()
  const dialogText = read()
  assert.ok(dialogText.includes('confirmBatchTitle') && dialogText.includes('confirmBatchBody'))
  const named = picks((node) => node.props?.className === 'smkit-sess-page-confirm-title')
    .map((node) => text(node))
    .join('\n')
  assert.ok(named.includes('Session one'), 'the dialog names the session it is confirming')
  assert.ok(!named.includes('Session two'), 'the dialog names only the selected ones')

  dialogConfirm(picks).props.onClick()
  await settle()
  again()
  const posted = app.calls.filter((call) => call.method === 'POST' && call.url.includes('/sessions/delete-batch'))
  assert.equal(posted.length, 1)
  assert.deepEqual(posted[0].body, { sessionIds: ['s-1'] })
  assert.ok(read().includes('batchDone'), 'the success report renders after the batch')
  const managerReads = app.calls.filter((call) => call.method === 'GET' && call.url.includes('/sessions/manager'))
  assert.ok(managerReads.length >= 2, 'the panel re-reads the listing after a batch')
})

it('reports a refused session as one line, not a failed batch', async () => {
  const page = await opened((url, method) => {
    if (method === 'GET' && url.includes('/sessions/manager')) return response(LIST)
    if (method === 'POST' && url.includes('/sessions/delete-batch')) {
      return response({
        results: [
          { sessionId: 's-1', ok: true },
          { sessionId: 's-2', ok: false, code: 'session/running', message: 'stop it first' },
        ],
        deleted: 1,
        failed: 1,
      })
    }
  })
  const { again, read, picks } = page

  check(picks, 'Session one', true)
  again()
  check(picks, 'Session two', true)
  again()
  toolbarDelete(picks).props.onClick()
  again()
  dialogConfirm(picks).props.onClick()
  await settle()
  again()

  assert.ok(read().includes('batchPartial'), 'the partial report renders')
  assert.ok(read().includes('deleteSessionRunning'), 'a known refusal reads as its instruction, not the raw code')
})

it('switches to the archived sub-tab, clears the selection and deletes from there', async () => {
  const page = await opened((url, method) => {
    if (method === 'GET' && url.includes('/sessions/manager')) return response(LIST)
    if (method === 'POST' && url.includes('/sessions/delete-batch')) {
      return response({ results: [{ sessionId: 's-arch', ok: true }], deleted: 1, failed: 0 })
    }
  })
  const { app, again, read, picks } = page

  // A selection made on the active view must not ride across the split.
  check(picks, 'Session one', true)
  again()
  const archivedTab = picks((node) => node.props?.role === 'tab' && node.children.includes('subtabArchived'))[0]
  archivedTab.props.onClick()
  again()

  const shown = read()
  assert.ok(shown.includes('Archived one'), 'the archived session renders on its own sub-tab')
  assert.ok(!shown.includes('Session one'), 'the active rows stay out of it')
  assert.ok(!shown.includes('selectedSummary'), 'the selection did not survive the switch')

  check(picks, 'Archived one', true)
  again()
  toolbarDelete(picks).props.onClick()
  again()
  dialogConfirm(picks).props.onClick()
  await settle()
  again()
  const posted = app.calls.filter((call) => call.method === 'POST' && call.url.includes('/sessions/delete-batch'))
  assert.deepEqual(posted[0].body, { sessionIds: ['s-arch'] })
})
