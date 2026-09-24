/**
 * The conversation header's OpenSpec control, driven through the real client
 * bundle in a hook harness: hover opens the panel, the panel shows what the
 * host answered, and the delete asks first and then reports what it did.
 *
 * Four things are worth testing beyond "the paths are rendered":
 *
 * - the panel is placed from measured coordinates — right-aligned under the
 *   control, and on the side with room — which is the one piece of geometry
 *   this control computes rather than reads;
 * - hovering is what reads the workspace, so a control that has not been
 *   hovered must have requested nothing;
 * - the hover that counts is a pointer *moving* on the control: the header can
 *   slide the control under a still pointer, and that arrival must open
 *   nothing;
 * - the delete is one action over the whole footprint, and a partial failure is
 *   reported inside the panel rather than read as a success.
 *
 * The translator is the identity, so every assertion about copy names the
 * dictionary key; the paths, names and counts below come from the fetch stub,
 * which is what the panel is supposed to render verbatim.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/**
 * The `t` this suite renders with: the key, plus the values it was handed.
 *
 * Identity would be enough to name the copy an assertion is about, but not to
 * see that the numbers and names reached it — and "the question says how much
 * of those directories stays" is a claim about the values, not the key.
 */
const t = (key, values) => (values === undefined ? key : `${key}(${JSON.stringify(values)})`)

const settle = () => new Promise((resolve) => setImmediate(resolve))
/** Let a chain of awaited requests and their state updates land. */
const flush = async (rounds = 5) => {
  for (let index = 0; index < rounds; index += 1) await settle()
}

/** One HTTP answer in the shape the client's `api()` helper expects. */
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

/**
 * One SSE answer in the shape the client's `stream()` helper expects: an open
 * response whose body reader hands back one encoded frame per `read()`, so the
 * panel paints each line as it arrives rather than in one block.
 */
const streamResponse = (events) => ({
  ok: true,
  status: 200,
  body: {
    getReader() {
      const frames = events.map((event) => `data: ${JSON.stringify(event)}\n\n`)
      let index = 0
      return {
        read: async () =>
          index >= frames.length
            ? { done: true, value: undefined }
            : { done: false, value: new TextEncoder().encode(frames[index++]) },
      }
    },
  },
})

/** Flatten a rendered tree, expanding function components the way React would. */
function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return []
  if (typeof tree.type === 'function') return [tree, ...nodes(tree.type(tree.props))]
  return [tree, ...(tree.children ?? []).flatMap(nodes)]
}

/** Every string rendered in a tree, for assertions about what a user can read. */
const texts = (tree) => nodes(tree).flatMap(node => node.children ?? []).filter(child => typeof child === 'string')

/** The one node carrying a class, or `undefined`. */
const withClass = (tree, className) => nodes(tree).find(node => node.props?.className === className)

/** The one node whose class list contains a token (`smkit-spec-openspec-init`, `smkit-spec-openspec-remove`). */
const token = (tree, name) =>
  nodes(tree).find(node => String(node.props?.className ?? '').split(' ').includes(name))

/**
 * The head's action buttons, left to right, as their class lists.
 *
 * The row's *seats* are the claim worth testing — which button sits where after
 * an action changes what the workspace holds — and a seat is only knowable by
 * position.
 */
const toolbarOf = (tree) => {
  const row = withClass(tree, 'smkit-spec-openspec-actions')
  if (row === undefined) return []
  return (row.children ?? [])
    .filter(child => String(child?.props?.className ?? '').split(' ').includes('smkit-ui-button'))
    .map(child => String(child.props.className))
}

/**
 * The one tree row of a kind (`smkit-spec-openspec-dir-row`, `smkit-spec-openspec-file-row`) whose own text names
 * `name`. A row's text is just its connector and its name — a directory's
 * children are siblings of its row, not descendants of it — so a name matches
 * exactly one row.
 */
const rowFor = (tree, kind, name) =>
  nodes(tree).find(node => String(node.props?.className ?? '').includes(kind) && texts(node).includes(name))

/** The tree's connectors, top to bottom: the shape the block is drawn in. */
const branchesOf = (tree) =>
  nodes(tree).filter(node => node.props?.className === 'smkit-spec-openspec-branch').map(node => node.children[0])

/**
 * The control's own stand-in: the panel is placed from its viewport rect, which
 * no headless render can produce, so the harness hands over the box a header
 * utility at the right edge of a 1280×800 window would have. The rect is one
 * shared object so a test can slide it — the way a reflowing header or a
 * scrolling page moves the real control under a panel that stays open.
 */
function anchorNode() {
  const rect = { left: 1000, top: 20, right: 1028, bottom: 48, width: 28, height: 28 }
  return {
    node: {
      parentElement: null,
      contains: () => false,
      // A live node in a live document: what the re-measure asks before it
      // trusts the box it is about to follow.
      isConnected: true,
      // A fresh object every call, the way a real rect is: the panel keeps the
      // box it measured as its comparison baseline, and a shared object would
      // let a moved control silently move its own baseline with it.
      getBoundingClientRect: () => ({ ...rect }),
    },
    rect,
  }
}

/**
 * The box the placement below produces for the panel: right edges aligned with
 * the control, hanging under it. The harness's own hit-test reads it, so the
 * leave guards can tell a real leave from a right-press's report.
 */
const panelRect = { left: 668, top: 54, right: 1028, bottom: 400 }

/**
 * A stand-in for one DOM element, shared into the bundle's scope as `Element`.
 *
 * The panel's dismissal rules ask two questions of an event target — is it
 * inside the panel, and where did focus go — and both are answered with
 * `closest` and an identity. A class (rather than a plain object) is what makes
 * `target instanceof Element` true the way it is in a browser.
 */
class SandboxElement {
  constructor(tag, closest) {
    this.tagName = tag
    this._closest = closest
  }

  closest(selector) {
    return this._closest(selector)
  }
}

/** `GET /openspec` answering with a real store and two integrations. */
const VIEW = {
  cwd: '/work/app',
  root: '/work/app',
  repo: true,
  initialized: true,
  store: {
    path: '/work/app/openspec',
    rel: 'openspec',
    bytes: 2048,
    files: 5,
    dirs: 7,
    parts: [
      { name: 'specs', rel: 'openspec/specs', kind: 'dir', exists: true, required: true },
      { name: 'changes', rel: 'openspec/changes', kind: 'dir', exists: true, required: true },
      { name: 'config.yaml', rel: 'openspec/config.yaml', kind: 'file', exists: true, required: true },
      { name: 'project.md', rel: 'openspec/project.md', kind: 'file', exists: false, required: false },
    ],
    tree: [
      {
        name: 'changes',
        rel: 'openspec/changes',
        kind: 'dir',
        bytes: 512,
        children: [
          {
            name: 'add-login',
            rel: 'openspec/changes/add-login',
            kind: 'dir',
            bytes: 512,
            children: [
              { name: 'proposal.md', rel: 'openspec/changes/add-login/proposal.md', kind: 'file', bytes: 512 },
            ],
          },
        ],
      },
      { name: 'config.yaml', rel: 'openspec/config.yaml', kind: 'file', bytes: 20 },
    ],
  },
  artifacts: [
    {
      tools: ['agents', 'codex', 'zed'],
      kind: 'skills',
      path: '/work/app/.agents/skills',
      rel: '.agents/skills',
      entries: [
        { name: 'openspec-propose', path: '/work/app/.agents/skills/openspec-propose', rel: '.agents/skills/openspec-propose', kind: 'dir', bytes: 300, marker: false },
        { name: '.openspec-target', path: '/work/app/.agents/skills/.openspec-target', rel: '.agents/skills/.openspec-target', kind: 'file', bytes: 8, marker: true },
      ],
      // How much of the directory is not OpenSpec's, which the confirmation
      // says in words rather than by listing a machine's other skills.
      keptCount: 2,
    },
    {
      tools: ['claude'],
      kind: 'commands',
      path: '/work/app/.claude/commands',
      rel: '.claude/commands',
      entries: [
        { name: 'opsx', path: '/work/app/.claude/commands/opsx', rel: '.claude/commands/opsx', kind: 'dir', bytes: 600, marker: false },
      ],
      keptCount: 0,
    },
  ],
  truncated: false,
  totalBytes: 3412,
  totalEntries: 3,
  hasIgnoreRules: true,
}

/** `GET /openspec` for a workspace that never ran the CLI. */
const EMPTY = {
  cwd: '/work/app',
  root: '/work/app',
  repo: false,
  initialized: false,
  artifacts: [],
  truncated: false,
  totalBytes: 0,
  totalEntries: 0,
  hasIgnoreRules: false,
}

const sessionState = (row = { cwd: '/work/app' }) => ({ ids: ['s1'], byId: { s1: row }, current: 's1' })
const workspaceState = (items = []) => ({ items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null })

/**
 * Mount the real client bundle with a hook harness and mount the header slot.
 * @param options - the URL-routed fetch stub, the store state the selectors
 *   read, and the control's stand-in geometry.
 * @returns the render, hover and click helpers plus the recorded calls.
 */
