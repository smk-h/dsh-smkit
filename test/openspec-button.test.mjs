/**
 * The conversation header's OpenSpec control, driven through the real client
 * bundle in a hook harness: hover opens the panel, the panel shows what the
 * host answered, and the delete asks first and then reports what it did.
 *
 * Three things are worth testing beyond "the paths are rendered":
 *
 * - the panel is placed from measured coordinates — right-aligned under the
 *   control, and on the side with room — which is the one piece of geometry
 *   this control computes rather than reads;
 * - hovering is what reads the workspace, so a control that has not been
 *   hovered must have requested nothing;
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

/** The one node whose class list contains a token (`os_init`, `os_remove`). */
const token = (tree, name) =>
  nodes(tree).find(node => String(node.props?.className ?? '').split(' ').includes(name))

/**
 * The control's own stand-in: the panel is placed from its viewport rect, which
 * no headless render can produce, so the harness hands over the box a header
 * utility at the right edge of a 1280×800 window would have.
 */
function anchorNode() {
  return {
    parentElement: null,
    contains: () => false,
    getBoundingClientRect: () => ({ left: 1000, top: 20, right: 1028, bottom: 48, width: 28, height: 28 }),
  }
}

/**
 * The box the placement below produces for the panel: right edges aligned with
 * the control, hanging under it. Only the leave checks read it, and they read it
 * to tell a real leave from a right-press's report.
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
}

/** `GET /openspec` for a workspace that never ran the CLI. */
const EMPTY = {
  cwd: '/work/app',
  root: '/work/app',
  initialized: false,
  artifacts: [],
  truncated: false,
  totalBytes: 0,
  totalEntries: 0,
}

const sessionState = (row = { cwd: '/work/app' }) => ({ ids: ['s1'], byId: { s1: row }, current: 's1' })
const workspaceState = (items = []) => ({ items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null })

/**
 * Mount the real client bundle with a hook harness and mount the header slot.
 * @param options - the URL-routed fetch stub, the store state the selectors
 *   read, and the control's stand-in geometry.
 * @returns the render, hover and click helpers plus the recorded calls.
 */
function mount({ fetch, session = sessionState(), workspace = workspaceState(), node = anchorNode() }) {
  const calls = []
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
  const body = new SandboxElement('BODY', () => null)
  // `installStylesheet` runs at bundle load and needs a document that can take
  // a <style>; nothing else here is a real DOM, only what the bundle asks for.
  const fakeDocument = {
    head: { appendChild() {} },
    body,
    querySelector: () => null,
    createElement: () => ({ dataset: {} }),
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
    setTimeout: (handler) => { const id = nextTimer++; timers.set(id, handler); return id },
    clearTimeout: (id) => { timers.delete(id) },
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
  }
  exported.apply(ctx)
  const OpenSpec = registrations.get('mcp-manager-openspec')
  assert.equal(typeof OpenSpec, 'function', 'the header slot must seat the OpenSpec control')
  const props = {
    sessionId: 's1',
    t,
    useSessions: (selector) => selector(session),
    useWorkspaces: (selector) => selector(workspace),
  }
  return {
    calls,
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
    inside: () => new SandboxElement('DIV', (selector) => (selector === '.os_panel' ? 'panel' : null)),
    outside: () => new SandboxElement('DIV', () => null),
    /** Let the grace period elapse, then render what it did. */
    runTimers() {
      const pending = [...timers.values()]
      timers.clear()
      for (const handler of pending) handler()
      return this.render()
    },
    /** Hover the control and let the host answer. */
    async hover() {
      const host = withClass(this.render(), 'os_host')
      assert.ok(host, 'the control must render a host element')
      host.props.onMouseEnter({ currentTarget: node })
      await flush()
      return this.render()
    },
    /**
     * Move the pointer off the control, away from the panel.
     * @param at - where the event reports the pointer was. A point inside the
     *   control's box is what a right-press reports, and is not a leave.
     */
    leave(at = { x: 0, y: 0 }) {
      const host = withClass(this.render(), 'os_host')
      host.props.onMouseLeave({ clientX: at.x, clientY: at.y, currentTarget: node })
      return this.render()
    },
    /** Move the pointer off the panel; `at` as in `leave`. */
    leavePanel(at = { x: 0, y: 0 }) {
      const panel = withClass(this.render(), 'os_panel')
      panel.props.onMouseLeave({
        clientX: at.x,
        clientY: at.y,
        currentTarget: { getBoundingClientRect: () => panelRect },
      })
      return this.render()
    },
  }
}

const routing = (view = VIEW, remove = { removed: ['openspec'], failed: [], bytes: 2048 }) => (url) =>
  url.includes('/openspec/delete') ? response(remove) : response(view)

