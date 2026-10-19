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
 * - a directory row LEADS with "new folder" and "new file"; a file row never
 *   offers them, because it has nowhere to create in;
 * - selecting either opens the inline editor pinned under that row, and Enter
 *   sends `{ path, name }` to `/smkit/api/explorer/create-…` and closes it;
 * - a refused name keeps the editor open with the reason beside the input; a
 *   name that breaks the shape rule is refused here, without a round trip;
 * - Escape and an empty name dismiss it without creating;
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
    this.value = ''
    this.listeners = new Map()
    this.focused = false
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

  /** The shell's directory row toggles on a real click. */
  click() {
    this.dispatch('click')
  }

  focus() {
    this.focused = true
  }

  /** Layout is not simulated: one row-sized rectangle is enough to pin to. */
  getBoundingClientRect() {
    const known = { x: 0, y: 0, left: 0, top: 0, right: 160, bottom: 20, width: 160, height: 20 }
    return { ...known, toJSON: () => known }
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
  /** The confirm dialog's last props, when one is open. */
  let dialog = null
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (callback) => callback,
  }
  const Menu = (props) => { rendered = props; return null }

  /**
   * The creating routes' stand-in: every request the bundle makes, and the
   * answer the next one receives. The client's `api` is a thin `fetch`, so this
   * is the whole channel.
   */
  const requests = []
  let reply = { ok: true, status: 200, body: {} }
  const fetchStub = async (url, init) => {
    requests.push({ url: String(url), method: init?.method, body: init?.body })
    return { ok: reply.ok, status: reply.status, json: async () => reply.body }
  }

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
                    /** What this root last rendered, so its unmount can retract it. */
                    current: null,
                    render: (node) => {
                      if (node === null || node === undefined) return
                      root.current = node.props ?? {}
                      if (Array.isArray(root.current.items)) rendered = root.current
                      else if (typeof root.current.title === 'string') dialog = root.current
                    },
                    unmount: () => {
                      if (root.current !== null && dialog === root.current) dialog = null
                      root.current = null
                      root.unmounted = true
                    },
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
    fetch: fetchStub,
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

  /** The neighbour service the feature probes; `true` = published. */
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
    body: shell,
    noPath,
    file,
    dir,
    roots,
    clipboard,
    requests,
    /** The confirm dialog's props, or null when none is open. */
    dialog: () => dialog,
    /** What the next creating request answers. */
    reply(next) { reply = next },
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

