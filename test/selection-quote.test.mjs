/**
 * "Add to conversation" on the host's read-only previews, driven through the
 * real client bundle against a stand-in for the shell's document preview.
 *
 * What is worth pinning is exactly what the port promises:
 *
 * - a mouse-up that ends a selection inside a preview offers one floating
 *   button, and only one;
 * - it is anchored to the point the gesture ended at, not to the selection's
 *   bounding box, so a selection taller than the window keeps its button on
 *   screen (and stays put below the top edge);
 * - its press drops a fenced block into the composer draft whose info line is
 *   the previewed path (relative to the session's cwd) plus the line span —
 *   read from the rendered rows, never guessed;
 * - a rendered Markdown document has no source lines, so its payload is the
 *   path alone; a selection over 500 characters is the header alone;
 * - a terminal is read through xterm's own copy path and quoted as a `console`
 *   block at every length, with no document selection to die with;
 * - the path falls back to the absolute form when the session cwd is unknown,
 *   and the whole gesture is a no-op when the preview names no session;
 * - `dsh-better-sidebar` draws this same popup in its own viewer, so its
 *   service being present means this feature adds nothing;
 * - the button dies with its selection: an outside press, Escape, a collapsed
 *   selection, a scroll, or disposing the effect all remove it;
 * - the button's own press never collapses the selection (its `mousedown` is
 *   prevented), so the payload survives until the click lands.
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

  // A clock the test can move: the button ignores scrolls for a short settle
  // window after it opens, and waiting for real time would slow the suite down.
  let clock = Date.now()
  class FakeDate extends Date {
    static now() {
      return clock
    }
  }

  let exported
  runInNewContext(source, {
    Date: FakeDate,
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
      addEventListener: () => {},
      removeEventListener: () => {},
      __ModuleLoader__: {
        load: ({ factory }) => {
          exported = factory((id) => {
            if (id === 'react') return react
            if (id === 'react-dom') throw new Error('no react-dom')
            if (id === 'react-dom/client') {
              return { createRoot: () => ({ render: () => {}, unmount: () => {} }) }
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
      // a no-op (and the button still closes).
      scope: () => (options.scope === false ? undefined : { id: 's1' }),
      list: {
        getSnapshot: () => (options.cwd === null ? { byId: {} } : { byId: { s1: { cwd: options.cwd ?? '/work' } } }),
      },
    },
  }
  exported.apply(ctx)

  /** Deliver one event to the document's own listeners. */
  const fire = (type, event) => {
    const delivered = { type, preventDefault() {}, stopPropagation() {}, ...event }
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
    fire('selectionchange', {})
    return selection
  }

  const action = () => shell.querySelectorAll('[data-smkit-quote-action]')[0] ?? null

  return {
    body: shell,
    preview,
    bodyElement: body,
    rows,
    terminal,
    /** Stand in for dragging over terminal output (the emulator's selection). */
    terminalSelect: (text) => { terminalSelection = text },
    outside,
    action,
    select,
    draft: () => draft,
    scroll: () => fire('scroll', {}),
    /** Move the clock, for the scroll settle window. */
    advance: (ms) => { clock += ms },
    /**
     * End a selection over `target`, as the browser's mouse-up does. Without a
     * point the event carries no usable pointer, which is the synthetic case.
     */
    mouseUp: (target, point = {}) => fire('mouseup', {
      target,
      button: 0,
      detail: point.detail ?? 1,
      clientX: point.x ?? 0,
      clientY: point.y ?? 0,
    }),
    mouseDown: (target, point = {}) => fire('mousedown', {
      target,
      button: 0,
      detail: point.detail ?? 1,
      clientX: point.x ?? 0,
      clientY: point.y ?? 0,
    }),
    pressKey: (key) => fire('keydown', { key }),
    /** Press the button: mousedown first (the selection guard), then the click. */
    press() {
      const button = action()
      assert.notEqual(button, null, 'the button is open')
      const down = button.dispatch('mousedown')
      button.dispatch('click')
      return down
    },
    dispose() { for (const dispose of effects.reverse()) dispose() },
  }
}

