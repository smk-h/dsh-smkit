/**
 * "Add to conversation" on the host's read-only previews, driven through the
 * real client bundle against a stand-in for the shell's document preview.
 *
 * What is worth pinning is exactly what the feature promises:
 *
 * - selecting a passage adds nothing on its own: the right-click card is the
 *   only affordance (the floating button is gone, and it was the one that could
 *   not be placed at a surface's edges);
 * - a right-click with a live selection replaces the native menu with the
 *   shell's own card — two rows, standard row metrics, one glyph each — anchored
 *   at the pointer, or at the end of the selection for a keyboard menu key;
 * - its first row drops a fenced block into the composer draft whose info line
 *   is the previewed path (relative to the session's cwd) plus the line span —
 *   read from the rendered rows, never guessed;
 * - its second row copies the selection itself and leaves a short confirmation;
 * - a rendered Markdown document has no source lines, so its payload is the
 *   path alone; a selection over 500 characters is the header alone;
 * - a terminal is read through xterm's own copy path and quoted as a `console`
 *   block at every length;
 * - the path falls back to the absolute form when the session cwd is unknown,
 *   and the gesture is a no-op without a selection, with the pointer off that
 *   surface, or when the surface names no session;
 * - `dsh-better-sidebar` being loaded does not silence any of it: its editor is
 *   its own tab body with its own popup, and the host's surfaces stay ours.
 *
 * The VM has no DOM, so the document below implements only the questions this
 * feature asks: attribute and class selectors, `closest`, containment, a
 * rectangle per row, and a selection the test drives by hand.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

/** Let a clipboard write's promise settle (the confirmation follows it). */
const flush = () => new Promise((resolve) => setImmediate(resolve))