it('reads nothing until it is hovered, and opens closed', () => {
  const app = mount({ fetch: routing() })
  const tree = app.render()
  const control = nodes(tree).find((node) => node.props?.['aria-label'] === 'manageOpenSpec')

  assert.ok(control, 'the control names itself for a screen reader')
  assert.equal(control.props['aria-expanded'], false)
  assert.equal(withClass(tree, 'os_panel'), undefined, 'the panel is not rendered before a hover')
  assert.deepEqual(app.calls, [], 'and nothing has been asked of the host')
})

it('opens on hover, right-aligned under the control, and shows the footprint', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()

  assert.equal(app.calls[0].url, '/mcp-manager/api/openspec?cwd=%2Fwork%2Fapp')
  const panel = nodes(shown).find((node) => node.props?.className === 'os_panel')
  assert.ok(panel, 'the hover opens the panel')

  // Placed from the control's own rect: right edges aligned, hanging below it.
  const style = panel.props.style
  assert.equal(Number.parseFloat(style.left) + Number.parseFloat(style.width), 1028)
  assert.equal(style.top, '54px')

  const text = texts(shown).join(' | ')
  assert.ok(text.includes('openSpecStatusReady'), 'the init status is the panel\u2019s answer')
  assert.ok(text.includes('/work/app'), 'the project root is named')
  assert.ok(
    text.includes('openSpecFiles') && text.includes('openSpecDirs'),
    'the counts sit on the tree block, not on a list of the same names',
  )
  assert.ok(text.includes('openSpecMissing') === false, 'a healthy store has no gap to report')
  assert.ok(text.includes('openSpecTree'), 'the tree is a block of its own')
  assert.ok(text.includes('add-login'), 'and the store is drawn in it')

  // The tree is drawn the way `tree` draws one: a connector per entry, with the
  // ancestor's `│` carried down through the levels that are not last.
  const branches = nodes(shown)
    .filter((node) => node.props?.className === 'os_branch')
    .map((node) => node.children[0])
  assert.deepEqual(branches, ['├── ', '│   └── ', '│       └── ', '└── '])
  const root = nodes(shown).find((node) => node.props?.className === 'os_root')
  assert.equal(root.children[0], 'openspec', 'the block starts at the store, as tree names the directory it was given')

  const chip = nodes(shown).find((node) => node.props?.className === 'os_chip')
  assert.equal(chip.props['data-ready'], 'true')
})

it('keeps the generated entries behind a toggle, and the tree at the bottom', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()

  // Closed by default: the count is what an open usually wants, the list of
  // generated names is not.
  const toggle = nodes(shown).find((node) => node.props?.className === 'os_toggle')
  assert.ok(toggle, 'the generated entries get a heading that opens')
  assert.equal(toggle.props['aria-expanded'], false)
  assert.equal(toggle.props.title, 'openSpecExpand')
  assert.equal(
    nodes(shown).filter((node) => node.props?.className === 'os_group').length,
    0,
    'and nothing under it is rendered until it is opened',
  )
  assert.ok(texts(shown).join(' | ').includes('openSpecEntries'), 'while the count still says how much there is')

  // The tree is the panel's last block, under the generated entries.
  const order = nodes(shown).map((node) => node.props?.className)
  assert.ok(
    order.indexOf('os_tree') > order.indexOf('os_toggle'),
    'the store is the reference the generated entries are read against, so it comes last',
  )

  toggle.props.onClick()
  const opened = app.render()
  const text = texts(opened).join(' | ')
  assert.equal(nodes(opened).find((node) => node.props?.className === 'os_toggle').props['aria-expanded'], true)
  assert.equal(
    nodes(opened).find((node) => node.props?.className === 'os_toggle').props.title,
    'openSpecCollapse',
  )
  assert.ok(text.includes('openSpecKindSkills') && text.includes('openspec-propose'), 'a skill directory is listed')
  assert.ok(text.includes('.openspec-target'), 'and so is the ownership marker, which is OpenSpec\u2019s own file')
  assert.ok(text.includes('.claude/commands') && text.includes('opsx'), 'and a command namespace')
  assert.ok(text.includes('openSpecSharedBy'), 'a directory three tools share says so')

  // What a shared directory keeps is a count in the confirmation, not a list in
  // the panel: naming a machine's other skills back at it is noise.
  const chips = nodes(opened)
    .filter((node) => String(node.props?.className ?? '').split(' ').includes('os_chipItem'))
    .map((node) => node.children[0])
  assert.deepEqual(chips, ['openspec-propose', '.openspec-target', 'opsx'])

  // The marker is neither a skill nor a command, so it is drawn apart from them
  // and explains itself on hover rather than being a dotfile among the skills.
  const marker = nodes(opened).find((node) => node.props?.className === 'os_chipItem os_chipMarker')
  assert.ok(marker, 'the ownership marker wears its own chip')
  assert.ok(String(marker.props.title).startsWith('openSpecMarker'), 'and names what it is')
})

