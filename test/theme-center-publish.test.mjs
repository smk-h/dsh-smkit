/**
 * What the theme center mounts itself as, and everything it leaves alone.
 *
 * `dsh-theme` — a different plugin, one this repository's themes were ported
 * from — is the reason for every coexistence assertion here. Its two service
 * names (`ctx.provide('dshTheme', …)`, `window.dshTheme`) collide with Cordis,
 * which throws on a second registration of one name; that throw lands inside
 * the client entry's mount effect, so it used to take the whole entry down
 * (`web boot: 1 entry did not activate`). Its two localStorage keys and its
 * `<style>` id collide more quietly: the keys were read away on every boot, and
 * the element was reused and overwritten by whichever plugin mounted last.
 *
 * The second revision changed *how* this plugin paints — a theme became a layer
 * of token overrides stacked over the shell's active theme, plus one write that
 * pins the shell's preference to the half the theme is drawn for — so the
 * assertions moved with it: what used to be "the swap element carries our id" is
 * now "no swap element exists at all, ours or anyone's", and the mount is
 * checked for the layer it stacks and the preference it writes.
 *
 * The preference write is the one that carries a reload, and the harness has to
 * be honest about why: the shell keeps a *registered* id in memory but persists
 * only its own three preferences, so anything else it holds is replaced the next
 * time its durable settings scope lands. `adopt()` below is that moment, and one
 * test is nothing but it — the regression that made this revision necessary.
 * The coexistence half is unchanged in substance: our own names are used, and
 * `dsh-theme`'s are untouched.
 *
 * The harness's registry is small but not permissive: `setTheme` persists the
 * three built-in preferences and keeps anything else in memory, `adopt()`
 * rewrites the preference from what was persisted, and every accepted write
 * re-publishes a snapshot, the way `theme/change` does.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'

const BUNDLE = fileURLToPath(new URL('../lib/client.js', import.meta.url))

/** The layer the center stacks its own colors under. */
const THEME_LAYER = 'smkit:theme'

