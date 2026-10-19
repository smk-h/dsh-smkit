/**
 * The explorer's `@`-reference chip, driven through the real client bundle
 * against a stand-in for the shell's file tree.
 *
 * The chip belongs to a surface this plugin does not draw, so the claims worth
 * pinning are the ones about coexistence and about the mention:
 *
 * - every row of the host tree gets one chip, and only one — a re-render that
 *   drops it puts it back, while a chip a previous mount left behind is
 *   replaced (its listener died with that mount);
 * - `dsh-better-sidebar` already owns the `files` page and renders exactly this
 *   chip, so its service being present means this plugin adds nothing, and the
 *   published `smkitFileReference` says which of the two answered;
 * - a host that grows the affordance itself is detected the same way: an
 *   `@`-labelled control on a row that is not ours stands the whole tree down;
 * - a press inserts the row as the shell's own reference chip (a workspace-root
 *   relative mention, never the session cwd), at the composer's caret, with a
 *   folder carrying `appearance: "folder"` and a slash-suffixed label; only a
 *   host that takes no chip gets plain draft text instead;
 * - an unresolved workspace leaves the draft untouched and lets the row's own
 *   click through.
 *
 * The VM has no DOM, so the document below implements only the questions the
 * feature asks: attribute selectors, `:scope > child`, `closest`, and the
 * marker the click handler walks up through.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

/** Parse the selectors this feature writes: `tag?[attr]?[="value"]?`, or `:scope > …`. */
function parseSelector(selector) {
  const scope = selector.startsWith(':scope > ')
  const body = scope ? selector.slice(':scope > '.length) : selector
  const match = /^([a-zA-Z]+)?(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/.exec(body)
  assert.ok(match, `the test DOM only answers this feature's selectors, got "${selector}"`)
  return { scope, tag: match[1]?.toLowerCase(), attr: match[2], value: match[3] }
}

/** Parse a selector list (`a[data-x], b[title]`); the feature writes no commas inside one. */
function parseList(selector) {
  return selector.split(',').map((part) => parseSelector(part.trim()))
}

/** Whether one element matches one parsed selector. */
function matchesParsed(element, parsed) {
  if (parsed.tag !== undefined && element.tagName.toLowerCase() !== parsed.tag) return false
  if (parsed.attr === undefined) return true
  if (!element.hasAttribute(parsed.attr)) return false
  return parsed.value === undefined || element.getAttribute(parsed.attr) === parsed.value
}

/** One DOM element, as much of it as the feature touches. */
class SandboxElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.attributes = new Map()
    this.childNodes = []
    this.parentNode = null
    this.textContent = ''
    this.className = ''
    this.type = ''
    // Real elements reflect these two properties onto attributes; the feature
    // writes the copy as properties and the assertions read the attributes.
    Object.defineProperty(this, 'title', {
      get: () => this.getAttribute('title') ?? '',
      set: (value) => this.setAttribute('title', value),
    })
    Object.defineProperty(this, 'className', {
      get: () => this.getAttribute('class') ?? '',
      set: (value) => this.setAttribute('class', value),
    })
    // `installStylesheet` writes `tag.dataset.smkitCss`; a real element always
    // has one, and the stylesheet injection runs at bundle load.
    this.dataset = new Proxy({}, {
      set: (target, key, value) => {
        target[key] = value
        this.attributes.set(`data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, String(value))
        return true
      },
      get: (target, key) => target[key],
    })
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof SandboxElement)
  }

  get isConnected() {
    let node = this
    while (node.parentNode !== null) node = node.parentNode
    return node.root === true
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  appendChild(child) {
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  remove() {
    if (this.parentNode === null) return
    const at = this.parentNode.childNodes.indexOf(this)
    if (at >= 0) this.parentNode.childNodes.splice(at, 1)
    this.parentNode = null
  }

  matches(selector) {
    const parsed = parseList(selector)
    return parsed.some((one) => matchesParsed(this, one))
  }

  closest(selector) {
    const parsed = parseList(selector)
    let node = this
    while (node !== null) {
      if (parsed.some((one) => matchesParsed(node, one))) return node
      node = node.parentNode
    }
    return null
  }

  querySelectorAll(selector) {
    const parsed = parseList(selector)
    const found = []
    const visit = (node) => {
      for (const child of node.children) {
        if (parsed.some((one) => matchesParsed(child, one))) found.push(child)
        // `:scope > x` is about direct children; a plain selector is a subtree.
        if (!parsed.some((one) => one.scope)) visit(child)
      }
    }
    visit(this)
    return found
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }
}

/** One row of the host's tree: `<li data-files-entry=…><button>…</button></li>`. */
function entry(kind, path, extra = []) {
  const item = new SandboxElement('li')
  item.setAttribute('data-files-entry', kind)
  item.setAttribute('data-files-path', path)
  const row = new SandboxElement('button')
  row.setAttribute('type', 'button')
  item.appendChild(row)
  for (const node of extra) item.appendChild(node)
  return item
}

/**
 * A document holding a right sidebar with one file tree, and (optionally) the
 * conversation column with the composer `<textarea>` inside it.
 */
function fakeDocument(rows, sidebarSession = 's1', composer = null) {
  /** The conversation column: the one thing the composer lookup starts from. */
  const column = composer === null ? null : { querySelector: () => composer }
  const html = new SandboxElement('html')
  html.root = true
  const body = new SandboxElement('body')
  html.appendChild(body)
  const sidebar = new SandboxElement('div')
  // Null models a host whose sidebar markup predates the session attribute.
  if (sidebarSession !== null) sidebar.setAttribute('data-sidebar-right-session', sidebarSession)
  body.appendChild(sidebar)
  const tree = new SandboxElement('div')
  tree.setAttribute('data-files-state', 'tree')
  tree.setAttribute('data-files-root', '/work')
  sidebar.appendChild(tree)
  const list = new SandboxElement('ul')
  tree.appendChild(list)
  for (const row of rows) list.appendChild(row)
  return {
    html,
    body,
    sidebar,
    tree,
    rows,
    documentElement: html,
    head: { appendChild: () => {} },
    createElement: (tag) => new SandboxElement(tag),
    // The composer lookup: the conversation column first, then the textarea
    // inside it; no other selector in the document is answered.
    querySelector: (selector) => {
      if (column === null) return null
      return String(selector).includes('conversation') ? column : null
    },
    // Other features in the same bundle ask the document their own questions
    // (the settings nav row, the format chips); this stand-in answers only the
    // selectors the reference feature writes and reports nothing for the rest.
    querySelectorAll: (selector) => {
      try {
        return html.querySelectorAll(selector)
      } catch {
        return []
      }
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

/**
 * Mount the whole bundle once and hand back what the assertions need.
 * @param options - `rows`, the services the feature reads, whether the shell's
 *   own tree already carries an `@` control, and the `draft`/`caret` the
 *   composer stand-in holds (`composer: false` models a host whose composer the
 *   feature cannot find).
 */
function mount(options = {}) {
  let draft = options.draft ?? 'before'
  let draftRev = 1
  /** Where the composer's caret sits: a textarea selection, or the shell's span. */
  let caret = options.caret ?? draft.length
  /** Every call the input-shell stand-in took. */
  const shellCalls = []
  /**
   * The input shell, as the host's `SessionInputShell` publishes it: the chip
   * batch insert its own file picker uses (`addFiles` — a method on the shell,
   * not on its action face), the action face with a detect-coordinate caret and
   * one span-CAS'd text insert, and the editor projection. Only mounted when a
   * test asks for it — its absence is the older host the event path exists for.
   */
  const shellAddFiles = options.shellInput === true
    ? (references) => {
      shellCalls.push({ kind: 'addFiles', references })
      // A busy draft (adjudicating/submitting) is refused, like the host does.
      if (options.addFilesRefuses === true) return false
      // `insertFileReferences`: write at the live caret, one space after each
      // chip, and one before the batch when the caret follows a word.
      const lead = caret > 0 && !/\s/u.test(draft.slice(caret - 1, caret)) ? ' ' : ''
      const text = `${lead}${references.map((reference) => `${reference.clipboardText} `).join('')}`
      draft = `${draft.slice(0, caret)}${text}${draft.slice(caret)}`
      caret += text.length
      draftRev += 1
      return true
    }
    : undefined
  const shellActions = options.shellInput === true
    ? {
      captureInsertion: () => ({ start: caret, end: caret, draftRev }),
      insertText: (text, span) => {
        shellCalls.push({ kind: 'insertText', text, span })
        if (span.draftRev !== draftRev) return false
        draft = `${draft.slice(0, span.start)}${text}${draft.slice(span.end)}`
        caret = span.start + text.length
        draftRev += 1
        return true
      },
    }
    : undefined
  /**
   * The composer `<textarea>` stand-in. Its value follows the draft the way a
   * controlled textarea re-renders after `setDraft`, and its selection is where
   * the user's caret is — the position a reference has to land on.
   */
  const composer = options.composer === false ? null : {
    disabled: false,
    readOnly: false,
    selectionStart: caret,
    selectionEnd: options.caretEnd ?? caret,
    get value() { return draft },
    setSelectionRange(start, end) {
      this.selectionStart = start
      this.selectionEnd = end
    },
  }
  const dom = fakeDocument(
    options.rows ?? [],
    options.sidebarSession === undefined ? 's1' : options.sidebarSession,
    composer,
  )
  const observers = []
  let click = null
  dom.addEventListener = (type, handler) => { if (type === 'click') click = handler }

  /** Every `slash/input-insert-reference` the feature emitted, in order. */
  const emitted = []
  const provided = []
  const effects = []
  const actx = {
    emit: (name, payload) => {
      emitted.push({ name, payload })
      // A host that does not take the event (no listener, closed draft):
      // nothing changes, and the feature has to notice and fall back.
      if (options.emitRejects === true) return
      // The host's input machine replaces the span it was handed with the
      // occurrence's text, writes the space it puts after a file chip, and
      // moves the revision. The feature only reports success when that happened,
      // and derives its caret placement from the resulting draft length.
      if (payload?.span !== undefined && payload?.reference !== undefined) {
        const { start, end } = payload.span
        draft = `${draft.slice(0, start)}${payload.reference.ref} ${draft.slice(end)}`
      }
      draftRev += 1
    },
  }
  const services = {
    workspaces: {
      list: {
        getSnapshot: () => (options.workspace === false
          ? { phase: 'pending', state: 'idle', items: [] }
          : { phase: 'ready', state: 'idle', items: [{ path: options.workspaceRoot ?? '/work', sessionIds: ['s1'] }] }),
      },
    },
    conversation: {
      input: {
        // The shell's action face is optional in the feature, so it is only
        // present when a test asks for it: absent = the DOM/append paths.
        for: () => ({
          state: { getSnapshot: () => ({ draft, draftRev }) },
          setDraft: (text) => { draft = text; draftRev += 1 },
          ...(shellActions === undefined ? {} : { actions: shellActions }),
          ...(shellAddFiles === undefined ? {} : { addFiles: shellAddFiles }),
          // The editor's text projection, which is what the feature reads to
          // decide whether a mention needs a separator. Plain text, no chips.
          projection: { get detectText() { return draft } },
        }),
      },
    },
    ...(options.betterSidebar === undefined || options.betterSidebar === false
      ? {}
      : { betterSidebar: options.betterSidebar === true ? { openTab: () => {} } : options.betterSidebar }),
    ...(options.sidebarRight === undefined ? {} : { sidebarRight: options.sidebarRight }),
  }
  const ctx = {
    effect: (fn) => { effects.push(fn()) },
    provide: (name, value) => { provided.push({ name, value }) },
    reflect: { get: (name) => services[name] },
    on: () => () => {},
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: { register: () => () => {}, inject: (_name, cb) => cb() },
    // The host session list has no `current`; the owning session must come from
    // the sidebar container (or the sidebar service), never from this store.
    sessions: { scope: () => actx, list: { getSnapshot: () => ({}) } },
  }

  let exported
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => ({
      createElement: (type, props) => ({ type, props: props ?? {} }),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
      useCallback: (fn) => fn,
    })) } } },
    document: dom,
    Element: SandboxElement,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: { warn: () => {} },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback
        this.targets = []
        observers.push(this)
      }
      observe(target) { this.targets.push(target) }
      disconnect() { this.targets = [] }
    },
    requestAnimationFrame: (fn) => { fn(); return 0 },
    cancelAnimationFrame: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  })
  exported.apply(ctx)

  const chips = () => dom.tree.querySelectorAll('[data-smkit-file-ref-button]')
  const status = () => provided.find((entry) => entry.name === 'smkitFileReference')?.value
  return {
    dom,
    chips,
    status,
    emitted,
    composer,
    shellCalls,
    draft: () => draft,
    press(chip) {
      const prevented = []
      const stopped = []
      click({
        composedPath: () => [chip, chip.parentNode, dom.tree, dom.sidebar, dom.html],
        preventDefault: () => prevented.push(true),
        stopPropagation: () => stopped.push(true),
      })
      return { prevented: prevented.length > 0, stopped: stopped.length > 0 }
    },
    /** Make the shell re-render one row: the chip disappears, then a batch lands. */
    reRender() {
      for (const chip of chips()) chip.remove()
      for (const observer of observers) {
        if (observer.targets.includes(dom.tree)) observer.callback([])
      }
    },
    dispose() { for (const dispose of effects.reverse()) dispose() },
  }
}

it('puts one @ chip on every file and folder row of the shell tree', () => {
  const view = mount({
    rows: [
      entry('file', '/work/src/a.ts'),
      entry('directory', '/work/src'),
      entry('other', '/work/pipe'),
    ],
  })
  try {
    const chips = view.chips()
    assert.equal(chips.length, 2, 'files and folders get the chip; an unopenable row does not')
    for (const chip of chips) {
      assert.equal(chip.getAttribute('aria-label'), 'referenceFile')
      assert.equal(chip.getAttribute('title'), 'referenceFile', 'copy and bubble are one string, as upstream')
      assert.equal(chip.textContent, 'referenceFile')
    }
    assert.equal(view.status().active, true)
    assert.equal(view.status().reason, 'active')
  } finally {
    view.dispose()
  }
})

it('emits the host insertion event with a workspace-root relative mention', () => {
  // No composer: the caret cannot be read, so the span is the end of the draft —
  // the degradation a host without a findable textarea gets.
  const view = mount({ rows: [entry('file', '/work/docs/my notes.md')], composer: false })
  try {
    const result = view.press(view.chips()[0])
    assert.equal(result.stopped, true, 'the row must not also open the file')
    // The payload is built inside the VM realm, so it is compared as data.
    assert.equal(JSON.stringify(view.emitted), JSON.stringify([{
      name: 'slash/input-insert-reference',
      payload: {
        reference: {
          source: 'reference',
          ref: '@"docs/my notes.md"',
          label: 'my notes.md',
          appearance: 'file',
          clipboardText: '@"docs/my notes.md"',
        },
        span: { draftRev: 1, start: 'before'.length, end: 'before'.length },
      },
    }]))
  } finally {
    view.dispose()
  }
})

it('inserts a file at the composer caret instead of at the end of the draft', () => {
  // Caret at the very start: an append would land after "second" instead.
  const view = mount({ rows: [entry('file', '/work/src/a.ts')], draft: 'second', caret: 0 })
  try {
    view.press(view.chips()[0])
    const span = view.emitted[0]?.payload?.span
    assert.deepEqual(
      { start: span.start, end: span.end },
      { start: 0, end: 0 },
      'the span is the live caret, which is where the host writes the token',
    )
    assert.equal(view.draft(), '@src/a.ts second')
    assert.equal(
      view.composer.selectionStart,
      '@src/a.ts '.length,
      'the caret follows the token, ready for whatever is typed next',
    )
  } finally {
    view.dispose()
  }
})

it('replaces the composer selection, and leaves the rest of the draft alone', () => {
  const view = mount({
    rows: [entry('file', '/work/src/a.ts')],
    draft: 'keep junk',
    caret: 5,
    caretEnd: 9,
  })
  try {
    view.press(view.chips()[0])
    assert.equal(view.draft(), 'keep @src/a.ts ')
    assert.equal(view.composer.selectionStart, 'keep @src/a.ts '.length)
  } finally {
    view.dispose()
  }
})

it('inserts a file as a chip through the shell, at the caret', () => {
  const view = mount({
    rows: [entry('file', '/work/src/a.ts')],
    draft: 'second',
    composer: false,
    caret: 0,
    shellInput: true,
  })
  try {
    view.press(view.chips()[0])
    assert.equal(view.shellCalls.length, 1)
    assert.equal(view.shellCalls[0].kind, 'addFiles', 'the shell writes the chip, not this feature')
    assert.deepEqual({ ...view.shellCalls[0].references[0] }, {
      source: 'reference',
      ref: '@src/a.ts',
      // A file chip shows its name only; the tree already said where it lives.
      label: 'a.ts',
      appearance: 'file',
      clipboardText: '@src/a.ts',
    })
    assert.equal(view.draft(), '@src/a.ts second')
    assert.equal(view.emitted.length, 0, 'no event fallback when the shell took the chip')
  } finally {
    view.dispose()
  }
})

it('inserts a folder as plain folder text at the caret, not as a chip', () => {
  // The reference implementation keeps folders as text on purpose: `@docs/` is
  // what DSH's own folder decoration and completion are built on, and a chip
  // would take that away. The trailing separator is the folder's own — text has
  // no chip to add one, and the next reference needs the boundary.
  const view = mount({
    rows: [entry('directory', '/work/my dir')],
    draft: 'second',
    composer: false,
    caret: 0,
    shellInput: true,
  })
  try {
    view.press(view.chips()[0])
    assert.equal(view.shellCalls[0].kind, 'insertText')
    assert.equal(view.shellCalls[0].text, '@"my dir/" ')
    assert.equal(view.draft(), '@"my dir/" second')
  } finally {
    view.dispose()
  }
})

it('lets the shell keep a chip off the word before it', () => {
  // `asdf@lib/` is not a mention: the grammar needs a word boundary. The host's
  // batch insert is the one that knows this, so the feature must not hand-roll
  // the separator when that face exists.
  const view = mount({
    rows: [entry('directory', '/work/lib'), entry('file', '/work/src/a.ts')],
    draft: 'asdf',
    composer: false,
    caret: 4,
    shellInput: true,
  })
  try {
    view.press(view.chips()[0])
    assert.equal(view.draft(), 'asdf @lib/ ', 'folder chip, separated from the word')
    view.press(view.chips()[1])
    assert.equal(view.draft(), 'asdf @lib/ @src/a.ts ', 'file chip, same rule')
  } finally {
    view.dispose()
  }
})

it('writes nothing when the host refuses the chip', () => {
  // A busy draft is the host's answer to a pick, not a cue to fall back: the
  // native picker leaves the composer alone, and writing `@path` text instead
  // would put a token in a draft that is being submitted.
  const view = mount({
    rows: [entry('file', '/work/src/a.ts')],
    draft: 'typing',
    composer: false,
    caret: 6,
    shellInput: true,
    addFilesRefuses: true,
  })
  try {
    view.press(view.chips()[0])
    assert.equal(view.shellCalls.length, 1, 'the host was asked once')
    assert.equal(view.draft(), 'typing', 'and its refusal stands')
  } finally {
    view.dispose()
  }
})

it('writes a folder as draft text when the host offers no text insert', () => {
  // No shell face: the draft is rewritten through `setDraft`, and the folder is
  // still quoted with its slash inside the quotes, so the grammar reads it as
  // one folder mention.
  const view = mount({ rows: [entry('directory', '/work/my dir')] })
  try {
    const result = view.press(view.chips()[0])
    assert.equal(result.stopped, true)
    assert.equal(view.draft(), 'before @"my dir/" ')
  } finally {
    view.dispose()
  }
})

it('stands down when dsh-better-sidebar owns the same affordance', () => {
  const view = mount({ rows: [entry('file', '/work/src/a.ts')], betterSidebar: true })
  try {
    assert.equal(view.chips().length, 0, 'two chips on one row is the defect this prevents')
    assert.equal(view.status().active, false)
    assert.equal(view.status().reason, 'better-sidebar')
  } finally {
    view.dispose()
  }
})

it('stands down for any published service, its own tab switches included', () => {
  // Policy: loaded means yield. The neighbour's per-type switches are not
  // consulted, so a service reporting every type off still owns the tree.
  const view = mount({
    rows: [entry('file', '/work/src/a.ts')],
    betterSidebar: { isTabEnabled: () => false },
  })
  try {
    assert.equal(view.chips().length, 0)
    assert.equal(view.status().reason, 'better-sidebar')
  } finally {
    view.dispose()
  }
})

it('stands down when dsh-better-sidebar keeps its own files takeover', () => {
  const view = mount({
    rows: [entry('file', '/work/src/a.ts')],
    betterSidebar: { isTabEnabled: () => true },
  })
  try {
    assert.equal(view.chips().length, 0)
    assert.equal(view.status().reason, 'better-sidebar')
  } finally {
    view.dispose()
  }
})

it('stands down when the host tree already carries its own @ control', () => {
  const own = new SandboxElement('button')
  own.setAttribute('aria-label', '@file')
  const view = mount({ rows: [entry('file', '/work/src/a.ts', [own])] })
  try {
    assert.equal(view.chips().length, 0)
    assert.equal(view.status().reason, 'host-affordance')
  } finally {
    view.dispose()
  }
})

it('projects a ~-rooted workspace, like the reference implementation', () => {
  const view = mount({ rows: [entry('file', '~/proj/a.ts')], workspaceRoot: '~/proj' })
  try {
    view.press(view.chips()[0])
    assert.equal(view.emitted[0]?.payload?.reference?.ref, '@a.ts')
  } finally {
    view.dispose()
  }
})

it('compares Windows paths case-insensitively and normalizes separators', () => {
  const view = mount({ rows: [entry('file', 'C:\\Work\\src\\a.ts')], workspaceRoot: 'c:/work' })
  try {
    view.press(view.chips()[0])
    assert.equal(view.emitted[0]?.payload?.reference?.ref, '@src/a.ts')
  } finally {
    view.dispose()
  }
})

it('refuses a path with a traversal component', () => {
  const view = mount({ rows: [entry('file', '/work/../secret')] })
  try {
    const result = view.press(view.chips()[0])
    assert.equal(view.emitted.length, 0)
    assert.equal(result.stopped, true, 'a chip press never activates the row')
    assert.equal(view.draft(), 'before')
  } finally {
    view.dispose()
  }
})

it('refuses to guess the session when neither the sidebar nor its service names one', () => {
  const view = mount({ rows: [entry('file', '/work/src/a.ts')], sidebarSession: null })
  try {
    const result = view.press(view.chips()[0])
    assert.equal(result.stopped, true, 'the chip still owns the press')
    assert.equal(view.emitted.length, 0, 'no reference in a guessed conversation')
    assert.equal(view.draft(), 'before')
  } finally {
    view.dispose()
  }
})

it('falls back to the sidebar service when the markup has no session attribute', () => {
  const view = mount({
    rows: [entry('file', '/work/src/a.ts')],
    sidebarSession: null,
    sidebarRight: { mounted: { getSnapshot: () => 's1' } },
  })
  try {
    view.press(view.chips()[0])
    assert.equal(view.emitted[0]?.payload?.reference?.ref, '@src/a.ts')
  } finally {
    view.dispose()
  }
})

it('re-decorates a row the shell re-rendered, and only once', () => {
  const view = mount({ rows: [entry('file', '/work/src/a.ts')] })
  try {
    assert.equal(view.chips().length, 1)
    view.reRender()
    assert.equal(view.chips().length, 1, 'the chip comes back once, not twice')
  } finally {
    view.dispose()
  }
})

it('leaves the draft and the row alone when the workspace cannot be resolved', () => {
  const view = mount({ rows: [entry('file', '/work/src/a.ts')], workspace: false })
  try {
    const result = view.press(view.chips()[0])
    // The reference implementation stops the press whether or not the insert
    // landed; the chip is never a row activation.
    assert.equal(result.stopped, true)
    assert.equal(view.draft(), 'before')
    assert.equal(view.emitted.length, 0)
  } finally {
    view.dispose()
  }
})

it('removes every chip when the entry is disposed', () => {
  const view = mount({ rows: [entry('file', '/work/src/a.ts'), entry('directory', '/work/src')] })
  view.dispose()
  assert.equal(view.chips().length, 0)
  assert.equal(view.status().active, false)
})
