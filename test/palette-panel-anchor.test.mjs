/**
 * The palette panel's corner, driven through the real client bundle in a hook
 * harness: the panel hangs under the header its toggle was seated in rather
 * than in the window's corner, and it follows that header when the shell's
 * columns change.
 *
 * The placement is the one thing this rule computes rather than reads, and no
 * headless render produces a layout — so the harness answers with the boxes a
 * browser would: a header whose border box is the conversation column, and the
 * panel element the rule writes to. The checks below are therefore about the
 * wiring rather than the arithmetic: which box is measured, when it is measured
 * again, what is left to the stylesheet when there is no box to measure, and
 * that the panel root carries the marker the rule looks for in the first place.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** The `t` this suite renders with: the key, which is all the checks need. */
const t = (key) => key

/** Flatten a rendered tree, expanding function components the way React would. */
function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return []
  if (typeof tree.type === 'function') return [tree, ...nodes(tree.type(tree.props))]
  return [tree, ...(tree.children ?? []).flatMap(nodes)]
}

/** The one node carrying a marker, or `undefined`. */
const marked = (tree, name) => nodes(tree).find((node) => node.props?.[name] !== undefined)

/**
 * A stand-in for one DOM element, shared into the bundle's scope as `Element`.
 *
 * The rule asks the toggle for its column with `closest`, so the stand-in
 * answers that question and nothing else.
 */
class SandboxElement {
  constructor(closest) {
    this._closest = closest
  }

  closest(selector) {
    return this._closest(selector)
  }

  append() {}
}

/**
 * Stand up one mount of the bundle and hand back the render, click and geometry
 * helpers.
 * @param options - `header` for a host whose seat has no header ancestor,
 *   `box` for the conversation column the header fills.
 * @returns the panel stand-in, the column's box, and the mount's own helpers.
 */
function mount(options = {}) {
  const box = { left: 0, top: 0, right: 1280, bottom: 76, width: 1280, height: 76, ...options.box }
  const header = { getBoundingClientRect: () => ({ ...box }) }
  // Where the rule writes. The panel's own root carries the marker this stands
  // in for; `marked()` below reads that off the render.
  const panel = { style: { right: '' } }
  const hasHeader = options.header ?? true
  const toggle = new SandboxElement((selector) => (selector === 'header' && hasHeader ? header : null))
  /** Every observer the rule installed, and what it asked each to watch. */
  const observers = []
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback
      this.targets = []
      this.disconnected = false
      observers.push(this)
    }

    observe(target) {
      this.targets.push(target)
    }

    disconnect() {
      this.disconnected = true
    }
  }

  let exported
  let states = []
  let cursor = 0
  const effectCells = []
  const pending = []
  let effectCursor = 0
  // Effects are registered per render and run on commit, with their
  // dependencies compared the way React compares them: the panel is placed when
  // it opens and uninstalled when it closes, and the checks below are about
  // both halves of that.
  const react = {
    createElement: (type, props, ...children) => {
      const kids = children.flat(Infinity)
      return { type, props: { ...props, children: kids }, children: kids }
    },
    useState: (initial) => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = value }]
    },
    useEffect: (effect, deps) => {
      const index = effectCursor++
      const cell = effectCells[index] ?? (effectCells[index] = { deps: undefined, cleanup: null })
      const same =
        Array.isArray(deps) &&
        Array.isArray(cell.deps) &&
        deps.length === cell.deps.length &&
        deps.every((value, position) => Object.is(value, cell.deps[position]))
      if (same) return
      cell.deps = deps
      pending.push({ cell, effect })
    },
    useCallback: (callback) => callback,
  }
  const body = new SandboxElement(() => null)
  body.style = { setProperty() {}, removeProperty() {} }
  // Only what the bundle asks for: a `<style>` tag it can key (nothing else is
  // appended), the panel's probe element, and the rule's two selectors.
  const fakeDocument = {
    head: { appendChild() {} },
    body,
    createElement: (tag) => (tag === 'style' ? { dataset: {} } : { style: {}, isConnected: true }),
    querySelector: (selector) =>
      selector === '[data-smkit-palette-panel]'
        ? panel
        : selector === '[data-smkit-palette-trigger]'
          ? toggle
          : null,
    addEventListener() {},
    removeEventListener() {},
  }
  runInNewContext(source, {
    window: {
      __ModuleLoader__: { load: ({ factory }) => { exported = factory((id) => (id === 'react' ? react : undefined)) } },
      // What the placement measures the column against, and what the panel's
      // probe reads its colors through.
      innerWidth: options.viewport ?? 1280,
      addEventListener() {},
      removeEventListener() {},
    },
    document: fakeDocument,
    Element: SandboxElement,
    getComputedStyle: () => ({ color: 'rgb(0, 0, 0)' }),
    ResizeObserver: FakeResizeObserver,
    TextDecoder: globalThis.TextDecoder,
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  })
  const registrations = new Map()
  const ctx = {
    effect(fn) { fn() },
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => { registrations.set(options.id, component) },
    },
    reflect: { get: () => undefined },
  }
  exported.apply(ctx)
  const PaletteButton = registrations.get('smkit-theme-palette')
  assert.equal(typeof PaletteButton, 'function', 'the header utilities seat must get the palette toggle')

  return {
    panel,
    toggle,
    header,
    observers,
    box,
    /** The column takes another width: the Sidebar opened, or was dragged. */
    resize(next) {
      Object.assign(box, next)
      for (const observer of observers) observer.callback()
    },
    render() {
      cursor = 0
      effectCursor = 0
      const tree = PaletteButton({ t })
      // React runs an effect after the commit, and runs the previous cleanup
      // first — which is what makes the uninstallers below the ones a browser
      // would have run.
      while (pending.length > 0) {
        const { cell, effect } = pending.shift()
        if (typeof cell.cleanup === 'function') cell.cleanup()
        const cleanup = effect()
        cell.cleanup = typeof cleanup === 'function' ? cleanup : null
      }
      return tree
    },
    /** Toggle the panel the way a press on the control does. */
    click() {
      const button = marked(this.render(), 'data-smkit-palette-trigger')
      assert.ok(button, 'the toggle must mark itself')
      button.props.onClick()
      return this.render()
    },
  }
}

