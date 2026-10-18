/**
 * The file tree's copy-path menu, driven through the real client bundle.
 *
 * What is worth pinning is exactly what the port promises:
 *
 * - a right-click on a row claims the gesture (no browser menu) and opens the
 *   SHELL's menu — the host component, compact and portalled — at the cursor,
 *   with the source's two rows in the source's order;
 * - "relative" copies the row's path projected against the tree's root, and
 *   "absolute" copies the row's path verbatim;
 * - the menu closes on selection, on the host's `onClose` (outside press /
 *   Escape, which the component itself handles);
 * - a successful write flips the row to "已复制" for 1.2 s; a refused write
 *   shows nothing at all;
 * - a row without a path, and every row while `dsh-better-sidebar` owns the
 *   file page, keep the browser's own right-click behaviour;
 * - disposing the effect unmounts the menu root and leaves the body clean.
 *
 * The menu component is a stub here (the real one is the host's), so the test
 * drives `onSelect`/`onClose` the way its rows would.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

/** Every selector this stand-in answers: `:scope >` , a tag, `[attr]`, `[attr="v"]`. */
function parseSelector(selector) {
  return String(selector).split(',').map((raw) => {
    let text = raw.trim()
    let direct = false
    if (text.startsWith(':scope >')) {
      direct = true
      text = text.slice(':scope >'.length).trim()
    }
    const match = /^([a-zA-Z0-9]*)((?:\[[a-z-]+(?:="[^"]*")?\]|:not\(\[[a-z-]+\]\))*)$/.exec(text)
    assert.ok(match, `the test DOM does not understand the selector "${selector}"`)
    const tokens = [...match[2].matchAll(/\[([a-z-]+)(?:="([^"]*)")?\]|:not\(\[([a-z-]+)\]\)/g)]
    return {
      direct,
      tag: match[1] === '' ? undefined : match[1].toLowerCase(),
      present: tokens.filter((token) => token[3] === undefined).map((token) => ({ name: token[1], value: token[2] })),
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

/** One DOM element, as much of it as the features on this surface touch. */
class SandboxElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase()
    this.attributes = new Map()
    this.childNodes = []
    this.parentNode = null
    this.textContent = ''
    this.type = ''
    this.offsetWidth = 0
    this.offsetHeight = 0
    /** Layout is not simulated; `display` is enough for the menu host. */
    this.style = { setProperty() {}, getPropertyValue: () => '' }
    Object.defineProperty(this, 'className', {
      get: () => this.getAttribute('class') ?? '',
      set: (value) => this.setAttribute('class', value),
    })
    Object.defineProperty(this, 'title', {
      get: () => this.getAttribute('title') ?? '',
      set: (value) => this.setAttribute('title', value),
    })
    this.dataset = new Proxy({}, {
      set: (_target, key, value) => {
        this.setAttribute(`data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, String(value))
        return true
      },
      get: () => undefined,
    })
    this.classList = {
      add: () => {},
      remove: () => {},
      contains: () => false,
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

  matches(selector) {
    return parseSelector(selector).some((parsed) => !parsed.direct && matchesParsed(this, parsed))
  }

  closest(selector) {
    const parsed = parseSelector(selector).filter((one) => !one.direct)
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
    const visit = (node, isRoot) => {
      for (const child of node.children) {
        // `:scope >` is relative to the element the query started from.
        if (parsed.some((one) => (!one.direct || isRoot) && matchesParsed(child, one))) found.push(child)
        visit(child, false)
      }
    }
    visit(this, true)
    return found
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }
}

/** One tree row: `<li data-files-entry=… data-files-path=…><button>name</button></li>`. */
function row(kind, path) {
  const item = new SandboxElement('li')
  item.setAttribute('data-files-entry', kind)
  if (path !== undefined) item.setAttribute('data-files-path', path)
  const button = new SandboxElement('button')
  const name = new SandboxElement('span')
  name.textContent = path === undefined ? '?' : path.split('/').pop()
  button.appendChild(name)
  item.appendChild(button)
  return item
}

/** Mount the bundle against one tree and hand back what the assertions need. */
function mount(options = {}) {
  const html = new SandboxElement('html')
  html.root = true
  const shell = new SandboxElement('body')
  html.appendChild(shell)

  const tree = new SandboxElement('div')
  tree.setAttribute('data-files-state', 'tree')
  tree.setAttribute('data-files-root', options.root ?? '/ws')
  const level = new SandboxElement('ul')
  tree.appendChild(level)
  shell.appendChild(tree)
  const noPath = row('file', undefined)
  const file = row('file', '/ws/src/a.ts')
  const dir = row('directory', '/ws/src')
  for (const item of [noPath, file, dir]) level.appendChild(item)

  const timers = []
  const documentListeners = new Map()
  const observers = []
  const roots = []
  let nextTimer = 1

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

  /** The clipboard the host would write to, and what it answers. */
  const clipboard = { texts: [], accept: true }
  /** The menu component's last props, as the stub root saw them. */
  let rendered = null
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (callback) => callback,
  }
  const Menu = (props) => { rendered = props; return null }

  let exported
  runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          exported = factory((id) => {
            if (id === 'react') return react
            if (id === 'react-dom') return { createPortal: () => null }
            if (id === 'react-dom/client') {
              return {
                createRoot: () => {
                  const root = {
                    render: (node) => { if (node !== null && node !== undefined) rendered = node.props },
                    unmount: () => { root.unmounted = true },
                    unmounted: false,
                  }
                  roots.push(root)
                  return root
                },
              }
            }
            if (id === '@deepseek-ai/dsh-client-ui-primitives') {
              return {
                Menu,
                writeClipboard: async (text) => {
                  clipboard.texts.push(text)
                  return clipboard.accept
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

  /** The neighbour service the feature probes; `true` = published, types on. */
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

  /** Deliver one contextmenu, the way the browser dispatches it (capture). */
  const contextMenu = (target, x = 120, y = 240) => {
    const event = {
      target,
      clientX: x,
      clientY: y,
      prevented: false,
      stopped: false,
      preventDefault() { this.prevented = true },
      stopPropagation() { this.stopped = true },
    }
    for (const handler of documentListeners.get('contextmenu') ?? []) handler(event)
    return event
  }

  return {
    tree,
    noPath,
    file,
    dir,
    roots,
    clipboard,
    contextMenu,
    /** The menu's props as of the last render (null before the first open). */
    menu: () => rendered,
    select: (id) => { rendered?.onSelect?.(id) },
    close: () => { rendered?.onClose?.() },
    /** Run the pending "copied" timers. */
    flush() {
      for (const timer of [...timers]) {
        if (timer.ms !== 1200) continue
        timers.splice(timers.indexOf(timer), 1)
        timer.callback()
      }
    },
    setBetterSidebar(value) { services.betterSidebar = value },
    dispose() { for (const dispose of effects.reverse()) dispose() },
  }
}

/** Let the clipboard promise's `.then` run. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

it('opens the shell’s menu at the cursor, with the source’s two rows', () => {
  const view = mount()
  try {
    const event = view.contextMenu(view.file.children[0], 120, 240)
    assert.equal(event.prevented, true, 'the browser menu is suppressed')
    assert.equal(event.stopped, true, 'the gesture is claimed before React sees it')
    const menu = view.menu()
    assert.equal(menu.open, true)
    assert.equal(menu.portal, true, 'portalled, so the tree’s overflow clip cannot crop it')
    assert.equal(menu.compact, true, 'the source’s compact typography')
    assert.equal(menu.align, 'start')
    // Joined, not deep-compared: the rows are built inside the VM, so their
    // array carries that realm's prototype.
    assert.equal(menu.items.map((item) => item.id).join(','), 'relative,absolute')
    assert.equal(menu.items.map((item) => item.label).join(','), 'copyRelative,copyAbsolute')
    const rect = menu.getAnchorRect()
    assert.equal(rect.x, 120, 'anchored at the right-click point')
    assert.equal(rect.y, 240)
  } finally {
    view.dispose()
  }
})

it('copies the row’s path relative to the tree root', async () => {
  const view = mount({ root: '/ws' })
  try {
    view.contextMenu(view.file.children[0])
    view.select('relative')
    assert.equal(view.menu().open, false, 'the menu closes on selection')
    await settle()
    assert.deepEqual(view.clipboard.texts, ['src/a.ts'])
    assert.equal(view.file.getAttribute('data-smkit-path-copied'), '', 'the row owns the label')
    const label = view.file.querySelector('[data-smkit-path-copy-label]')
    assert.equal(label.textContent, 'copied')
    assert.equal(label.getAttribute('class'), 'smkit-path-copy-label')
    view.flush()
    assert.equal(view.file.querySelector('[data-smkit-path-copy-label]'), null, 'the label is transient')
    assert.equal(view.file.getAttribute('data-smkit-path-copied'), null)
  } finally {
    view.dispose()
  }
})

it('copies the row’s path verbatim for the absolute row', async () => {
  const view = mount({ root: '/ws' })
  try {
    view.contextMenu(view.dir.children[0])
    view.select('absolute')
    await settle()
    assert.deepEqual(view.clipboard.texts, ['/ws/src'])
  } finally {
    view.dispose()
  }
})

it('shows no label when the clipboard refuses the write', async () => {
  const view = mount()
  try {
    view.clipboard.accept = false
    view.contextMenu(view.file.children[0])
    view.select('absolute')
    await settle()
    assert.deepEqual(view.clipboard.texts, ['/ws/src/a.ts'], 'the write was attempted')
    assert.equal(view.file.querySelector('[data-smkit-path-copy-label]'), null)
    assert.equal(view.file.getAttribute('data-smkit-path-copied'), null)
  } finally {
    view.dispose()
  }
})

it('lets the host component close the menu (outside press, Escape)', () => {
  const view = mount()
  try {
    view.contextMenu(view.file.children[0])
    assert.equal(view.menu().open, true)
    view.close()
    assert.equal(view.menu().open, false)
  } finally {
    view.dispose()
  }
})

it('keeps the browser’s right-click while dsh-better-sidebar owns the tree', () => {
  const view = mount({ betterSidebar: true })
  try {
    const event = view.contextMenu(view.file.children[0])
    assert.equal(event.prevented, false, 'its own menu already offers both rows')
    assert.equal(view.menu(), null, 'and no menu of ours was ever drawn')
    view.setBetterSidebar(undefined)
    const after = view.contextMenu(view.file.children[0])
    assert.equal(after.prevented, true, 'the shell’s tree is ours again once the service is gone')
    assert.equal(view.menu().open, true)
  } finally {
    view.dispose()
  }
})

it('ignores a row the tree published no path for', () => {
  const view = mount()
  try {
    const event = view.contextMenu(view.noPath.children[0])
    assert.equal(event.prevented, false)
    assert.equal(view.menu(), null)
  } finally {
    view.dispose()
  }
})

it('unmounts its root and leaves the body clean when disposed', () => {
  const view = mount()
  view.contextMenu(view.file.children[0])
  view.dispose()
  assert.equal(view.roots.length, 1)
  assert.equal(view.roots[0].unmounted, true)
  const host = view.tree.parentNode
  assert.equal(
    host.children.filter((child) => child.hasAttribute('data-smkit-path-menu-root')).length,
    0,
    'the menu host div is gone',
  )
  const event = view.contextMenu(view.file.children[0])
  assert.equal(event.prevented, false, 'the listener is gone too')
})
