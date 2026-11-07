/**
 * The composer's `/mcp` history: ↑ recalls, ↓ walks forward, and only lines
 * this plugin owns are ever recorded.
 *
 * What is worth pinning:
 *
 * - a submitted `/mcp …` line is stored under the workspace path, newest
 *   first, de-duplicated, capped at 50;
 * - anything else submitted (prose, another command) is not stored at all;
 * - ↑ on an empty draft fills the newest command and consumes the key; a
 *   second ↑ walks back, ↓ walks forward, and ↓ past the newest clears the box;
 * - a draft the reader is typing keeps ↑ for the shell (caret movement);
 * - a session whose conversation input cannot be resolved (a brand-new one)
 *   never swallows the key.
 *
 * The VM has no DOM, so the harness below answers only what the bundle asks:
 * `closest`/`matches` on a tiny element class, a listener registry, and a
 * storage map.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

/** One element: enough of one for the key handler's two questions. */
class SandboxElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.textContent = ''
    this.parentNode = null
    this.attributes = new Map()
    // The menu's portal container parks itself with `style.display`.
    this.style = { setProperty: () => {}, removeProperty: () => {} }
    // `installStylesheet` writes `tag.dataset.plugin`; a real element has one,
    // and the stylesheet injection runs while the bundle is created.
    this.dataset = new Proxy({}, {
      set: (target, key, value) => {
        target[key] = value
        return true
      },
      get: (target, key) => target[key],
    })
  }

  setAttribute(name, value) { this.attributes.set(name, value) }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  hasAttribute(name) { return this.attributes.has(name) }
  removeAttribute(name) { this.attributes.delete(name) }

  get children() { return [] }

  matches(selector) { return selector === '[role="textbox"][contenteditable="true"]' }
  closest(selector) { return this.matches(selector) ? this : null }

  appendChild() {}
  remove() {}
  addEventListener() {}
}

/** Mount the whole bundle once, with the composer and its storage under test. */
function mount(options = {}) {
  /** Commands the bundle wrote through `setDraft`, in order. */
  const drafts = []
  /** Everything the fake storage holds. */
  const storage = new Map(Object.entries(options.storage ?? {}))
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)) },
    removeItem: (key) => { storage.delete(key) },
  }

  const listeners = new Map()
  const document = {
    documentElement: new SandboxElement('html'),
    body: new SandboxElement('body'),
    head: { appendChild: () => {} },
    createElement: (tag) => new SandboxElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, handler) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler])
    },
    removeEventListener: (type, handler) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler))
    },
  }

  const react = {
    createElement: (type, props) => ({ type, props: props ?? {} }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
  }

  let exported
  runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          exported = factory((id) => {
            if (id === 'react') return react
            if (id === 'react-dom') return { createPortal: () => null }
            if (id === 'react-dom/client') return { createRoot: () => ({ render: () => {}, unmount: () => {} }) }
            if (id === '@deepseek-ai/dsh-client-ui-primitives') {
              return { Menu: () => null, writeClipboard: async () => true }
            }
            return {}
          })
        },
      },
    },
    document,
    Element: SandboxElement,
    HTMLElement: SandboxElement,
    localStorage,
    console: { warn: () => {}, error: () => {}, log: () => {} },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (fn) => { fn(); return 0 },
    cancelAnimationFrame: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn) => { fn(); return 0 },
    clearTimeout: () => {},
  })

  const sessionList = options.session === false
    ? { byId: {} }
    : {
      current: 's1',
      byId: { s1: { cwd: options.cwd ?? '/work', retainedBy: { mainView: 1 } } },
    }
  const services = {
    conversation: options.conversation === false
      ? undefined
      : { input: { for: () => ({ setDraft: (text) => drafts.push(text) }) } },
  }
  const effects = []
  const ctx = {
    effect: (fn) => { effects.push(fn()) },
    provide: () => {},
    reflect: { get: (name) => services[name] },
    on: () => () => {},
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: { register: () => () => {}, inject: (_name, setup) => { setup?.() } },
    sessions: {
      scope: (id) => (options.session === false ? undefined : { sessionId: id }),
      list: { getSnapshot: () => sessionList },
    },
  }
  exported.apply(ctx)

  const composer = new SandboxElement('div')
  const other = new SandboxElement('input')

  /** Deliver one keydown the way the browser dispatches it (capture). */
  function press(key, box = composer) {
    let prevented = false
    const event = {
      key,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      target: box,
      preventDefault: () => { prevented = true },
    }
    for (const handler of listeners.get('keydown') ?? []) handler(event)
    return prevented
  }

  return {
    press,
    drafts,
    storage,
    composer,
    other,
    /** Put text into the composer, the way a reader would have typed it. */
    type(text) { composer.textContent = text },
    stored(key = 'smkit.mcp-history:/work') {
      const raw = storage.get(key)
      return raw === undefined ? [] : JSON.parse(raw)
    },
    dispose() { for (const dispose of effects.reverse()) dispose() },
  }
}

