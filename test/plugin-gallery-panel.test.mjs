/**
 * The plugin gallery tab, driven through the real client bundle on the merged
 * section's hook harness: open the tab, read the shelf it draws, and press a
 * card's copy button.
 *
 * What this file owns is the pairing, not the shortlist. There are three halves
 * to one card and nothing at runtime compares them: the entry in `catalog.ts`
 * (a name, a repository, a command), the panel that has to render each in its
 * own place, and the one line of copy per card the two dictionaries have to
 * declare under `<id>Desc`. A card whose line is missing reads its own key; a
 * card whose command is missing renders an empty row; a card whose link is
 * dropped renders a name that goes nowhere. So the assertions below read the
 * catalogue where it is written and check the rendered card field by field,
 * and the last case checks the dictionaries against it — no second copy of a
 * command lives here to drift from the one that ships.
 *
 * The copy button is the page's only state, and its case pins all three parts
 * of it: the clipboard really receives the command (the harness hands the page
 * a `navigator.clipboard` and records what was written), the button turns into
 * the answer and holds it — disabled, so the same second cannot start a second
 * copy — and the hold is exactly the second the page schedules, read back from
 * the harness's own timer queue rather than waited out.
 *
 * Harness discipline (same as `session-manager-panel.test.mjs`): hooks are
 * handed out on one flat cursor, and every read is one whole render pass,
 * because a bare walk of an already-rendered tree would re-invoke the panel at
 * whatever cursor the last walk left behind and read another component's
 * state.
 *
 * Which plugins are on the shelf, and in what order, is `catalog.ts`'s
 * business: only the entry the page was asked for is named literally.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const FEATURE = new URL('../src/client/features/plugin-gallery/', import.meta.url)

/** The `t` this suite renders with: identity, so assertions name the key. */
const t = (key) => key

/** The catalogue as it is written: one `{ id, name, repo, command }` per card. */
const ENTRIES = [
  ...readFileSync(new URL('catalog.ts', FEATURE), 'utf8').matchAll(
    /id: '([^']+)',\s+name: '([^']+)',\s+repo: '([^']+)',\s+command: '([^']+)',/g,
  ),
].map((match) => ({ id: match[1], name: match[2], repo: match[3], command: match[4] }))

/** The keys one dictionary declares, in the `key: '…'` form the files use. */
function dictionaryKeys(locale) {
  const sourceText = readFileSync(new URL(`i18n/${locale}.ts`, FEATURE), 'utf8')
  return new Set([...sourceText.matchAll(/^\s{2}"?([A-Za-z_][\w-]*)"?:\s*["']/gm)].map((match) => match[1]))
}

/** One HTTP answer in the shape the client's `api()` helper expects. */
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

const settle = () => new Promise((resolve) => setImmediate(resolve))

/** Flatten a rendered tree, expanding function components the way React does. */
function nodes(tree) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return []
  if (typeof tree.type === 'function') return [tree, ...nodes(tree.type(tree.props))]
  return [tree, ...(tree.children ?? []).flatMap(nodes)]
}

/** Every string in a tree, for assertions about what a user can read. */
const text = (tree) =>
  typeof tree === 'string'
    ? tree
    : typeof tree?.type === 'function'
      ? text(tree.type(tree.props))
      : (tree?.children ?? []).map(text).join(' ')

/** All nodes whose props match a predicate, in render order. */
const findAll = (tree, matches) => nodes(tree).filter(matches)

/**
 * Mount the real bundle and the merged section on a hook harness.
 *
 * `read` is one whole render pass — the section from the top, then whatever the
 * active tab put below it, hooks handed out in render order — and the tab
 * switch drops the slots the panel it replaced wrote, so the next panel starts
 * from its own initial state rather than from the last one's leftovers.
 *
 * Effects are captured rather than run (`effects()`), and `setTimeout` is a
 * queue the suite drains by hand (`flushTimers`), because the page's second is
 * the thing under test: waiting it out would only prove that time passes.
 *
 * `denied` hands the page a clipboard that refuses, which is the one other
 * answer a copy can get.
 */
function mount({ denied = false } = {}) {
  const registrations = new Map()
  const written = []
  const timers = new Map()
  const states = []
  let timerId = 0
  let cursor = 0
  let shellSlots = 0
  let slots = []
  let running = []
  let capturing = false
  let exported
  const react = {
    createElement: (type, props, ...children) => {
      const kids = children.flat(Infinity)
      return { type, props: { ...props, children: kids }, children: kids }
    },
    useState: (initial) => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => {
        states[index] = typeof value === 'function' ? value(states[index]) : value
      }]
    },
    useEffect: (effect) => { if (capturing) slots.push(effect) },
    useCallback: (callback) => callback,
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react) } } },
    fetch: async () => response({}),
    navigator: {
      clipboard: {
        writeText: async (value) => {
          if (denied) throw new Error('clipboard write refused')
          written.push(value)
        },
      },
    },
    setTimeout: (fn, ms) => {
      const id = ++timerId
      timers.set(id, { fn, ms })
      return id
    },
    clearTimeout: (id) => { timers.delete(id) },
    setInterval: () => 1,
    clearInterval: () => {},
  })
  exported.apply({
    effect(fn) { fn() },
    locale: { register: () => () => {}, bind: () => t },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => { registrations.set(options.id, component) },
    },
  })
  const section = registrations.get('mcp-manager')
  assert.ok(section, 'the merged settings section must be registered')
  return {
    written,
    /**
     * One whole render pass, handing the reader the tree it drew. Every walk in
     * this file goes through here: the cursor starts at the section's own slots
     * and the reader expands the panel exactly once.
     */
    read(reader) {
      cursor = 0
      slots = []
      capturing = true
      const tree = section()
      shellSlots = cursor
      const out = reader(tree)
      capturing = false
      return out
    },
    /** Click one strip tab by its (identity) label. */
    openTab(label) {
      const tab = this.read((tree) =>
        nodes(tree).find((node) => node.props?.role === 'tab' && node.children.includes(label)))
      assert.ok(tab, `the merged section must offer the ${label} tab`)
      tab.props.onClick()
      // The panel that was below the strip is gone with the switch: its slots
      // would otherwise be read back as the next panel's initial state.
      states.length = shellSlots
      return tab
    },
    /** Run what the last pass registered, as React would after its paint. */
    effects() {
      for (const cleanup of running) if (typeof cleanup === 'function') cleanup()
      running = slots.map((effect) => effect())
      slots = []
    },
    /** The delays of the timers the page parked, in the order it parked them. */
    timerDelays: () => [...timers.values()].map((timer) => timer.ms),
    /** Fire every parked timer, as the browser would when its second is up. */
    flushTimers() {
      const parked = [...timers.values()]
      timers.clear()
      for (const timer of parked) timer.fn()
    },
  }
}