it('places the panel in its own column corner, not the window’s', () => {
  const ui = mount()
  const tree = ui.click()
  // The marker the rule hunts for is the panel root's own: without it the
  // placement would be looking for something the render never draws.
  assert.equal(marked(tree, 'data-smkit-palette-panel')?.props['data-smkit-palette-panel'], 'true')
  // A column that reaches the window's edge is the sidebar-closed case, and
  // the panel lands exactly where the stylesheet used to put it.
  assert.equal(ui.panel.style.right, '12px')
})

it('follows the column when the Sidebar takes its width', () => {
  const ui = mount()
  ui.click()
  // The shell's right Sidebar opens: the conversation column ends 300px short
  // of the window, and the panel travels left with its toggle.
  ui.resize({ right: 980, width: 700 })
  assert.equal(ui.panel.style.right, '312px')
  // …and back when it closes.
  ui.resize({ right: 1280, width: 1280 })
  assert.equal(ui.panel.style.right, '12px')
})

it('watches the column, not the panel', () => {
  const ui = mount()
  ui.click()
  assert.equal(ui.observers.length, 1, 'one observer, for the panel’s lifetime')
  // The header is the one box whose width the frame's columns change, so it is
  // the one worth a per-frame answer; the panel's own box is what the rule
  // writes and must never be what it reads.
  assert.deepEqual(ui.observers[0].targets, [ui.header])
})

it('hands the panel back to the stylesheet when there is no column to measure', () => {
  const ui = mount()
  ui.click()
  assert.equal(ui.panel.style.right, '12px')
  // A header the shell has hidden: no box, so nothing to align to, and the
  // stylesheet's own corner is what is left.
  ui.resize({ right: 0, width: 0 })
  assert.equal(ui.panel.style.right, '')
  ui.resize({ right: 1280, width: 1280 })
  assert.equal(ui.panel.style.right, '12px')
})

it('keeps the stylesheet’s corner where the host seats the toggle outside a header', () => {
  const ui = mount({ header: false })
  ui.click()
  assert.equal(ui.panel.style.right, '', 'no column to hang off means no measurement')
  assert.equal(ui.observers.length, 0, 'and nothing to watch')
})

it('stops following the column once the panel closes', () => {
  const ui = mount()
  ui.click()
  assert.equal(ui.observers[0].disconnected, false)
  ui.click()
  assert.equal(ui.observers[0].disconnected, true)
})