function mount({
  fetch,
  session = sessionState(),
  workspace = workspaceState(),
  anchor = anchorNode(),
  sidebar = false,
}) {
  const node = anchor.node
  const calls = []
  /** The addresses the shell's sidebar viewer was asked to open, in order. */
  const opened = []
  const sidebarFace = sidebar ? { openResource: (address) => { opened.push(address) } } : undefined
  const registrations = new Map()
  let exported
  let states = []
  let cursor = 0
  // Effects are registered per render and run on commit, with their
  // dependencies compared the way React compares them: the panel's dismissal
  // listeners must be installed when it opens and removed when it closes, and
  // the checks below are about what those listeners do.
  const effectCells = []
  const pending = []
  let effectCursor = 0
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
    useEffect: (effect, deps) => {
      const index = effectCursor++
      const cell = effectCells[index] ?? (effectCells[index] = { deps: undefined, cleanup: null })
      const same =
        Array.isArray(deps) &&
        Array.isArray(cell.deps) &&
        deps.length === cell.deps.length &&
        deps.every((value, position) => Object.is(value, cell.deps[position]))
      if (same) return
      cell.deps = deps
      pending.push({ cell, effect })
    },
    useCallback: (callback) => callback,
  }
  /** One listener registry, the way a DOM node keeps them. */
  const registry = () => {
    const handlers = new Map()
    return {
      add(type, handler) {
        if (!handlers.has(type)) handlers.set(type, new Set())
        handlers.get(type).add(handler)
      },
      remove(type, handler) { handlers.get(type)?.delete(handler) },
      emit(type, event) { for (const handler of handlers.get(type) ?? []) handler(event) },
    }
  }
  const onDocument = registry()
  const onWindow = registry()
  // A controllable clock. The panel's dismissal is deliberately delayed so the
  // pointer can cross to it, so a suite that never advances the clock would
  // only ever see the panel still open.
  const timers = new Map()
  let nextTimer = 1
  // The re-measure of the control rides one animation frame; the harness runs
  // frames on demand, the way it runs timers, so a test can say "the browser
  // painted once after that scroll" and read what the panel decided.
  const frames = new Map()
  let nextFrame = 1
  const body = new SandboxElement('BODY', () => null)
  // The leave guards ask the browser's own question — what is under this
  // point — so the stub document answers it. Both surfaces are rounded for
  // real (a 28px circle for the control, 10px corners for the panel), and
  // that rounding is exactly what a slow walk-out reports from: a point
  // inside the bounding rectangle but outside the drawn surface, which the
  // old box test read as "still on it" and swallowed a genuine leave.
  const panelTarget = { getBoundingClientRect: () => panelRect }
  const onAnchor = (x, y) => (x - 1014) ** 2 + (y - 34) ** 2 <= 14 ** 2
  const onPanel = (x, y) => {
    if (x < panelRect.left || x > panelRect.right || y < panelRect.top || y > panelRect.bottom) return false
    const rx = x < panelRect.left + 10 ? panelRect.left + 10 : x > panelRect.right - 10 ? panelRect.right - 10 : null
    const ry = y < panelRect.top + 10 ? panelRect.top + 10 : y > panelRect.bottom - 10 ? panelRect.bottom - 10 : null
    if (rx === null || ry === null) return true
    return (x - rx) ** 2 + (y - ry) ** 2 <= 10 ** 2
  }
  // `installStylesheet` runs at bundle load and needs a document that can take
  // a <style>; nothing else here is a real DOM, only what the bundle asks for.
  const fakeDocument = {
    head: { appendChild() {} },
    body,
    querySelector: () => null,
    createElement: () => ({ dataset: {} }),
    elementFromPoint: (x, y) => (onAnchor(x, y) ? node : onPanel(x, y) ? panelTarget : null),
    addEventListener: onDocument.add,
    removeEventListener: onDocument.remove,
  }
  runInNewContext(source, {
    window: {
      __ModuleLoader__: { load: ({ factory }) => { exported = factory((id) => (id === 'react' ? react : undefined)) } },
      // What `clipBounds` narrows the placement to.
      innerWidth: 1280,
      innerHeight: 800,
      addEventListener: onWindow.add,
      removeEventListener: onWindow.remove,
    },
    document: fakeDocument,
    Element: SandboxElement,
    // The streaming reader decodes the SSE bytes as they arrive; the harness
    // hands it the platform's own decoder so the update path runs unchanged.
    TextDecoder: globalThis.TextDecoder,
    setTimeout: (handler) => { const id = nextTimer++; timers.set(id, handler); return id },
    clearTimeout: (id) => { timers.delete(id) },
    // The panel's re-measure rides one animation frame; the harness queues it
    // and a test runs it with `flushFrames`, the same way it drives the clock.
    requestAnimationFrame: (handler) => { const id = nextFrame++; frames.set(id, handler); return id },
    cancelAnimationFrame: (id) => { frames.delete(id) },
    fetch: async (url, options) => {
      calls.push({ url, body: options?.body === undefined ? undefined : JSON.parse(options.body) })
      return fetch(url)
    },
    setInterval: () => 1,
    clearInterval: () => {},
  })
  const ctx = {
    effect(fn) { fn() },
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject: (_name, callback) => callback(),
      // Keyed by entry id: two features seat this same utilities list.
      register: (options, component) => { registrations.set(options.id, component) },
    },
    // The shell's right sidebar, as cordis's reflection layer hands it over:
    // present when this mount says the host has the column, absent otherwise.
    reflect: { get: (name) => (name === 'sidebarRight' ? sidebarFace : undefined) },
  }
  exported.apply(ctx)
  const OpenSpec = registrations.get('smkit-openspec')
  assert.equal(typeof OpenSpec, 'function', 'the header slot must seat the OpenSpec control')
  const props = {
    sessionId: 's1',
    t,
    useSessions: (selector) => selector(session),
    useWorkspaces: (selector) => selector(workspace),
  }
  return {
    calls,
    opened,
    document: fakeDocument,
    node,
    render() {
      cursor = 0
      effectCursor = 0
      const tree = OpenSpec(props)
      // React runs an effect after the commit, and runs the previous cleanup
      // first. Doing the same here is what makes the dismissal listeners the
      // checks below drive the ones a browser would have.
      while (pending.length > 0) {
        const { cell, effect } = pending.shift()
        if (typeof cell.cleanup === 'function') cell.cleanup()
        const cleanup = effect()
        cell.cleanup = typeof cleanup === 'function' ? cleanup : null
      }
      return tree
    },
    /** Deliver one event to whatever the panel installed listeners for. */
    dispatch(type, event) {
      onDocument.emit(type, event)
      onWindow.emit(type, event)
    },
    /** A target inside the panel, and one outside everything the panel owns. */
    inside: () => new SandboxElement('DIV', (selector) => (selector === '.smkit-spec-openspec-panel' ? 'panel' : null)),
    outside: () => new SandboxElement('DIV', () => null),
    /** Let the grace period elapse, then render what it did. */
    runTimers() {
      const pending = [...timers.values()]
      timers.clear()
      for (const handler of pending) handler()
      return this.render()
    },
    /** Run the queued animation frames (the control's re-measure), then render. */
    flushFrames() {
      const queued = [...frames.values()]
      frames.clear()
      for (const handler of queued) handler()
      return this.render()
    },
    /**
     * Slide the control's box vertically, the way a reflow or a scrolling page
     * moves it under an open panel.
     */
    moveNode({ top, bottom }) {
      anchor.rect.top = top
      anchor.rect.bottom = bottom
      return { ...anchor.rect }
    },
    /** Take the control out of the document, as an unmount would. */
    detachNode() {
      anchor.node.isConnected = false
    },
    /**
     * Hover the control the way a browser reports a hand doing it: the pointer
     * enters the control and then moves within it, both dispatched from one
     * pointer sample, enter first. Both halves are delivered because which one
     * the control opens on is the point of the reflow test below.
     */
    async hover() {
      const host = withClass(this.render(), 'smkit-spec-openspec-host')
      assert.ok(host, 'the control must render a host element')
      if (typeof host.props.onMouseEnter === 'function') host.props.onMouseEnter({ currentTarget: node })
      this.move()
      await flush()
      return this.render()
    },
    /** Move the pointer on the control: the gesture the panel opens on. */
    move() {
      const host = withClass(this.render(), 'smkit-spec-openspec-host')
      assert.ok(host, 'the control must render a host element')
      host.props.onMouseMove({ currentTarget: node, clientX: 1010, clientY: 30 })
      return this.render()
    },
    /**
     * The enter alone: what the browser reports when the header reflows and
     * the control arrives under a pointer that never moved. Delivered to
     * whatever handler the control declares for it, if any — an implementation
     * that opens on this is the bug, not this harness.
     */
    arrive() {
      const host = withClass(this.render(), 'smkit-spec-openspec-host')
      assert.ok(host, 'the control must render a host element')
      if (typeof host.props.onMouseEnter === 'function') host.props.onMouseEnter({ currentTarget: node })
      return this.render()
    },
    /**
     * Move the pointer off the control, away from the panel.
     * @param at - where the event reports the pointer was. A point inside the
     *   control's box is what a right-press reports, and is not a leave.
     */
    leave(at = { x: 0, y: 0 }) {
      const host = withClass(this.render(), 'smkit-spec-openspec-host')
      host.props.onMouseLeave({ clientX: at.x, clientY: at.y, currentTarget: node })
      return this.render()
    },
    /** Move the pointer off the panel; `at` as in `leave`. */
    leavePanel(at = { x: 0, y: 0 }) {
      const panel = withClass(this.render(), 'smkit-spec-openspec-panel')
      // The one shared object, so the guard's identity check against the
      // hit-test's answer sees the same surface the event was delivered to.
      panel.props.onMouseLeave({
        clientX: at.x,
        clientY: at.y,
        currentTarget: panelTarget,
      })
      return this.render()
    },
  }
}