it('opens the shell’s menu at the cursor, with the source’s rows', () => {
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
    assert.equal(menu.items.map((item) => item.id).join(','), 'relative,absolute,mutate-sep,rename,delete')
    assert.equal(
      menu.items.map((item) => (item.type === 'separator' ? '—' : item.label)).join(','),
      'copyRelative,copyAbsolute,—,rename,delete',
    )
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
    assert.equal(view.file.getAttribute('data-smkit-explorer-copied'), '', 'the row owns the label')
    const label = view.file.querySelector('[data-smkit-explorer-label]')
    assert.equal(label.textContent, 'copied')
    assert.equal(label.getAttribute('class'), 'smkit-explorer-label')
    view.flush()
    assert.equal(view.file.querySelector('[data-smkit-explorer-label]'), null, 'the label is transient')
    assert.equal(view.file.getAttribute('data-smkit-explorer-copied'), null)
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
    assert.equal(view.file.querySelector('[data-smkit-explorer-label]'), null)
    assert.equal(view.file.getAttribute('data-smkit-explorer-copied'), null)
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

it('keeps the row lit while its menu is open, one row at a time', () => {
  const view = mount()
  try {
    view.contextMenu(view.file.children[0])
    assert.equal(
      view.file.getAttribute('data-smkit-explorer-target'),
      '',
      'the portalled card leaves the row, so the row has to be lit by its own marker',
    )
    assert.equal(view.dir.getAttribute('data-smkit-explorer-target'), null)

    view.contextMenu(view.dir.children[0])
    assert.equal(view.dir.getAttribute('data-smkit-explorer-target'), '', 'a second menu moves the light')
    assert.equal(view.file.getAttribute('data-smkit-explorer-target'), null, 'and releases the first row')

    view.close()
    assert.equal(view.dir.getAttribute('data-smkit-explorer-target'), null, 'closing the menu releases the row')
  } finally {
    view.dispose()
  }
})

it('releases the lit row as soon as an action is chosen', () => {
  const view = mount()
  try {
    view.contextMenu(view.dir.children[0])
    view.select('new-file')
    assert.equal(view.dir.getAttribute('data-smkit-explorer-target'), null, 'the editor, not the menu, is up now')
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
  assert.equal(view.file.getAttribute('data-smkit-explorer-target'), null, 'the kept-lit marker goes with the effect')
  assert.equal(view.roots.length, 1)
  assert.equal(view.roots[0].unmounted, true)
  const host = view.tree.parentNode
  assert.equal(
    host.children.filter((child) => child.hasAttribute('data-smkit-explorer-menu-root')).length,
    0,
    'the menu host div is gone',
  )
  const event = view.contextMenu(view.file.children[0])
  assert.equal(event.prevented, false, 'the listener is gone too')
})

it('offers the two creating rows on a directory row, never on a file row', () => {
  const view = mount()
  try {
    view.contextMenu(view.dir.children[0])
    assert.equal(
      view.menu().items.map((item) => item.id).join(','),
      'new-folder,new-file,relative,absolute,mutate-sep,rename,delete',
      'the creating rows lead and the mutations close, as in the source’s menu',
    )
    assert.equal(
      view.menu().items.map((item) => (item.type === 'separator' ? '—' : item.label)).join(','),
      'newFolder,newFile,copyRelative,copyAbsolute,—,rename,delete',
    )
    view.contextMenu(view.file.children[0])
    assert.equal(view.menu().items.map((item) => item.id).join(','), 'relative,absolute,mutate-sep,rename,delete')
  } finally {
    view.dispose()
  }
})

it('opens the inline editor under the row and creates the file on Enter', async () => {
  const view = mount()
  try {
    view.contextMenu(view.dir.children[0])
    view.select('new-file')
    const editor = view.body.querySelector('[data-smkit-explorer-new-row]')
    assert.notEqual(editor, null, 'the editor is mounted on the body')
    assert.equal(editor.getAttribute('class'), 'smkit-explorer-new-row')
    assert.equal(editor.getAttribute('data-smkit-explorer-new-kind'), 'file')
    const input = editor.querySelector('input')
    assert.equal(input.getAttribute('placeholder'), 'newFilePlaceholder')
    // Pinned to the directory row: same left edge, same width, right under it.
    assert.equal(editor.style.left, '0px')
    assert.equal(editor.style.top, '20px')
    assert.equal(editor.style.width, '160px')
    assert.equal(input.focused, true, 'the editor takes the caret')

    input.value = '  todo.md  '
    input.dispatch('keydown', { key: 'Enter' })
    await settle()
    assert.equal(view.requests.length, 1)
    assert.equal(view.requests[0].url, '/smkit/api/explorer/create-file')
    assert.equal(view.requests[0].method, 'POST')
    assert.deepEqual(JSON.parse(view.requests[0].body), { path: '/ws/src', name: 'todo.md' })
    assert.equal(view.body.querySelector('[data-smkit-explorer-new-row]'), null, 'it closes on success')
  } finally {
    view.dispose()
  }
})

it('commits on blur, as the source does', async () => {
  const view = mount()
  try {
    view.contextMenu(view.dir.children[0])
    view.select('new-folder')
    const input = view.body.querySelector('[data-smkit-explorer-new-row]').querySelector('input')
    input.value = 'made'
    input.dispatch('blur')
    await settle()
    assert.equal(view.requests.length, 1)
    assert.equal(view.requests[0].url, '/smkit/api/explorer/create-folder')
    assert.equal(JSON.parse(view.requests[0].body).name, 'made')
  } finally {
    view.dispose()
  }
})

it('keeps the editor open with the reason when the host refuses the name', async () => {
  const view = mount()
  try {
    view.reply({ ok: false, status: 409, body: { code: 'explorer/exists', error: '"a.ts" already exists' } })
    view.contextMenu(view.dir.children[0])
    view.select('new-folder')
    const editor = view.body.querySelector('[data-smkit-explorer-new-row]')
    const input = editor.querySelector('input')
    input.value = 'a.ts'
    input.dispatch('keydown', { key: 'Enter' })
    await settle()
    assert.equal(editor.hasAttribute('data-smkit-explorer-new-invalid'), true)
    // A folder duplicate keeps the host's own sentence, as the source's does.
    assert.equal(editor.children[2].textContent, '"a.ts" already exists')
    assert.notEqual(view.body.querySelector('[data-smkit-explorer-new-row]'), null, 'and it stays open')

    // A FILE duplicate has copy of its own (the source pre-checks it locally).
    input.dispatch('keydown', { key: 'Escape' })
    view.contextMenu(view.dir.children[0])
    view.select('new-file')
    const fileEditor = view.body.querySelector('[data-smkit-explorer-new-row]')
    const fileInput = fileEditor.querySelector('input')
    fileInput.value = 'a.ts'
    fileInput.dispatch('keydown', { key: 'Enter' })
    await settle()
    assert.equal(fileEditor.children[2].textContent, 'fileNameExists')
  } finally {
    view.dispose()
  }
})

it('refuses a broken name without a round trip, and dismisses on Escape or an empty name', async () => {
  const view = mount()
  try {
    view.contextMenu(view.dir.children[0])
    view.select('new-folder')
    const editor = view.body.querySelector('[data-smkit-explorer-new-row]')
    const input = editor.querySelector('input')
    for (const name of ['a/b', 'a\\b', 'a:b', '..']) {
      input.value = name
      input.dispatch('keydown', { key: 'Enter' })
      await settle()
      assert.equal(view.requests.length, 0, `${name} never reaches the host`)
      assert.equal(editor.children[2].textContent, 'folderNameInvalid')
    }
    input.dispatch('keydown', { key: 'Escape' })
    assert.equal(view.body.querySelector('[data-smkit-explorer-new-row]'), null, 'Escape closes it')

    view.contextMenu(view.dir.children[0])
    view.select('new-file')
    const second = view.body.querySelector('[data-smkit-explorer-new-row]')
    second.querySelector('input').dispatch('keydown', { key: 'Enter' })
    await settle()
    assert.equal(view.requests.length, 0)
    assert.equal(view.body.querySelector('[data-smkit-explorer-new-row]'), null, 'an empty name just closes')
  } finally {
    view.dispose()
  }
})

it('closes the inline editor when the effect is disposed', () => {
  const view = mount()
  view.contextMenu(view.dir.children[0])
  view.select('new-file')
  assert.notEqual(view.body.querySelector('[data-smkit-explorer-new-row]'), null)
  view.dispose()
  assert.equal(view.body.querySelector('[data-smkit-explorer-new-row]'), null, 'the editor goes with the effect')
})

it('renames in place: the editor replaces the row, prefilled with its own name', () => {
  const view = mount()
  try {
    view.contextMenu(view.file.children[0])
    view.select('rename')
    const editor = view.body.querySelector('[data-smkit-explorer-new-row]')
    assert.notEqual(editor, null, 'the editor is mounted')
    assert.equal(editor.getAttribute('data-smkit-explorer-editor-mode'), 'rename')
    assert.equal(editor.getAttribute('data-smkit-explorer-new-kind'), 'file')
    const input = editor.querySelector('input')
    assert.equal(input.value, 'a.ts', 'the current name is the starting buffer')
    assert.equal(input.getAttribute('aria-label'), 'rename')
    // A rename sits OVER its row; a creation sits in the gap below one.
    assert.equal(editor.style.top, '0px')
    assert.equal(editor.style.left, '0px')
  } finally {
    view.dispose()
  }
})

it('sends the new name, and treats the unchanged one as a no-op', async () => {
  const view = mount()
  try {
    view.contextMenu(view.file.children[0])
    view.select('rename')
    view.body.querySelector('[data-smkit-explorer-new-row]').querySelector('input').dispatch('keydown', { key: 'Enter' })
    await settle()
    assert.equal(view.requests.length, 0, 'the same name is not a rename')
    assert.equal(view.body.querySelector('[data-smkit-explorer-new-row]'), null, 'and the editor just closes')

    view.contextMenu(view.file.children[0])
    view.select('rename')
    const input = view.body.querySelector('[data-smkit-explorer-new-row]').querySelector('input')
    input.value = ' b.ts '
    input.dispatch('keydown', { key: 'Enter' })
    await settle()
    assert.equal(view.requests.length, 1)
    assert.equal(view.requests[0].url, '/smkit/api/explorer/rename')
    assert.deepEqual(JSON.parse(view.requests[0].body), { path: '/ws/src/a.ts', name: 'b.ts' })
    assert.equal(view.body.querySelector('[data-smkit-explorer-new-row]'), null)
  } finally {
    view.dispose()
  }
})

it('keeps the rename editor open when the host refuses it', async () => {
  const view = mount()
  try {
    view.reply({ ok: false, status: 409, body: { code: 'explorer/exists', error: '"b.ts" already exists' } })
    view.contextMenu(view.file.children[0])
    view.select('rename')
    const editor = view.body.querySelector('[data-smkit-explorer-new-row]')
    const input = editor.querySelector('input')
    input.value = 'b.ts'
    input.dispatch('keydown', { key: 'Enter' })
    await settle()
    assert.equal(editor.children[2].textContent, '"b.ts" already exists', 'the host’s own words, as the source shows')
    assert.notEqual(view.body.querySelector('[data-smkit-explorer-new-row]'), null, 'and it stays open')
  } finally {
    view.dispose()
  }
})

it('refuses a rename name with a separator, without a round trip', async () => {
  const view = mount()
  try {
    view.contextMenu(view.file.children[0])
    view.select('rename')
    const editor = view.body.querySelector('[data-smkit-explorer-new-row]')
    const input = editor.querySelector('input')
    input.value = 'a/b.ts'
    input.dispatch('keydown', { key: 'Enter' })
    await settle()
    assert.equal(view.requests.length, 0)
    assert.equal(editor.children[2].textContent, 'renameInvalid')
  } finally {
    view.dispose()
  }
})

it('asks before deleting, naming the entry and what goes with it', async () => {
  const view = mount()
  try {
    view.contextMenu(view.file.children[0])
    view.select('delete')
    const dialog = view.dialog()
    assert.notEqual(dialog, null, 'the confirmation opens')
    assert.equal(dialog.title, 'deleteTitle')
    assert.equal(dialog.body, 'deleteDescFile')
    assert.equal(view.requests.length, 0, 'nothing is deleted before the confirm')

    dialog.onConfirm()
    await settle()
    assert.equal(view.requests.length, 1)
    assert.equal(view.requests[0].url, '/smkit/api/explorer/delete')
    assert.deepEqual(JSON.parse(view.requests[0].body), { path: '/ws/src/a.ts' })
    assert.equal(view.dialog(), null, 'and the dialog closes on success')
  } finally {
    view.dispose()
  }
})

it('promises the directory’s contents, and stays open with the failure', async () => {
  const view = mount()
  try {
    view.reply({ ok: false, status: 500, body: { code: 'explorer/unavailable', error: 'EBUSY: resource busy' } })
    view.contextMenu(view.dir.children[0])
    view.select('delete')
    assert.equal(view.dialog().body, 'deleteDescDir')
    view.dialog().onConfirm()
    await settle()
    assert.equal(view.dialog().error, 'EBUSY: resource busy')
    assert.notEqual(view.dialog(), null, 'the dialog keeps the reason on screen')
  } finally {
    view.dispose()
  }
})

it('cancelling the confirmation deletes nothing', async () => {
  const view = mount()
  try {
    view.contextMenu(view.file.children[0])
    view.select('delete')
    view.dialog().onCancel()
    await settle()
    assert.equal(view.requests.length, 0)
    assert.equal(view.dialog(), null)
  } finally {
    view.dispose()
  }
})

it('closes an open confirmation when the effect is disposed', () => {
  const view = mount()
  view.contextMenu(view.file.children[0])
  view.select('delete')
  assert.notEqual(view.dialog(), null)
  view.dispose()
  assert.equal(view.dialog(), null, 'the dialog goes with the effect')
})
