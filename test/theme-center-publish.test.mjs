/**
 * What the theme center mounts itself as, and everything it leaves alone.
 *
 * `dsh-theme` — a different plugin, one this repository's themes were ported
 * from — is the reason for every assertion here. Its two service names
 * (`ctx.provide('dshTheme', …)`, `window.dshTheme`) collide with Cordis, which
 * throws on a second registration of one name; that throw lands inside the
 * client entry's mount effect, so it used to take the whole entry down (`web
 * boot: 1 entry did not activate`). Its two localStorage keys and its `<style>`
 * id collide more quietly: the keys were read away on every boot, and the
 * element was reused and overwritten by whichever plugin mounted last.
 *
 * So the assertions run in both directions — this plugin's own names are used,
 * and `dsh-theme`'s are untouched. A rename that quietly reaches for the old
 * name again fails here.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'

const BUNDLE = fileURLToPath(new URL('../lib/client.js', import.meta.url))

/** A `document` with just the parts the mount effect touches. */
function fakeDocument() {
  const created = []
  const attrs = new Map()
  return {
    created,
    attrs,
    // The mount looks the swap element up by id and reuses what it finds, so
    // the stub has to answer from what it was actually asked to create —
    // `() => null` would let a duplicated element pass unnoticed.
    getElementById: (id) => created.find((el) => el.id === id) ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => {
      // `installStylesheet` writes `tag.dataset.smkitCss`; every real element
      // has a dataset, and a stub without one throws on the assignment instead
      // of on anything the test meant to check.
      const el = {
        id: '',
        dataset: {},
        textContent: '',
        style: {},
        remove() {
          const at = created.indexOf(this)
          if (at >= 0) created.splice(at, 1)
        },
      }
      created.push(el)
      return el
    },
    head: { appendChild: () => {} },
    body: {
      setAttribute: (name, value) => attrs.set(name, value),
      removeAttribute: (name) => attrs.delete(name),
      style: { setProperty: () => {}, removeProperty: () => {} },
    },
  }
}

/** A `localStorage` the plugin can read and write without a browser. */
function fakeStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

/**
 * Boot the real client bundle against a stub harness and report what it did.
 * @param {{ throwOn?: string, storage?: ReturnType<typeof fakeStorage> }} [options]
 *   - `throwOn` makes `provide` throw for one name, the way Cordis does when
 *   that service is already registered; `storage` lets a test arrive with keys
 *   already in the browser, which is how the migration is exercised.
 */
function harness(options = {}) {
  const source = readFileSync(BUNDLE, 'utf8')
  const provided = []
  const document = fakeDocument()
  const localStorage = options.storage ?? fakeStorage()
  const window = {
    __ModuleLoader__: {
      load: ({ factory }) => {
        exported = factory(() => ({
          createElement: (type, props) => ({ type, props: props ?? {} }),
          useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
          useEffect: () => {},
          useCallback: (fn) => fn,
        }))
      },
    },
  }
  let exported

  runInNewContext(source, {
    // The same object the bundle writes to — spreading a copy here would leave
    // the assertions reading a window the plugin never touched, and a check
    // that can never fail is worse than no check.
    window,
    document,
    localStorage,
    console,
    setInterval: () => 1,
    clearInterval: () => {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  })

  assert.ok(exported, 'the bundle must register itself through __ModuleLoader__')

  // A context that records everything the plugin publishes, and answers the
  // way Cordis answers: a second registration of one name throws.
  const ctx = {
    effect: (fn) => {
      fn()
      return () => {}
    },
    provide: (name, value) => {
      if (options.throwOn !== undefined && name === options.throwOn) {
        throw new Error(`service "${name}" has been registered at <dsh-theme>`)
      }
      provided.push({ name, value })
    },
    slots: {
      register: () => () => {},
      inject: (_name, cb) => cb(ctx),
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    sessions: {},
  }

  return { ctx, provided, document, window, localStorage, boot: () => exported.apply(ctx) }
}

it('publishes the API under the plugin’s own names', () => {
  const { boot, provided, ctx } = harness()
  boot()

  assert.ok(provided.length > 0, 'the mount must publish the API as a service')
  for (const entry of provided) {
    assert.equal(
      entry.name,
      'smkitTheme',
      `published under "${entry.name}" — dsh-theme owns "dshTheme", and Cordis throws on the collision`,
    )
  }
  assert.ok(ctx, 'context survived the mount')
})

it('leaves the dsh-theme window handle alone', () => {
  const { boot, window } = harness()
  boot()

  assert.ok(window.smkitTheme, 'the plugin must publish its own window handle')
  assert.equal(
    window.dshTheme,
    undefined,
    'window.dshTheme must not be written — it is dsh-theme’s object, and writing it replaces it silently',
  )
})

it('keeps the entry alive when the service name is taken', () => {
  const { boot } = harness({ throwOn: 'smkitTheme' })
  // Cordis throws on a duplicate registration. Losing the service is meant to
  // cost the publication, never the entry — so this must not rethrow.
  assert.doesNotThrow(() => boot())
})

it('reads its own old keys forward without touching another plugin’s', () => {
  const storage = fakeStorage()
  // A browser that has upgraded through every name this lineage ever carried,
  // plus a coexisting `dsh-theme` with its own saved choice.
  storage.setItem('smkit:skin', 'zcode')
  storage.setItem('dsh-theme-pack:theme', 'nord')
  storage.setItem('dsh-theme:theme', 'night-owl')
  storage.setItem('dsh-theme:mode', 'dark')

  const { boot, localStorage, document } = harness({ storage })
  boot()

  assert.equal(
    localStorage.getItem('smkit:theme'),
    'zcode',
    'the retired skin key is this center’s own and must be read forward',
  )
  assert.equal(localStorage.getItem('smkit:skin'), null, 'and then retired, since it is ours')
  assert.equal(
    document.attrs.get('data-smkit-theme'),
    'zcode',
    'the migrated choice has to reach the body, not just storage',
  )

  assert.equal(
    localStorage.getItem('dsh-theme:theme'),
    'night-owl',
    '`dsh-theme:theme` is `dsh-theme`’s LIVE key — reading it away clears a coexisting install’s chosen theme',
  )
  assert.equal(
    localStorage.getItem('dsh-theme:mode'),
    'dark',
    'same for `dsh-theme:mode` — deleting it flips that install back to system on its next boot',
  )
  assert.equal(
    localStorage.getItem('dsh-theme-pack:theme'),
    'nord',
    '`dsh-theme-pack:theme` is a name both plugins migrate from; the one that loads second must still find it',
  )
})

it('swaps its stylesheet in an element of its own', () => {
  const { boot, document } = harness()
  boot()

  const swap = document.created.find((el) => el.id === 'smkit-theme-active-style')
  assert.ok(
    swap,
    'the swap element must carry this plugin’s own id — `dsh-theme-active-style` is `dsh-theme`’s, and sharing it means whichever mounts last wipes the other’s sheet',
  )
  assert.equal(
    document.created.filter((el) => el.id === 'dsh-theme-active-style').length,
    0,
    'and the shared id must not be created at all',
  )
})