/** A `document` with just the parts the mount effect touches. */
function fakeDocument() {
  const created = []
  const attrs = new Map()
  return {
    created,
    attrs,
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

/** The preferences the shell persists; anything else it holds in memory alone. */
const BUILTIN_PREFERENCES = new Set(['light', 'dark', 'system'])

/**
 * A stand-in for the shell's theme registry, faithful in the three places the
 * plugin depends on: `setTheme` persists a built-in preference and keeps anything
 * else in memory, `overrideTokens` records the layer it was handed, and a write
 * re-publishes a snapshot the way `theme/change` does.
 *
 * `adopt()` is `ThemeRuntime.adopt` — the durable settings scope landing and
 * rewriting the in-memory preference from what it holds. A test calls it to say
 * "the settings finished loading"; a registered id would not survive that call,
 * which is the whole reason the center does not use one.
 */
function fakeThemeRegistry() {
  const layers = []
  const listeners = []
  let preference = 'system'
  let persisted = 'system'
  const snapshot = () => {
    const resolved = preference === 'system' ? 'dark' : preference
    return { preference, active: { id: resolved, colorScheme: resolved === 'light' ? 'light' : 'dark', tokens: {} }, themes: [], revision: 0 }
  }
  const publish = () => {
    for (const listener of [...listeners]) listener(snapshot())
  }
  return {
    layers,
    get preference() {
      return preference
    },
    get persisted() {
      return persisted
    },
    overrideTokens(source, tokens) {
      layers.push({ source, tokens })
      return () => {
        const at = layers.findIndex((layer) => layer.source === source && layer.tokens === tokens)
        if (at >= 0) layers.splice(at, 1)
      }
    },
    setTheme(id) {
      if (preference === id) return
      preference = id
      if (BUILTIN_PREFERENCES.has(id)) persisted = id
      publish()
    },
    /** The durable scope landing: the shell rewrites its preference from it. */
    adopt() {
      if (preference === persisted) return
      preference = persisted
      publish()
    },
    subscribe(listener) {
      listeners.push(listener)
      return () => {
        const at = listeners.indexOf(listener)
        if (at >= 0) listeners.splice(at, 1)
      }
    },
  }
}

/** The layers currently stacked under a source, oldest first. */
function layersOf(theme, source) {
  return theme.layers.filter((layer) => layer.source === source)
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
  const theme = fakeThemeRegistry()
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
    on: (event, handler) => {
      if (event === 'theme/change') return theme.subscribe(handler)
      return () => {}
    },
    theme,
    slots: {
      register: () => () => {},
      inject: (_name, cb) => cb(ctx),
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    sessions: {},
  }

  return { ctx, provided, document, window, localStorage, theme, boot: () => exported.apply(ctx) }
}

it('stacks the theme’s colors as a layer of its own', () => {
  const storage = fakeStorage()
  storage.setItem('smkit:theme', 'one-dark-pro')
  const { boot, theme } = harness({ storage })
  boot()

  const stacked = layersOf(theme, THEME_LAYER)
  assert.equal(stacked.length, 1, 'the applied theme must reach the shell as exactly one layer')
  const tokens = stacked[0].tokens
  assert.ok(Object.keys(tokens).length > 0, 'the layer carries the tokens the theme repaints')
  for (const [token, pair] of Object.entries(tokens)) {
    assert.ok(token.startsWith('--'), `${token}: a layer key is a custom property`)
    assert.equal(
      pair.light,
      pair.dark,
      `${token}: a theme here is one palette, so both halves repeat its value — a layer that answered per half would follow the OS`,
    )
  }
})

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

it('remembers the choice through the shell and marks the body for its own rules', () => {
  const { boot, document, theme, localStorage, window } = harness()
  boot()

  // No stored choice: the mount must leave the shell's own preference alone
  // rather than claiming one.
  assert.equal(theme.preference, 'system', 'a fresh browser must not switch the shell’s theme')
  assert.equal(
    document.attrs.get('data-smkit-theme'),
    undefined,
    'and the structural attribute stays off — no theme of ours is active',
  )

  window.smkitTheme.set('one-dark-pro')

  assert.equal(
    theme.preference,
    'dark',
    'the theme pins the shell to the half it is drawn for — the one preference the shell persists for us',
  )
  assert.equal(
    document.attrs.get('data-smkit-theme'),
    'one-dark-pro',
    'and the attribute the structural sheet is scoped on follows it',
  )
  assert.equal(
    localStorage.getItem('smkit:theme'),
    'one-dark-pro',
    'the center’s own id is remembered — the shell’s storage only accepts its own preferences',
  )

  window.smkitTheme.reset()

  assert.equal(theme.preference, 'system', 'reset hands the preference back to the shell')
  assert.equal(
    document.attrs.get('data-smkit-theme'),
    undefined,
    'and takes the structural attribute with it',
  )
})

it('survives the shell adopting its durable preference', () => {
  const storage = fakeStorage()
  storage.setItem('smkit:theme', 'one-dark-pro')
  const { boot, theme, document } = harness({ storage })
  boot()

  assert.equal(theme.preference, 'dark', 'the restored theme pins the half it is drawn for')
  assert.equal(theme.persisted, 'dark', 'and that half is the part the shell actually stores')

  // The durable settings scope lands. A registered theme would be rewritten to
  // the shell's own preference here and the screen would fall back to it while
  // the row still showed the theme as selected — the bug this shape exists for.
  theme.adopt()

  assert.equal(theme.preference, 'dark', 'adopting the stored preference must leave the theme in force')
  assert.equal(layersOf(theme, THEME_LAYER).length, 1, 'and its colors must stay stacked')
  assert.equal(
    document.attrs.get('data-smkit-theme'),
    'one-dark-pro',
    'and the structural attribute must stay on the body',
  )
})

it('stands down when the shell’s appearance row moves off the theme’s half', () => {
  const storage = fakeStorage()
  storage.setItem('smkit:theme', 'one-dark-pro')
  const { boot, theme, document, localStorage } = harness({ storage })
  boot()

  assert.equal(theme.preference, 'dark', 'the restored theme starts pinned to its half')

  // The user picks Light in Settings → General. The center only ever writes
  // `dark`, so this value came from someone else — a choice to leave the theme.
  theme.setTheme('light')

  assert.equal(localStorage.getItem('smkit:theme'), null, 'the stored choice goes with it')
  assert.equal(layersOf(theme, THEME_LAYER).length, 0, 'and the colors come off the shell')
  assert.equal(
    document.attrs.get('data-smkit-theme'),
    undefined,
    'and the body stops being marked for the theme’s own rules',
  )
})

it('reads its own old keys forward without touching another plugin’s', () => {
  const storage = fakeStorage()
  // A browser that has upgraded through every name this lineage ever carried,
  // plus a coexisting `dsh-theme` with its own saved choice.
  storage.setItem('smkit:skin', 'one-dark-pro')
  storage.setItem('dsh-theme-pack:theme', 'nord')
  storage.setItem('dsh-theme:theme', 'night-owl')
  storage.setItem('dsh-theme:mode', 'dark')

  const { boot, localStorage, document, theme } = harness({ storage })
  boot()

  assert.equal(
    localStorage.getItem('smkit:theme'),
    'one-dark-pro',
    'the retired skin key is this center’s own and must be read forward',
  )
  assert.equal(localStorage.getItem('smkit:skin'), null, 'and then retired, since it is ours')
  assert.equal(
    theme.preference,
    'dark',
    'the migrated choice has to reach the shell, not just storage',
  )
  assert.equal(
    document.attrs.get('data-smkit-theme'),
    'one-dark-pro',
    'and the structural attribute has to reach the body',
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

it('lets an id the center no longer ships fall back to the shell’s palettes', () => {
  const storage = fakeStorage()
  // A browser that still remembers a theme this revision retired. It must land
  // on the shell's own preference rather than on a half state, and it must not
  // mark the body for a structural sheet that is not there any more.
  storage.setItem('smkit:theme', 'zcode-dark')

  const { boot, theme, document } = harness({ storage })
  boot()

  assert.equal(theme.preference, 'system', 'a retired id must not switch the shell’s theme')
  assert.equal(layersOf(theme, THEME_LAYER).length, 0, 'and must not stack a color layer')
  assert.equal(
    document.attrs.get('data-smkit-theme'),
    undefined,
    'and must not mark the body',
  )
})

it('paints no stylesheet of its own: the shell carries the themes', () => {
  const { boot, document } = harness()
  boot()

  for (const id of ['smkit-theme-active-style', 'dsh-theme-active-style']) {
    assert.equal(
      document.created.filter((el) => el.id === id).length,
      0,
      `${id} must not be created — a theme is a token table and the shell writes it; sharing dsh-theme’s id means whichever mounts last wipes the other’s rules`,
    )
  }
})
