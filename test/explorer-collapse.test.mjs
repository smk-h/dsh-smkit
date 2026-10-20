/**
 * The explorer's "collapse all" control, driven through the real client bundle
 * against stand-ins for both file trees it has to serve.
 *
 * Two surfaces, one act, so what is worth pinning is that each surface gets the
 * button in the seat it actually has, and that the press closes the tree the
 * button belongs to:
 *
 * - the shell's tree publishes `sidebar.right.tab.files.actions` in its header,
 *   so the feature fills that seat, and the press closes the tree whose root the
 *   seat reports — not whichever tree the document lists first;
 * - `dsh-better-sidebar` owns the `files` page instead, and its file window has
 *   no fold-everything control: one is inserted immediately after its search
 *   box, named in the active locale, and it closes that window's tree only;
 * - both walks go deepest first, because a directory's rows leave the document
 *   the moment it closes — a top-down walk would leave the inner ones open;
 * - nothing is inserted while the neighbour's service is absent.
 *
 * The VM has no DOM, so the document below implements only the questions the
 * two trees are asked: a small attribute/tag selector grammar (descendants,
 * `:scope > child`, `[class*=…]`), `closest`, `insertBefore`, an inline `style`
 * the neighbour indents with, and a `click()` that reaches per-element listeners
 * the way React's root listener would.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

const ATTRIBUTE = /\[([a-z-]+)(?:([*^$]?=)"([^"]*)")?\]/g

/** One compound of a selector: an optional tag, then its attribute filters. */
function parseCompound(text) {
  const tag = /^([a-zA-Z][\w-]*)/.exec(text)?.[1]?.toLowerCase()
  const attributes = [...text.matchAll(ATTRIBUTE)].map((match) => ({
    name: match[1],
    op: match[2],
    value: match[3],
  }))
  return { tag, attributes }
}

/** One selector list, as `:scope > child` or a descendant chain per part. */
function parseSelector(selector) {
  return String(selector).split(',').map((part) => {
    const text = part.trim()
    const scoped = text.startsWith(':scope > ')
    const body = scoped ? text.slice(':scope > '.length) : text
    const compounds = body.split(/\s+/).filter(Boolean).map(parseCompound)
    assert.ok(compounds.length > 0, `empty selector "${selector}"`)
    return { scoped, compounds }
  })
}

/** Whether one element matches one compound (`tag[attr][attr="value"]`). */
function matchesCompound(element, compound) {
  if (compound.tag !== undefined && element.tagName.toLowerCase() !== compound.tag) return false
  for (const attribute of compound.attributes) {
    if (!element.hasAttribute(attribute.name)) return false
    if (attribute.op === '=' && element.getAttribute(attribute.name) !== attribute.value) return false
    if (attribute.op === '*=' && !element.getAttribute(attribute.name).includes(attribute.value)) return false
  }
  return true
}

