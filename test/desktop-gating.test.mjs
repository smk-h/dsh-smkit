/**
 * The Desktop gate: what the plugin does in the Electron shell, and what it
 * must keep doing everywhere else.
 *
 * The notifications feature is switched off on the Desktop profile, in both
 * halves, and the settings page drops its tab there. Every one of those three
 * decisions is a `false` away from taking the web down with it, so each is
 * asserted from both sides here: the Desktop answer, and the answer the same
 * code gives the browser.
 *
 * The two halves ask the question through the only channel each one has — the
 * host reads the profile name the harness publishes (`profileContext`), the
 * client reads the document's scheme — so neither test can stand in for the
 * other, and neither may drift into being the web's gate as well.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, it } from 'node:test'

const { isDesktopProfile, profileNameOf } = await import('../lib/host/platform/desktop.js')
const { notifyFeature } = await import('../lib/host/features/notify/host.js')

/** A host context that answers `profileContext` like the real boot does. */
function contextWith(profile) {
  const events = []
  const ctx = {
    get: (name) => (name === 'profileContext' && profile !== null ? { name: profile } : undefined),
    on: (event) => {
      events.push(event)
      return () => {}
    },
    effect: (callback) => {
      callback()
      return {}
    },
    inject: () => ({ dispose: () => {} }),
  }
  return { ctx, events }
}

/** Mount the notify host feature on a stub platform and hand back what it left. */
function mountHost(profile) {
  const { ctx, events } = contextWith(profile)
  const logged = []
  const platform = {
    logger: { info: (line) => logged.push(line), warn: () => {} },
    tools: {},
    services: {},
    ctx,
    outsideApi: [],
    handlers: [],
  }
  notifyFeature.mount(platform)
  return { handlers: platform.handlers, events, logged }
}

describe('the Desktop profile is read off the harness, never inferred', () => {
  it('names the profile the harness published', () => {
    assert.equal(profileNameOf(contextWith('desktop').ctx), 'desktop')
    assert.equal(profileNameOf(contextWith('web').ctx), 'web')
  })

  it('reads an unhelpful host as "not the Desktop"', () => {
    // A host that answers nothing, answers garbage, or cannot be asked at all
    // must all land on the web answer: the gate may never fire by accident.
    assert.equal(isDesktopProfile({}), false)
    assert.equal(isDesktopProfile({ get: () => undefined }), false)
    assert.equal(isDesktopProfile({ get: () => null }), false)
    assert.equal(isDesktopProfile({ get: () => ({ name: 7 }) }), false)
    assert.equal(isDesktopProfile({ get: () => ({ name: '' }) }), false)
    assert.equal(
      isDesktopProfile({
        get: () => {
          throw new Error('no such service')
        },
      }),
      false,
    )
  })

  it('accepts the name however it was spelled, and nothing like it', () => {
    assert.equal(isDesktopProfile(contextWith('Desktop').ctx), true)
    assert.equal(isDesktopProfile(contextWith('desktop').ctx), true)
    // The names the neighbouring profiles actually wear, plus the one a
    // substring match would have swallowed.
    for (const name of ['web', 'headless', 'acp', 'sdk', 'desktop-dev', 'my-desktop']) {
      assert.equal(isDesktopProfile(contextWith(name).ctx), false, name)
    }
  })
})

describe('the notify host feature mounts only where it can work', () => {
  it('contributes no route and hears no event on the Desktop profile', () => {
    const { handlers, events, logged } = mountHost('desktop')
    assert.deepEqual(handlers, [], 'the Desktop profile must get no /notify route')
    assert.deepEqual(events, [], 'the Desktop profile must get no session listener')
    assert.equal(logged.length, 1, 'the stand-down is logged once, for diagnostics')
  })

  it('mounts whole on every other profile', () => {
    const { handlers, events } = mountHost('web')
    assert.ok(handlers.length > 0, 'the web profile still gets its routes')
    assert.ok(events.length > 0, 'the web profile still gets its listeners')
  })
})

/* ------------------------------------------------------------------ client */

/**
 * The bundle as the page sees it: a VM with a `window`, a `fetch` and — the
 * only thing this suite varies — a `location`, since that is the whole of the
 * client half's Desktop test. Nothing here renders a panel: the section
 * component is called once to get its element tree, which is all the tab strip
 * needs to be read off it.
 */
function mountClient(protocol) {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const labels = []
  const registrations = new Map()
  const states = new Map()
  let exported
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: (initial) => [states.has('state') ? states.get('state') : typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (callback) => callback,
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react) } } },
    // `protocol: undefined` is the Node harness the other suites run in: no
    // document, no scheme, no Desktop.
    location: protocol === undefined ? undefined : { protocol },
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }),
    setInterval: () => 1,
    clearInterval: () => {},
  })
  exported.apply({
    effect(fn, label) {
      labels.push(label)
      return fn() ?? (() => {})
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => registrations.set(options.id, component),
    },
  })
  return { tabs: tabIds(registrations.get('mcp-manager')), labels }
}

/** Every tab id the section's strip was built with, found by walking the tree. */
function tabIds(element) {
  const found = []
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node !== 'object' || node === null) return
    if (Array.isArray(node.props?.tabs)) found.push(...node.props.tabs.map((tab) => tab.id))
    walk(node.children)
  }
  walk(element())
  return found
}

const NOTIFY_EFFECTS = ['smkit: notify/heartbeat', 'smkit: notify/web-delivery']

describe('the client half stands down only in the Desktop shell', () => {
  it('drops the notifications tab and both effects in the shell', () => {
    const { tabs, labels } = mountClient('dsh-app:')
    assert.ok(tabs.length > 0, 'the section still builds its strip')
    assert.ok(!tabs.includes('notify'), `the Desktop shell must not offer the tab: ${tabs.join(', ')}`)
    for (const label of NOTIFY_EFFECTS) {
      assert.ok(!labels.includes(label), `the Desktop shell must not register ${label}`)
    }
    // The other pages are untouched: the gate is one tab, not the section.
    assert.ok(tabs.includes('mcp') && tabs.includes('sessions'))
  })

  for (const protocol of ['http:', 'https:', undefined]) {
    it(`keeps the tab and both effects on ${protocol ?? 'a document-less harness'}`, () => {
      const { tabs, labels } = mountClient(protocol)
      assert.ok(tabs.includes('notify'), `the web must keep the tab: ${tabs.join(', ')}`)
      for (const label of NOTIFY_EFFECTS) {
        assert.ok(labels.includes(label), `the web must keep ${label}`)
      }
    })
  }
})
