/**
 * The update button, driven through the real client bundle on the merged
 * section's hook harness.
 *
 * What is asserted is the crossing the file exists for: the button the section
 * renders above its tab strip reaches the check route, shows a turning arc
 * while it waits, and each answer it can get ends up on screen — "already
 * latest" as a line, "update available" as a dialog carrying the exact command,
 * a copy button that really writes to the clipboard, and the Desktop's
 * no-command variant.
 *
 * Nothing is installed from here, and nothing is scheduled: every case starts
 * with a click, and `settle()` is the request coming back.
 *
 * Harness discipline (same as `plugin-gallery-panel.test.mjs`): hooks are handed
 * out on one flat cursor, and **one pass is one walk** — a tree may not be
 * walked twice, because the second walk would re-invoke the components at
 * whatever cursor the first one left behind.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { it } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** The `t` this suite renders with: identity, so assertions name the key. */
const t = (key) => key

/** One HTTP answer in the shape the client's `api()` helper expects. */
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })

const settle = () => new Promise((resolve) => setImmediate(resolve))

/** The command the host would hand over for a web profile. */
const COMMAND = 'dsh plugin --profile web add @smai-kit/dsh-smkit@1.16.0'

/** Whether one node wears a class, among however many it wears. */
const hasClass = (node, name) => String(node.props?.className ?? '').split(/\s+/).includes(name)

/**
 * One pass over a rendered tree: every readable string, every element, and the
 * button whose label is one of the section's dictionary keys.
 *
 * The walk happens once and its results are reused, which is the rule this
 * harness has: expanding a component a second time reads another component's
 * hook slots.
 */
function inspect(tree) {
  const strings = []
  const elements = []
  const walk = (node) => {
    if (node === null || node === undefined) return
    if (typeof node === 'string') {
      strings.push(node)
      return
    }
    if (typeof node !== 'object') return
    if (typeof node.type === 'function') {
      walk(node.type(node.props))
      return
    }
    elements.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return {
    text: strings.join(' '),
    elements,
    button(label) {
      const found = elements.find((node) => node.type === 'button' && node.children?.includes(label))
      assert.ok(found, `the section must render a ${label} button; saw ${JSON.stringify(elements.filter((n) => n.type === 'button').map((n) => n.children))}`)
      return found
    },
  }
}

/**
 * Mount the real bundle and the merged section on a hook harness.
 *
 * `answers` is the queue the stubbed `fetch` reads from; an entry may be a
 * promise, which is how a case holds a check open to look at the spinner.
 * `copied` records what the clipboard received.
 */
function mount(answers) {
  const registrations = new Map()
  const calls = []
  const copied = []
  const states = []
  let cursor = 0
  let exported
  const react = {
    createElement: (type, props, ...children) => {
      const kids = children.flat(Infinity)
      return { type, props: { ...props, children: kids }, children: kids }
    },
    useState: (initial) => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [
        states[index],
        (value) => {
          states[index] = typeof value === 'function' ? value(states[index]) : value
        },
      ]
    },
    useEffect: () => {},
    useCallback: (callback) => callback,
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react) } } },
    navigator: {
      clipboard: {
        writeText: async (value) => {
          copied.push(value)
        },
      },
    },
    fetch: async (url, options) => {
      calls.push({ url: String(url), method: options?.method ?? 'GET' })
      const next = answers.shift() ?? response({})
      return typeof next === 'function' ? next() : next
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
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
    calls,
    copied,
    /** One whole render pass, read once. */
    read() {
      cursor = 0
      return inspect(section())
    },
  }
}

it('turns an arc in the button while the check is in flight', async () => {
  let release
  const harness = mount([
    () =>
      new Promise((resolve) => {
        release = () => resolve(response({ current: '1.14.0', latest: '1.14.0', hasUpdate: false }))
      }),
  ])

  harness.read().button('updateCheck').props.onClick()
  const waiting = harness.read()
  assert.match(waiting.text, /updateChecking/, 'the label says it is checking')

  const spinning = waiting.elements.filter((node) => hasClass(node, 'smkit-ui-spin'))
  assert.ok(spinning.length > 0, 'the spinner must be drawn while the request is open')
  // Inside the button, not beside it: the button's own children carry it.
  const checking = waiting.button('updateChecking')
  assert.ok(
    checking.children.some((child) => child !== null && typeof child === 'object'),
    'the arc is a child of the button, so the box does not grow a second control',
  )

  release()
  await settle()
  assert.deepEqual(harness.calls, [{ url: '/smkit/api/update/check', method: 'GET' }])
})

it('reports that there is nothing to install', async () => {
  const harness = mount([response({ current: '1.14.0', latest: '1.14.0', hasUpdate: false })])

  harness.read().button('updateCheck').props.onClick()
  await settle()

  const drawn = harness.read().text
  assert.match(drawn, /updateLatest/)
  assert.doesNotMatch(drawn, /updateTitle/)
})

it('hands over the install command instead of installing', async () => {
  const harness = mount([
    response({ current: '1.14.0', latest: '1.16.0', hasUpdate: true, installCommand: COMMAND }),
  ])

  harness.read().button('updateCheck').props.onClick()
  await settle()

  const prompted = harness.read()
  assert.match(prompted.text, /updateTitle/)
  assert.match(prompted.text, /updateBody/)
  assert.ok(prompted.text.includes(COMMAND), 'the dialog must print the command verbatim')

  // One request only: the dialog is the end of the wire, nothing is posted.
  assert.deepEqual(harness.calls, [{ url: '/smkit/api/update/check', method: 'GET' }])
})

it('copies the command and says so', async () => {
  const harness = mount([
    response({ current: '1.14.0', latest: '1.16.0', hasUpdate: true, installCommand: COMMAND }),
  ])

  harness.read().button('updateCheck').props.onClick()
  await settle()
  harness.read().button('updateCopy').props.onClick()
  await settle()

  assert.deepEqual(harness.copied, [COMMAND])
  const after = harness.read()
  assert.match(after.text, /updateCopied/, 'the button reports the copy')
  assert.equal(after.button('updateCopied').props.disabled, true, 'and a second click cannot repeat it')
})

it('closes without copying anything', async () => {
  const harness = mount([
    response({ current: '1.14.0', latest: '1.16.0', hasUpdate: true, installCommand: COMMAND }),
  ])

  harness.read().button('updateCheck').props.onClick()
  await settle()
  harness.read().button('updateClose').props.onClick()
  await settle()

  assert.deepEqual(harness.copied, [])
  assert.doesNotMatch(harness.read().text, /updateTitle/)
})

it('offers no command where the profile is not a terminal away (Desktop)', async () => {
  const harness = mount([response({ current: '1.14.0', latest: '1.16.0', hasUpdate: true })])

  harness.read().button('updateCheck').props.onClick()
  await settle()

  const drawn = harness.read()
  assert.match(drawn.text, /updateBodyNoCommand/)
  assert.equal(drawn.button('updateCopy').props.disabled, true, 'nothing to copy, no button to press')
})

it('reports a failed check instead of pretending the plugin is current', async () => {
  const harness = mount([response({ current: '1.14.0', latest: null, hasUpdate: false, error: 'ENOTFOUND' })])

  harness.read().button('updateCheck').props.onClick()
  await settle()

  const drawn = harness.read().text
  assert.match(drawn, /updateFailed/)
  assert.doesNotMatch(drawn, /updateLatest/)
})
