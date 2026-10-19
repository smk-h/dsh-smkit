/**
 * The Markdown preview's table of contents, driven through the real client
 * bundle against a stand-in for the host's document preview.
 *
 * The feature is a port of `dsh-better-sidebar`'s `MdToc`, and what is worth
 * pinning is exactly what the port promises:
 *
 * - fewer than three headings and the toggle is not drawn at all (but the
 *   zero-height bar is there, waiting for pages);
 * - the popover lists the headings in document order, with the level number
 *   beside the text and the level carried as the item's own `data-*` value (the
 *   stylesheet's indent ladder reads that);
 * - the popover opens on the section being read, with that row lit and centred,
 *   and the mark follows the reader while it stays open;
 * - the toggle rides the preview header just before reload, comes back if a
 *   host re-render drops it, and stays in the bar on a host without that row;
 * - a click on an entry scrolls the heading to the top, flashes it for 1.2 s
 *   and closes the popover;
 * - Escape and a press outside the bar close it; a press inside does not;
 * - the bar pins itself where the document's prose padding rests it, so the
 *   toggle does not rise when the reader starts scrolling;
 * - a page the host appends later is picked up through the body observer, and
 *   an unchanged document never gains a second bar;
 * - a body that stops showing Markdown loses the bar, and gets it back when the
 *   document returns;
 * - disposing the effect takes every bar away.
 *
 * The VM has no DOM, so the document below implements only the questions the
 * feature asks: a small attribute/tag selector grammar, `:not([attr])`,
 * `closest`, `contains`, and per-element listeners.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

/** Every selector the feature writes, as far as this stand-in answers them. */
function parseSelector(selector) {
  return String(selector).split(',').map((part) => {
    const text = part.trim()
    const match = /^([a-zA-Z0-9]*)((?:\[[a-z-]+(?:="[^"]*")?\]|:not\(\[[a-z-]+\]\))*)$/.exec(text)
    assert.ok(match, `the test DOM does not understand the selector "${selector}"`)
    const tokens = [...match[2].matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]|:not\(\[([a-z-]+)\]\)/g)]
    return {
      tag: match[1] === '' ? undefined : match[1].toLowerCase(),
      present: tokens.filter((token) => token[3] === undefined).map((token) => ({
        name: token[1],
        value: token[2],
      })),
      absent: tokens.filter((token) => token[3] !== undefined).map((token) => token[3]),
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
  for (const name of parsed.absent) {
    if (element.hasAttribute(name)) return false
  }
  return true
}

/** Where the test says an element sits, in viewport coordinates. */
const placements = new Map()

/**
 * The stand-in's layout for one element.
 *
 * Elements the test placed answer with that. The popover and its rows are built
 * inside the feature, so they are laid out synthetically — a 200px panel of
 * 24px rows — which is enough for the positioning rules to be observable.
 */
function placementOf(element) {
  if (element === null || element === undefined) return undefined
  const placed = placements.get(element)
  if (placed !== undefined) return placed
  if (element.className === 'smkit-outline-toc-panel') return { top: 132, height: 200 }
  if (element.getAttribute('data-smkit-md-toc-item') !== null) {
    const index = element.parentNode?.children.indexOf(element) ?? 0
    return { top: 132 + index * 24, height: 24 }
  }
  return undefined
}

/** Tell the stand-in where one element sits. */
function place(element, top, height) {
  placements.set(element, { top, height })
  return element
}

/** One DOM element, as much of it as the feature touches. */
class SandboxElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.attributes = new Map()
    this.childNodes = []
    this.parentNode = null
    this.textContent = ''
    this.type = ''
    this.listeners = new Map()
    // A real element always carries a style object; the feature writes the
    // bar's sticky offset into it.
    this.style = {}
    // The popover is the one scroller the feature moves by hand.
    this.scrollTop = 0
    Object.defineProperty(this, 'className', {
      get: () => this.getAttribute('class') ?? '',
      set: (value) => this.setAttribute('class', value),
    })
    Object.defineProperty(this, 'title', {
      get: () => this.getAttribute('title') ?? '',
      set: (value) => this.setAttribute('title', value),
    })
    // `installStylesheet` writes `tag.dataset.smkitCss`; a real element always
    // has one, and the stylesheet injection runs at bundle load.
    this.dataset = new Proxy({}, {
      set: (target, key, value) => {
        target[key] = value
        this.setAttribute(`data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, String(value))
        return true
      },
      get: (target, key) => target[key],
    })
    this.classList = {
      add: (name) => {
        const names = new Set((this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean))
        names.add(name)
        this.setAttribute('class', [...names].join(' '))
      },
      remove: (name) => {
        const names = (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
        this.setAttribute('class', names.filter((one) => one !== name).join(' '))
      },
      contains: (name) => (this.getAttribute('class') ?? '').split(/\s+/).includes(name),
    }
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

  get nextSibling() {
    const siblings = this.parentNode?.childNodes ?? []
    const at = siblings.indexOf(this)
    return at < 0 ? null : siblings[at + 1] ?? null
  }

  get clientHeight() {
    return placementOf(this)?.height ?? 0
  }

  /** The stand-in's layout: what `place` (or the popover's synthetic layout) says. */
  getBoundingClientRect() {
    const placed = placementOf(this)
    return { top: placed?.top ?? 0, left: 0, right: 0, bottom: 0, width: 0, height: placed?.height ?? 0 }
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

  /** Fire one event on this element (a click on the toggle or an entry). */
  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }

  matches(selector) {
    return parseSelector(selector).some((parsed) => matchesParsed(this, parsed))
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
    const parsed = parseSelector(selector)
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

  scrollIntoView(options) {
    this.scrolled = options
  }
}

/** One rendered heading: `<h2>title</h2>`, text already set. */
function heading(level, text) {
  const el = new SandboxElement(`h${level}`)
  el.textContent = text
  return el
}

/** One Markdown document, carrying the host's prose padding the stub answers. */
function markdownDocument(headings, paddingTop = '10px') {
  const doc = new SandboxElement('div')
  doc.setAttribute('data-document-markdown', '')
  doc.computedPaddingTop = paddingTop
  for (const node of headings) doc.appendChild(node)
  return doc
}

/**
 * A host preview: the header row (path, wrap, reload) over the scroll body.
 *
 * `withHeader: false` stands in for a host that draws no tool row, where the
 * toggle has to stay in the bar.
 */
function previewBody(headings, paddingTop, withHeader = true) {
  const preview = new SandboxElement('div')
  preview.setAttribute('data-textpreview-state', 'text')
  const header = new SandboxElement('div')
  let reload = null
  if (withHeader) {
    const path = new SandboxElement('span')
    path.textContent = '/work/README.md'
    header.appendChild(path)
    const wrap = new SandboxElement('button')
    wrap.setAttribute('data-textpreview-tool', 'wrap')
    header.appendChild(wrap)
    reload = new SandboxElement('button')
    reload.setAttribute('data-textpreview-tool', 'reload')
    header.appendChild(reload)
    preview.appendChild(header)
  }
  const body = new SandboxElement('div')
  body.setAttribute('data-textpreview-body', '')
  const doc = markdownDocument(headings, paddingTop)
  body.appendChild(doc)
  preview.appendChild(body)
  return { preview, header, reload, body, doc }
}

/**
 * Mount the whole bundle once against one preview body and hand back what the
 * assertions need.
 * @param options - `headings` to render, the document's `paddingTop` (10px as
 *   the host sets it), `header: false` for a host that draws no tool row, the
 *   `betterSidebar` service the neighbour probe should find (`true` =
 *   published), and `computedStyle: false` to stand in for a harness with no
 *   layout.
 */
function mount(options = {}) {
  const html = new SandboxElement('html')
  html.root = true
  const shell = new SandboxElement('body')
  html.appendChild(shell)
  const { preview, header, reload, body, doc } = previewBody(
    options.headings ?? [], options.paddingTop, options.header !== false,
  )
  shell.appendChild(preview)

  /** Timers the flash schedules, so the test can see the class both ways. */
  const timers = []
  /** Document listeners, by type (keydown / pointerdown / click). */
  const documentListeners = new Map()
  /** Observers the bundle created, in creation order. */
  const observers = []
  let nextTimer = 1
  let disposed = false

  const dom = {
    documentElement: html,
    body: shell,
    head: { appendChild() {} },
    createElement: (tag) => new SandboxElement(tag),
    createElementNS: (_namespace, tag) => new SandboxElement(tag),
    querySelector: () => null,
    querySelectorAll: (selector) => {
      try {
        return html.querySelectorAll(selector)
      } catch {
        return []
      }
    },
    addEventListener: (type, handler) => {
      documentListeners.set(type, [...(documentListeners.get(type) ?? []), handler])
    },
    removeEventListener: (type, handler) => {
      documentListeners.set(type, (documentListeners.get(type) ?? []).filter((one) => one !== handler))
    },
  }

  /**
   * Deliver a childList record the way the browser would: every observer whose
   * target contains the node hears about it (the document observer and the
   * preview body's own).
   */
  function mutate(node, added = true) {
    for (const observer of observers) {
      if (!observer.targets.some((target) => target === node || target?.contains?.(node) === true)) continue
      observer.callback([{
        type: 'childList',
        addedNodes: added ? [node] : [],
        removedNodes: added ? [] : [node],
      }])
    }
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
            throw new Error(`no platform module ${id}`)
          })
        },
      },
    },
    document: dom,
    Element: SandboxElement,
    Node: SandboxElement,
    // The host pads the rendered document (10px top, 12px sides) and the
    // feature reads that padding to place the bar's sticky offset. The rest of
    // the answer keeps other bundle features that probe styles at load awake
    // but harmless; `computedStyle: false` stands in for a bare harness.
    ...(options.computedStyle === false ? {} : {
      getComputedStyle: (element) => ({
        paddingTop: element?.computedPaddingTop ?? '0px',
        paddingRight: '12px',
        paddingBottom: '0px',
        paddingLeft: '12px',
        color: 'rgb(0, 0, 0)',
      }),
    }),
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
    requestAnimationFrame: (callback) => { callback(); return 0 },
    cancelAnimationFrame: () => {},
    setTimeout: (callback, ms) => {
      const id = nextTimer++
      timers.push({ id, callback, ms })
      return id
    },
    clearTimeout: (id) => {
      const at = timers.findIndex((timer) => timer.id === id)
      if (at >= 0) timers.splice(at, 1)
    },
    setInterval: () => 1,
    clearInterval: () => {},
  })

  /** The neighbour service the feature probes; `true` is "published". */
  const services = {
    betterSidebar: options.betterSidebar === true
      ? { isTabEnabled: () => true }
      : options.betterSidebar === undefined || options.betterSidebar === false
        ? undefined
        : options.betterSidebar,
  }
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

  const bar = () => body.querySelector('[data-smkit-md-toc]')
  // The toggle may live in the preview header, outside the body being watched.
  const toggle = () => shell.querySelector('[data-smkit-md-toc-toggle]')
  const panel = () => body.querySelector('[data-smkit-md-toc-panel]')
  const items = () => body.querySelectorAll('[data-smkit-md-toc-item]')
  /** Fire one document-level event at the nodes the feature listens for. */
  const fireDocument = (type, event) => {
    for (const handler of documentListeners.get(type) ?? []) handler(event)
  }
  return {
    preview,
    header,
    reload,
    body,
    doc,
    shell,
    bar,
    toggle,
    panel,
    items,
    timers,
    dispose() {
      if (disposed) return
      disposed = true
      for (const dispose of effects.reverse()) dispose()
    },
    /** Publish, replace or withdraw the neighbour service (an unload is `undefined`). */
    setBetterSidebar(value) {
      services.betterSidebar = value
    },
    /** Add a heading the way a new page of `text-pages` would. */
    appendHeading(level, text) {
      const el = heading(level, text)
      doc.appendChild(el)
      mutate(el)
      return el
    },
    /** Swap the body to a non-Markdown preview (code, image, PDF…). */
    toOtherPreview() {
      // The record a browser delivers carries the node that left, but the
      // observers that must hear it are the ones watching its (still attached)
      // container — that is what the body being passed here stands in for.
      doc.remove()
      mutate(body, false)
    },
    /** Put a Markdown document back into the same body (the next tab). */
    backToMarkdown(headings, paddingTop) {
      const next = markdownDocument(headings, paddingTop)
      body.appendChild(next)
      mutate(next)
      return next
    },
    pressOutside(target = shell) {
      fireDocument('pointerdown', { target })
    },
    pressEscape() {
      fireDocument('keydown', { key: 'Escape' })
    },
    flushFlash() {
      for (const timer of [...timers]) {
        if (timer.ms !== 1200) continue
        timers.splice(timers.indexOf(timer), 1)
        timer.callback()
      }
    },
  }
}

it('draws no toggle while the document has fewer than three headings', () => {
  const view = mount({ headings: [heading(1, '一'), heading(2, '1.1')] })
  try {
    assert.ok(view.bar() !== null, 'the zero-height bar is always there')
    assert.equal(view.toggle(), null, 'two headings are not an outline')
    assert.equal(view.panel(), null)
  } finally {
    view.dispose()
  }
})

it('draws the toggle once the document has three headings, closed', () => {
  const view = mount({ headings: [heading(1, '一'), heading(2, '1.1'), heading(2, '1.2')] })
  try {
    const toggle = view.toggle()
    assert.ok(toggle !== null)
    assert.equal(toggle.tagName, 'BUTTON')
    assert.equal(toggle.type, 'button')
    assert.equal(toggle.getAttribute('aria-label'), 'toc')
    assert.equal(toggle.getAttribute('title'), 'toc', 'copy and bubble are one string, as upstream')
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(toggle.getAttribute('class'), 'smkit-outline-toc-toggle')
    assert.equal(toggle.children.length, 1, 'the glyph is the toggle’s only child')
    assert.equal(toggle.children[0].tagName, 'SVG')
    assert.equal(view.panel(), null, 'a closed outline has no panel')
  } finally {
    view.dispose()
  }
})

it('rides the preview header, just before the reload control', () => {
  const view = mount({ headings: [heading(1, '一'), heading(2, '1.1'), heading(2, '1.2')] })
  try {
    const toggle = view.toggle()
    assert.equal(toggle.parentNode, view.header, 'the toggle joins the header row')
    assert.equal(toggle.nextSibling, view.reload, 'and sits immediately before reload')
    assert.equal(toggle.getAttribute('data-smkit-md-toc-in-header'), '')
    assert.equal(
      view.bar().getAttribute('data-smkit-md-toc-in-header'),
      '',
      'the bar knows the toggle left it, so the panel opens under the header',
    )
    assert.equal(view.bar().contains(toggle), false, 'the bar holds the panel alone')
  } finally {
    view.dispose()
  }
})

it('puts the toggle back when a host re-render drops it from the header', () => {
  const view = mount({ headings: [heading(1, '一'), heading(2, '1.1'), heading(2, '1.2')] })
  try {
    view.toggle().remove()
    // The next draw re-hangs it; a page arriving is the usual mutation while a
    // long document is being read.
    view.appendHeading(2, '1.3')
    const toggle = view.toggle()
    assert.ok(toggle !== null, 'the control comes back')
    assert.equal(toggle.nextSibling, view.reload, 'in the same place')
  } finally {
    view.dispose()
  }
})

it('keeps the floating square when the host draws no tool row', () => {
  const view = mount({
    headings: [heading(1, '一'), heading(2, '1.1'), heading(2, '1.2')],
    header: false,
  })
  try {
    const toggle = view.toggle()
    assert.equal(toggle.parentNode, view.bar(), 'no header to join, so it stays in the bar')
    assert.equal(toggle.getAttribute('data-smkit-md-toc-in-header'), null)
  } finally {
    view.dispose()
  }
})

it('takes the toggle out of the header when the preview stops being Markdown', () => {
  const view = mount({ headings: [heading(1, '一'), heading(2, '1.1'), heading(2, '1.2')] })
  try {
    const toggle = view.toggle()
    view.toOtherPreview()
    assert.equal(toggle.isConnected, false, 'a code file gets no outline control')
    assert.equal(view.header.contains(toggle), false)
  } finally {
    view.dispose()
  }
})

it('opens a popover listing every heading with its level and text', () => {
  const view = mount({
    headings: [heading(1, '项目简介'), heading(2, '背景'), heading(3, '细节'), heading(2, '介绍')],
  })
  try {
    view.toggle().dispatch('click')
    assert.equal(view.toggle().getAttribute('aria-expanded'), 'true')
    const items = view.items()
    assert.equal(items.length, 4)
    assert.deepEqual(
      items.map((item) => item.getAttribute('data-smkit-md-toc-level')),
      ['1', '2', '3', '2'],
      'the stylesheet’s indent ladder reads this attribute',
    )
    assert.deepEqual(
      items.map((item) => item.getAttribute('title')),
      ['项目简介', '背景', '细节', '介绍'],
    )
    assert.deepEqual(
      items.map((item) => item.children.map((child) => child.textContent)),
      [['1', '项目简介'], ['2', '背景'], ['3', '细节'], ['2', '介绍']],
      'level number first, then the text',
    )
    assert.equal(items[0].getAttribute('class'), 'smkit-outline-toc-item')
  } finally {
    view.dispose()
  }
})

it('opens on the section being read, with its row lit', () => {
  const first = heading(1, '一')
  const second = heading(2, '1. 背景')
  const third = heading(2, '2. 介绍')
  const fourth = heading(3, '2.1 细节')
  const view = mount({ headings: [first, second, third, fourth] })
  try {
    // The reader has scrolled past the first two headings, and the reading line
    // (32px under the scrollport edge, at 132) is inside the second one.
    place(view.body, 100, 600)
    place(first, 40, 40)
    place(second, 120, 40)
    place(third, 400, 40)
    place(fourth, 900, 40)
    view.toggle().dispatch('click')
    const items = view.items()
    assert.deepEqual(
      items.map((item) => item.getAttribute('data-smkit-md-toc-active')),
      [null, '', null, null],
      'only the section being read is lit',
    )
    assert.equal(items[1].getAttribute('aria-current'), 'true', 'the mark is announced, not just painted')
  } finally {
    view.dispose()
  }
})

it('centres the lit row in the popover, without moving the preview', () => {
  const headings = Array.from({ length: 12 }, (_, index) => heading(2, `第 ${index + 1} 节`))
  const view = mount({ headings })
  try {
    place(view.body, 100, 600)
    headings.forEach((element, index) => {
      // The eleventh heading is the last above the reading line.
      place(element, index <= 10 ? 130 - (10 - index) * 60 : 300 + (index - 10) * 60, 40)
    })
    view.toggle().dispatch('click')
    // Row 10 starts at 132 + 10 × 24 = 372; the panel is 200px tall, its rows 24.
    assert.equal(view.panel().scrollTop, 152, '240 − (200 − 24) / 2')
    assert.equal(view.items()[10].getAttribute('data-smkit-md-toc-active'), '')
    assert.ok(
      headings.every((element) => element.scrolled === undefined),
      'opening the list must not scroll the document behind it',
    )

    // Reopening re-centres, so the list never comes back at an old offset.
    view.panel().scrollTop = 999
    view.toggle().dispatch('click')
    view.toggle().dispatch('click')
    assert.equal(view.panel().scrollTop, 152)
    assert.equal(
      view.items()[10].getAttribute('data-smkit-md-toc-active'),
      '',
      'a rebuilt list is marked again, even at the same section',
    )
  } finally {
    view.dispose()
  }
})

it('keeps the mark on the reader while the popover is open, without re-centring', () => {
  const first = heading(1, '一')
  const second = heading(2, '1. 背景')
  const third = heading(2, '2. 介绍')
  const view = mount({ headings: [first, second, third] })
  try {
    place(view.body, 100, 600)
    place(first, 40, 40)
    place(second, 120, 40)
    place(third, 400, 40)
    view.toggle().dispatch('click')
    assert.equal(view.items()[1].getAttribute('data-smkit-md-toc-active'), '')
    const centred = view.panel().scrollTop

    // The reader scrolls on: the third heading becomes the section being read.
    place(third, 128, 40)
    view.body.dispatch('scroll')
    assert.equal(view.items()[2].getAttribute('data-smkit-md-toc-active'), '')
    assert.equal(view.items()[1].getAttribute('data-smkit-md-toc-active'), null)
    assert.equal(view.panel().scrollTop, centred, 'the reader keeps their place inside the panel')
  } finally {
    view.dispose()
  }
})

it('jumps to a heading, flashes it, and closes the popover', () => {
  const view = mount({
    headings: [heading(1, '一'), heading(2, '二'), heading(2, '三')],
  })
  try {
    view.toggle().dispatch('click')
    const target = view.doc.querySelectorAll('h1, h2, h3, h4, h5, h6')[1]
    assert.equal(target.textContent, '二', 'the second entry is the second heading')
    view.items()[1].dispatch('click')
    assert.deepEqual(
      { ...target.scrolled },
      { behavior: 'smooth', block: 'start' },
      'the heading is scrolled to the top of its own scroller',
    )
    assert.equal(target.classList.contains('smkit-outline-toc-flash'), true)
    assert.equal(view.panel(), null, 'the popover closes on the jump')
    assert.equal(view.toggle().getAttribute('aria-expanded'), 'false')
    view.flushFlash()
    assert.equal(target.classList.contains('smkit-outline-toc-flash'), false, 'the flash is 1.2 s long')
    assert.equal(view.timers.length, 0)
  } finally {
    view.dispose()
  }
})

it('closes on Escape and on a press outside the bar, but not inside it', () => {
  const view = mount({ headings: [heading(1, '一'), heading(2, '二'), heading(2, '三')] })
  try {
    view.toggle().dispatch('click')
    assert.ok(view.panel() !== null)
    view.toggle().dispatch('click')
    assert.equal(view.panel(), null, 'a second press on the toggle closes it')

    view.toggle().dispatch('click')
    view.pressOutside(view.toggle())
    assert.ok(view.panel() !== null, 'a press on the header toggle is not a dismiss')
    view.pressOutside(view.panel())
    assert.ok(view.panel() !== null, 'nor is a press inside the bar')

    view.pressOutside(view.doc)
    assert.equal(view.panel(), null, 'blank preview space dismisses the outline')

    view.toggle().dispatch('click')
    view.pressEscape()
    assert.equal(view.panel(), null)
  } finally {
    view.dispose()
  }
})

it('picks up a page the host appends later, without drawing a second bar', () => {
  const view = mount({ headings: [heading(1, '一')] })
  try {
    assert.equal(view.toggle(), null, 'one heading is still not an outline')
    view.appendHeading(2, '二')
    view.appendHeading(2, '三')
    assert.ok(view.toggle() !== null, 'the third heading brings the toggle in')
    view.toggle().dispatch('click')
    assert.equal(view.items().length, 3)
    assert.equal(view.body.querySelectorAll('[data-smkit-md-toc]').length, 1, 'one bar per body, ever')

    view.appendHeading(2, '四')
    assert.equal(view.items().length, 4, 'the open popover follows the new page')
    assert.equal(view.body.querySelectorAll('[data-smkit-md-toc]').length, 1)
  } finally {
    view.dispose()
  }
})

it('pins the bar at the document’s own padding, so the toggle never rises on scroll', () => {
  // The bar leads the document, so at rest the host's prose padding insets it;
  // pinning to the bare scrollport edge instead lifted the toggle by exactly
  // that padding the moment scrolling began (upstream mounts the bar on the
  // scroll container itself, where the resting and pinned positions coincide).
  const view = mount({ headings: [heading(1, '一'), heading(2, '二'), heading(2, '三')] })
  try {
    assert.equal(view.bar().style.top, '10px', 'the sticky offset is the document’s padding, not 0')
    assert.equal(view.doc.firstChild, view.bar(), 'the bar leads the document')
  } finally {
    view.dispose()
  }
})

it('re-reads the inset from the next document', () => {
  const view = mount({ headings: [heading(1, '一'), heading(2, '二'), heading(2, '三')] })
  try {
    view.toOtherPreview()
    view.backToMarkdown([heading(1, 'A'), heading(2, 'B'), heading(2, 'C')], '12px')
    assert.equal(view.bar().style.top, '12px', 'a swapped document brings its own prose padding')
  } finally {
    view.dispose()
  }
})

it('leaves the stylesheet’s top in place when the host answers no computed style', () => {
  const view = mount({
    headings: [heading(1, '一'), heading(2, '二'), heading(2, '三')],
    computedStyle: false,
  })
  try {
    assert.ok(view.bar() !== null, 'the bar still mounts')
    assert.equal(view.bar().style.top, undefined, 'no layout, no offset written')
  } finally {
    view.dispose()
  }
})

it('takes the bar away when the preview stops being Markdown, and puts it back', () => {
  const view = mount({ headings: [heading(1, '一'), heading(2, '二'), heading(2, '三')] })
  try {
    assert.ok(view.bar() !== null)
    view.toOtherPreview()
    assert.equal(view.bar(), null, 'a code preview has no outline')
    view.backToMarkdown([heading(1, 'A'), heading(2, 'B'), heading(2, 'C')])
    assert.ok(view.bar() !== null)
    assert.ok(view.toggle() !== null)
  } finally {
    view.dispose()
  }
})

it('stands down while dsh-better-sidebar owns the file preview', () => {
  // That plugin's own editor tab carries this exact outline, so a second one
  // would be the defect — and it is loaded that puts the preview in its hands.
  const view = mount({ headings: [heading(1, '一'), heading(2, '二'), heading(2, '三')], betterSidebar: true })
  try {
    assert.equal(view.bar(), null, 'no bar, not merely no toggle')
    assert.equal(view.toggle(), null)
    view.appendHeading(2, '四')
    assert.equal(view.bar(), null, 'and a preview change does not bring it back')
  } finally {
    view.dispose()
  }
})

it('stands down for any published service, its own tab switches included', () => {
  // Policy: loaded means yield. The neighbour's per-type switches are not
  // consulted, so a service reporting every type off still owns the surface.
  const view = mount({
    headings: [heading(1, '一'), heading(2, '二'), heading(2, '三')],
    betterSidebar: { isTabEnabled: () => false },
  })
  try {
    assert.equal(view.bar(), null, 'no bar, not merely no toggle')
    assert.equal(view.toggle(), null)
  } finally {
    view.dispose()
  }
})

it('comes back when the neighbour unloads', () => {
  const view = mount({ headings: [heading(1, '一'), heading(2, '二'), heading(2, '三')], betterSidebar: true })
  try {
    assert.equal(view.bar(), null)
    view.setBetterSidebar(undefined)
    view.appendHeading(2, '四')
    assert.ok(view.bar() !== null, 'the next preview change re-runs the scan')
    assert.ok(view.toggle() !== null)
  } finally {
    view.dispose()
  }
})

it('removes every bar when the effect is disposed', () => {
  const view = mount({ headings: [heading(1, '一'), heading(2, '二'), heading(2, '三')] })
  view.dispose()
  assert.equal(view.bar(), null)
  assert.equal(
    view.body.querySelectorAll('[data-smkit-md-toc]').length
      + view.body.querySelectorAll('[data-smkit-md-toc-panel]').length
      + view.body.querySelectorAll('[data-smkit-md-toc-toggle]').length,
    0,
    'and nothing else of ours is left in the body',
  )
})
