/**
 * The explorer's rows on the shell's shared context menu, driven through the
 * real client bundle against a stand-in for the shell's menu service.
 *
 * The rows are data contributions rather than markup, so what is worth pinning
 * is what the contribution promises:
 *
 * - one contribution per target family (`file`, `directory`), both above the
 *   shell's own rows (open-in-app registers at order 100);
 * - "add to conversation" leads the menu; every other row is a footer row, so
 *   the shell's own hairline is the separation;
 * - the footer's first row carries no `separatorBefore` (the shell ignores one
 *   there anyway), and each later section opens with one;
 * - the tree's root carries the two creating rows only — no path to copy, no
 *   sibling to rename, no parent to delete out of;
 * - a file carries no creating rows;
 * - choosing a copy row writes the tree's own absolute path, or its projection
 *   against the root, and the delete row is the shell's danger style.
 *
 * The VM has no DOM, so the document below answers only what the bundle asks
 * on mount.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

/** Mount the bundle against one menu service, and hand back the contributions. */
function mount(options = {}) {
  const contributions = []
  const registrations = []
  const clipboard = { texts: [] }
  const effects = []
  const services = {
    contextMenus: options.menu === false ? undefined : { register },
    // The neighbour's client half publishes this while it is loaded; its mere
    // presence is the whole answer (`platform/neighbour`).
    betterSidebar: options.betterSidebar === true ? { isTabEnabled: () => true } : undefined,
  }

  function register(contribution) {
    contributions.push(contribution)
    return () => {}
  }

  const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) }
  let exported
  runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          exported = factory((id) => {
            if (id === 'react') return react
            if (id === 'react-dom') return { createPortal: () => null }
            if (id === 'react-dom/client') {
              return { createRoot: () => ({ render: () => {}, unmount: () => {} }) }
            }
            if (id === '@deepseek-ai/dsh-client-ui-primitives') {
              return {
                Menu: () => null,
                writeClipboard: async (text) => { clipboard.texts.push(text); return true },
              }
            }
            throw new Error(`no platform module ${id}`)
          })
        },
      },
    },
    document: {
      body: { appendChild: () => {}, removeChild: () => {} },
      head: { appendChild: () => {} },
      documentElement: { dataset: {} },
      createElement: () => ({ dataset: {}, setAttribute: () => {}, appendChild: () => {}, remove: () => {}, style: {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    Element: class {},
    Node: class {},
    DOMRect: class {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: { warn: () => {} },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback) => { callback(); return 0 },
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  })

  const ctx = {
    effect: (fn) => { effects.push(fn()) },
    provide: () => {},
    reflect: { get: (name) => services[name] },
    sessions: { list: { getSnapshot: () => ({ byId: { 'session-1': { cwd: '/ws' } } }) } },
    on: () => () => {},
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (_name, callback) => callback(),
      register: (entry, component) => { registrations.push({ entry, component }); return () => {} },
    },
  }
  exported.apply(ctx)

  const directory = contributions.find((one) => one.target === 'directory')
  const file = contributions.find((one) => one.target === 'file')

  return {
    contributions,
    registrations,
    clipboard,
    /** Resolve the directory rows for one path. */
    resolveDirectory: (path) => directory?.resolve({ sessionId: 'session-1', path }),
    /** Resolve the file rows for one path. */
    resolveFile: (path) => file?.resolve({ sessionId: 'session-1', path }),
    /** Publish or withdraw the neighbour mid-lifetime, as loading it would. */
    setBetterSidebar(value) {
      services.betterSidebar = value === true ? { isTabEnabled: () => true } : undefined
    },
    dispose() { for (const dispose of effects.reverse()) dispose?.() },
  }
}

/** Let the clipboard promise's `.then` run. */
const settle = () => new Promise((resolve) => setImmediate(resolve))

it('contributes one row family per target, above the shell’s own rows', () => {
  const view = mount()
  const explorer = view.contributions.filter((one) => one.id.startsWith('smkit.explorer.'))
  const targets = [...explorer.map((one) => one.target)].sort()
  assert.deepEqual(targets, ['directory', 'file'])
  for (const contribution of explorer) {
    assert.equal(contribution.id, `smkit.explorer.${contribution.target}`)
    assert.equal(contribution.order, 10, 'open-in-app registers its directory rows at 100')
    assert.equal(typeof contribution.resolve, 'function')
  }
})

it('leads with “add to conversation” and keeps every other row in the footer', () => {
  const view = mount()
  const rows = view.resolveDirectory('/ws/src')
  assert.equal(rows[0].label, 'addToChat')
  assert.equal(rows[0].afterContent, undefined, 'the leading row scrolls with the menu')
  const footer = rows.slice(1)
  assert.ok(footer.every((row) => row.afterContent === true), 'the rest are pinned below')
  assert.deepEqual([...footer.map((row) => row.label)], [
    'newFolder',
    'newFile',
    'copyRelative',
    'copyAbsolute',
    'rename',
    'delete',
  ])
})