/** Whether one node wears a class, among however many it wears. */
const hasClass = (node, name) => String(node.props?.className ?? '').split(/\s+/).includes(name)

/** The cards of one rendered tree. Read within a pass: no walk of its own. */
const cardsOf = (tree) => findAll(tree, (node) => hasClass(node, 'smkit-gallery-page-card'))

/** The single child of a card that wears one class — the button wears two. */
const partOf = (card, className) => nodes(card).find((node) => hasClass(node, className))

/** One card's copy button, as the user meets it: its label and its pressability. */
const copyButtonOf = (app, name) =>
  app.read((tree) => partOf(cardsOf(tree).find((card) => text(card).includes(name)), 'smkit-gallery-page-copy'))

it('opens to one card per catalogue entry, each linking out and printing its command', () => {
  assert.ok(ENTRIES.length > 0, 'the suite must read the catalogue it asserts against')
  const app = mount()
  const tab = app.openTab('tabPlugins')

  // The tab itself: the strip names it from the section's dictionary, and it
  // wears a glyph — the puzzle piece — before that label.
  assert.equal(tab.children[1], 'tabPlugins', 'the tab reads its own dictionary key')
  assert.equal(typeof tab.children[0]?.type, 'function', 'the tab draws a glyph before its label')

  const cards = app.read(cardsOf)
  assert.equal(cards.length, ENTRIES.length, 'one card per entry in catalog.ts')
  // The strip marked this tab, and this tab alone: the panel below the strip is
  // the one the user asked for.
  const selected = app.read((tree) =>
    findAll(tree, (node) => node.props?.role === 'tab' && node.props?.['aria-selected'] === true))
  assert.equal(selected.length, 1, 'exactly one tab reads as selected')
  assert.ok(text(selected[0]).includes('tabPlugins'), 'and it is this one')

  for (const [index, entry] of ENTRIES.entries()) {
    const card = cards[index]
    // The name is the link, and the mark is inside it: the text a user reads
    // and the target they click are the same element.
    const name = partOf(card, 'smkit-gallery-page-name')
    assert.equal(name.props.href, entry.repo, `${entry.id}: the name links to its repository`)
    assert.equal(name.props.target, '_blank', `${entry.id}: the repository opens in a new tab`)
    assert.equal(name.props.rel, 'noreferrer', `${entry.id}: the new tab gets no referrer`)
    assert.equal(name.type, 'a', `${entry.id}: the name is the anchor itself, not a wrapper`)
    assert.ok(text(name).includes(entry.name), `${entry.id}: the card names the package`)
    const mark = partOf(card, 'smkit-gallery-page-mark')
    assert.ok(mark, `${entry.id}: the GitHub mark rides the link`)
    assert.ok(
      nodes(name).includes(mark),
      `${entry.id}: the mark is inside the anchor, so it is part of the target`,
    )
    // One sentence per card, addressed by the entry's own id.
    assert.equal(
      partOf(card, 'smkit-gallery-page-desc').children[0],
      `${entry.id}Desc`,
      `${entry.id}: the description is asked for under the entry's id`,
    )
    // The command is printed verbatim, inside a code run, with its button.
    const command = partOf(card, 'smkit-gallery-page-command')
    assert.equal(command.type, 'code', `${entry.id}: the command is marked up as code`)
    assert.equal(text(command), entry.command, `${entry.id}: the command is printed verbatim`)
    const button = partOf(card, 'smkit-gallery-page-copy')
    assert.equal(button.type, 'button', `${entry.id}: the copy control is a button`)
    assert.equal(button.props.type, 'button', `${entry.id}: and it never submits anything`)
    assert.equal(text(button), 'copy', `${entry.id}: it reads its own dictionary key while idle`)
    assert.equal(button.props.disabled, false, `${entry.id}: and it is pressable`)
  }

  // The entry this page was asked for, named literally: the shelf is data, but
  // the first thing on it is the reason the page exists, repository included.
  const first = app.read((tree) => cardsOf(tree).find((card) => text(card).includes('dsh-better-sidebar')))
  assert.ok(first, 'the sidebar workbench is on the shelf')
  assert.equal(
    partOf(first, 'smkit-gallery-page-name').props.href,
    'https://github.com/omdsh-dev/DSH-better-sidebar',
  )
  assert.ok(
    text(first).includes('dsh plugin --profile web add dsh-better-sidebar@latest'),
    'and its card carries the install line its README gives',
  )
})