const routing = (view = VIEW, remove = { removed: ['openspec'], failed: [], bytes: 2048 }) => (url) =>
  url.includes('/openspec/delete') ? response(remove) : response(view)

/**
 * A fetch stub for the upgrade: the update POST answers with a live SSE stream,
 * and every read answers with `view`. The stream's events are handed in as the
 * frames the host emits.
 */
const updateRouting = (events, view = VIEW) => (url) =>
  url.includes('/openspec/update') ? streamResponse(events) : response(view)

/** The index in the rendered tree at which a class token first appears. */
const orderOf = (tree, name) =>
  nodes(tree).findIndex((node) => String(node.props?.className ?? '').split(' ').includes(name))

it('reads nothing until it is hovered, and opens closed', () => {
  const app = mount({ fetch: routing() })
  const tree = app.render()
  const control = nodes(tree).find((node) => node.props?.['aria-label'] === 'manageOpenSpec')

  assert.ok(control, 'the control names itself for a screen reader')
  assert.equal(control.props['aria-expanded'], false)
  assert.equal(withClass(tree, 'smkit-spec-openspec-panel'), undefined, 'the panel is not rendered before a hover')
  assert.deepEqual(app.calls, [], 'and nothing has been asked of the host')
})

it('opens on hover, right-aligned under the control, and shows the footprint', async () => {
  const app = mount({ fetch: routing(), sidebar: true })
  const shown = await app.hover()

  assert.equal(app.calls[0].url, '/smkit/api/openspec?cwd=%2Fwork%2Fapp')
  const panel = nodes(shown).find((node) => node.props?.className === 'smkit-spec-openspec-panel')
  assert.ok(panel, 'the hover opens the panel')

  // Placed from the control's own rect: right edges aligned, hanging below it.
  const style = panel.props.style
  assert.equal(Number.parseFloat(style.left) + Number.parseFloat(style.width), 1028)
  assert.equal(style.top, '54px')

  const text = texts(shown).join(' | ')
  assert.equal(
    token(shown, 'smkit-ui-state-dot').props.title,
    'openSpecStatusReady',
    'the init status is the panel\u2019s answer, worn as a dot',
  )
  const dot = token(shown, 'smkit-ui-state-dot')
  assert.equal(
    dot.props['aria-label'],
    'openSpecStatusReady',
    'a dot with no words still names itself to a screen reader',
  )
  assert.ok(
    String(dot.props.className).includes('smkit-spec-openspec-state'),
    'the platform dot is seated by this panel\u2019s own class',
  )
  assert.equal(
    text.includes('openSpecStatusReady'),
    false,
    'and it is not spelled out in words beside the title',
  )
  assert.ok(text.includes('/work/app'), 'the project root is named')
  assert.ok(
    text.includes('openSpecFiles') && text.includes('openSpecDirs'),
    'the counts sit on the tree block, not on a list of the same names',
  )
  assert.ok(text.includes('openSpecMissing') === false, 'a healthy store has no gap to report')
  assert.ok(text.includes('openSpecTree'), 'the tree is a block of its own')

  // The tree folds the way the sidebar's file tree does: the store's root
  // starts open and every directory under it starts closed, so the block is
  // two rows — the closed directory and the file beside it — until a click
  // says otherwise.
  assert.deepEqual(branchesOf(shown), ['├── ', '└── '])
  assert.ok(text.includes('add-login') === false, 'a closed directory keeps its children to itself')
  const rootRow = rowFor(shown, 'smkit-spec-openspec-dir-row', 'openspec')
  assert.equal(rootRow.props['aria-expanded'], true, 'the store\u2019s own root is the one directory that opens open')
  assert.equal(
    rootRow.children.at(-1).children[0],
    'openspec',
    'the block starts at the store, as tree names the directory it was given',
  )

  // Opening a directory draws its children under it, connectors and all — a
  // connector per entry, with the ancestor's `│` carried down through the
  // levels that are not last — and one level at a time.
  rowFor(shown, 'smkit-spec-openspec-dir-row', 'changes').props.onClick()
  const unfolded = app.render()
  assert.deepEqual(branchesOf(unfolded), ['├── ', '│   └── ', '└── '])
  assert.ok(texts(unfolded).includes('add-login'), 'the open directory shows what is under it')
  assert.ok(texts(unfolded).includes('proposal.md') === false, 'and only what is directly under it')

  rowFor(unfolded, 'smkit-spec-openspec-dir-row', 'add-login').props.onClick()
  const deep = app.render()
  assert.deepEqual(branchesOf(deep), ['├── ', '│   └── ', '│       └── ', '└── '])

  // A file row goes to the shell's sidebar viewer, addressed the way the
  // sidebar's own tree addresses one: session-scoped and workspace-relative.
  rowFor(deep, 'smkit-spec-openspec-file-row', 'proposal.md').props.onClick()
  assert.deepEqual(app.opened, ['dsh-resource://file/session/s1/openspec/changes/add-login/proposal.md'])

  // Closing a directory hides its children again, down to the default fold.
  rowFor(deep, 'smkit-spec-openspec-dir-row', 'changes').props.onClick()
  assert.deepEqual(branchesOf(app.render()), ['├── ', '└── '])

  assert.equal(dot.props['data-smkit-state'], 'done', 'the dot still says the store is there')
})

it('leaves a file click alone on a host without the sidebar column', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()

  rowFor(shown, 'smkit-spec-openspec-dir-row', 'changes').props.onClick()
  const unfolded = app.render()
  rowFor(unfolded, 'smkit-spec-openspec-file-row', 'config.yaml').props.onClick()

  assert.deepEqual(app.opened, [], 'nothing is handed to a sidebar that does not exist')
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'and the panel is none the worse for the click')
})

it('keeps the generated entries behind a toggle, and the tree at the bottom', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()

  // Closed by default: the count is what an open usually wants, the list of
  // generated names is not.
  const toggle = nodes(shown).find((node) => node.props?.className === 'smkit-spec-openspec-toggle')
  assert.ok(toggle, 'the generated entries get a heading that opens')
  assert.equal(toggle.props['aria-expanded'], false)
  assert.equal(toggle.props.title, 'openSpecExpand')
  assert.equal(
    nodes(shown).filter((node) => node.props?.className === 'smkit-spec-openspec-group').length,
    0,
    'and nothing under it is rendered until it is opened',
  )
  assert.ok(texts(shown).join(' | ').includes('openSpecEntries'), 'while the count still says how much there is')

  // The tree is the panel's last block, under the generated entries.
  const order = nodes(shown).map((node) => node.props?.className)
  assert.ok(
    order.indexOf('smkit-spec-openspec-tree') > order.indexOf('smkit-spec-openspec-toggle'),
    'the store is the reference the generated entries are read against, so it comes last',
  )

  toggle.props.onClick()
  const opened = app.render()
  const text = texts(opened).join(' | ')
  assert.equal(nodes(opened).find((node) => node.props?.className === 'smkit-spec-openspec-toggle').props['aria-expanded'], true)
  assert.equal(
    nodes(opened).find((node) => node.props?.className === 'smkit-spec-openspec-toggle').props.title,
    'openSpecCollapse',
  )
  assert.ok(text.includes('openSpecKindSkills') && text.includes('openspec-propose'), 'a skill directory is listed')
  assert.ok(text.includes('.openspec-target'), 'and so is the ownership marker, which is OpenSpec\u2019s own file')
  assert.ok(text.includes('.claude/commands') && text.includes('opsx'), 'and a command namespace')
  assert.ok(text.includes('openSpecSharedBy'), 'a directory three tools share says so')

  // What a shared directory keeps is a count in the confirmation, not a list in
  // the panel: naming a machine's other skills back at it is noise.
  const chips = nodes(opened)
    .filter((node) => String(node.props?.className ?? '').split(' ').includes('smkit-spec-openspec-chip-item'))
    .map((node) => node.children[0])
  assert.deepEqual(chips, ['openspec-propose', '.openspec-target', 'opsx'])

  // The marker is neither a skill nor a command, so it is drawn apart from them
  // and explains itself on hover rather than being a dotfile among the skills.
  const marker = nodes(opened).find((node) => node.props?.className === 'smkit-spec-openspec-chip-item smkit-spec-openspec-chip-marker')
  assert.ok(marker, 'the ownership marker wears its own chip')
  assert.ok(String(marker.props.title).startsWith('openSpecMarker'), 'and names what it is')
})

it('asks before removing, and names everything the question covers', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()
  const remove = nodes(shown).find((node) => node.props?.className === 'smkit-ui-button danger smkit-spec-openspec-remove')
  assert.equal(remove.props.disabled, false)

  remove.props.onClick()
  const dialog = withClass(app.render(), 'smkit-ui-dialog-overlay')
  assert.ok(dialog, 'the panel\u2019s delete opens the confirmation')
  const text = texts(app.render()).join(' | ')
  assert.ok(text.includes('openSpecConfirm'), 'the question says what it means')
  assert.ok(text.includes('openspec'), 'the store is named')
  assert.ok(text.includes('.agents/skills'), 'and so is every directory of generated entries')
  assert.ok(text.includes('openSpecKeptShort'), 'the question says how much of those directories stays')
  assert.deepEqual(app.calls.length, 1, 'nothing is removed until the question is answered')
})