/** Every selector the stand-in answers: a tag, `.class`, `[attr]`, `[attr="v"]`. */
function parseSelector(selector) {
  return String(selector).split(',').map((raw) => {
    const text = raw.trim()
    const match = /^([a-zA-Z0-9]*)((?:\[[a-z-]+(?:="[^"]*")?\]|\.[a-zA-Z0-9_-]+)*)$/.exec(text)
    assert.ok(match, `the test DOM does not understand the selector "${selector}"`)
    const tokens = [...match[2].matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]|\.([a-zA-Z0-9_-]+)/g)]
    return {
      tag: match[1] === '' ? undefined : match[1].toLowerCase(),
      present: tokens
        .filter((token) => token[1] !== undefined)
        .map((token) => ({ name: token[1], value: token[2] })),
      classes: tokens.filter((token) => token[3] !== undefined).map((token) => token[3]),
    }
  })
}

/** Whether one element matches one parsed selector. */
function matchesParsed(element, parsed) {
  if (parsed.tag !== undefined && element.tagName.toLowerCase() !== parsed.tag) return false
  for (const attribute of parsed.present) {
    if (!element.hasAttribute(attribute.name)) return false
    if (attribute.value !== undefined && element.getAttribute(attribute.name) !== attribute.value) return false
  }
  for (const name of parsed.classes) {
    if (!String(element.className).split(/\s+/).includes(name)) return false
  }
  return true
}

/** One DOM element, as much of it as the watchers on this surface touch. */
class SandboxElement {
  constructor(tagName, owner) {
    this.tagName = String(tagName).toUpperCase()
    this.nodeType = 1
    this.owner = owner
    this.attributes = new Map()
    this.childNodes = []
    this.parentNode = null
    this.textContent = ''
    this.value = ''
    this.type = ''
    this.title = ''
    this.listeners = new Map()
    this.scrollTop = 0
    this.style = {}
    this.rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
    Object.defineProperty(this, 'className', {
      get: () => this.getAttribute('class') ?? '',
      set: (value) => this.setAttribute('class', value),
    })
    this.dataset = new Proxy({}, {
      set: (_target, key, value) => {
        this.setAttribute(`data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, String(value))
        return true
      },
      get: () => undefined,
    })
    this.classList = { add: () => {}, remove: () => {}, contains: () => false }
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

  insertBefore(child, reference) {
    child.parentNode = this
    const at = reference === null ? -1 : this.childNodes.indexOf(reference)
    if (at < 0) this.childNodes.push(child)
    else this.childNodes.splice(at, 0, child)
    return child
  }

  remove() {
    if (this.parentNode === null) return
    const at = this.parentNode.childNodes.indexOf(this)
    if (at >= 0) this.parentNode.childNodes.splice(at, 1)
    this.parentNode = null
  }

  contains(node) {
    let current = node
    while (current !== null && current !== undefined) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
  }

  addEventListener(type, handler) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((one) => one !== handler))
  }

  /** Deliver one event to this element's own listeners, as the browser would. */
  dispatch(type, event = {}) {
    const delivered = {
      type,
      key: '',
      preventDefault() { delivered.prevented = true },
      stopPropagation() { delivered.stopped = true },
      ...event,
    }
    for (const handler of this.listeners.get(type) ?? []) handler(delivered)
    return delivered
  }

  /** Deliver one real event object (the terminal probe uses this path). */
  dispatchEvent(event) {
    for (const handler of this.listeners.get(event.type) ?? []) handler(event)
    return !event.defaultPrevented
  }

  getBoundingClientRect() {
    return { ...this.rect }
  }

  closest(selector) {
    const parsed = parseSelector(selector)
    let node = this
    while (node !== null && node !== undefined) {
      if (parsed.some((one) => matchesParsed(node, one))) return node
      node = node.parentNode
    }
    return null
  }

  querySelectorAll(selector) {
    // Every feature in the bundle mounts here, and only the preview's own
    // selectors are this stand-in's business: anything else answers nothing.
    let parsed
    try {
      parsed = parseSelector(selector)
    } catch {
      return []
    }
    const found = []
    const visit = (node) => {
      for (const child of node.children) {
        if (parsed.some((one) => matchesParsed(child, one))) found.push(child)
        visit(child)
      }
    }
    visit(this)
    return found
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }
}

/** One rendered line: `<span class=line>` (code) or a numbered row (plain). */
function lineRow(parent, number, top, plain) {
  const row = new SandboxElement(plain === true ? 'div' : 'span')
  if (plain === true) row.setAttribute('data-textpreview-line', String(number))
  else row.setAttribute('class', 'line')
  row.textContent = `line ${number}`
  row.rect = { top, left: 0, right: 600, bottom: top + 20, width: 600, height: 20 }
  parent.appendChild(row)
  return row
}

/** Mount the bundle against one preview and hand back what the assertions need. */
function mount(options = {}) {
  const mode = options.mode ?? 'code'
  const total = options.lines ?? 40
  const shell = new SandboxElement('body')
  const html = new SandboxElement('html')
  html.root = true
  html.appendChild(shell)

  const sidebar = new SandboxElement('div')
  // Null models a preview outside any session container (a host that names none).
  if (options.sidebarSession !== null) sidebar.setAttribute('data-sidebar-right-session', options.sidebarSession ?? 's1')
  shell.appendChild(sidebar)

  const preview = new SandboxElement('div')
  preview.setAttribute('data-textpreview-state', 'text')
  sidebar.appendChild(preview)
  const header = new SandboxElement('div')
  preview.appendChild(header)
  const label = new SandboxElement('span')
  label.setAttribute('data-textpreview-path', '')
  label.setAttribute('title', options.path ?? '/work/src/a.ts')
  label.textContent = options.path ?? '/work/src/a.ts'
  header.appendChild(label)

  const body = new SandboxElement('div')
  body.setAttribute('data-textpreview-body', '')
  body.rect = { top: 100, left: 800, right: 1440, bottom: 700, width: 640, height: 600 }
  preview.appendChild(body)

  const rows = []
  if (mode === 'code') {
    const block = new SandboxElement('div')
    block.setAttribute('data-code-preview', '')
    const scroll = new SandboxElement('div')
    scroll.setAttribute('data-code-block-content', '')
    scroll.rect = { top: 100, left: 800, right: 1440, bottom: 700, width: 640, height: 600 }
    const pre = new SandboxElement('pre')
    const code = new SandboxElement('code')
    pre.appendChild(code)
    scroll.appendChild(pre)
    block.appendChild(scroll)
    body.appendChild(block)
    for (let number = 1; number <= total; number += 1) {
      rows.push(lineRow(code, number, 100 + (number - 1) * 20, false))
    }
  } else if (mode === 'plain') {
    const page = new SandboxElement('pre')
    page.setAttribute('data-textpreview-page', '1')
    body.appendChild(page)
    for (let number = 1; number <= total; number += 1) {
      rows.push(lineRow(page, number, 108 + (number - 1) * 20, true))
    }
  } else {
    // A rendered document: prose in blocks, no source lines to count.
    const doc = new SandboxElement('div')
    doc.setAttribute('data-document-markdown', '')
    const paragraph = new SandboxElement('p')
    paragraph.textContent = 'prose'
    doc.appendChild(paragraph)
    body.appendChild(doc)
    rows.push(paragraph)
  }

  // The sidebar terminal: an xterm root whose own `copy` listener answers with
  // the emulator's selection, exactly as xterm's `copyHandler` does on the real
  // element. `terminalSelect` stands in for the drag that filled it.
  const terminal = new SandboxElement('div')
  terminal.setAttribute('class', 'xterm')
  terminal.rect = { top: 100, left: 700, right: 1010, bottom: 620, width: 310, height: 520 }
  sidebar.appendChild(terminal)
  let terminalSelection = options.terminalText ?? ''
  terminal.addEventListener('copy', (event) => {
    event.clipboardData?.setData('text/plain', terminalSelection)
    event.preventDefault()
  })

  /** Something selectable outside the preview, for the endpoint check. */
  const outside = new SandboxElement('div')
  shell.appendChild(outside)

  // The draft the conversation service holds, and the revision its shell bumps
  // on every write.
  let draft = options.draft ?? ''
  let draftRev = 1
  const services = {
    conversation: {
      input: {
        for: () => ({
          state: { getSnapshot: () => ({ draft, draftRev }) },
          setDraft: (text) => { draft = text; draftRev += 1 },
        }),
      },
    },
    ...(options.betterSidebar === true ? { betterSidebar: {} } : {}),
  }

  const listeners = new Map()
  const observers = []
  const effects = []

  // The document's selection, as the feature reads it: collapsed, or one range
  // with the endpoints the test names.
  let selection = { isCollapsed: true, rangeCount: 0, toString: () => '', getRangeAt: () => null }
  let lastRect = { top: 100, left: 200, right: 320, bottom: 118, width: 120, height: 18 }

  const dom = {
    documentElement: html,
    body: shell,
    head: { appendChild() {} },
    activeElement: shell,
    hidden: false,
    createElement: (tag) => new SandboxElement(tag, dom),
    createElementNS: (_namespace, tag) => new SandboxElement(tag, dom),
    getSelection: () => selection,
    querySelector: () => null,
    querySelectorAll: (selector) => {
      try {
        return html.querySelectorAll(selector)
      } catch {
        return []
      }
    },
    addEventListener: (type, handler) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler])
    },
    removeEventListener: (type, handler) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((one) => one !== handler))
    },
  }

  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (callback) => callback,
  }

  // The card mounts the shell's `Menu` through a React root of its own; with
  // `options.menu` the platform table carries that, `createRoot` and the shell's
  // clipboard write. Every render is recorded so a test can read the card's
  // props and press its rows, and every write is kept so it can check what a
  // copy actually put on the clipboard.
  const renders = []
  const shellMenu = function Menu() {}
  const clipboard = { writes: [], ok: options.clipboardOk !== false }

  let exported
  runInNewContext(source, {
    // The terminal probe dispatches a `copy` event at xterm's root; the sandbox
    // needs a constructor and an element that can dispatch it.
    Event: class {
      constructor(type, init = {}) {
        this.type = type
        this.bubbles = init.bubbles === true
        this.cancelable = init.cancelable === true
        this.defaultPrevented = false
      }
      preventDefault() { this.defaultPrevented = true }
      stopPropagation() {}
    },
    window: {
      innerWidth: 1600,
      innerHeight: 900,
      addEventListener: () => {},
      removeEventListener: () => {},
      __ModuleLoader__: {
        load: ({ factory }) => {
          exported = factory((id) => {
            if (id === 'react') return react
            if (id === 'react-dom') throw new Error('no react-dom')
            if (id === 'react-dom/client') {
              return { createRoot: () => ({ render: (node) => { renders.push(node) }, unmount: () => {} }) }
            }
            if (id === '@deepseek-ai/dsh-client-ui-primitives') {
              if (options.menu !== true) throw new Error('no ui-primitives')
              return {
                Menu: shellMenu,
                writeClipboard: async (text) => {
                  clipboard.writes.push(text)
                  return clipboard.ok
                },
              }
            }
            throw new Error(`no platform module ${id}`)
          })
        },
      },
    },
    document: dom,
    Element: SandboxElement,
    Node: SandboxElement,
    DOMRect: class {
      constructor(x, y, width, height) {
        Object.assign(this, { x, y, width, height })
      }
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: { warn: () => {} },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; observers.push(this) }
      observe(target) { this.targets.push(target) }
      disconnect() { this.targets = [] }
    },
    requestAnimationFrame: (callback) => { callback(); return 0 },
    cancelAnimationFrame: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  })

  const ctx = {
    effect: (fn) => { effects.push(fn()) },
    provide: () => {},
    reflect: { get: (name) => services[name] },
    on: () => () => {},
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: { register: () => () => {}, inject: (_name, callback) => callback() },
    sessions: {
      // The composer's insert needs the session's scope; a host without one is
      // a no-op.
      scope: () => (options.scope === false ? undefined : { id: 's1' }),
      list: {
        getSnapshot: () => (options.cwd === null ? { byId: {} } : { byId: { s1: { cwd: options.cwd ?? '/work' } } }),
      },
    },
  }
  exported.apply(ctx)

  /** Deliver one event to the document's own listeners. */
  const fire = (type, event) => {
    const delivered = {
      type,
      preventDefault() { delivered.prevented = true },
      stopPropagation() { delivered.stopped = true },
      ...event,
    }
    for (const handler of listeners.get(type) ?? []) handler(delivered)
    return delivered
  }

  /** Select one range inside the preview (or nothing), as a drag does. */
  const select = (range = null) => {
    if (range === null) {
      selection = { isCollapsed: true, rangeCount: 0, toString: () => '', getRangeAt: () => null }
    } else {
      if (range.rect !== undefined) lastRect = range.rect
      selection = {
        isCollapsed: false,
        rangeCount: 1,
        toString: () => range.text ?? '',
        getRangeAt: () => ({
          startContainer: range.start,
          endContainer: range.end ?? range.start,
          getBoundingClientRect: () => ({ ...lastRect }),
        }),
      }
    }
    return selection
  }

  /** The open card, as the shell's `Menu` was last rendered. */
  const menu = () => {
    const last = renders[renders.length - 1]
    return last !== undefined && last.props?.open === true ? last : null
  }

  return {
    body: shell,
    preview,
    bodyElement: body,
    rows,
    terminal,
    /** Stand in for dragging over terminal output (the emulator's selection). */
    terminalSelect: (text) => { terminalSelection = text },
    outside,
    menu,
    /** What the shell's clipboard has been asked to write, in order. */
    clipboard: () => clipboard.writes.slice(),
    /** Make the next copy refused, as a browser without a clipboard does. */
    refuseClipboard: () => { clipboard.ok = false },
    /** The copy confirmation still on screen, if any. */
    copied: () => shell.querySelectorAll('[data-smkit-quote-copied]')[0] ?? null,
    /** Press one row of the open card, as the shell's menu does. */
    pick(id = 'quote') {
      const card = menu()
      assert.notEqual(card, null, 'the menu is open')
      card.props.onSelect(id)
    },
    /** Right-click one surface, as the browser does before its native menu. */
    contextMenu: (target, point = {}) => fire('contextmenu', {
      target,
      clientX: point.x ?? 0,
      clientY: point.y ?? 0,
    }),
    select,
    /** Deliver any other document event (to prove nothing listens for it). */
    fire,
    draft: () => draft,
    dispose() { for (const dispose of effects.reverse()) dispose() },
  }
}

it('opens the card on a preview selection and inserts the quoted block', () => {
  const view = mount({ menu: true })
  try {
    // Selecting is not a gesture of ours: nothing is drawn until a right-click.
    const before = view.body.children.length
    view.select({
      start: view.rows[4],
      end: view.rows[7],
      text: 'const a = 1\nconst b = 2\n...\nconst d = 4',
      rect: { top: 180, left: 200, right: 420, bottom: 260, width: 220, height: 80 },
    })
    view.fire('mouseup', { target: view.rows[7], button: 0, clientX: 310, clientY: 260 })
    assert.equal(view.body.children.length, before, 'a selection on its own adds nothing')
    assert.equal(view.menu(), null)

    const event = view.contextMenu(view.rows[7], { x: 900, y: 640 })
    assert.equal(event.prevented, true, 'the browser menu gives way to the card')
    assert.equal(event.stopped, true)

    const card = view.menu()
    assert.notEqual(card, null, 'the shell menu is up')
    // The card's items array is built in the VM's realm, so it is compared by
    // value rather than by prototype.
    assert.equal(card.props.items.map((item) => item.id).join(), 'quote,copy')
    assert.equal(card.props.items[0].label, 'addToConversation')
    assert.equal(card.props.items[1].label, 'copy')
    // Each row carries a glyph: the bubble-plus is lucide's, on its 24-unit grid
    // (`lucide.nodejs.cn/icons`); the copy mark is the host's own 16-unit one the
    // file tree's rows wear. The stand-in factory keeps a glyph's nodes as the
    // single array argument `iconElement` passes, so the counts are 3 paths and
    // a rect + a path.
    assert.equal(card.props.items[0].icon.type, 'svg', 'the quote row is marked')
    assert.equal(card.props.items[0].icon.props.viewBox, '0 0 24 24')
    assert.equal(card.props.items[0].icon.children[0].length, 3, 'the bubble and its plus')
    assert.equal(card.props.items[1].icon.type, 'svg', 'so is the copy row')
    assert.equal(card.props.items[1].icon.props.viewBox, '0 0 16 16')
    assert.equal(card.props.items[1].icon.children[0].length, 2, 'the two sheets')
    // The standard row, not the shell's compact list: compact shrinks the row to
    // 24px/11px text with `2px 6px` padding, which crowds the card's left edge.
    assert.equal(card.props.compact, undefined, 'the roomy row this card is read against')
    const anchor = card.props.getAnchorRect()
    assert.equal(anchor.x, 900, 'the card opens where the pointer is')
    assert.equal(anchor.y, 640)

    view.pick()
    assert.equal(
      view.draft(),
      '```src/a.ts:5-8\nconst a = 1\nconst b = 2\n...\nconst d = 4\n```',
      'the info line carries the cwd-relative path and the line span',
    )
    assert.equal(view.menu(), null, 'the card closes on its row')
    assert.deepEqual(view.clipboard(), [], 'the quote row is not a copy')

    // A keyboard menu key reports 0,0: the card opens at the end of the
    // selection instead, which is where the reader is looking.
    view.contextMenu(view.rows[7])
    const anchored = view.menu().props.getAnchorRect()
    assert.equal(anchored.x, 310, 'the selection’s midpoint, not the missing pointer')
    assert.equal(anchored.y, 180)
  } finally {
    view.dispose()
  }
})

it('copies the selection itself, and says so where the card was', async () => {
  const view = mount({ menu: true })
  try {
    // Indented, unfenced: what the native menu's `copy` would have produced.
    const text = '  const a = 1\n  const b = 2'
    view.select({ start: view.rows[2], end: view.rows[3], text })
    view.contextMenu(view.rows[3], { x: 900, y: 640 })
    view.pick('copy')
    assert.equal(view.menu(), null, 'the card closes before the write lands')
    await flush()

    assert.deepEqual(view.clipboard(), [text], 'the selection itself, not the fenced block')

    const note = view.copied()
    assert.notEqual(note, null, 'a copy that landed says so')
    assert.equal(note.textContent, 'copied')
    assert.equal(note.style.left, '900px')
    assert.equal(note.style.top, '640px', 'the confirmation stands where the card was')

    view.dispose()
    assert.equal(view.copied(), null, 'and the effect takes it with it')
  } finally {
    view.dispose()
  }
})

it('shows no confirmation when the clipboard refuses the write', async () => {
  const view = mount({ menu: true })
  try {
    view.refuseClipboard()
    view.select({ start: view.rows[2], end: view.rows[2], text: 'x' })
    view.contextMenu(view.rows[2], { x: 900, y: 300 })
    view.pick('copy')
    await flush()
    assert.equal(view.clipboard().length, 1, 'the write was attempted')
    assert.equal(view.copied(), null, 'a refused copy must not look like a copy')
  } finally {
    view.dispose()
  }
})

it('quotes a terminal from the card, and leaves the native menu alone', () => {
  const view = mount({ menu: true })
  try {
    // Nothing selected: the card has nothing to offer, so the browser keeps the
    // gesture — and with it the terminal's own right-click behaviour.
    view.select(null)
    const plain = view.contextMenu(view.rows[2], { x: 900, y: 300 })
    assert.equal(plain.prevented, undefined, 'no selection, no claim')
    assert.equal(view.menu(), null)

    // A selection left in the preview does not put a card under a pointer
    // somewhere else: the composer keeps its own paste menu.
    view.select({ start: view.rows[2], end: view.rows[2], text: 'x' })
    const elsewhere = view.contextMenu(view.outside, { x: 100, y: 100 })
    assert.equal(elsewhere.prevented, undefined, 'the card belongs to the surface under the pointer')
    assert.equal(view.menu(), null)

    // A terminal's selection is the emulator's, so the click that made it is
    // not part of the question: right there, right-click is enough.
    view.terminalSelect('$ ls\nsrc')
    const event = view.contextMenu(view.terminal, { x: 950, y: 320 })
    assert.equal(event.prevented, true)
    view.pick()
    assert.equal(view.draft(), '```console\n$ ls\nsrc\n```')

    // Empty selection, no card.
    view.terminalSelect('   \n')
    assert.equal(view.contextMenu(view.terminal, { x: 950, y: 320 }).prevented, undefined)
  } finally {
    view.dispose()
  }
})

it('keeps terminal passages whole, whatever their length', () => {
  const view = mount({ menu: true })
  try {
    // No path or line span to fall back to, so nothing is cut — not at the
    // preview's 500 either, and not at any size a scrollback can hold.
    const long = Array.from({ length: 400 }, (_unused, at) => `line ${at + 1}: 输出`).join('\n')
    assert.ok(long.length > 5000, 'the fixture is well past the preview limit')
    view.terminalSelect(long)
    view.contextMenu(view.terminal, { x: 900, y: 300 })
    view.pick()
    assert.equal(view.draft(), `\`\`\`console\n${long}\n\`\`\``)
  } finally {
    view.dispose()
  }
})

it('leaves the native menu alone when the shell cannot draw its own', () => {
  const view = mount()
  try {
    view.select({ start: view.rows[2], end: view.rows[2], text: 'x' })
    const event = view.contextMenu(view.rows[2], { x: 900, y: 300 })
    assert.equal(event.prevented, undefined, 'no card to replace it with')
    assert.equal(view.menu(), null)
  } finally {
    view.dispose()
  }
})

it('numbers a plain renderer’s rows by their own attribute', () => {
  const view = mount({ menu: true, mode: 'plain', lines: 20, path: '/work/notes/1.c' })
  try {
    view.select({ start: view.rows[1], end: view.rows[2], text: 'b\nc' })
    view.contextMenu(view.rows[2], { x: 900, y: 300 })
    view.pick()
    assert.equal(view.draft(), '```notes/1.c:2-3\nb\nc\n```')
  } finally {
    view.dispose()
  }
})

it('names only the path for a rendered Markdown document, which has no source lines', () => {
  const view = mount({ menu: true, mode: 'markdown', path: '/work/docs/readme.md' })
  try {
    view.select({ start: view.rows[0], end: view.rows[0], text: 'prose' })
    view.contextMenu(view.rows[0], { x: 900, y: 300 })
    view.pick()
    assert.equal(view.draft(), '```docs/readme.md\nprose\n```')
  } finally {
    view.dispose()
  }
})

it('drops the content for a selection over the limit, and keeps the header', () => {
  const view = mount({ menu: true })
  try {
    view.select({ start: view.rows[0], end: view.rows[0], text: 'x'.repeat(501) })
    view.contextMenu(view.rows[0], { x: 900, y: 300 })
    view.pick()
    assert.equal(view.draft(), 'src/a.ts:1', 'an empty fence would only take up room')
  } finally {
    view.dispose()
  }
})

it('keeps the absolute path when the session cwd is unknown', () => {
  const view = mount({ menu: true, cwd: null })
  try {
    view.select({ start: view.rows[4], end: view.rows[4], text: 'x' })
    view.contextMenu(view.rows[4], { x: 900, y: 300 })
    view.pick()
    assert.equal(view.draft(), '```/work/src/a.ts:5\nx\n```')
  } finally {
    view.dispose()
  }
})

it('offers nothing without a selection, for whitespace, outside the preview, or without a session', () => {
  const view = mount({ menu: true })
  try {
    const claim = (event) => assert.equal(event.prevented, undefined, 'nothing to quote, no card')

    view.select(null)
    claim(view.contextMenu(view.rows[3], { x: 900, y: 300 }))

    // Whitespace only: nothing to quote.
    view.select({ start: view.rows[3], end: view.rows[3], text: '  \n  ' })
    claim(view.contextMenu(view.rows[3], { x: 900, y: 300 }))

    // A selection whose ends live outside the preview body.
    view.select({ start: view.outside, end: view.outside, text: 'elsewhere' })
    claim(view.contextMenu(view.rows[3], { x: 900, y: 300 }))

    // A selection inside the preview, right-clicked on its header: that surface
    // keeps its own menu.
    view.select({ start: view.rows[3], end: view.rows[3], text: 'x' })
    claim(view.contextMenu(view.preview.querySelector('div'), { x: 900, y: 60 }))

    assert.equal(view.menu(), null)
  } finally {
    view.dispose()
  }

  const unnamed = mount({ menu: true, sidebarSession: null })
  try {
    unnamed.select({ start: unnamed.rows[3], end: unnamed.rows[3], text: 'x' })
    assert.equal(
      unnamed.contextMenu(unnamed.rows[3], { x: 900, y: 300 }).prevented,
      undefined,
      'no session, nowhere to insert',
    )
  } finally {
    unnamed.dispose()
  }
})

it('keeps answering on the host’s surfaces while dsh-better-sidebar is loaded', () => {
  const view = mount({ menu: true, betterSidebar: true })
  try {
    view.select({ start: view.rows[2], end: view.rows[3], text: 'a\nb' })
    const event = view.contextMenu(view.rows[3], { x: 900, y: 640 })
    assert.equal(event.prevented, true, 'the neighbour’s editor is its own surface; this one is the host’s')
    view.pick()
    assert.equal(view.draft(), '```src/a.ts:3-4\na\nb\n```')

    // Its terminal is still an xterm, so a terminal passage answers too.
    view.terminalSelect('$ ls')
    assert.equal(view.contextMenu(view.terminal, { x: 950, y: 320 }).prevented, true)
  } finally {
    view.dispose()
  }
})