/** Whether one element matches the tail of a descendant chain, on up. */
function matchesChain(element, compounds, index = compounds.length - 1) {
  if (!matchesCompound(element, compounds[index])) return false
  if (index === 0) return true
  for (let node = element.parentNode; node instanceof SandboxElement; node = node.parentNode) {
    if (matchesChain(node, compounds, index - 1)) return true
  }
  return false
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
    // The neighbour's rows indent with an inline padding; the walk reads it.
    this.style = {}
    Object.defineProperty(this, 'className', {
      get: () => this.getAttribute('class') ?? '',
      set: (value) => this.setAttribute('class', value),
    })
    // A real element reflects `title` onto its attribute; the injected button
    // is named through the property and asserted through the attribute.
    Object.defineProperty(this, 'title', {
      get: () => this.getAttribute('title') ?? '',
      set: (value) => this.setAttribute('title', String(value)),
    })
    this.dataset = new Proxy({}, {
      set: (target, key, value) => {
        target[key] = value
        this.setAttribute(`data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, String(value))
        return true
      },
      get: (target, key) => target[key],
    })
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof SandboxElement)
  }

  get parentElement() {
    return this.parentNode instanceof SandboxElement ? this.parentNode : null
  }

  get nextElementSibling() {
    if (this.parentNode === null) return null
    const siblings = this.parentNode.children
    return siblings[siblings.indexOf(this) + 1] ?? null
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
    const at = reference === null || reference === undefined ? -1 : this.childNodes.indexOf(reference)
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

  addEventListener(type, handler) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((one) => one !== handler))
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }

  /** A real press: React's own listener is what answers in the browser. */
  click() {
    this.dispatch('click', { target: this, currentTarget: this })
  }

  matches(selector) {
    let parsed
    try {
      parsed = parseSelector(selector)
    } catch {
      return false
    }
    return parsed.some((one) => !one.scoped && matchesChain(this, one.compounds))
  }

  closest(selector) {
    let parsed
    try {
      parsed = parseSelector(selector)
    } catch {
      return null
    }
    for (let node = this; node instanceof SandboxElement; node = node.parentNode) {
      if (parsed.some((one) => !one.scoped && matchesChain(node, one.compounds))) return node
    }
    return null
  }

  querySelectorAll(selector) {
    let parsed
    try {
      parsed = parseSelector(selector)
    } catch {
      return []
    }
    const found = []
    const visit = (node) => {
      for (const child of node.children) {
        const hit = parsed.some((one) => one.scoped
          ? child.parentNode === node && one.compounds.length === 1 && matchesCompound(child, one.compounds[0])
          : matchesChain(child, one.compounds))
        if (hit) found.push(child)
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

/** One row of the shell's tree: `<li data-files-entry=…><button aria-expanded>…`. */
function shellRow(kind, expanded) {
  const item = new SandboxElement('li')
  item.setAttribute('data-files-entry', kind)
  const button = new SandboxElement('button')
  if (expanded !== undefined) button.setAttribute('aria-expanded', String(expanded))
  item.appendChild(button)
  item.button = button
  return item
}

/** A level of the shell's tree: `<ul>` holding `items`. */
function shellLevel(items) {
  const list = new SandboxElement('ul')
  for (const item of items) list.appendChild(item)
  return list
}

/**
 * One shell tree: `root > directory(open) > [directory(open) > file, file]`.
 * The outer directory's control is pressed last (it is one level up).
 */
function shellTree(rootPath, pressLog) {
  const tree = new SandboxElement('div')
  tree.setAttribute('data-files-state', 'tree')
  tree.setAttribute('data-files-root', rootPath)
  const body = new SandboxElement('div')
  body.setAttribute('data-files-body', '')
  const inner = shellRow('directory', true)
  inner.appendChild(shellLevel([shellRow('file')]))
  const outer = shellRow('directory', true)
  outer.appendChild(shellLevel([inner, shellRow('file')]))
  body.appendChild(shellLevel([outer, shellRow('directory', false)]))
  tree.appendChild(body)
  for (const row of tree.querySelectorAll('li[data-files-entry="directory"] button')) {
    row.addEventListener('click', () => { pressLog.push(row.parentNode.getAttribute('data-files-entry')) })
  }
  return { tree, inner, outer }
}

/** One neighbour row: a `role="button"` div indented to its level. */
function neighbourRow(depth, label, pressLog) {
  const row = new SandboxElement('div')
  row.setAttribute('role', 'button')
  row.setAttribute('title', label)
  row.style.paddingLeft = `${depth * 22 + 6}px`
  row.addEventListener('click', () => { pressLog.push(label) })
  return row
}

/**
 * The neighbour's file window: search box + its controls on a toolbar row, then
 * the tree rows (two open directories, one nested inside the other).
 */
function neighbourPanel(pressLog) {
  const panel = new SandboxElement('div')
  const row = new SandboxElement('div')
  const input = new SandboxElement('input')
  input.setAttribute('class', 'nArs4W_editorSearchInput')
  input.setAttribute('placeholder', '搜索文件')
  row.appendChild(input)
  const refresh = new SandboxElement('button')
  refresh.setAttribute('aria-label', 'refresh')
  row.appendChild(refresh)
  panel.appendChild(row)
  const outer = neighbourRow(0, 'outer', pressLog)
  const inner = neighbourRow(1, 'inner', pressLog)
  panel.appendChild(outer)
  panel.appendChild(inner)
  panel.appendChild(neighbourRow(2, 'file', pressLog))
  panel.appendChild(neighbourRow(1, 'sibling', pressLog))
  return { panel, row, input }
}

/**
 * Mount the whole bundle once.
 *
 * @param options - `trees` names the shell trees to build (their roots),
 *   `neighbour` = false to leave the neighbour's service unpublished.
 */
function mount(options = {}) {
  const html = new SandboxElement('html')
  html.root = true
  const shellBody = new SandboxElement('body')
  html.appendChild(shellBody)
  const column = new SandboxElement('div')
  column.setAttribute('data-sidebar-right-session', 'session-1')
  shellBody.appendChild(column)

  const shellPresses = []
  const trees = (options.trees ?? []).map((rootPath) => shellTree(rootPath, shellPresses))
  for (const built of trees) column.appendChild(built.tree)

  const neighbourPresses = []
  let neighbour = null
  if (options.neighbour === true) {
    neighbour = neighbourPanel(neighbourPresses)
    column.appendChild(neighbour.panel)
  }

  const registrations = []
  const dom = {
    documentElement: html,
    body: shellBody,
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
    console: { warn: () => {}, error: () => {}, log: () => {} },
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

  const services = options.neighbour === true ? { betterSidebar: { version: '0.28.0' } } : {}
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

  /** The component built for the header seat, rendered with the seat's props. */
  const seat = () => {
    const found = registrations.find((one) => one.entry.name === 'sidebar.right.tab.files.actions')
    assert.ok(found, 'the feature fills the file tree header seat')
    return found
  }

  /** Walk a rendered tree and return the first node whose class matches. */
  const buttonIn = (node) => {
    if (node === null || typeof node !== 'object') return null
    const className = node.props?.className
    if (typeof className === 'string' && className.split(/\s+/).includes('smkit-collapse-button')) return node
    for (const child of node.children ?? []) {
      const found = buttonIn(child)
      if (found !== null) return found
    }
    return null
  }

  return {
    shellPresses,
    neighbourPresses,
    trees,
    neighbour,
    seat,
    /** Render the header control and press it. */
    pressHeaderControl: (absolutePath) => {
      const entry = seat()
      const tree = entry.component({ absolutePath, t: (key) => key })
      const button = buttonIn(tree)
      assert.ok(button, 'the seat renders one collapse-all control')
      assert.equal(button.props['aria-label'], 'collapseAll')
      button.props.onClick()
    },
  }
}

it('fills the shell file tree header seat', () => {
  const view = mount()
  const entry = view.seat()
  assert.equal(entry.entry.id, 'smkit-collapse-all')
  assert.equal(entry.entry.locale, 'explorer-collapse')
})

it('collapses the tree the seat names, deepest first', () => {
  const view = mount({ trees: ['/work/a', '/work/b'] })
  view.pressHeaderControl('/work/b')
  // Two open directories in the reported tree, the inner one first; nothing is
  // pressed in the other tree.
  assert.deepEqual(view.shellPresses, ['directory', 'directory'])
  const [first, second] = view.trees
  assert.equal(first.outer.button.listeners.get('click').length, 1, 'the other tree was left alone')
  assert.equal(second.outer.button.listeners.get('click').length, 1)
})

it('hangs one control on the neighbour toolbar, right after its search box', () => {
  const view = mount({ neighbour: true })
  const { row, input } = view.neighbour
  const buttons = row.querySelectorAll('[data-smkit-collapse-all]')
  assert.equal(buttons.length, 1, 'one control per file window')
  const button = buttons[0]
  assert.equal(button.className, 'smkit-collapse-button smkit-collapse-button-neighbour')
  assert.equal(button.getAttribute('aria-label'), 'collapseAll')
  assert.equal(button.getAttribute('title'), 'collapseAll')
  // Immediately after the search box, ahead of the neighbour's own controls.
  const order = row.children
  assert.equal(order.indexOf(button), order.indexOf(input) + 1)
  assert.equal(order.length, 3, 'nothing else was added to the row')
})

it('collapses the neighbour tree it sits above, deepest first', () => {
  const view = mount({ neighbour: true })
  view.neighbour.row.querySelector('[data-smkit-collapse-all]').click()
  // The nested directory closes before its parent; the file row and the closed
  // directory at the same level are never pressed.
  assert.deepEqual(view.neighbourPresses, ['inner', 'outer'])
})

it('adds nothing while the neighbour is absent', () => {
  const view = mount({ neighbour: false })
  assert.equal(view.neighbour, null)
  assert.deepEqual(view.neighbourPresses, [])
})