it('copies the command from its card and holds the button for one second', async () => {
  const app = mount()
  app.openTab('tabPlugins')
  const [entry] = ENTRIES

  const idle = copyButtonOf(app, entry.name)
  assert.equal(text(idle), 'copy')
  await idle.props.onClick()
  await settle()

  // The clipboard really received this card's command, verbatim — and only it.
  assert.deepEqual(app.written, [entry.command], 'the click writes that one command')

  // The answer: the label reports it and the button holds it, which is what
  // stops a second press from starting a second copy inside the same second.
  const done = copyButtonOf(app, entry.name)
  assert.equal(text(done), 'copied', 'the button reports the copy it made')
  assert.equal(done.props.disabled, true, 'and refuses a second press while it reports')

  // The hold is the page's own second, taken from the timer it parked.
  app.effects()
  assert.deepEqual(app.timerDelays(), [1_000], 'the answer is held for exactly one second')
  app.flushTimers()

  // And it ends: the button is a button again, ready for the next copy.
  const back = copyButtonOf(app, entry.name)
  assert.equal(text(back), 'copy', 'the answer clears itself')
  assert.equal(back.props.disabled, false, 'and the button copies again')
})

it('says so when the clipboard refuses, and re-arms just the same', async () => {
  // A refused write is the other answer a copy can get: the command is still
  // on screen (the line selects whole on a click), so the button reports the
  // failure rather than pretending, and it comes back on the same second.
  const app = mount({ denied: true })
  app.openTab('tabPlugins')
  const [entry] = ENTRIES

  await copyButtonOf(app, entry.name).props.onClick()
  await settle()
  assert.deepEqual(app.written, [], 'nothing reached the clipboard')

  const failed = copyButtonOf(app, entry.name)
  assert.equal(text(failed), 'copyFailed')
  assert.equal(failed.props.disabled, true, 'the report is held in the button like the other answer')

  app.effects()
  assert.deepEqual(app.timerDelays(), [1_000])
  app.flushTimers()
  const back = copyButtonOf(app, entry.name)
  assert.equal(text(back), 'copy')
  assert.equal(back.props.disabled, false)
})

it('declares one description per catalogue entry in both dictionaries', () => {
  // The panel asks for `<id>Desc` per card and three keys for the button; a
  // missing key would render the key itself in the middle of a card, in one
  // language or the other.
  for (const locale of ['en', 'zh']) {
    const keys = dictionaryKeys(locale)
    for (const key of ['intro', 'copy', 'copied', 'copyFailed']) {
      assert.ok(keys.has(key), `i18n/${locale}.ts declares no ${key}`)
    }
    for (const entry of ENTRIES) {
      assert.ok(keys.has(`${entry.id}Desc`), `i18n/${locale}.ts declares no ${entry.id}Desc`)
    }
  }
})
