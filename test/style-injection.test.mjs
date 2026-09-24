/**
 * The stylesheet injector's one guarantee, and the fact that it was broken.
 *
 * `installStylesheet` promises that a second call with the same name is a
 * no-op, because the client half is a single script the shell may evaluate more
 * than once — a hot reload, or an entry that re-activates. It keeps that
 * promise by keying each `<style>` with an attribute and looking for that
 * attribute first.
 *
 * The two halves drifted: the query took `data-smkit-css` while the writer
 * still assigned `dataset.pluginCss`, which is `data-plugin-css`. Nobody
 * noticed because the key is only load-bearing on a *second* mount — the first
 * one has nothing to find either way. So the assertion below is stated over two
 * loads, and the harness has to model the part that makes the two spellings
 * differ at all: `dataset` is camelCase, the attribute it writes is not.
 *
 * The fake `querySelector` therefore matches against the ATTRIBUTE an element
 * really carries, parsed back out of the camelCase key, and it refuses any
 * selector it was not written for. A stub that answered from a stored object
 * would pass whichever spelling the code happened to use, which is the one
 * thing this file must not do.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'

const BUNDLE = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const source = readFileSync(BUNDLE, 'utf8')

/** The attribute one `dataset` key writes: `smkitCss` -> `data-smkit-css`. */
const attributeOf = (key) => `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`

/**
 * A `document` that remembers what it was handed: a head that keeps its
 * children, a `dataset` that lands on attributes the way a browser's does, and
 * a `querySelector` that resolves the injector's one selector against them.
 */
function fakeDocument() {
  const styles = []
  const element = (tagName) => {
    const attrs = new Map()
    return {
      tagName,
      attrs,
      dataset: new Proxy(
        {},
        {
          set: (_target, key, value) => {
            attrs.set(attributeOf(String(key)), String(value))
            return true
          },
          get: (_target, key) => attrs.get(attributeOf(String(key))),
          has: (_target, key) => attrs.has(attributeOf(String(key))),
        },
      ),
      textContent: '',
      style: {},
      remove() {
        const at = styles.indexOf(this)
        if (at >= 0) styles.splice(at, 1)
      },
    }
  }
  return {
    /** What actually ended up in the head, in insertion order. */
    styles,
    head: { appendChild: (el) => styles.push(el) },
    createElement: element,
    querySelector(selector) {
      const match = /^style\[([a-z0-9-]+)="([^"]*)"\]$/.exec(selector)
      assert.ok(match, `the document only answers the injector's own selector, got: ${selector}`)
      return styles.find((el) => el.tagName === 'style' && el.attrs.get(match[1]) === match[2]) ?? null
    },
    getElementById: (id) => styles.find((el) => el.attrs.get('id') === id) ?? null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    body: {
      setAttribute: () => {},
      removeAttribute: () => {},
      style: { setProperty: () => {}, removeProperty: () => {} },
    },
  }
}

/** Evaluate the real client bundle once against `document`, as the shell does. */
function load(document) {
  runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          factory(() => ({
            createElement: (type, props) => ({ type, props: props ?? {} }),
            useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
            useEffect: () => {},
            useCallback: (fn) => fn,
          }))
        },
      },
    },
    document,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console,
    setInterval: () => 1,
    clearInterval: () => {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  })
}

/** The key one injected sheet carries, or undefined. */
const keyOf = (tag) => tag.attrs.get('data-smkit-css')

it('keys every sheet by the attribute its own de-dupe check looks for', () => {
  const document = fakeDocument()
  load(document)

  assert.ok(document.styles.length > 0, 'the mount must inject the platform sheet at least')
  for (const tag of document.styles) {
    assert.equal(
      tag.attrs.get('data-plugin-css'),
      undefined,
      'the key is `data-smkit-css`; `data-plugin-css` is the spelling a rename left behind, and writing it is what broke the check',
    )
    assert.equal(typeof keyOf(tag), 'string', 'every injected sheet must carry the key the injector queries for')
  }
})

it('adds one tag per sheet, however many times the bundle is evaluated', () => {
  const document = fakeDocument()
  load(document)
  const first = document.styles.length
  assert.ok(first > 0, 'the first load must inject something before a second one can stack it')

  load(document)
  assert.equal(
    document.styles.length,
    first,
    'a second mount must find the sheets already there — otherwise a hot reload stacks a duplicate of every rule in the plugin',
  )
})

it('keeps every sheet under its own namespaced key', () => {
  const document = fakeDocument()
  load(document)

  const names = document.styles.map(keyOf)
  assert.ok(names.includes('smkit/platform'), `the platform sheet is missing from ${JSON.stringify(names)}`)
  for (const name of names) assert.ok(name.startsWith('smkit/'), `every key must be namespaced, got "${name}"`)
  assert.equal(new Set(names).size, names.length, 'two sheets must not share one key')
})
