/**
 * The boot splash's paint is written down twice — once as the colour in the
 * theme's own table (which `theme-sheet-guard.mjs` checks against the swatch the
 * card advertises, by reading the table's text) and once as the map the host
 * inlines into the boot HTML — and nothing at runtime compares them: the host
 * renders that HTML before any client bundle exists, so a re-tuned canvas would
 * otherwise ship a splash in the colour the theme used to have.
 *
 * This is that comparison, plus the shape of the row the shell renders: one head
 * script, one line, no token of the application's touched.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'
import { tokenTableOf } from '../scripts/theme-sheet-guard.mjs'
import { THEME_CANVAS, bootPaintRows, bootPaintScript } from '../lib/index.js'

const CENTER = fileURLToPath(new URL('../src/client/features/theme-center', import.meta.url))
const DATA = JSON.parse(readFileSync(`${CENTER}/themes.data.json`, 'utf8'))
const MODULE = readFileSync(`${CENTER}/themes.data.ts`, 'utf8')

/** The canvas one theme's table paints, read the way the guard reads a table: as text. */
function canvasOf(id) {
  const specifier = tokenTableOf(MODULE, id)
  assert.ok(specifier, `${id}: themes.data.ts maps no token table for it`)
  const table = readFileSync(`${CENTER}/${specifier.replace('./', '')}.ts`, 'utf8')
  const match = table.match(/'--dsw-alias-bg-base':\s*'(#[0-9a-fA-F]{3,8})'/)
  assert.ok(match, `${id}: its table names no --dsw-alias-bg-base`)
  return match[1]
}

it('paints the boot splash in the canvas its own theme declares', () => {
  for (const theme of DATA) {
    assert.equal(
      THEME_CANVAS[theme.id],
      canvasOf(theme.id),
      `${theme.id}: the boot canvas and the theme's own --dsw-alias-bg-base disagree, so the splash would paint the colour this theme used to have`,
    )
  }
})

it('contributes one head script that names the splash and asks the browser', () => {
  const rows = bootPaintRows()
  assert.equal(rows.length, 1, 'the boot table takes one row from this plugin')
  const [row] = rows
  assert.equal(row.kind, 'script')
  assert.equal(row.placement, 'head')
  assert.ok(row.text.includes(JSON.stringify(THEME_CANVAS)), 'the map has to travel with the script')
  assert.ok(row.text.includes('smkit:theme'), 'the browser is the one that knows which theme is on')
  assert.ok(row.text.includes('html [data-dsh-boot]{background:'), 'the rule has to aim at the splash element')
  assert.ok(!row.text.includes('</script>'), 'a closing tag inside the row would end the element early')
  assert.ok(!row.text.includes('\n'), 'one line, so the served HTML keeps its shape')
})

it('contributes nothing when the center ships no canvas to paint', () => {
  assert.deepEqual(bootPaintRows({}), [])
  assert.ok(bootPaintScript({}).includes('!canvas'), 'a script with an empty map still has to give up quietly')
})