it('opens a section with a hairline, never on the footer’s first row', () => {
  const view = mount()
  const footer = view.resolveDirectory('/ws/src').slice(1)
  assert.deepEqual(
    [...footer.map((row) => row.separatorBefore === true)],
    [false, false, true, false, true, false],
  )
})

it('offers the creating rows on the root, and nothing that names the workspace itself', () => {
  const view = mount()
  const rows = view.resolveDirectory('/ws')
  assert.deepEqual([...rows.map((row) => row.label)], ['newFolder', 'newFile'])
  assert.ok(rows.every((row) => row.afterContent === true))
  assert.equal(rows[0].separatorBefore, undefined, 'the footer’s own border is the separation')
})

it('offers no creating rows on a file, and keeps the danger row last', () => {
  const view = mount()
  const rows = view.resolveFile('/ws/src/a.ts')
  assert.deepEqual([...rows.map((row) => row.label)], [
    'addToChat',
    'copyRelative',
    'copyAbsolute',
    'rename',
    'delete',
  ])
  assert.equal(rows[0].afterContent, undefined)
  assert.equal(rows[1].separatorBefore, undefined, 'first footer row carries no hairline')
  assert.equal(rows.at(-1).danger, true)
})

it('copies the root-relative path, and the absolute one verbatim', async () => {
  const view = mount()
  const rows = view.resolveDirectory('/ws/src/lib')
  rows.find((row) => row.label === 'copyRelative').run()
  rows.find((row) => row.label === 'copyAbsolute').run()
  await settle()
  assert.deepEqual(view.clipboard.texts, ['src/lib', '/ws/src/lib'])
})

it('answers every glyph key on the icon seat, with a component', () => {
  const view = mount()
  const keys = view.registrations
    .filter((one) => one.entry.name === 'contextMenu.icon')
    .map((one) => one.entry.key)
    .filter((key) => key.startsWith('smkit.explorer.'))
    .sort()
  assert.deepEqual(keys, [
    'smkit.explorer.copy',
    'smkit.explorer.delete',
    'smkit.explorer.new-file',
    'smkit.explorer.new-folder',
    'smkit.explorer.reference',
    'smkit.explorer.rename',
  ])
  assert.ok(view.registrations.every((one) => typeof one.component === 'function'))
})

it('marks the leading row’s glyph so its own hairline can close the group', () => {
  // The menu API draws separators only before a row, and hides one on the first
  // row: the lead row's glyph is the only element this plugin owns inside the
  // shell's row, so the stylesheet's hairline hangs off it.
  const view = mount()
  const icons = new Map(view.registrations
    .filter((one) => one.entry.name === 'contextMenu.icon')
    .map((one) => [one.entry.key, one.component]))

  const lead = icons.get('smkit.explorer.reference')({ size: 16 })
  assert.equal(lead.type, 'span')
  assert.ok('data-smkit-menu-lead' in lead.props, 'the lead glyph carries the mark')
  assert.equal(lead.children.length, 1, 'and the glyph itself, untouched')

  const copy = icons.get('smkit.explorer.copy')({ size: 16 })
  assert.ok(!('data-smkit-menu-lead' in copy.props), 'other rows keep the plain glyph')
})

it('yields to dsh-better-sidebar even though the rows are the shell’s own', () => {
  // Entering the shared menu does not change who owns the tree: that plugin's
  // explorer already carries these rows, so this contribution answers with none
  // rather than drawing a second set on top of its own menu.
  const view = mount({ betterSidebar: true })
  assert.deepEqual([...view.resolveDirectory('/ws/src')], [], 'no directory rows')
  assert.deepEqual([...view.resolveDirectory('/ws')], [], 'not even the creating rows at the root')
  assert.deepEqual([...view.resolveFile('/ws/src/a.ts')], [], 'no file rows')
})

it('re-reads the neighbour on every opening, so unloading it brings the rows back', () => {
  const view = mount({ betterSidebar: true })
  assert.equal(view.resolveDirectory('/ws/src').length, 0)
  view.setBetterSidebar(false)
  assert.ok(view.resolveDirectory('/ws/src').length > 0, 'the shell’s tree is ours again')
  view.setBetterSidebar(true)
  assert.equal(view.resolveDirectory('/ws/src').length, 0, 'and yielding is per opening, not per mount')
})

it('stands down on a host with no menu service, drawn menu included', () => {
  const view = mount({ menu: false })
  assert.deepEqual(view.contributions, [])
  assert.deepEqual(
    view.registrations.filter((one) => one.entry.name === 'contextMenu.icon'),
    [],
    'no keyed seat is filled where nothing renders those rows',
  )
})
