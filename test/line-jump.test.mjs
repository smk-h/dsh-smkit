/**
 * Ctrl+G on the host's text preview, driven through the real client bundle.
 *
 * What is worth pinning is exactly what the feature promises:
 *
 * - Ctrl+G (Cmd+G on macOS) opens one small box on the preview the reader is in,
 *   carrying the range the host has paged in so far (`1–8`, `1–8+`);
 * - Enter lands on the named line a third of the way down the scrollport, flashes
 *   it for 1.2 s, and closes the box; `:120` and `120:8` name line 120 too;
 * - Escape, blur and an empty box close it without moving the document;
 * - a line the host has not paged in yet is reached by pressing its own "load
 *   more" and looking again, and a line past the end lands on the last line;
 * - the gesture is left alone inside a text field, on a preview with no line
 *   numbers (Markdown), and while `dsh-better-sidebar` owns the surface;
 * - disposing the effect closes the box, clears the flash and drops the
 *   listeners.
 *
 * The DOM below is the smallest one the bundle's whole mount can run against:
 * the shell's own participants are no-ops here, and only the preview fixture is
 * real. Layout is not simulated — each element carries the rectangle the
 * feature reads, which is what the scroll arithmetic is checked against.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

/** Every selector this stand-in answers: a tag, `.class`, `[attr]`, `[attr="v"]`. */
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
    this.owner = owner
    this.attributes = new Map()
    this.childNodes = []
    this.parentNode = null
    this.textContent = ''
    this.value = ''
    this.listeners = new Map()
    this.focused = false
    this.selected = false
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

  get firstChild() {
    return this.childNodes[0] ?? null
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

  click() {
    this.dispatch('click')
  }

  focus() {
    this.focused = true
    if (this.owner !== undefined) this.owner.activeElement = this
  }

  select() {
    this.selected = true
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

/** One line of the highlighted renderer: `<span class=line>` with its rectangle. */
function codeLine(parent, number, top) {
  const line = new SandboxElement('span', undefined)
  line.setAttribute('class', 'line')
  line.textContent = `line ${number}`
  line.rect = { top, left: 0, right: 600, bottom: top + 20, width: 600, height: 20 }
  parent.appendChild(line)
  return line
}

/** Mount the bundle against one preview and hand back what the assertions need. */
function mount(options = {}) {
  const mode = options.mode ?? 'code'
  const total = options.lines ?? 40
  const shell = new SandboxElement('body')
  const html = new SandboxElement('html')
  html.root = true
  html.appendChild(shell)

  const preview = new SandboxElement('div')
  preview.setAttribute('data-textpreview-state', 'text')
  preview.appendChild(new SandboxElement('div'))
  const body = new SandboxElement('div')
  body.setAttribute('data-textpreview-body', 'true')
  body.rect = { top: 100, left: 800, right: 1440, bottom: 700, width: 640, height: 600 }
  preview.appendChild(body)
  shell.appendChild(preview)

  let scrollport = null
  let codeBlock = null
  let rows = []
  if (mode === 'code') {
    const code = new SandboxElement('div')
    code.setAttribute('data-code-preview', 'true')
    scrollport = new SandboxElement('div')
    scrollport.setAttribute('data-code-block-content', 'true')
    scrollport.rect = { top: 100, left: 800, right: 1440, bottom: 700, width: 640, height: 600 }
    const pre = new SandboxElement('pre')
    codeBlock = new SandboxElement('code')
    const block = codeBlock
    pre.appendChild(block)
    scrollport.appendChild(pre)
    code.appendChild(scrollport)
    body.appendChild(code)
    for (let number = 1; number <= total; number += 1) rows.push(codeLine(block, number, 100 + (number - 1) * 20))
  } else if (mode === 'plain') {
    scrollport = body
    const document_ = new SandboxElement('div')
    document_.setAttribute('data-textpreview-plain', 'true')
    const page = new SandboxElement('pre')
    page.setAttribute('data-textpreview-page', '1')
    document_.appendChild(page)
    body.appendChild(document_)
    for (let number = 1; number <= total; number += 1) {
      const row = new SandboxElement('div')
      row.setAttribute('data-textpreview-line', String(number))
      row.rect = { top: 108 + (number - 1) * 20, left: 800, right: 1440, bottom: 128 + (number - 1) * 20, width: 640, height: 20 }
      page.appendChild(row)
      rows.push(row)
    }
  } else {
    // A rendered document, with a fenced code block inside it: the block is a
    // `CodeBlock` with its own scrollport, and must not pass for the preview's
    // own renderer.
    const markdown = new SandboxElement('div')
    markdown.setAttribute('data-document-markdown', 'true')
    const code = new SandboxElement('div')
    code.setAttribute('data-code-preview', 'true')
    const scroll = new SandboxElement('div')
    scroll.setAttribute('data-code-block-content', 'true')
    const pre = new SandboxElement('pre')
    const block = new SandboxElement('code')
    for (let number = 1; number <= 6; number += 1) codeLine(block, number, 100 + number * 20)
    pre.appendChild(block)
    scroll.appendChild(pre)
    code.appendChild(scroll)
    markdown.appendChild(code)
    body.appendChild(markdown)
  }

  let more = null
  if (options.more === true) {
    more = new SandboxElement('button')
    more.setAttribute('data-textpreview-more', 'true')
    body.appendChild(more)
  }

  const composers = []
  if (options.composer === true) {
    const composer = new SandboxElement('textarea')
    shell.appendChild(composer)
    composers.push(composer)
  }

  const documentListeners = new Map()
  const observers = []
  const timers = new Map()
  const roots = []
  let nextTimer = 1

  const dom = {
    documentElement: html,
    body: shell,
    head: { appendChild() {} },
    activeElement: shell,
    createElement: (tag) => new SandboxElement(tag, dom),
    createElementNS: (_namespace, tag) => new SandboxElement(tag, dom),
    querySelector: (selector) => html.querySelector(selector),
    querySelectorAll: (selector) => html.querySelectorAll(selector),
    elementFromPoint: () => null,
    addEventListener: (type, handler) => {
      documentListeners.set(type, [...(documentListeners.get(type) ?? []), handler])
    },
    removeEventListener: (type, handler) => {
      documentListeners.set(type, (documentListeners.get(type) ?? []).filter((one) => one !== handler))
    },
  }

  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (callback) => callback,
  }

  let exported
  runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          exported = factory((id) => {
            if (id === 'react') return react
            if (id === 'react-dom') throw new Error('no react-dom')
            if (id === 'react-dom/client') {
              return {
                createRoot: () => {
                  const root = {
                    render: () => {},
                    unmount: () => { root.unmounted = true },
                    unmounted: false,
                  }
                  roots.push(root)
                  return root
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
      constructor(callback) {
        this.callback = callback
        this.targets = []
        observers.push(this)
      }
      observe(target) { this.targets.push(target) }
      disconnect() { this.targets = [] }
      flush() { if (this.targets.length > 0) this.callback([{ type: 'childList', target: this.targets[0] }], this) }
    },
    requestAnimationFrame: (callback) => { callback(); return 0 },
    cancelAnimationFrame: () => {},
    setTimeout: (callback, ms) => {
      const id = nextTimer++
      timers.set(id, { callback, ms })
      return id
    },
    clearTimeout: (id) => { timers.delete(id) },
    setInterval: () => 1,
    clearInterval: () => {},
  })

  const services = { betterSidebar: options.betterSidebar === true ? { isTabEnabled: () => true } : undefined }
  const effects = []
  const ctx = {
    effect: (fn) => { effects.push(fn()) },
    provide: () => {},
    reflect: { get: (name) => services[name] },
    on: () => () => {},
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: { register: () => () => {}, inject: (_name, callback) => callback() },
  }
  exported.apply(ctx)

  /** Deliver Ctrl+G (or whatever keys) the way the browser dispatches it. */
  const press = (target, key, mods = {}) => {
    const event = {
      target,
      key,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      isComposing: false,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() {},
      ...mods,
    }
    for (const handler of documentListeners.get('keydown') ?? []) handler(event)
    return event
  }

  /** Run the timers of one duration, as time passing would. */
  const drain = (ms) => {
    for (let guard = 0; guard < 200; guard += 1) {
      const entry = [...timers.entries()].find(([, timer]) => timer.ms === ms)
      if (entry === undefined) return
      timers.delete(entry[0])
      entry[1].callback()
    }
  }

  /** Type into the open box and press Enter, as the reader would. */
  const jump = (text) => {
    const field = box()?.querySelector('input')
    assert.notEqual(field ?? null, null, 'the box is open')
    field.value = text
    field.dispatch('keydown', { key: 'Enter' })
  }

  const box = () => html.querySelector('[data-smkit-line-jump]')

  return {
    body: shell,
    preview,
    scrollport,
    rows,
    more,
    composer: composers[0] ?? null,
    box,
    jump,
    press,
    drain,
    /** Point at one preview, so `pick` prefers it. */
    pointAt: (element) => { dom.elementFromPoint = () => element },
    setActive: (element) => { dom.activeElement = element },
    /** Replace every line node, as the host does when a page arrives. */
    rerender(total) {
      if (codeBlock === null) return
      codeBlock.childNodes = []
      rows.length = 0
      for (let number = 1; number <= total; number += 1) rows.push(codeLine(codeBlock, number, 100 + (number - 1) * 20))
    },
    /**
     * Deliver the re-render the go-to-line watcher is waiting for. The outline
     * keeps observers of its own on the same document, so only the one watching
     * the preview root is woken.
     */
    flushMutations() {
      for (const observer of observers) {
        if (observer.targets.some((target) => target.hasAttribute?.('data-textpreview-state') === true)) observer.flush()
      }
    },
    setBetterSidebar(value) { services.betterSidebar = value },
    pending: () => timers.size,
    dispose() { for (const dispose of effects.reverse()) dispose() },
  }
}

it('opens the go-to-line box on Ctrl+G, with the range rendered so far', () => {
  const view = mount({ lines: 40 })
  try {
    const event = view.press(view.body, 'g')
    assert.equal(event.defaultPrevented, true, 'the browser keeps no Ctrl+G of its own here')
    const box = view.box()
    assert.notEqual(box, null, 'the box is on the page')
    const field = box.querySelector('input')
    assert.equal(field.getAttribute('placeholder'), 'linePlaceholder')
    assert.equal(field.getAttribute('aria-label'), 'gotoLine')
    assert.equal(field.focused, true, 'the field takes the caret')
    assert.equal(field.selected, true, 'and its text is selected, as an editor does')
    assert.equal(box.querySelector('[data-smkit-line-jump-hint]').textContent, '1–40', 'no pages left')
    // Pinned inside the preview's top-right corner.
    assert.equal(box.style.top, '108px')
    assert.equal(box.style.left, '1190px')
  } finally {
    view.dispose()
  }
})

it('lands on the named line a third of the way down and keeps it marked', () => {
  const view = mount({ lines: 40 })
  try {
    view.press(view.body, 'g')
    view.jump('30')
    assert.equal(view.box(), null, 'the box closes on Enter')
    // Line 30 sits 29 × 20 = 580 into the scrollport, which is 600 tall.
    assert.equal(view.scrollport.scrollTop, 380, '580 − 600 / 3')
    assert.equal(view.rows[29].hasAttribute('data-smkit-line-jump-mark'), true)
    assert.equal(view.rows[28].hasAttribute('data-smkit-line-jump-mark'), false)
    // Time passing changes nothing: the mark is the answer to "where did I land".
    view.drain(5000)
    assert.equal(view.rows[29].hasAttribute('data-smkit-line-jump-mark'), true, 'the mark stays put')

    view.press(view.body, 'g')
    view.jump('12')
    assert.equal(view.rows[11].hasAttribute('data-smkit-line-jump-mark'), true)
    assert.equal(view.rows[29].hasAttribute('data-smkit-line-jump-mark'), false, 'one mark at a time')
  } finally {
    view.dispose()
  }
})

it('puts the mark back when the host re-renders the block under it', () => {
  const view = mount({ lines: 40 })
  try {
    view.press(view.body, 'g')
    view.jump('30')
    view.rerender(40)
    assert.equal(view.rows[29].hasAttribute('data-smkit-line-jump-mark'), false, 'a fresh render drops it')
    view.flushMutations()
    assert.equal(view.rows[29].hasAttribute('data-smkit-line-jump-mark'), true, 'and the mark is repainted')
    assert.equal(view.scrollport.scrollTop, 380, 'without moving the document again')
  } finally {
    view.dispose()
  }
})

it('reads :120 and 120:8 as line 120, and ignores an empty box', () => {
  const view = mount({ lines: 200 })
  try {
    for (const typed of [':120', '120:8', ' 120 ']) {
      view.press(view.body, 'g')
      view.jump(typed)
      assert.equal(view.rows[119].hasAttribute('data-smkit-line-jump-mark'), true, typed)
    }
    const before = view.scrollport.scrollTop
    view.press(view.body, 'g')
    view.jump('   ')
    assert.equal(view.box(), null, 'an empty box just closes')
    assert.equal(view.scrollport.scrollTop, before, 'and moves nothing')
  } finally {
    view.dispose()
  }
})

it('closes without moving on Escape and on blur', () => {
  const view = mount({ lines: 40 })
  try {
    view.press(view.body, 'g')
    let field = view.box().querySelector('input')
    field.value = '12'
    field.dispatch('keydown', { key: 'Escape' })
    assert.equal(view.box(), null)
    assert.equal(view.scrollport.scrollTop, 0, 'Escape names nothing')

    view.press(view.body, 'g')
    field = view.box().querySelector('input')
    field.value = '12'
    field.dispatch('blur')
    assert.equal(view.box(), null, 'clicking away closes it too')
    assert.equal(view.scrollport.scrollTop, 0)
  } finally {
    view.dispose()
  }
})

it('leaves Ctrl+G alone in a text field and on a preview with no line numbers', () => {
  const composer = mount({ composer: true })
  try {
    const event = composer.press(composer.composer, 'g')
    assert.equal(composer.box(), null, 'the composer keeps its own keystroke')
    assert.equal(event.defaultPrevented, false)
  } finally {
    composer.dispose()
  }

  const markdown = mount({ mode: 'markdown' })
  try {
    const event = markdown.press(markdown.body, 'g')
    assert.equal(markdown.box(), null, 'a rendered document has no lines to name')
    assert.equal(event.defaultPrevented, false)
  } finally {
    markdown.dispose()
  }
})

it('presses the host’s load-more until the named line is rendered', () => {
  const view = mount({ mode: 'plain', lines: 20, more: true })
  try {
    view.press(view.body, 'g')
    assert.equal(view.box().querySelector('[data-smkit-line-jump-hint]').textContent, '1–20+', 'pages remain')
    let clicks = 0
    view.more.addEventListener('click', () => {
      clicks += 1
      // The host appends its next page, as its own fetch would.
      const page = view.rows[0].parentNode
      for (let number = view.rows.length + 1; number <= 40; number += 1) {
        const row = new SandboxElement('div')
        row.setAttribute('data-textpreview-line', String(number))
        row.rect = { top: 108 + (number - 1) * 20, left: 800, right: 1440, bottom: 128 + (number - 1) * 20, width: 640, height: 20 }
        page.appendChild(row)
        view.rows.push(row)
      }
    })
    view.jump('30')
    assert.equal(clicks, 1, 'one page was asked for, through the host’s own control')
    assert.equal(view.rows[29].hasAttribute('data-smkit-line-jump-mark'), false, 'not rendered yet')
    view.drain(60)
    assert.equal(view.rows[29].hasAttribute('data-smkit-line-jump-mark'), true, 'the retry lands on it')
    // Line 30 sits 8 + 29 × 20 = 588 into the scrollport, which is 600 tall.
    assert.equal(view.scrollport.scrollTop, 388)
  } finally {
    view.dispose()
  }
})

it('lands on the last line when the document ends before the named line', () => {
  const view = mount({ mode: 'plain', lines: 12 })
  try {
    view.press(view.body, 'g')
    view.jump('999')
    assert.equal(view.rows[11].hasAttribute('data-smkit-line-jump-mark'), true, 'the last line, as an editor does')
  } finally {
    view.dispose()
  }
})

it('closes the box, clears every mark and drops the listener when disposed', () => {
  const view = mount({ lines: 40 })
  try {
    view.press(view.body, 'g')
    view.jump('30')
    assert.equal(view.box(), null)
    view.dispose()
    assert.equal(view.rows[29].hasAttribute('data-smkit-line-jump-mark'), false)
    assert.equal(view.pending(), 0, 'the flash timer is cancelled')
    const event = view.press(view.body, 'g')
    assert.equal(view.box(), null, 'and the gesture is gone')
    assert.equal(event.defaultPrevented, false)
  } finally {
    view.dispose()
  }
})

it('stays out of the way while dsh-better-sidebar owns the preview', () => {
  const view = mount({ lines: 40, betterSidebar: true })
  try {
    const event = view.press(view.body, 'g')
    assert.equal(view.box(), null)
    assert.equal(event.defaultPrevented, false)
  } finally {
    view.dispose()
  }
})

it('does not open on Shift or Alt variants, or on another letter', () => {
  const view = mount({ lines: 40 })
  try {
    assert.equal(view.press(view.body, 'g', { shiftKey: true }).defaultPrevented, false)
    assert.equal(view.press(view.body, 'g', { altKey: true }).defaultPrevented, false)
    assert.equal(view.press(view.body, 'f').defaultPrevented, false)
    assert.equal(view.press(view.body, 'g', { ctrlKey: false }).defaultPrevented, false)
    assert.equal(view.box(), null)
  } finally {
    view.dispose()
  }
})
