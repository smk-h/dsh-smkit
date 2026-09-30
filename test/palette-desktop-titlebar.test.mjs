/**
 * The palette panel's seat on the Windows desktop.
 *
 * The panel is `position: fixed`, so its `top` is measured from the viewport —
 * but the desktop pads the whole app frame under its caption row, and that
 * padding is exactly the offset a viewport-anchored number is missing. The
 * panel therefore came up 40px too high, over the conversation header's own row
 * of buttons, where the web shell (no caption to clear) read the same number as
 * the seat under that header.
 *
 * The guarantee worth pinning is the shape of the correction: the seat is
 * stated once, the caption height is read only behind
 * `html[data-windows-titlebar]`, and the declaration the web shell reads is the
 * one from before. The first two assertions are what keep the web sheet exactly
 * what it was — a selector that cannot match where the attribute never arrives —
 * and this file is where that stops being an intention and starts being a test.
 * (`workbench-windows-titlebar.test.mjs` pins the same guarantee for the card
 * skin's frame, which had the mirror-image problem.)
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'

const SHEET = fileURLToPath(new URL('../src/client/features/theme-center/style/palette.css', import.meta.url))
const source = readFileSync(SHEET, 'utf8')

/** The attribute the desktop preload writes on `document.documentElement`; the
 * panel's own rules are on a class, which is why this prefix is the guard. */
const DESKTOP_GUARD = 'html[data-windows-titlebar]'
const CAPTION_HEIGHT = '--dsh-windows-titlebar-height'
const SEAT = '--smkit-palette-panel-seat'
const BASE_SELECTOR = '.smkit-theme-palette-panel'
/** The one number the web shell reads, restated here so a silent edit fails. */
const WEB_SEAT = '56px'

const normalize = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * The sheet's top-level rule blocks, comments removed first so a property named
 * in a docblock is never read as a declaration. The sheet has no nested
 * conditionals today and the parser below is only honest for that shape, so the
 * assumption is asserted rather than assumed.
 */
function ruleBlocks(css) {
  const commentless = css.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(
    !/@(media|supports|layer|container)\b/.test(commentless),
    'this parser only reads top-level rules; extend it before nesting one in palette.css',
  )
  const blocks = []
  const open = []
  let cursor = 0
  for (let index = 0; index < commentless.length; index += 1) {
    const character = commentless[index]
    if (character === '{') {
      open.push({ selector: normalize(commentless.slice(cursor, index)), start: index + 1 })
      cursor = index + 1
    } else if (character === '}') {
      const block = open.pop()
      assert.ok(block !== undefined, 'unbalanced braces in palette.css')
      blocks.push({ selector: block.selector, body: commentless.slice(block.start, index), index: block.start })
      cursor = index + 1
    }
  }
  assert.equal(open.length, 0, 'unbalanced braces in palette.css')
  return blocks
}

const rules = ruleBlocks(source)
const base = rules.find((rule) => rule.selector === BASE_SELECTOR)
const captionRules = rules.filter((rule) => rule.body.includes(CAPTION_HEIGHT))

it('states the seat once, and leaves the caption out of the web shell’s declaration', () => {
  assert.ok(base !== undefined, 'the panel base rule is gone')
  assert.match(normalize(base.body), new RegExp(`${SEAT}: ${WEB_SEAT}`), 'the web seat moved')
  assert.match(normalize(base.body), new RegExp(`top: var\\(${SEAT}\\)`), 'the base rule must read the seat')
  assert.ok(
    !base.body.includes(CAPTION_HEIGHT),
    'the base rule the web shell reads must not know the caption exists',
  )
})

it('reads the caption height only under html[data-windows-titlebar]', () => {
  assert.ok(captionRules.length > 0, 'the desktop seat override is gone')
  for (const rule of captionRules) {
    assert.ok(
      rule.selector.startsWith(DESKTOP_GUARD),
      `a rule reading ${CAPTION_HEIGHT} would also fire on the web shell: ${rule.selector}`,
    )
  }
})

it('seats the panel at the caption height plus that same seat', () => {
  const override = captionRules.find((rule) => rule.selector.includes(BASE_SELECTOR))
  assert.ok(override !== undefined, 'no desktop override states the panel’s own top')
  assert.match(
    normalize(override.body),
    new RegExp(`top: calc\\(var\\(${CAPTION_HEIGHT}\\) \\+ var\\(${SEAT}\\)\\)`),
    'the desktop top must be the caption height added to the same seat, not a second literal',
  )
  assert.ok(override.index > base.index, 'the seat override must follow the rule it corrects')
})