it('posts the workspace, keeps the panel through the question, and reports what survived', async () => {
  const app = mount({
    fetch: routing(VIEW, { removed: ['.agents/skills/openspec-propose'], failed: [{ rel: 'openspec', error: 'EBUSY' }], bytes: 300 }),
  })
  await app.hover()
  nodes(app.render()).find((node) => node.props?.className === 'smkit-ui-button danger smkit-spec-openspec-remove').props.onClick()

  // Reaching the confirmation is a leave — the pointer is on the dialog now —
  // and it is the one leave the panel has to survive: the answer to the
  // question is what it is there to show.
  app.leavePanel()
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'the panel outlives the confirmation')
  assert.ok(withClass(app.runTimers(), 'smkit-spec-openspec-panel'), 'and the pending leave is refused while the question is up')

  nodes(app.render()).find((node) => node.props?.className === 'smkit-ui-button danger').props.onClick()
  await flush()

  assert.deepEqual(app.calls[1], { url: '/smkit/api/openspec/delete', body: { cwd: '/work/app' } })
  assert.equal(app.calls[2].url, '/smkit/api/openspec?cwd=%2Fwork%2Fapp', 'the panel reads what is left')
  assert.equal(withClass(app.render(), 'smkit-ui-dialog-overlay'), undefined, 'the dialog closes once the host answered')

  const text = texts(app.render()).join(' | ')
  assert.ok(text.includes('openSpecPartial'), 'a partial failure is not a success')
  assert.ok(text.includes('openspec'), 'and names what survived')
})

it('flags the part the layout expects and the disk does not have', async () => {
  const app = mount({
    fetch: routing({
      ...VIEW,
      store: {
        ...VIEW.store,
        parts: [
          { name: 'specs', rel: 'openspec/specs', kind: 'dir', exists: true, required: true },
          { name: 'changes', rel: 'openspec/changes', kind: 'dir', exists: false, required: true },
          { name: 'config.yaml', rel: 'openspec/config.yaml', kind: 'file', exists: true, required: true },
          // An earlier CLI's spelling, which nothing writes now: reported as
          // absent, never as a gap.
          { name: 'project.md', rel: 'openspec/project.md', kind: 'file', exists: false, required: false },
        ],
      },
    }),
  })
  const text = texts(await app.hover()).join(' | ')

  assert.ok(
    text.includes('openSpecMissing({"names":"changes"})'),
    'the one thing a tree cannot say: something the CLI writes is not there',
  )
  assert.equal(text.includes('project.md'), false, 'a name only an earlier CLI wrote is not a gap')
})

it('offers the initialise where there is nothing to delete', async () => {
  const app = mount({ fetch: routing(EMPTY) })
  const shown = await app.hover()

  const text = texts(shown).join(' | ')
  assert.ok(text.includes('openSpecStatusAbsent'), 'the body says what is missing in words')
  const dot = token(shown, 'smkit-ui-state-dot')
  assert.equal(dot.props['data-smkit-state'], 'idle')
  assert.equal(dot.props.title, 'openSpecStatusAbsent', 'and the dot carries the same answer as its hover')
  assert.ok(text.includes('openSpecEmpty'), 'the panel says how to create one')
  assert.equal(token(shown, 'smkit-spec-openspec-remove'), undefined, 'there is nothing to delete, so nothing offers it')

  const init = token(shown, 'smkit-spec-openspec-init')
  assert.ok(init, 'an uninitialised workspace offers to create one')
  assert.equal(init.props.title, 'openSpecInitCommand', 'and shows the command it runs')
  assert.equal(init.props.disabled, false)
})

it('runs openspec init for the workspace, then reads the store back', async () => {
  let initialized = false
  const app = mount({
    fetch: (url) => {
      if (url.includes('/openspec/init')) {
        initialized = true
        return response({ ok: true, root: '/work/app', command: 'openspec init --tools agents --force', output: 'Created openspec/\nCreated .agents/skills/openspec-propose' })
      }
      return response(initialized ? VIEW : EMPTY)
    },
  })
  const shown = await app.hover()
  token(shown, 'smkit-spec-openspec-init').props.onClick()
  await flush()

  assert.deepEqual(app.calls[1], { url: '/smkit/api/openspec/init', body: { cwd: '/work/app' } })
  assert.equal(app.calls[2].url, '/smkit/api/openspec?cwd=%2Fwork%2Fapp', 'the panel reads what it created')

  const after = app.render()
  const text = texts(after).join(' | ')
  assert.ok(text.includes('openSpecInitDone'), 'the CLI\u2019s own output is shown')
  assert.ok(text.includes('Created openspec/'))
  assert.equal(
    token(after, 'smkit-ui-state-dot').props['data-smkit-state'],
    'done',
    'and the workspace is initialised now',
  )
  assert.ok(token(after, 'smkit-spec-openspec-remove'), 'and what was created can be taken back out')
  assert.equal(toolbarOf(shown)[0], 'smkit-ui-button smkit-spec-openspec-init', 'the create button leads the three that never leave')
  assert.equal(token(shown, 'smkit-spec-openspec-init').props['data-smkit-state'], 'warn', 'amber while there is nothing there yet')
  assert.equal(token(after, 'smkit-spec-openspec-init').props['data-smkit-state'], 'done', 'and green once the store stands')
  assert.equal(
    toolbarOf(after)[1],
    'smkit-ui-button smkit-spec-openspec-ignore',
    // The permanent three hold the right end, so what the answer brings lands
    // at the left end of the group instead: the seats under the pointer, which
    // is still on the create button, have not moved, and no delete has arrived
    // beside them either.
    'what an answer brings arrives away from where the pointer rests',
  )
  assert.equal(token(after, 'smkit-spec-openspec-init').props.disabled, true, 'and the button that created the store has nothing left to do')
})

it('reports a refused init as an instruction, and offers it again', async () => {
  const app = mount({
    fetch: (url) => url.includes('/openspec/init')
      ? response({ error: 'the openspec command was not found on PATH', code: 'openspec/not-installed', output: '' }, false, 503)
      : response(EMPTY),
  })
  const shown = await app.hover()
  token(shown, 'smkit-spec-openspec-init').props.onClick()
  await flush()

  const after = app.render()
  assert.ok(texts(after).join(' | ').includes('openSpecInitNotInstalled'), 'the refusal is localized as an instruction')
  assert.equal(withClass(after, 'smkit-ui-dialog-overlay'), undefined, 'a run needs no confirmation, and leaves none behind')
  assert.equal(token(after, 'smkit-spec-openspec-init').props.disabled, false, 'the button stays available')
  assert.equal(app.calls.length, 2, 'a refused run is not followed by a read')
})

it('offers both actions when the store is gone but its skills are not', async () => {
  const app = mount({ fetch: routing({ ...EMPTY, artifacts: VIEW.artifacts, totalEntries: 2 }) })
  const shown = await app.hover()

  assert.ok(token(shown, 'smkit-spec-openspec-init'), 'the store can be created again')
  assert.ok(token(shown, 'smkit-spec-openspec-remove'), 'and what is left can still be removed')
})

it('says so when the session has no workspace at all', async () => {
  const app = mount({ fetch: routing(), session: sessionState({}), workspace: workspaceState([]) })
  const shown = await app.hover()

  assert.deepEqual(app.calls, [], 'a session without a directory is not asked about')
  assert.ok(texts(shown).join(' | ').includes('openSpecNoWorkspace'))
  assert.equal(
    token(shown, 'smkit-spec-openspec-init').props['data-smkit-state'],
    'reading',
    'with nothing to point at the create button reports no status — it keeps its seat and waits',
  )
  assert.equal(token(shown, 'smkit-spec-openspec-init').props.disabled, true)
  assert.equal(token(shown, 'smkit-spec-openspec-remove'), undefined)
})

it('reports a failed read inside the panel rather than as an empty workspace', async () => {
  const app = mount({ fetch: async () => { throw new Error('network down') } })
  const shown = await app.hover()

  assert.ok(texts(shown).join(' | ').includes('openSpecLoadFailed'))
  assert.equal(token(shown, 'smkit-ui-state-dot'), undefined, 'and claims no status it could not read')
})

it('survives the page scrolling under it, and follows the control instead', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'the hover opened it')

  // Reading past the fold scrolls the panel's own body: a re-measure finds the
  // control exactly where it was, and the panel keeps its placement.
  app.dispatch('scroll', { type: 'scroll', target: app.inside() })
  app.flushFrames()
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'scrolling the panel is reading it')

  // The streaming bug: a chat auto-scrolling under a reply dispatches page
  // scrolls the panel used to treat as a dismissal, closing it under a pointer
  // that never left. The control has not moved, so the answer is still no.
  app.dispatch('scroll', { type: 'scroll', target: app.outside() })
  app.flushFrames()
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'a page scroll that leaves the header alone is not a leave')
})

it('re-places itself when the control moves, and goes when the control leaves the viewport', async () => {
  const app = mount({ fetch: routing() })
  const before = await app.hover()
  const panelBefore = withClass(before, 'smkit-spec-openspec-panel')
  assert.ok(panelBefore)

  // A header the page scrolled sideways: the panel follows the measured box
  // rather than pointing at where the control used to be.
  app.moveNode({ top: 120, bottom: 148 })
  app.dispatch('resize', { type: 'resize' })
  const moved = app.flushFrames()
  const panelMoved = withClass(moved, 'smkit-spec-openspec-panel')
  assert.ok(panelMoved, 'a moved control is followed, not abandoned')
  assert.notEqual(
    panelMoved.props.style.top,
    panelBefore.props.style.top,
    'and the placement carries the new coordinates',
  )

  // The control scrolled out of the window for real: there is nothing left to
  // point at, which is the one case the dismissal belongs to.
  app.moveNode({ top: -40, bottom: -12 })
  app.dispatch('scroll', { type: 'scroll', target: app.outside() })
  assert.equal(
    withClass(app.flushFrames(), 'smkit-spec-openspec-panel'),
    undefined,
    'a control off the viewport closes the panel that pointed at it',
  )
})