it('asks before removing, and names everything the question covers', async () => {
  const app = mount({ fetch: routing() })
  const shown = await app.hover()
  const remove = nodes(shown).find((node) => node.props?.className === 'mm_btn danger os_remove')
  assert.equal(remove.props.disabled, false)

  remove.props.onClick()
  const dialog = withClass(app.render(), 'mm_overlay')
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
  nodes(app.render()).find((node) => node.props?.className === 'mm_btn danger os_remove').props.onClick()

  // Reaching the confirmation is a leave — the pointer is on the dialog now —
  // and it is the one leave the panel has to survive: the answer to the
  // question is what it is there to show.
  app.leavePanel()
  assert.ok(withClass(app.render(), 'os_panel'), 'the panel outlives the confirmation')
  assert.ok(withClass(app.runTimers(), 'os_panel'), 'and the pending leave is refused while the question is up')

  nodes(app.render()).find((node) => node.props?.className === 'mm_btn danger').props.onClick()
  await flush()

  assert.deepEqual(app.calls[1], { url: '/mcp-manager/api/openspec/delete', body: { cwd: '/work/app' } })
  assert.equal(app.calls[2].url, '/mcp-manager/api/openspec?cwd=%2Fwork%2Fapp', 'the panel reads what is left')
  assert.equal(withClass(app.render(), 'mm_overlay'), undefined, 'the dialog closes once the host answered')

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
  assert.ok(text.includes('openSpecStatusAbsent'))
  assert.ok(text.includes('openSpecEmpty'), 'the panel says how to create one')
  const chip = nodes(shown).find((node) => node.props?.className === 'os_chip')
  assert.equal(chip.props['data-ready'], 'false')
  assert.equal(token(shown, 'os_remove'), undefined, 'there is nothing to delete, so nothing offers it')

  const init = token(shown, 'os_init')
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
  token(shown, 'os_init').props.onClick()
  await flush()

  assert.deepEqual(app.calls[1], { url: '/mcp-manager/api/openspec/init', body: { cwd: '/work/app' } })
  assert.equal(app.calls[2].url, '/mcp-manager/api/openspec?cwd=%2Fwork%2Fapp', 'the panel reads what it created')

  const after = app.render()
  const text = texts(after).join(' | ')
  assert.ok(text.includes('openSpecInitDone'), 'the CLI\u2019s own output is shown')
  assert.ok(text.includes('Created openspec/'))
  assert.ok(text.includes('openSpecStatusReady'), 'and the workspace is initialised now')
  assert.ok(token(after, 'os_remove'), 'so the delete takes the initialise\u2019s place')
  assert.equal(token(after, 'os_init'), undefined)
})

it('reports a refused init as an instruction, and offers it again', async () => {
  const app = mount({
    fetch: (url) => url.includes('/openspec/init')
      ? response({ error: 'the openspec command was not found on PATH', code: 'openspec/not-installed', output: '' }, false, 503)
      : response(EMPTY),
  })
  const shown = await app.hover()
  token(shown, 'os_init').props.onClick()
  await flush()

  const after = app.render()
  assert.ok(texts(after).join(' | ').includes('openSpecInitNotInstalled'), 'the refusal is localized as an instruction')
  assert.equal(withClass(after, 'mm_overlay'), undefined, 'a run needs no confirmation, and leaves none behind')
  assert.equal(token(after, 'os_init').props.disabled, false, 'the button stays available')
  assert.equal(app.calls.length, 2, 'a refused run is not followed by a read')
})

it('offers both actions when the store is gone but its skills are not', async () => {
  const app = mount({ fetch: routing({ ...EMPTY, artifacts: VIEW.artifacts, totalEntries: 2 }) })
  const shown = await app.hover()

  assert.ok(token(shown, 'os_init'), 'the store can be created again')
  assert.ok(token(shown, 'os_remove'), 'and what is left can still be removed')
})

it('says so when the session has no workspace at all', async () => {
  const app = mount({ fetch: routing(), session: sessionState({}), workspace: workspaceState([]) })
  const shown = await app.hover()

  assert.deepEqual(app.calls, [], 'a session without a directory is not asked about')
  assert.ok(texts(shown).join(' | ').includes('openSpecNoWorkspace'))
  assert.equal(token(shown, 'os_init'), undefined, 'with nothing to point at, nothing is offered')
  assert.equal(token(shown, 'os_remove'), undefined)
})