it('offers the button over a preview selection and inserts the quoted block', () => {
  const view = mount()
  try {
    view.select({
      start: view.rows[4],
      end: view.rows[7],
      text: 'const a = 1\nconst b = 2\n...\nconst d = 4',
      rect: { top: 180, left: 200, right: 420, bottom: 260, width: 220, height: 80 },
    })
    view.mouseUp(view.rows[7])
    const button = view.action()
    assert.notEqual(button, null, 'the button is on the page')
    assert.equal(button.textContent, 'addToConversation')
    assert.equal(button.title, 'addToConversation', 'copy and bubble are one string')
    // Centred on the selection and lifted off it: the stylesheet owns the lift.
    assert.equal(button.style.left, '310px')
    assert.equal(button.style.top, '180px')

    const down = view.press()
    assert.equal(down.prevented, true, 'the press must not collapse the selection before the click')
    assert.equal(
      view.draft(),
      '```src/a.ts:5-8\nconst a = 1\nconst b = 2\n...\nconst d = 4\n```',
      'the info line carries the cwd-relative path and the line span',
    )
    assert.equal(view.action(), null, 'the button goes away once it has committed')
  } finally {
    view.dispose()
  }
})

it('anchors the button to the pointer, not to the selection’s box', () => {
  const view = mount()
  try {
    // A selection taller than the window: its box starts far above the viewport,
    // so a box anchor places the button off-screen — the defect this pins.
    view.select({
      start: view.rows[3],
      end: view.rows[39],
      text: 'x'.repeat(700),
      rect: { top: -400, left: 900, right: 1400, bottom: 520, width: 500, height: 920 },
    })
    view.mouseUp(view.rows[39], { x: 700, y: 520 })
    const button = view.action()
    assert.notEqual(button, null, 'a large selection keeps its button')
    assert.equal(button.style.left, '700px', 'the pointer, not the box midpoint')
    assert.equal(button.style.top, '520px', 'the pointer, not the box top')

    // Against the top edge the lift is floored, so the button stays on screen.
    view.mouseUp(view.rows[39], { x: 400, y: 10 })
    assert.equal(view.action().style.top, '44px', 'the button cannot be lifted off the window')
  } finally {
    view.dispose()
  }
})

it('adds a terminal selection as a console block', () => {
  const view = mount()
  try {
    view.terminalSelect('$ ls\nLICENSE  README.md  src')
    view.mouseUp(view.terminal, { x: 900, y: 300 })
    const button = view.action()
    assert.notEqual(button, null, 'the terminal gets the same button')
    assert.equal(button.style.left, '900px')
    assert.equal(button.style.top, '300px')

    view.press()
    assert.equal(view.draft(), '```console\n$ ls\nLICENSE  README.md  src\n```')

    // The terminal's selection is the emulator's, not the document's: a
    // selection change elsewhere must not drop its button.
    view.terminalSelect('npm test')
    view.mouseUp(view.terminal, { x: 900, y: 320 })
    view.select(null)
    assert.notEqual(view.action(), null, 'a document selection says nothing about the terminal')
  } finally {
    view.dispose()
  }
})

it('offers nothing for an empty terminal selection, and keeps long ones whole', () => {
  const view = mount()
  try {
    view.terminalSelect('   \n')
    view.mouseUp(view.terminal, { x: 900, y: 300 })
    assert.equal(view.action(), null, 'no selected text, no button')

    // No path or line span to fall back to, so nothing is cut — not at the
    // preview's 500 either, and not at any size a scrollback can hold.
    const long = Array.from({ length: 400 }, (_unused, at) => `line ${at + 1}: 输出`).join('\n')
    assert.ok(long.length > 5000, 'the fixture is well past the preview limit')
    view.terminalSelect(long)
    view.mouseUp(view.terminal, { x: 900, y: 300 })
    view.press()
    assert.equal(view.draft(), `\`\`\`console\n${long}\n\`\`\``)
  } finally {
    view.dispose()
  }
})

it('does not re-offer the terminal button for a plain click', () => {
  const view = mount()
  try {
    view.terminalSelect('a selection the reader already used')
    // xterm can keep its selection through a click; a click must not bring the
    // button back for text the reader did not just select.
    view.mouseDown(view.terminal, { x: 900, y: 300 })
    view.mouseUp(view.terminal, { x: 900, y: 300 })
    assert.equal(view.action(), null)

    // A drag is what selects, so it offers the button.
    view.mouseDown(view.terminal, { x: 900, y: 300 })
    view.mouseUp(view.terminal, { x: 940, y: 330 })
    assert.notEqual(view.action(), null)

    // So does a multi-click, which selects a word or a line without moving.
    view.mouseDown(view.terminal, { x: 900, y: 300 })
    view.mouseUp(view.terminal, { x: 900, y: 300, detail: 2 })
    assert.notEqual(view.action(), null)
  } finally {
    view.dispose()
  }
})