it('closes when its control leaves the document', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'))

  // The header re-rendering away the seat: the measured node is gone, and a
  // panel hung off a detached control would float over nothing.
  app.detachNode()
  app.dispatch('scroll', { type: 'scroll', target: app.outside() })
  assert.equal(
    withClass(app.flushFrames(), 'smkit-spec-openspec-panel'),
    undefined,
    'a panel whose control no longer exists has nothing to follow',
  )
})

it('stays open when the press lands on a part of it that cannot be focused', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()
  const host = withClass(app.render(), 'smkit-spec-openspec-host')

  // A press on the panel's own text, tree or chips focuses nothing, which puts
  // focus on the body: that is not the user walking away.
  host.props.onBlur({ relatedTarget: app.document.body, currentTarget: app.node })
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'focus landing on the body is not a walk away')

  host.props.onBlur({ relatedTarget: null, currentTarget: app.node })
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'and neither is focus landing nowhere')

  // The panel's own controls live in a portaled subtree this host does not
  // contain, so `contains` cannot answer for them: the panel class is what does.
  host.props.onBlur({ relatedTarget: app.inside(), currentTarget: app.node })
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'focus moving to the panel\u2019s own toggle is not a walk away')

  host.props.onBlur({ relatedTarget: app.outside(), currentTarget: app.node })
  assert.equal(withClass(app.render(), 'smkit-spec-openspec-panel'), undefined, 'a Tab onto another control still closes it')
})

it('closes on a press outside it, and only there', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()

  app.dispatch('pointerdown', { target: app.inside() })
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'a press on the panel is not a dismissal')

  app.dispatch('keydown', { key: 'Escape' })
  assert.equal(withClass(app.render(), 'smkit-spec-openspec-panel'), undefined, 'Escape is')

  await app.hover()
  app.dispatch('pointerdown', { target: app.outside() })
  assert.equal(withClass(app.render(), 'smkit-spec-openspec-panel'), undefined, 'and so is a press on the page behind it')
})

it('keeps the panel through a right-press, which reports a leave it never made', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()

  // The control: the browser's own menu opens under the pointer and the element
  // under it is reported as losing the pointer. The tell is that the point
  // still lands on the control's own surface.
  app.leave({ x: 1010, y: 30 })
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'a leave reported from the control itself is not a leave')

  // The panel itself: the same report, from a point still on its surface.
  app.leavePanel({ x: 700, y: 100 })
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'and neither is one from inside the panel')

  // A leave the pointer did make is still a leave.
  app.leavePanel({ x: 4, y: 4 })
  assert.equal(withClass(app.runTimers(), 'smkit-spec-openspec-panel'), undefined)
})

it('closes on a slow leave through a rounded corner, which the box test swallowed', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()
  // The panel has been entered, so no host-side timer is pending: the panel's
  // own leave is the only thing that can dismiss the panel from here — exactly
  // the state a real slow walk-out leaves behind.
  withClass(app.render(), 'smkit-spec-openspec-panel').props.onMouseEnter()

  // A point a couple of pixels into the top-right corner square is inside the
  // panel's bounding rectangle but outside its drawn, rounded surface: the
  // coordinates a `mouseleave` really reports when the pointer slides off
  // along the arc. The old guard read them as "still on the panel" and the
  // panel stayed open forever.
  app.leavePanel({ x: panelRect.right - 2, y: panelRect.top + 2 })
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'the leave is a leave, but dismissal is still on the grace timer')
  assert.equal(withClass(app.runTimers(), 'smkit-spec-openspec-panel'), undefined, 'and the timer finds nothing to cancel: the panel closes')
})

it('gives the pointer time to cross to the panel', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'the hover opened it')

  // A diagonal move toward the panel's far half leaves the control's 28px box
  // through its *side*, at a height no geometric test can tell apart from
  // walking away — so the leave starts a timer rather than closing.
  app.leave({ x: 990, y: 30 })
  assert.ok(withClass(app.render(), 'smkit-spec-openspec-panel'), 'the panel is still there the moment the pointer leaves')

  // Reaching the panel is what the grace period is for.
  withClass(app.render(), 'smkit-spec-openspec-panel').props.onMouseEnter()
  assert.ok(withClass(app.runTimers(), 'smkit-spec-openspec-panel'), 'and stays once the pointer got there')

  // Walking away instead lets the timer have it.
  app.leave({ x: 990, y: 30 })
  assert.equal(withClass(app.runTimers(), 'smkit-spec-openspec-panel'), undefined, 'a leave nothing cancels closes it')
})

it('lets the pointer come back before the grace period is up', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()

  app.leave({ x: 990, y: 30 })
  // Coming back is a move onto the control: there is no other way back onto it.
  app.move()
  assert.ok(withClass(app.runTimers(), 'smkit-spec-openspec-panel'), 'returning to the control cancels the leave too')
})

it('does not open for a control that reflowed under a still pointer', () => {
  const app = mount({ fetch: routing() })

  // Closing the sidebar's last tab collapses it, the conversation grows, and
  // the header's utilities — this control among them — slide sideways under a
  // pointer that is still where its last click left it. The browser reports
  // that arrival as an enter, and no move follows it.
  assert.equal(
    withClass(app.arrive(), 'smkit-spec-openspec-panel'),
    undefined,
    'a control that came to the pointer is not a hover',
  )
  assert.deepEqual(app.calls, [], 'and a gesture nobody made reads nothing from the host')

  // The smallest move on the control is a hand, and opens it.
  assert.ok(withClass(app.move(), 'smkit-spec-openspec-panel'), 'moving on the control is what opens the panel')
  assert.equal(app.calls.length, 1, 'and the arrival reads the workspace once, as it always did')
})

// --- the head's refresh button -----------------------------------------------

it('holds the refresh face for the floor, not just for the read', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()
  const refresh = token(shown, 'smkit-spec-openspec-refresh')
  assert.equal(refresh.props.disabled, false, 'an arrival leaves nothing pending')

  refresh.props.onClick()
  await flush()

  // The point of the floor: the host has answered, and the click is still
  // visibly the thing that answered it. Without it this whole exchange fits
  // inside a frame, and a button that lights up and gone again reads as one
  // that did nothing.
  const busy = app.render()
  assert.equal(
    app.calls.filter((call) => call.url.startsWith('/smkit/api/openspec?')).length,
    2,
    'the re-read has already come back',
  )
  assert.equal(token(busy, 'smkit-spec-openspec-refresh').props.disabled, true, 'the face is still up')
  assert.ok(token(busy, 'smkit-ui-spin'), 'as the turning arc, not as a blink')

  const settled = app.runTimers()
  assert.equal(token(settled, 'smkit-spec-openspec-refresh').props.disabled, false, 'and it comes down with the floor')
  assert.equal(token(settled, 'smkit-ui-spin'), undefined)
})

// --- the head's update button ------------------------------------------------

it('holds the row\u2019s right end, wearing a glyph and naming the commands it runs', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()

  const dot = token(shown, 'smkit-ui-state-dot')
  const update = token(shown, 'smkit-spec-openspec-update')
  const refresh = token(shown, 'smkit-spec-openspec-refresh')
  assert.ok(dot && update && refresh, 'the head carries all three')
  assert.ok(orderOf(shown, 'smkit-ui-state-dot') < orderOf(shown, 'smkit-spec-openspec-update'), 'the update sits after the dot')
  assert.ok(orderOf(shown, 'smkit-spec-openspec-refresh') < orderOf(shown, 'smkit-spec-openspec-update'), 'and last of all, at the right end')
  // The word it used to wear is now its hover's subject, so the seat is a
  // square like the rest of them. The fill stays because this is the one action
  // here that changes what is installed, and the pointer is meant to land on it.
  assert.equal(texts([update]).length, 0, 'it wears only a glyph')
  assert.ok(String(update.props.className).includes('primary'), 'over its own fill')
  assert.equal(update.props['aria-label'], 'openSpecUpdate', 'and still has a name without the word')
  assert.equal(update.props.title, 'openSpecUpdateCommand', 'the hover names the commands it runs')
  assert.equal(update.props.disabled, false)
})

it('marks the button busy and the panel running while the stream is open', async () => {
  const app = mount({ fetch: updateRouting([{ type: 'line', stream: 'out', text: 'working' }]) })
  const shown = await app.hover()
  token(shown, 'smkit-spec-openspec-update').props.onClick()

  // The click flips `updating` synchronously, before the first awaited read; a
  // render taken here sees the run in flight.
  const busy = app.render()
  assert.equal(token(busy, 'smkit-spec-openspec-update').props.disabled, true, 'the button cannot start a second upgrade')
  assert.ok(texts(busy).join(' | ').includes('openSpecUpdateRunning'), 'and the panel says the run is going')
})