it('reports a failed read inside the panel rather than as an empty workspace', async () => {
  const app = mount({ fetch: async () => { throw new Error('network down') } })
  const shown = await app.hover()

  assert.ok(texts(shown).join(' | ').includes('openSpecLoadFailed'))
  assert.equal(withClass(shown, 'os_chip'), undefined, 'and claims no status it could not read')
})

it('stays open while its own body scrolls, and closes when the page moves under it', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()
  assert.ok(withClass(app.render(), 'os_panel'), 'the hover opened it')

  // Reading past the fold scrolls the panel's own body, which is a scroll event
  // like any other: it must not be mistaken for the page moving away.
  app.dispatch('scroll', { type: 'scroll', target: app.inside() })
  assert.ok(withClass(app.render(), 'os_panel'), 'scrolling the panel is reading it')

  app.dispatch('scroll', { type: 'scroll', target: app.outside() })
  assert.equal(withClass(app.render(), 'os_panel'), undefined, 'a page scroll leaves the placement stale')
})

it('stays open when the press lands on a part of it that cannot be focused', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()
  const host = withClass(app.render(), 'os_host')

  // A press on the panel's own text, tree or chips focuses nothing, which puts
  // focus on the body: that is not the user walking away.
  host.props.onBlur({ relatedTarget: app.document.body, currentTarget: app.node })
  assert.ok(withClass(app.render(), 'os_panel'), 'focus landing on the body is not a walk away')

  host.props.onBlur({ relatedTarget: null, currentTarget: app.node })
  assert.ok(withClass(app.render(), 'os_panel'), 'and neither is focus landing nowhere')

  // The panel's own controls live in a portaled subtree this host does not
  // contain, so `contains` cannot answer for them: the panel class is what does.
  host.props.onBlur({ relatedTarget: app.inside(), currentTarget: app.node })
  assert.ok(withClass(app.render(), 'os_panel'), 'focus moving to the panel\u2019s own toggle is not a walk away')

  host.props.onBlur({ relatedTarget: app.outside(), currentTarget: app.node })
  assert.equal(withClass(app.render(), 'os_panel'), undefined, 'a Tab onto another control still closes it')
})

it('closes on a press outside it, and only there', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()

  app.dispatch('pointerdown', { target: app.inside() })
  assert.ok(withClass(app.render(), 'os_panel'), 'a press on the panel is not a dismissal')

  app.dispatch('keydown', { key: 'Escape' })
  assert.equal(withClass(app.render(), 'os_panel'), undefined, 'Escape is')

  await app.hover()
  app.dispatch('pointerdown', { target: app.outside() })
  assert.equal(withClass(app.render(), 'os_panel'), undefined, 'and so is a press on the page behind it')
})

it('keeps the panel through a right-press, which reports a leave it never made', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()

  // The control: the browser's own menu opens under the pointer and the element
  // under it is reported as losing the pointer. The coordinates are the tell —
  // they are still inside the control's box.
  app.leave({ x: 1010, y: 30 })
  assert.ok(withClass(app.render(), 'os_panel'), 'a leave reported from inside the control is not a leave')

  // The panel itself: the same report, from a point inside its own box.
  app.leavePanel({ x: 700, y: 100 })
  assert.ok(withClass(app.render(), 'os_panel'), 'and neither is one from inside the panel')

  // A leave the pointer did make is still a leave.
  app.leavePanel({ x: 4, y: 4 })
  assert.equal(withClass(app.runTimers(), 'os_panel'), undefined)
})

it('gives the pointer time to cross to the panel', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()
  assert.ok(withClass(app.render(), 'os_panel'), 'the hover opened it')

  // A diagonal move toward the panel's far half leaves the control's 28px box
  // through its *side*, at a height no geometric test can tell apart from
  // walking away — so the leave starts a timer rather than closing.
  app.leave({ x: 990, y: 30 })
  assert.ok(withClass(app.render(), 'os_panel'), 'the panel is still there the moment the pointer leaves')

  // Reaching the panel is what the grace period is for.
  withClass(app.render(), 'os_panel').props.onMouseEnter()
  assert.ok(withClass(app.runTimers(), 'os_panel'), 'and stays once the pointer got there')

  // Walking away instead lets the timer have it.
  app.leave({ x: 990, y: 30 })
  assert.equal(withClass(app.runTimers(), 'os_panel'), undefined, 'a leave nothing cancels closes it')
})

it('lets the pointer come back before the grace period is up', async () => {
  const app = mount({ fetch: routing() })
  await app.hover()

  app.leave({ x: 990, y: 30 })
  withClass(app.render(), 'os_host').props.onMouseEnter({ currentTarget: app.node })
  assert.ok(withClass(app.runTimers(), 'os_panel'), 'returning to the control cancels the leave too')
})