it('records a submitted /mcp line under the workspace', () => {
  const view = mount()
  view.type('/mcp list embedded-board')
  view.press('Enter')
  assert.deepEqual(view.stored(), ['/mcp list embedded-board'])
})

it('records nothing that is not an /mcp command', () => {
  const view = mount()
  view.type('please summarise this')
  view.press('Enter')
  view.type('/compact')
  view.press('Enter')
  assert.deepEqual(view.stored(), [])
})

it('keeps the newest first and drops duplicates', () => {
  const view = mount()
  for (const line of ['/mcp list', '/mcp help x', '/mcp list']) {
    view.type(line)
    view.press('Enter')
  }
  assert.deepEqual(view.stored(), ['/mcp list', '/mcp help x'])
})

it('recalls the newest on ↑, walks back, and forward again', () => {
  const view = mount()
  for (const line of ['/mcp list', '/mcp help x']) {
    view.type(line)
    view.press('Enter')
  }
  view.type('')

  assert.equal(view.press('ArrowUp'), true, 'the key is consumed')
  assert.deepEqual(view.drafts, ['/mcp help x'])

  view.press('ArrowUp')
  assert.deepEqual(view.drafts, ['/mcp help x', '/mcp list'], 'one step further back')

  view.press('ArrowDown')
  assert.equal(view.drafts.at(-1), '/mcp help x', 'forward again')

  view.press('ArrowDown')
  assert.equal(view.drafts.at(-1), '', 'past the newest: the box is cleared')
})

it('leaves ↑ to the shell while a draft is being typed', () => {
  const view = mount()
  view.type('/mcp list')
  view.press('Enter')
  view.type('half a thought')

  assert.equal(view.press('ArrowUp'), false, 'the caret keeps its meaning')
  assert.deepEqual(view.drafts, [])
})

it('keeps the key when the session has no conversation input', () => {
  const view = mount({ conversation: false })
  view.type('/mcp list')
  view.press('Enter')
  view.type('')
  assert.equal(view.press('ArrowUp'), false, 'nothing to fill, so nothing is swallowed')
  assert.deepEqual(view.drafts, [])
})

it('ignores a text box that is not the conversation composer', () => {
  const view = mount()
  view.type('/mcp list')
  view.press('Enter', view.other)
  assert.deepEqual(view.stored(), [])
})

it('caps one workspace at fifty commands', () => {
  const view = mount({
    storage: { 'smkit.mcp-history:/work': JSON.stringify(Array.from({ length: 50 }, (_, at) => `/mcp old-${at}`)) },
  })
  view.type('/mcp newest')
  view.press('Enter')
  const stored = view.stored()
  assert.equal(stored.length, 50)
  assert.equal(stored[0], '/mcp newest')
  assert.equal(stored.includes('/mcp old-49'), false, 'the oldest fell off')
})

it('keeps two workspaces apart', () => {
  const first = mount({ cwd: '/a' })
  first.type('/mcp list')
  first.press('Enter')
  assert.deepEqual(first.stored('smkit.mcp-history:/a'), ['/mcp list'])
  assert.deepEqual(first.stored('smkit.mcp-history:/b'), [])
})