it('streams the upgrade into the panel, then reads the footprint back', async () => {
  const app = mount({
    fetch: updateRouting([
      { type: 'line', stream: 'out', text: '$ npm update -g @fission-ai/openspec' },
      { type: 'line', stream: 'out', text: 'changed 1 package in 4s' },
      { type: 'line', stream: 'out', text: '$ openspec update' },
      { type: 'done', status: 'ok', exitCode: 0 },
    ]),
  })
  const shown = await app.hover()
  token(shown, 'smkit-spec-openspec-update').props.onClick()
  await flush(20)

  const post = app.calls.find((call) => call.url === '/smkit/api/openspec/update')
  assert.ok(post, 'the click POSTs to the streaming route')
  assert.deepEqual(post.body, { cwd: '/work/app' }, 'and names the workspace')

  const after = app.render()
  const text = texts(after).join(' | ')
  assert.ok(text.includes('openSpecUpdateDone'), 'the closing frame becomes the block heading')
  const output = withClass(after, 'smkit-spec-openspec-output')
  assert.ok(output, 'the streamed lines are painted into the panel')
  assert.ok(text.includes('changed 1 package in 4s'), 'verbatim, as npm wrote them')
  assert.ok(text.includes('$ openspec update'), 'including the second command echo')
  assert.equal(token(after, 'smkit-spec-openspec-update').props.disabled, false, 'the button frees once the run lands')
  assert.ok(app.calls.at(-1).url.startsWith('/smkit/api/openspec?cwd='), 'and the footprint is re-read')
})

it('turns a failed upgrade into its localized reason, in the error style', async () => {
  const app = mount({
    fetch: updateRouting([
      { type: 'line', stream: 'out', text: '$ npm update -g @fission-ai/openspec' },
      { type: 'line', stream: 'err', text: 'npm ERR! 404' },
      { type: 'done', status: 'failed', exitCode: 1 },
    ]),
  })
  const shown = await app.hover()
  token(shown, 'smkit-spec-openspec-update').props.onClick()
  await flush(20)

  const after = app.render()
  const text = texts(after).join(' | ')
  assert.ok(text.includes('openSpecUpdateFailed'), 'a non-zero exit is reported as a failure')
  assert.ok(text.includes('npm ERR! 404'), 'and the CLI\u2019s own words still reach the block')
  const heading = withClass(after, 'smkit-spec-openspec-error')
  assert.ok(heading && texts(heading).includes('openSpecUpdateFailed'), 'the heading wears the error style')
})

it('phrases a missing npm as an instruction, not a stack', async () => {
  const app = mount({
    fetch: updateRouting([
      { type: 'line', stream: 'out', text: '$ npm update -g @fission-ai/openspec' },
      { type: 'line', stream: 'err', text: 'npm: command not found on PATH' },
      { type: 'done', status: 'npm-missing', exitCode: null },
    ]),
  })
  const shown = await app.hover()
  token(shown, 'smkit-spec-openspec-update').props.onClick()
  await flush(20)

  assert.ok(texts(app.render()).join(' | ').includes('openSpecUpdateNpmMissing'))
})

it('prints a finished upgrade on the next opening, then drops it', async () => {
  const app = mount({
    fetch: updateRouting([
      { type: 'line', stream: 'out', text: 'changed 1 package in 4s' },
      { type: 'done', status: 'ok', exitCode: 0 },
    ]),
  })
  const shown = await app.hover()
  token(shown, 'smkit-spec-openspec-update').props.onClick()
  await flush(20)
  const done = texts(app.render()).join(' | ')
  assert.ok(done.includes('openSpecUpdateDone'), 'the opening the run finished on shows the record')
  assert.ok(!done.includes('openSpecUpdateExpiryLast'), 'and does not call itself the last viewing yet')

  /** Walk the pointer out, let the grace period close the panel, hover back in. */
  const reopen = async () => {
    app.leave()
    app.runTimers()
    return await app.hover()
  }
  const once = await reopen()
  const first = texts(once).join(' | ')
  assert.ok(first.includes('openSpecUpdateDone'), 'the next opening prints the record')
  assert.ok(first.includes('openSpecUpdateExpiryLast'), 'and says plainly that this is the last of it')

  const gone = await reopen()
  const text = texts(gone).join(' | ')
  assert.ok(!text.includes('openSpecUpdateDone'), 'the opening after that drops the receipt')
  assert.ok(!text.includes('openSpecUpdateExpiry'), 'and the notice goes with it')
  assert.equal(withClass(gone, 'smkit-spec-openspec-output'), undefined, 'and its output goes with it')
})

it('does not count openings while the upgrade is still running', async () => {
  // A stream that delivers one line and then never answers the next read: the
  // run stays in flight, which is news, not a receipt.
  const live = (url) => {
    if (!url.includes('/openspec/update')) return response(VIEW)
    return {
      ok: true,
      status: 200,
      body: {
        getReader() {
          let index = 0
          return {
            read: () => {
              index += 1
              if (index === 1) {
                const frame = `data: ${JSON.stringify({ type: 'line', stream: 'out', text: 'working' })}\n\n`
                return Promise.resolve({ done: false, value: new TextEncoder().encode(frame) })
              }
              return new Promise(() => {})
            },
          }
        },
      },
    }
  }
  const app = mount({ fetch: live })
  const shown = await app.hover()
  token(shown, 'smkit-spec-openspec-update').props.onClick()
  await flush(20)

  for (const view of [1, 2, 3, 4]) {
    app.leave()
    app.runTimers()
    const again = await app.hover()
    const text = texts(again).join(' | ')
    assert.ok(text.includes('openSpecUpdateRunning'), `reopen ${view} still says the run is going`)
    assert.ok(text.includes('working'), `and the running log survives it`)
  }
})

// --- the .gitignore action --------------------------------------------------

/** One answer of `POST /openspec/gitignore`, as the host would send it. */
const ignoreBody = (over = {}) => ({
  repo: true,
  results: [
    { rel: 'openspec', ignoreFile: 'openspec/.gitignore', patterns: ['*', '!.gitignore'], ignored: false, untracked: true, listed: true, alreadyListed: false },
    { rel: '.agents/skills/openspec-propose', ignoreFile: '.agents/skills/.gitignore', patterns: ['openspec-propose/'], ignored: true, untracked: false, listed: false, alreadyListed: false },
    { rel: '.agents/skills/demo', ignoreFile: '.agents/skills/.gitignore', patterns: ['demo/'], ignored: false, untracked: false, listed: false, alreadyListed: true },
  ],
  ...over,
})

/** A panel open on a footprint, with `POST /openspec/gitignore` answered by `body`. */
async function withIgnore(body, fetch = routing()) {
  const app = mount({
    fetch: (url) => (url.includes('/openspec/gitignore') ? response(body) : fetch(url)),
  })
  const shown = await app.hover()
  return { app, shown }
}

it('offers the ignore action on a footprint, and not on an empty workspace', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()

  const ignore = token(shown, 'smkit-spec-openspec-ignore')
  assert.ok(ignore, 'a workspace with a footprint can be handed to git')
  assert.equal(ignore.props.title, 'openSpecGitignoreCommand', 'the tooltip says what it asks and where it writes')
  assert.equal(ignore.props['aria-label'], 'openSpecGitignore', 'a button with no words still has a name')
  assert.equal(texts([ignore]).length, 0, 'the hover holds the sentence; the button wears only the glyph')
  assert.equal(ignore.props.disabled, false)
  // The delete is the loud answer and this the quiet one; the toolbar holds both.
  assert.ok(orderOf(shown, 'smkit-spec-openspec-ignore') < orderOf(shown, 'smkit-spec-openspec-remove'), 'the reversible action sits before the destructive one')

  const emptyApp = mount({ fetch: routing(EMPTY) })
  const empty = await emptyApp.hover()
  assert.equal(token(empty, 'smkit-spec-openspec-ignore'), undefined, 'a workspace with nothing in it has nothing to hide')

  const outsideApp = mount({ fetch: routing({ ...VIEW, repo: false }) })
  const outside = await outsideApp.hover()
  assert.equal(
    token(outside, 'smkit-spec-openspec-ignore'),
    undefined,
    'outside a repository, hiding a footprint from git is meaningless, so the offer stays out',
  )
  assert.ok(token(outside, 'smkit-spec-openspec-remove'), 'the delete needs no git: it is a filesystem answer')
})

it('asks git once for the workspace and reports what each entry became', async () => {
  const { app, shown } = await withIgnore(ignoreBody())
  token(shown, 'smkit-spec-openspec-ignore').props.onClick()
  await flush()

  assert.deepEqual(app.calls[1], { url: '/smkit/api/openspec/gitignore', body: { cwd: '/work/app' } },
    'the host re-derives the targets, so the panel names only the workspace')
  const text = texts(app.render()).join(' | ')
  assert.ok(text.includes('openSpecGitignoreUntracked({"count":1})'), 'one entry had to leave the index first')
  assert.ok(text.includes('openSpecGitignoreListed({"count":1})'), 'one line was new')
  assert.ok(text.includes('openSpecGitignoreIgnored({"count":1})'), 'one git already ignored on its own')
  assert.ok(text.includes('openSpecGitignoreListedBefore({"count":1})'), 'one was already named, and was not repeated')
  assert.equal(text.includes('openSpecGitignoreNothing'), false, 'a run that wrote something is not a run that wrote nothing')
  assert.equal(app.calls.length, 2, 'with nothing written there is nothing new to read back')
})

it('re-reads the store after writing an ignore file into it', async () => {
  const grown = {
    ...VIEW,
    store: {
      ...VIEW.store,
      files: VIEW.store.files + 1,
      tree: [...VIEW.store.tree, { name: '.gitignore', rel: 'openspec/.gitignore', kind: 'file', bytes: 26 }],
    },
  }
  let reads = 0
  const app = mount({
    fetch: (url) => {
      if (url.includes('/openspec/gitignore')) return response(ignoreBody({ files: ['openspec/.gitignore'] }))
      reads += 1
      return response(reads === 1 ? VIEW : grown)
    },
  })
  const shown = await app.hover()
  assert.equal(texts(shown).includes('.gitignore'), false, 'the store has no ignore file on disk yet')

  token(shown, 'smkit-spec-openspec-ignore').props.onClick()
  await flush()

  assert.equal(reads, 2, 'a file landed inside the store, so the tree that draws it reads again')
  assert.ok(texts(app.render()).includes('.gitignore'), 'and the panel shows it without another hover')
})