it('numbers a plain renderer’s rows by their own attribute', () => {
  const view = mount({ mode: 'plain', lines: 20, path: '/work/notes/1.c' })
  try {
    view.select({ start: view.rows[1], end: view.rows[2], text: 'b\nc' })
    view.mouseUp(view.rows[2])
    view.press()
    assert.equal(view.draft(), '```notes/1.c:2-3\nb\nc\n```')
  } finally {
    view.dispose()
  }
})

it('names only the path for a rendered Markdown document, which has no source lines', () => {
  const view = mount({ mode: 'markdown', path: '/work/docs/readme.md' })
  try {
    view.select({ start: view.rows[0], end: view.rows[0], text: 'prose' })
    view.mouseUp(view.rows[0])
    view.press()
    assert.equal(view.draft(), '```docs/readme.md\nprose\n```')
  } finally {
    view.dispose()
  }
})

it('drops the content for a selection over the limit, and keeps the header', () => {
  const view = mount()
  try {
    view.select({ start: view.rows[0], end: view.rows[0], text: 'x'.repeat(501) })
    view.mouseUp(view.rows[0])
    view.press()
    assert.equal(view.draft(), 'src/a.ts:1', 'an empty fence would only take up room')
  } finally {
    view.dispose()
  }
})

it('keeps the absolute path when the session cwd is unknown', () => {
  const view = mount({ cwd: null })
  try {
    view.select({ start: view.rows[4], end: view.rows[4], text: 'x' })
    view.mouseUp(view.rows[4])
    view.press()
    assert.equal(view.draft(), '```/work/src/a.ts:5\nx\n```')
  } finally {
    view.dispose()
  }
})

it('offers nothing without a selection, outside the preview, or without a session', () => {
  const view = mount()
  try {
    // A click that selects nothing.
    view.select(null)
    view.mouseUp(view.rows[3])
    assert.equal(view.action(), null)

    // Whitespace only: nothing to quote.
    view.select({ start: view.rows[3], end: view.rows[3], text: '  \n  ' })
    view.mouseUp(view.rows[3])
    assert.equal(view.action(), null)

    // A selection whose ends live outside the preview body.
    view.select({ start: view.outside, end: view.outside, text: 'elsewhere' })
    view.mouseUp(view.rows[3])
    assert.equal(view.action(), null)

    // A release past the preview's edge still belongs to the selection inside
    // it: that is how a drag over the last visible line usually ends.
    view.select({ start: view.rows[3], end: view.rows[3], text: 'x' })
    view.mouseUp(view.outside)
    assert.notEqual(view.action(), null, 'the selection names the surface, not the release target')
  } finally {
    view.dispose()
  }

  const unnamed = mount({ sidebarSession: null })
  try {
    unnamed.select({ start: unnamed.rows[3], end: unnamed.rows[3], text: 'x' })
    unnamed.mouseUp(unnamed.rows[3])
    assert.equal(unnamed.action(), null, 'no session, nowhere to insert')
  } finally {
    unnamed.dispose()
  }
})

it('stands down while dsh-better-sidebar draws the same popup', () => {
  const view = mount({ betterSidebar: true })
  try {
    view.select({ start: view.rows[3], end: view.rows[3], text: 'x' })
    view.mouseUp(view.rows[3])
    assert.equal(view.action(), null, 'two popups on one selection is the defect this prevents')
  } finally {
    view.dispose()
  }
})

it('closes on an outside press, Escape, a collapsed selection, a scroll, or teardown', () => {
  const view = mount()
  try {
    const open = (row) => {
      view.select({ start: row, end: row, text: 'x' })
      view.mouseUp(row)
      assert.notEqual(view.action(), null, 'the button is open')
    }

    open(view.rows[2])
    view.mouseDown(view.body)
    assert.equal(view.action(), null, 'an outside press dismisses')

    open(view.rows[2])
    view.pressKey('Escape')
    assert.equal(view.action(), null)

    open(view.rows[2])
    view.select(null)
    assert.equal(view.action(), null, 'the selection it belongs to is gone')

    open(view.rows[2])
    view.scroll()
    assert.notEqual(view.action(), null, 'a drag’s own auto-scroll must not kill it at once')
    view.advance(300)
    view.scroll()
    assert.equal(view.action(), null, 'later, a scroll means the anchor moved out from under it')

    open(view.rows[2])
    view.dispose()
    assert.equal(view.action(), null, 'and the effect takes it with it')
  } finally {
    view.dispose()
  }
})
