/**
 * The session-manager panel, driven through the real client bundle on the
 * merged section's hook harness: open the tab, read the listing the host
 * serves, fold groups open, select rows (one, a group whole, or all), confirm
 * a batch delete, and read the report.
 *
 * What is pinned is the shape a user meets: workspace groups that open as a
 * ledger — head, count, group select-all — and stay folded until asked; the
 * ungrouped tail; the archive set one sub-tab away; the toolbar's tri-state
 * select-all and armed delete; a group checkbox that completes or clears its
 * workspace without expanding it; the confirm dialog carrying the rows it is
 * confirming (captured at open time, not re-derived); the POST's body; and
 * per-session refusals reported without failing the batch. The translator is
 * the identity, so every copy assertion names the dictionary key; titles and
 * paths come from the fetch stub, which is what the page is supposed to
 * render verbatim.
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

/** One group's head node, found by the workspace title it renders. */
const groupHead = (picks, title) =>
  picks((node) => node.props?.className === 'smkit-sess-page-group-head' && text(node).includes(title))[0]

/** The head's own checkbox — the group select-all — from a head node. */
const headCheckbox = (head) => nodes(head).find((node) => node.props?.type === 'checkbox')

/** Fold a group open by clicking its head, the way a user does. */
function expand(picks, title) {
  const head = groupHead(picks, title)
  assert.ok(head, `expected a group headed ${title}`)
  head.props.onClick()
}

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

it('opens to the folded ledger: heads with counts, rows only after expanding', async () => {
  const page = await opened((url, method) => {
    if (method === 'GET' && url.includes('/sessions/manager')) return response(LIST)
  })
  const shown = page.read()
  // The ledger: workspace heads and the ungrouped tail are visible, the rows
  // under them are not — a session list is the expanded state, not the first.
  assert.ok(shown.includes('My App') && shown.includes('/work/app'), 'the workspace head renders')
  assert.ok(shown.includes('ungrouped'), 'the ungrouped group renders under its own key')
  assert.ok(!shown.includes('Session one'), 'a folded group keeps its rows to itself')
  assert.ok(!shown.includes('untitledSession'), 'the ungrouped group stays folded too')
  assert.ok(!shown.includes('Archived one'), 'the archived session stays out of the active view')
  // One toolbar select-all plus one checkbox per folded group head.
  assert.equal(checkboxes(page.picks).length, 3)

  expand(page.picks, 'My App')
  page.again()
  const openedText = page.read()
  assert.ok(openedText.includes('Session one') && openedText.includes('Session two'), 'expanding reveals the rows')
  assert.ok(openedText.includes('badgeRunning'), 'the running session wears its badge')
  // Toolbar + two heads + the two revealed rows.
  assert.equal(checkboxes(page.picks).length, 5)
})

it('selects a workspace whole from its head, folded or expanded', async () => {
  const page = await opened((url, method) => {
    if (method === 'GET' && url.includes('/sessions/manager')) return response(LIST)
    if (method === 'POST' && url.includes('/sessions/delete-batch')) {
      return response({ results: [{ sessionId: 's-1', ok: true }, { sessionId: 's-2', ok: true }], deleted: 2, failed: 0 })
    }
  })
  const { app, again, read, picks } = page

  // The group select-all works on the folded group: no expansion needed.
  const head = groupHead(picks, 'My App')
  assert.ok(head, 'the group head renders folded')
  const groupBox = headCheckbox(head)
  assert.ok(groupBox, 'the group head carries its own select-all')
  groupBox.props.onChange({ target: { checked: true } })
  again()
  assert.ok(read().includes('selectedSummary'), 'the selection summary renders')
  assert.equal(toolbarDelete(picks).props.disabled, false)

  // Expanding shows the selection landed on the rows.
  expand(picks, 'My App')
  again()
  for (const name of ['Session one', 'Session two']) {
    const row = picks((node) => node.props?.type === 'checkbox' && node.props?.['aria-label'] === name)[0]
    assert.ok(row?.props.checked === true, `${name} renders checked after the group select-all`)
  }

  // Clearing one row drops the head to its partial mark, not to checked.
  check(picks, 'Session one', false)
  again()
  assert.equal(headCheckbox(groupHead(picks, 'My App'))?.props.checked, false)
  const headLabel = nodes(groupHead(picks, 'My App')).find((node) => node.props?.className === 'smkit-sess-page-check')
  assert.equal(headLabel?.props['data-smkit-on'], 'partial', 'a partly selected group reads as partial')

  // The group checkbox completes the group again — the other direction.
  headCheckbox(groupHead(picks, 'My App')).props.onChange({ target: { checked: true } })
  again()
  assert.equal(
    picks((node) => node.props?.type === 'checkbox' && node.props?.['aria-label'] === 'Session one')[0]?.props.checked,
    true,
    'the group select-all completes a partly selected group',
  )

  toolbarDelete(picks).props.onClick()
  again()
  const dialogText = read()
  assert.ok(dialogText.includes('confirmBatchTitle') && dialogText.includes('confirmBatchBody'))
  // The dialog names its rows through their title spans: the panel behind the
  // dialog still renders its own rows, so whole-tree text cannot tell them apart.
  const named = picks((node) => node.props?.className === 'smkit-sess-page-confirm-title')
    .map((node) => text(node))
    .join('\n')
  assert.ok(named.includes('Session one') && named.includes('Session two'), 'the dialog names the group rows')
  assert.ok(!named.includes('Stray session'), 'the dialog names only the selected ones')

  dialogConfirm(picks).props.onClick()
  await settle()
  again()
  assert.ok(read().includes('batchDone'), 'the success report renders after the batch')
  const posted = app.calls.filter((call) => call.method === 'POST' && call.url.includes('/sessions/delete-batch'))
  assert.deepEqual(posted[0].body, { sessionIds: ['s-1', 's-2'] })
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

  expand(picks, 'My App')
  again()
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

it('switches to the archived sub-tab, keeps the fold default and deletes from there', async () => {
  const page = await opened((url, method) => {
    if (method === 'GET' && url.includes('/sessions/manager')) return response(LIST)
    if (method === 'POST' && url.includes('/sessions/delete-batch')) {
      return response({ results: [{ sessionId: 's-arch', ok: true }], deleted: 1, failed: 0 })
    }
  })
  const { app, again, read, picks } = page

  // A selection made on the active view must not ride across the split.
  expand(picks, 'My App')
  again()
  check(picks, 'Session one', true)
  again()
  const archivedTab = picks((node) => node.props?.role === 'tab' && node.children.includes('subtabArchived'))[0]
  archivedTab.props.onClick()
  again()

  const shown = read()
  assert.ok(!shown.includes('Session one'), 'the active rows stay out of it')
  assert.ok(!shown.includes('selectedSummary'), 'the selection did not survive the switch')
  // The fold state is per workspace, not per view: the group the user opened
  // on the active sub-tab is still open here, now holding its archived rows.
  assert.ok(shown.includes('Archived one'), 'the opened group stays open across the switch')

  // Folding it again hides the rows; expanding once more brings them back.
  const head = groupHead(picks, 'My App')
  head.props.onClick()
  again()
  assert.ok(!read().includes('Archived one'), 'folding the group on the archived view hides its rows')
  head.props.onClick()
  again()
  assert.ok(read().includes('Archived one'), 'expanding again reveals the archived row')

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
