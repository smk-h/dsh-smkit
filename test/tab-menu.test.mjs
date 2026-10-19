/**
 * The right sidebar's tab menu, driven through the real client bundle against a
 * stand-in for the shell's dockkit strip.
 *
 * The feature fills a slot (`sidebar.right.tab.menu.item`) rather than drawing
 * a menu, so what is worth pinning is what the filled seat promises:
 *
 * - the rows that apply are the ones that would close something: "others",
 *   "left", "right" and "all", in that order, each omitted when it is empty;
 * - a tab the shell does not let go (no × on its chip) is never in a set;
 * - "close all" does not repeat the kit's own "close" (a lone closable tab) or
 *   "close others" (the open tab is not closable);
 * - a hairline leads the rows only when the kit's "close" row is above them;
 * - a row dismisses the menu before it closes anything, and closes through the
 *   column's controller, keeping strip order;
 * - without that controller the chip's own × is what gets pressed;
 * - a tab whose chip has left the strip renders nothing, leaving the kit's own
 *   menu as it was.
 *
 * The VM has no DOM, so the document below implements only the questions the
 * feature asks: a small attribute/tag selector grammar, `:not([attr])`,
 * `closest`, and a `click()` that reaches per-element listeners.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

/** Every selector the bundle writes, as far as this stand-in answers them. */
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

/** One DOM element, as much of it as the feature and the bundle touch. */
class SandboxElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.attributes = new Map()
    this.childNodes = []
    this.parentNode = null
    this.textContent = ''
    this.type = ''
    this.listeners = new Map()
    this.style = {}
    Object.defineProperty(this, 'className', {
      get: () => this.getAttribute('class') ?? '',
      set: (value) => this.setAttribute('class', value),
    })
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

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }

  /**
   * A real press: the feature reaches for a chip's × in the no-controller
   * fallback, and React's own listener is what answers in the browser.
   */
  click() {
    this.dispatch('click', { target: this, currentTarget: this })
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
}

/** The tab strip of the right column, from a list of `[id, closable]` pairs. */
function strip(tabs) {
  const stripEl = new SandboxElement('div')
  stripEl.setAttribute('data-dockkit-strip-tabs', 'top')
  const chips = []
  for (const [id, closable] of tabs) {
    const chip = new SandboxElement('div')
    chip.setAttribute('data-dockkit-tab', id)
    if (closable) {
      const close = new SandboxElement('button')
      close.setAttribute('data-dockkit-tab-close', id)
      chip.appendChild(close)
    }
    stripEl.appendChild(chip)
    chips.push(chip)
  }
  return { stripEl, chips }
}

/**
 * Mount the whole bundle once and hand back the tab-menu component it
 * registered for the seat.
 *
 * @param options - `tabs` the strip carries as `[id, closable]` pairs, and
 *   `sidebarRight` = false for a column whose controller predates `close()`.
 */
function mount(options = {}) {
  const html = new SandboxElement('html')
  html.root = true
  const shell = new SandboxElement('body')
  html.appendChild(shell)
  const panel = new SandboxElement('div')
  panel.setAttribute('data-sidebar-right-session', 'session-1')
  shell.appendChild(panel)
  const { stripEl, chips } = strip(options.tabs ?? [])
  panel.appendChild(stripEl)

  const closers = []
  const dismissed = []
  const pressed = []
  const registrations = []

  const dom = {
    documentElement: html,
    body: shell,
    head: { appendChild() {} },
    createElement: (tag) => new SandboxElement(tag),
    createElementNS: (_namespace, tag) => new SandboxElement(tag),
    querySelector: (selector) => html.querySelector(selector),
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

  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (callback) => callback,
    useRef: (initial) => ({ current: initial }),
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
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: { warn: () => {} },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback) => { callback(); return 0 },
    cancelAnimationFrame: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  })

  const services = options.sidebarRight === false
    ? {}
    : {
        sidebarRight: {
          close: (id) => { closers.push(id) },
        },
      }
  const ctx = {
    effect: (fn) => { fn() },
    provide: () => {},
    reflect: { get: (name) => services[name] },
    on: () => () => {},
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      register: (entry, component) => {
        registrations.push({ entry, component })
        return () => {}
      },
      inject: (_name, callback) => callback(),
    },
  }
  exported.apply(ctx)

  const seat = registrations.find((one) => one.entry.name === 'sidebar.right.tab.menu.item')
  assert.ok(seat, 'the feature registered a row list for the tab menu seat')

  // The fallback path presses the chip's own ×; those presses are recorded the
  // way React's listener would answer them.
  for (const chip of chips) {
    const close = chip.querySelector('[data-dockkit-tab-close]')
    close?.addEventListener('click', () => { pressed.push(close.getAttribute('data-dockkit-tab-close')) })
  }

  /** Render the slot component for one tab and flatten the rows it returned. */
  function open(tabId) {
    const events = []
    const render = (node) => {
      if (node === null || node === undefined) return
      if (Array.isArray(node)) { node.forEach(render); return }
      if (typeof node !== 'object') return
      if (node.type === 'button') {
        events.push({
          label: node.children.filter((child) => typeof child === 'string').join(''),
          select: () => node.props.onClick(),
        })
        return
      }
      for (const child of node.children ?? []) render(child)
    }
    const tree = seat.component({
      tab: { id: tabId },
      dismiss: () => { dismissed.push(tabId) },
      t: (key) => key,
    })
    const separator = Array.isArray(tree) && tree.some((node) => node?.props?.role === 'separator')
    render(tree)
    return { events, separator, tree }
  }

  return { open, closers, dismissed, pressed, chips, stripEl }
}