it('names the ignore files it wrote, beside the entries they carry', async () => {
  const { app, shown } = await withIgnore(ignoreBody({ files: ['openspec/.gitignore', '.agents/skills/.gitignore'] }))
  token(shown, 'smkit-spec-openspec-ignore').props.onClick()
  await flush()

  assert.ok(
    texts(app.render()).join(' | ').includes('openSpecGitignoreFiles({"paths":"openspec/.gitignore, .agents/skills/.gitignore"})'),
    'the receipt says which files changed, because they are not the project\u2019s own',
  )
})

it('says so when there was nothing to hide and nothing was written', async () => {
  const { app, shown } = await withIgnore({
    repo: true,
    results: [
      { rel: 'openspec', ignoreFile: 'openspec/.gitignore', patterns: ['*', '!.gitignore'], ignored: true, untracked: false, listed: false, alreadyListed: false },
    ],
  })
  token(shown, 'smkit-spec-openspec-ignore').props.onClick()
  await flush()

  const text = texts(app.render()).join(' | ')
  assert.ok(text.includes('openSpecGitignoreIgnored({"count":1})'))
  assert.ok(text.includes('openSpecGitignoreNothing'), 'which is the answer, not a failure')
})

it('tells a workspace outside a repository from a machine without git', async () => {
  const outside = await withIgnore({ repo: false, reason: 'not-a-repo', results: [] })
  token(outside.shown, 'smkit-spec-openspec-ignore').props.onClick()
  await flush()
  const outsideText = texts(outside.app.render()).join(' | ')
  assert.ok(outsideText.includes('openSpecGitignoreNoRepo'))
  assert.equal(outsideText.includes('openSpecGitignoreListed'), false, 'nothing was counted, because nothing was asked')

  const noGit = await withIgnore({ repo: false, reason: 'no-git', results: [] })
  token(noGit.shown, 'smkit-spec-openspec-ignore').props.onClick()
  await flush()
  assert.ok(
    texts(noGit.app.render()).join(' | ').includes('openSpecGitignoreNoGit'),
    '"install git" and "this folder is not a repo" are different sentences',
  )
})

it('names an entry git refused, with its own reason', async () => {
  const refused = ignoreBody()
  refused.results[0].error = "fatal: something's in the way"
  const { app, shown } = await withIgnore(refused)
  token(shown, 'smkit-spec-openspec-ignore').props.onClick()
  await flush()

  const tree = app.render()
  const text = texts(tree).join(' | ')
  assert.ok(text.includes('openSpecGitignorePartial'), 'the section says the run was not whole')
  const row = nodes(tree).find((node) => node.props?.title === "fatal: something's in the way")
  assert.ok(row, 'and the entry carries the git command\u2019s own words rather than a paraphrase')
  assert.equal(row.children[0], 'openspec')
})

it('marks itself busy while git is being asked, and localises a refused call', async () => {
  let settle
  const held = { promise: new Promise((resolve) => { settle = resolve }) }
  const app = mount({
    fetch: (url) => {
      if (url.includes('/openspec/gitignore')) return held.promise
      return response(VIEW)
    },
  })
  token(await app.hover(), 'smkit-spec-openspec-ignore').props.onClick()
  await flush()

  const busy = app.render()
  assert.equal(token(busy, 'smkit-spec-openspec-ignore').props.disabled, true, 'a second press while the first is running would ask git twice')
  assert.equal(token(busy, 'smkit-spec-openspec-ignore').props['aria-busy'], true)
  assert.ok(texts(busy).join(' | ').includes('openSpecGitignoreRunning'))

  settle(response(ignoreBody({ files: ['openspec/.gitignore'] })))
  await flush()
  const done = app.render()
  assert.equal(token(done, 'smkit-spec-openspec-ignore').props.disabled, false, 'the button is itself again once the answer is in')
  assert.ok(texts(done).join(' | ').includes('openSpecGitignoreFiles'))

  const failed = mount({
    fetch: (url) => (url.includes('/openspec/gitignore')
      ? response({ error: '' }, false, 500)
      : response(VIEW)),
  })
  token(await failed.hover(), 'smkit-spec-openspec-ignore').props.onClick()
  await flush()
  assert.ok(
    texts(failed.render()).join(' | ').includes('openSpecGitignoreFailed({"status":500})'),
    'a call that never got an answer says so with its status',
  )
})

it('clears its answer when the panel opens again', async () => {
  const { app, shown } = await withIgnore(ignoreBody())
  token(shown, 'smkit-spec-openspec-ignore').props.onClick()
  await flush()
  assert.ok(texts(app.render()).join(' | ').includes('openSpecGitignore'), 'the receipt is showing')

  app.leave()
  app.runTimers()
  const again = await app.hover()
  assert.equal(
    texts(again).join(' | ').includes('openSpecGitignoreUntracked'),
    false,
    'last time\u2019s answer is not this opening\u2019s news',
  )
})

it('says what the delete took back out of the ignore files', async () => {
  const app = mount({
    fetch: routing(VIEW, {
      removed: ['openspec', '.agents/skills/openspec-propose'],
      failed: [],
      bytes: 300,
      ignoreFiles: [
        { rel: '.agents/skills/.gitignore', lines: 2, deleted: true },
        { rel: '.claude/commands/.gitignore', lines: 1, deleted: false },
      ],
    }),
  })
  await app.hover()
  nodes(app.render()).find((node) => node.props?.className === 'smkit-ui-button danger smkit-spec-openspec-remove').props.onClick()
  nodes(app.render()).find((node) => node.props?.className === 'smkit-ui-button danger').props.onClick()
  await flush()

  const text = texts(app.render()).join(' | ')
  assert.ok(text.includes('openSpecIgnoreCleaned'), 'the delete reports what it tidied, not only what it removed')
  assert.ok(
    text.includes('openSpecIgnoreFileDeleted({"path":".agents/skills/.gitignore"})'),
    'one file went with the lines it held',
  )
  assert.ok(
    text.includes('openSpecIgnoreFilePruned({"path":".claude/commands/.gitignore","count":1})'),
    'the other only lost the lines that named what is gone',
  )
  assert.equal(text.includes('openSpecPartial'), false, 'a delete that finished says nothing survived')

  app.leave()
  app.runTimers()
  const again = await app.hover()
  assert.equal(
    texts(again).join(' | ').includes('openSpecIgnoreCleaned'),
    false,
    'the tidy-up is this opening\u2019s news, not every opening\u2019s',
  )
})


// --- the un-ignore action ----------------------------------------------------

/** One answer of `POST /openspec/untrack`, as the host would send it. */
const untrackBody = (over = {}) => ({
  results: [
    { rel: 'openspec', ignoreFile: 'openspec/.gitignore', patterns: ['*', '!.gitignore'], unlisted: true, alreadyUnlisted: false },
    { rel: '.agents/skills/openspec-propose', ignoreFile: '.agents/skills/.gitignore', patterns: ['openspec-propose/'], unlisted: false, alreadyUnlisted: true },
    { rel: '.agents/skills/demo', ignoreFile: '.agents/skills/.gitignore', patterns: ['demo/'], unlisted: false, alreadyUnlisted: true },
  ],
  ...over,
})

/** A panel open on a footprint, with `POST /openspec/untrack` answered by `body`. */
async function withUntrack(body) {
  const route = routing()
  const app = mount({
    fetch: (url) => (url.includes('/openspec/untrack') ? response(body) : route(url)),
  })
  const shown = await app.hover()
  return { app, shown }
}

it('offers the un-ignore action beside the one it reverses, and not on an empty workspace', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()

  const untrack = token(shown, 'smkit-spec-openspec-untrack')
  assert.ok(untrack, 'what the ignore button handed to git, this one takes back')
  assert.equal(untrack.props.title, 'openSpecUntrackCommand', 'the tooltip says what comes out, what goes with it, and what git is never asked')
  assert.equal(untrack.props['aria-label'], 'openSpecUntrack', 'a button with no words still has a name')
  assert.equal(texts([untrack]).length, 0, 'the hover holds the sentence; the button wears only the glyph')
  assert.ok(orderOf(shown, 'smkit-spec-openspec-untrack') < orderOf(shown, 'smkit-spec-openspec-ignore'), 'it sits directly to its twin\u2019s left, the undo beside the act')
  assert.ok(orderOf(shown, 'smkit-spec-openspec-ignore') < orderOf(shown, 'smkit-spec-openspec-remove'), 'and both reversible actions precede the destructive one')

  const emptyApp = mount({ fetch: routing(EMPTY) })
  const empty = await emptyApp.hover()
  assert.equal(token(empty, 'smkit-spec-openspec-untrack'), undefined, 'a workspace with nothing in it has nothing to take back')

  const quietApp = mount({ fetch: routing({ ...VIEW, hasIgnoreRules: false }) })
  const quiet = await quietApp.hover()
  assert.ok(token(quiet, 'smkit-spec-openspec-ignore'), 'hiding stays on offer while the store stands')
  const quietUntrack = token(quiet, 'smkit-spec-openspec-untrack')
  assert.ok(quietUntrack, 'and its twin keeps its seat rather than vanishing out of the row')
  assert.equal(
    quietUntrack.props.disabled,
    true,
    'with no line of ours on disk it can only answer "nothing was there", so it is dimmed',
  )

  const outsideApp = mount({ fetch: routing({ ...VIEW, repo: false }) })
  const outside = await outsideApp.hover()
  assert.equal(
    token(outside, 'smkit-spec-openspec-untrack'),
    undefined,
    'outside a repository there is no tracking to take back, so the twin stays out too',
  )
})

