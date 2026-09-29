/**
 * The card skin's desktop guarantee: the Windows caption row keeps its seat.
 *
 * The skin's frame rule pads the frame the way the editor frames its parts, and
 * it states that padding as the shorthand. On the desktop the shorthand is not a
 * margin but a collision: ui-layout's `[data-windows-titlebar] .frame` puts the
 * caption row (the native menu bar plus the sidebar's brand strip) in the frame's
 * own `padding-top`, at the 40px the desktop preload writes on the root, and
 * paints its band with a `.frame::before` that reads the variable and never
 * follows this padding. Clearing the seat lifted every column 34px under a band
 * that stayed put, while the web shell — no preload, no attribute, no band — read
 * the same rule as the gutter it was written to be.
 *
 * So the fix is a second rule, and the guarantee worth pinning is the shape of
 * it: every reference to the caption height sits behind `html[data-windows-titlebar]`,
 * and the seat comes back at that height plus the skin's own gutter. The first
 * assertion is the one that keeps the web skin exactly what it was — a selector
 * that cannot match where the attribute never arrives — and this file is where
 * that stops being an intention and starts being a test.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'

const SHEET = fileURLToPath(new URL('../src/client/features/theme-center/style/workbench.css', import.meta.url))
const source = readFileSync(SHEET, 'utf8')

/** The attribute the desktop preload writes on `document.documentElement`; the
 * sheet's own anchors are on the body, which is why this prefix is the guard. */
const DESKTOP_GUARD = 'html[data-windows-titlebar]'
const CAPTION_HEIGHT = '--dsh-windows-titlebar-height'
const GUTTER = '--smkit-workbench-pad'
const FRAME_SELECTOR = "body[data-smkit-workbench='card'] div:has(> [data-shell-overlay])"

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
    'this parser only reads top-level rules; extend it before nesting one in workbench.css',
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
      assert.ok(block !== undefined, 'unbalanced braces in workbench.css')
      blocks.push({ selector: block.selector, body: commentless.slice(block.start, index), index: block.start })
      cursor = index + 1
    }
  }
  assert.equal(open.length, 0, 'unbalanced braces in workbench.css')
  return blocks
}

const rules = ruleBlocks(source)
const captionRules = rules.filter((rule) => rule.body.includes(CAPTION_HEIGHT))

it('states the caption height only under html[data-windows-titlebar], so the web shell cannot match it', () => {
  assert.ok(captionRules.length > 0, 'the desktop seat override is gone')
  for (const rule of captionRules) {
    assert.ok(
      rule.selector.startsWith(DESKTOP_GUARD),
      `a rule reading ${CAPTION_HEIGHT} would also fire on the web shell: ${rule.selector}`,
    )
  }
})

it('restores the seat at the host height plus the skin gutter', () => {
  const seat = captionRules.find((rule) => rule.body.includes('padding-top'))
  assert.ok(seat !== undefined, 'the seat override states no padding-top')
  assert.match(
    normalize(seat.body),
    new RegExp(`padding-top: calc\\(var\\(${CAPTION_HEIGHT}\\) \\+ var\\(${GUTTER}\\)\\)`),
  )
})

it('leaves the frame gutter owning the other three sides, with the override after it', () => {
  const gutter = rules.find((rule) => rule.selector === FRAME_SELECTOR)
  assert.ok(gutter !== undefined, 'the frame gutter rule is gone')
  assert.match(normalize(gutter.body), new RegExp(`padding: var\\(${GUTTER}\\)`))
  assert.match(normalize(gutter.body), /gap: var\(--smkit-workbench-gap\)/)
  assert.ok(captionRules[0].index > gutter.index, 'the seat override must follow the rule it corrects')
})