it('offers every batch row that would close something, in a fixed order', () => {
  const view = mount({ tabs: [['tab-1', true], ['tab-2', true], ['tab-3', true], ['tab-4', true]] })
  const { events, separator } = view.open('tab-2')
  assert.deepEqual(events.map((row) => row.label), ['closeOthers', 'closeLeft', 'closeRight', 'closeAll'])
  assert.equal(separator, true, 'the kit’s own close row sits above these')
})

it('omits the rows the strip gives them nothing to close', () => {
  const view = mount({ tabs: [['tab-1', true], ['tab-2', false], ['tab-3', false]] })
  // The open tab can go, but nothing else can: the kit's own close row already
  // says the only thing there is to say.
  assert.equal(view.open('tab-1').tree, null)
  // The open tab cannot go, and only what is left of it can.
  const last = view.open('tab-3')
  assert.deepEqual(last.events.map((row) => row.label), ['closeOthers', 'closeLeft'])
})

it('never offers a tab the shell holds open', () => {
  // The guide has no ×, so no row may name it, and "close all" would merely
  // repeat "close others" when the open tab cannot go.
  const view = mount({ tabs: [['tab-1', true], ['guide', false], ['tab-3', true]] })
  const { events, separator } = view.open('guide')
  assert.deepEqual(events.map((row) => row.label), ['closeOthers', 'closeLeft', 'closeRight'])
  assert.equal(separator, false, 'no close row above, so no hairline leading the menu')

  events[0].select()
  assert.deepEqual(view.closers, ['tab-1', 'tab-3'], 'only the closable siblings')
})

it('leaves the kit menu alone for a lone tab', () => {
  const view = mount({ tabs: [['tab-1', true]] })
  assert.equal(view.open('tab-1').tree, null)
  assert.deepEqual(view.open('tab-1').events, [])
})

it('dismisses first, then closes each set in strip order', () => {
  const view = mount({
    tabs: [['tab-1', true], ['tab-2', true], ['tab-3', true], ['tab-4', true]],
  })
  const orders = []

  const rows = view.open('tab-2').events
  for (const row of rows) {
    const before = view.closers.length
    row.select()
    orders.push(view.closers.slice(before))
  }
  assert.deepEqual(orders, [
    ['tab-1', 'tab-3', 'tab-4'],
    ['tab-1'],
    ['tab-3', 'tab-4'],
    ['tab-1', 'tab-2', 'tab-3', 'tab-4'],
  ])
  assert.deepEqual(view.dismissed, ['tab-2', 'tab-2', 'tab-2', 'tab-2'], 'each row closed the menu first')
})

it('falls back to the chip’s own × when the column has no controller', () => {
  const view = mount({
    tabs: [['tab-1', true], ['tab-2', true], ['tab-3', true]],
    sidebarRight: false,
  })
  const right = view.open('tab-2').events.find((row) => row.label === 'closeRight')
  right.select()
  assert.deepEqual(view.pressed, ['tab-3'])
})

it('renders nothing for a tab whose chip has left the strip', () => {
  const view = mount({ tabs: [['tab-1', true], ['tab-2', true]] })
  assert.equal(view.open('ghost').tree, null)
})