it('asks the host once for the workspace and reports what each entry became', async () => {
  const { app, shown } = await withUntrack(untrackBody({ files: [{ rel: 'openspec/.gitignore', lines: 2, deleted: true }] }))
  token(shown, 'smkit-spec-openspec-untrack').props.onClick()
  await flush()

  assert.deepEqual(app.calls[1], { url: '/smkit/api/openspec/untrack', body: { cwd: '/work/app' } },
    'the host re-derives the targets, so the panel names only the workspace')
  const text = texts(app.render()).join(' | ')
  assert.ok(text.includes('openSpecUntrackUnlisted({"count":1})'), 'one entry had its line taken out')
  assert.ok(text.includes('openSpecUntrackAlreadyUnlisted({"count":2})'), 'two never had a line of their own')
  assert.ok(
    text.includes('openSpecIgnoreFileDeleted({"path":"openspec/.gitignore"})'),
    'the emptied store file is named with the same sentence the delete\u2019s tidy-up uses',
  )
  assert.equal(text.includes('openSpecUntrackRetracked'), false, 'nothing went back into the index, because the action never asks git')
  assert.equal(app.calls.length, 3, 'a file inside the store went, so the tree that draws it reads again')

  const quiet = await withUntrack(untrackBody())
  token(quiet.shown, 'smkit-spec-openspec-untrack').props.onClick()
  await flush()
  assert.equal(quiet.app.calls.length, 2, 'nothing on disk moved, so nothing is re-read')
})

it('marks itself busy while the host works, and localises a refused call', async () => {
  let settle
  const held = { promise: new Promise((resolve) => { settle = resolve }) }
  const app = mount({
    fetch: (url) => (url.includes('/openspec/untrack') ? held.promise : response(VIEW)),
  })
  token(await app.hover(), 'smkit-spec-openspec-untrack').props.onClick()
  await flush()

  const busy = app.render()
  assert.equal(token(busy, 'smkit-spec-openspec-untrack').props.disabled, true, 'a second press while the first runs would rewrite the same files twice')
  assert.equal(token(busy, 'smkit-spec-openspec-untrack').props['aria-busy'], true)
  assert.ok(texts(busy).join(' | ').includes('openSpecUntrackRunning'))

  settle(response(untrackBody()))
  await flush()
  assert.equal(token(app.render(), 'smkit-spec-openspec-untrack').props.disabled, false, 'the button is itself again once the answer is in')

  const failed = mount({
    fetch: (url) => (url.includes('/openspec/untrack')
      ? response({ error: '' }, false, 500)
      : response(VIEW)),
  })
  token(await failed.hover(), 'smkit-spec-openspec-untrack').props.onClick()
  await flush()
  assert.ok(
    texts(failed.render()).join(' | ').includes('openSpecUntrackFailed({"status":500})'),
    'a call that never got an answer says so with its status',
  )
})

it('names an entry whose file could not be rewritten', async () => {
  const refused = untrackBody()
  refused.results[2].error = 'EPERM: operation not permitted'
  const { app, shown } = await withUntrack(refused)
  token(shown, 'smkit-spec-openspec-untrack').props.onClick()
  await flush()
  const tree = app.render()
  assert.ok(texts(tree).join(' | ').includes('openSpecUntrackPartial'), 'the section says the run was not whole')
  const row = nodes(tree).find((node) => node.props?.title === 'EPERM: operation not permitted')
  assert.ok(row, 'and the entry carries the file system\u2019s own words rather than a paraphrase')
  assert.equal(row.children[0], '.agents/skills/demo')
})

it('clears its answer when the panel opens again', async () => {
  const { app, shown } = await withUntrack(untrackBody())
  token(shown, 'smkit-spec-openspec-untrack').props.onClick()
  await flush()
  assert.ok(texts(app.render()).join(' | ').includes('openSpecUntrackUnlisted'), 'the receipt is showing')

  app.leave()
  app.runTimers()
  const again = await app.hover()
  assert.equal(
    texts(again).join(' | ').includes('openSpecUntrackUnlisted'),
    false,
    'last time\u2019s answer is not this opening\u2019s news',
  )
})

// --- how the log is laid out -------------------------------------------------

/** The receipts the panel holds open, top to bottom. */
const openItems = (tree) =>
  nodes(tree).filter(node => String(node.props?.className ?? '').split(' ').includes('smkit-spec-openspec-log-item'))

/**
 * A panel that answers both ignore actions, so two receipts can stack up in the
 * one visit and the log has to decide which of them to show.
 */
async function withTwoAnswers(ignore, untrack) {
  const route = routing()
  const app = mount({
    fetch: (url) =>
      url.includes('/openspec/gitignore')
        ? response(ignore)
        : url.includes('/openspec/untrack')
          ? response(untrack)
          : route(url),
  })
  const shown = await app.hover()
  return { app, shown }
}

it('mounts the log before there is anything in it', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()
  const messages = withClass(shown, 'smkit-spec-openspec-messages')
  assert.ok(messages, 'the block is on the panel with no receipt to report')
  assert.equal(nodes(messages).length, 1, 'and nothing hangs off it, so it takes no room')
  assert.equal(openItems(shown).length, 0)
})

it('keeps every answer in the one window, newest first', async () => {
  const { app, shown } = await withTwoAnswers(ignoreBody(), untrackBody())
  token(shown, 'smkit-spec-openspec-ignore').props.onClick()
  await flush()
  let tree = app.render()
  assert.equal(openItems(tree).length, 1, 'the answer just earned is in the log')

  token(tree, 'smkit-spec-openspec-untrack').props.onClick()
  await flush()
  tree = app.render()
  const items = openItems(tree)
  assert.equal(
    items.length,
    2,
    'the older answer stays in the window rather than being filed away: folding it gave the panel height back, and the pointer was left outside',
  )
  assert.equal(withClass(tree, 'smkit-spec-openspec-older'), undefined, 'and there is no expander to read the log through')
  assert.ok(texts(items[0]).join(' ').includes('openSpecUntrack'), 'newest first, where no scrolling is needed')
  assert.ok(texts(items[1]).join(' ').includes('openSpecGitignore'), 'and the answer before it right underneath')
})

it('keeps a receipt that failed above the one that came after it', async () => {
  const refused = ignoreBody()
  refused.results[2].error = 'EPERM: operation not permitted'
  const { app, shown } = await withTwoAnswers(refused, untrackBody())
  token(shown, 'smkit-spec-openspec-ignore').props.onClick()
  await flush()
  token(app.render(), 'smkit-spec-openspec-untrack').props.onClick()
  await flush()

  const items = openItems(app.render())
  assert.equal(items.length, 2)
  assert.ok(
    texts(items[0]).join(' ').includes('openSpecGitignorePartial'),
    'what went wrong is on top, because it is still asking to be read',
  )
  assert.ok(texts(items[1]).join(' ').includes('openSpecUntrack'), 'and the clean answer sits under it')
})

it('puts every action in the head, so no click waits on the panel\u2019s bottom edge', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()

  assert.deepEqual(
    toolbarOf(shown),
    [
      'smkit-ui-button smkit-spec-openspec-untrack',
      'smkit-ui-button smkit-spec-openspec-ignore',
      'smkit-ui-button danger smkit-spec-openspec-remove',
      'smkit-ui-button smkit-spec-openspec-init',
      'smkit-ui-button smkit-spec-openspec-refresh',
      'smkit-ui-button primary smkit-spec-openspec-update',
    ],
    // The two actions the panel offers whatever the workspace holds hold the
    // right end; the ones a read brings or takes away are the further-left
    // half of the row.
    'one row, permanent on the right and volatile on the left',
  )
  assert.ok(
    orderOf(shown, 'smkit-spec-openspec-head') < orderOf(shown, 'smkit-spec-openspec-body'),
    'the actions are above what they act on, so the pointer that clicks is a body away from the edge a shrinking body lifts',
  )
  assert.equal(withClass(shown, 'smkit-spec-openspec-foot'), undefined, 'nothing asks the pointer to wait under the facts')
  // The only words the head wears are the name the entry button answers to and
  // the panel carries as its own — every action is a glyph, so the row has room
  // for the full name again.
  assert.deepEqual(texts(withClass(shown, 'smkit-spec-openspec-head')), ['manageOpenSpec'], 'one name, no second label')

  const remove = token(shown, 'smkit-spec-openspec-remove')
  assert.equal(texts([remove]).length, 0, 'the delete wears only the glyph the rest of the plugin wears for it')
  assert.equal(remove.props.title, 'openSpecRemove', 'and the words it dropped ride its hover')
  assert.equal(remove.props['aria-label'], 'openSpecRemove', 'so the button still has a name without them')

  const init = token(shown, 'smkit-spec-openspec-init')
  assert.equal(texts([init]).length, 0, 'the create button wears lucide\u2019s letter initial, not the word')
  assert.equal(init.props['aria-label'], 'openSpecInit', 'and keeps its name without the word')
})
