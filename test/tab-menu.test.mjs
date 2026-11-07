/**
 * The tab menu's one contributed row, driven through the real client bundle
 * against stand-ins for the shell's menu service and the right column.
 *
 * The feature contributes a `tab` menu action rather than markup, so what is
 * worth pinning is what the contribution promises:
 *
 * - it registers for the `tab` target and nothing else, and stands down when
 *   the host has no menu service at all;
 * - the one action is "close all to the left", with the icon key the plugin
 *   answers on the icon seat;
 * - the set is the closable tabs to the left: `all` minus `right`, with the
 *   clicked tab already excluded by the controller, and never a tab the shell
 *   holds open;
 * - nothing to the left means no action at all, not a disabled one;
 * - running it closes through the column's controller in display order, and
 *   falls back to the older `close(id)` when the session-aware one is missing;
 * - a controller without `menuTabs` is read off the strip's own anchors.
 *
 * The VM has no DOM, so the document below implements only the questions the
 * bundle asks: a small attribute/tag selector grammar, `:not([attr])`,
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

/** One DOM element, as much of it as the bundle touches. */
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

  /** A real press: the fallback reaches for a chip's ×, as a reader would. */
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
 * Mount the whole bundle once and hand back what the feature registered.
 *
 * @param options - `tabs` the strip carries as `[id, closable]` pairs (read
 *   only by the DOM fallback), `menu` = false for a host with no menu service,
 *   `controller` picks which controller methods the column publishes.
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

  const contributions = []
  const closed = []
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

  const controller = options.controller ?? 'closeIn'
  const menus = options.menu === false
    ? undefined
    : { register: (contribution) => { contributions.push(contribution); return () => {} } }
  const sidebar = controller === 'none'
    ? undefined
    : {
        ...(options.menuTabs === false
          ? {}
          : {
              menuTabs: () => options.pane ?? { all: [], right: [], close: true },
            }),
        ...(controller === 'closeIn' ? { closeIn: (_sessionId, id) => { closed.push(id) } } : {}),
        ...(controller === 'close' ? { close: (id) => { closed.push(id) } } : {}),
      }
  const services = { contextMenus: menus, sidebarRight: sidebar }
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

  // The fallback presses the chip's own ×; those presses are recorded the way
  // React's listener would answer them.
  for (const chip of chips) {
    const close = chip.querySelector('[data-dockkit-tab-close]')
    close?.addEventListener('click', () => { pressed.push(close.getAttribute('data-dockkit-tab-close')) })
  }

  const contribution = contributions.find((one) => one.target === 'tab')

  /** Resolve the contributed action for one tab. */
  function resolve(tabId) {
    assert.ok(contribution, 'the feature contributed a tab menu')
    return contribution.resolve({ sessionId: 'session-1', paneId: 'pane-1', tab: { id: tabId } }, new AbortController().signal)
  }

  return { resolve, contributions, closed, pressed, registrations, chips }
}

it('contributes one action to the tab menu, after the shell’s own rows', () => {
  const view = mount({ pane: { all: ['tab-1'], right: [], close: true } })
  // The bundle carries one other family of contributions — the explorer's
  // `file` / `directory` rows — so the tab family is what this asserts on.
  const tabs = view.contributions.filter((one) => one.target === 'tab')
  assert.equal(tabs.length, 1)
  assert.ok(tabs[0].order > 100, 'the column registers at 100')
  const [action] = view.resolve('tab-2')
  assert.equal(action.id, 'smkit.close-left')
  assert.equal(action.label, 'closeLeft')
  assert.equal(action.icon.key, 'smkit.close-left')
})

it('answers the icon key on the icon seat, with a component', () => {
  const view = mount()
  const icon = view.registrations.find((one) => one.entry.key === 'smkit.close-left')
  assert.ok(icon, 'the icon seat is filled')
  assert.equal(icon.entry.name, 'contextMenu.icon')
  assert.equal(typeof icon.component, 'function')
})

it('offers nothing when the left side has nothing to close', () => {
  const view = mount({ pane: { all: [], right: [], close: true } })
  // The answer is built inside the VM, so its array is a different realm's.
  assert.equal(view.resolve('tab-1').length, 0)
})

it('keeps only the tabs left of the clicked one, in display order', () => {
  // `all` is everything but the clicked tab; `right` is its right-hand subset.
  const view = mount({ pane: { all: ['tab-1', 'tab-2', 'tab-4', 'tab-5'], right: ['tab-4', 'tab-5'], close: true } })
  const [action] = view.resolve('tab-3')
  action.run()
  assert.deepEqual(view.closed, ['tab-1', 'tab-2'])
})

it('falls back to the older close(id) when the session-aware one is missing', () => {
  const view = mount({ controller: 'close', pane: { all: ['tab-1'], right: [], close: true } })
  view.resolve('tab-2')[0].run()
  assert.deepEqual(view.closed, ['tab-1'])
})

it('reads the strip’s own anchors when the controller cannot list tabs', () => {
  const view = mount({
    menuTabs: false,
    tabs: [['tab-1', true], ['guide', false], ['tab-3', true], ['tab-4', true]],
    controller: 'none',
  })
  view.resolve('tab-4')[0].run()
  assert.deepEqual(view.pressed, ['tab-1', 'tab-3'], 'the held guide keeps its place')
})

it('stands down on a host with no menu service', () => {
  const view = mount({ menu: false })
  assert.deepEqual(view.contributions, [])
  assert.equal(
    view.registrations.filter((one) => one.entry.name === 'contextMenu.icon').length,
    0,
    'no icon seat is filled either',
  )
})
