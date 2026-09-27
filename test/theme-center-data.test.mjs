/**
 * One theme is written down in four places, three of them by hand: its metadata
 * in `themes.data.json`, its rules in `themes/<id>.css`, its name and its
 * description in the two dictionaries, and the palette its card paints inside
 * the metadata again. Nothing at runtime compares them — `apply.ts` looks an id
 * up and falls back to a blank sheet, and the card falls back to the id itself —
 * so a missed half ships as a card that paints nothing, or that advertises a
 * palette the theme does not wear.
 *
 * The sheet pairing is what the split into `themes/` introduced: the rules used
 * to travel inside the entry, so an entry could not exist without them, and now
 * it can. The rule for the pair — the scope a sheet opens its blocks on, and
 * whether the palette it wears is the one the card paints — is deliberately not
 * written here: it lives in `scripts/theme-sheet-guard.mjs`, which
 * `scripts/build-theme-data.mjs` applies at publish time. This is the run that
 * makes it CI's business, with no second copy to drift from that one.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'
import { themeSheetViolations } from '../scripts/theme-sheet-guard.mjs'

const CENTER = fileURLToPath(new URL('../src/client/features/theme-center', import.meta.url))
const DATA = JSON.parse(readFileSync(`${CENTER}/themes.data.json`, 'utf8'))

it('pairs every entry with one stylesheet that paints the swatch it advertises', () => {
  const ids = new Set()
  for (const theme of DATA) {
    assert.ok(!ids.has(theme.id), `duplicate theme id: ${theme.id}`)
    ids.add(theme.id)
    assert.equal(
      theme.css,
      undefined,
      `${theme.id}: the rules belong in themes/${theme.id}.css — the data carries metadata only`,
    )
    const path = `${CENTER}/themes/${theme.id}.css`
    assert.ok(existsSync(path), `${theme.id}: themes/${theme.id}.css is missing`)
    const violations = themeSheetViolations(theme, readFileSync(path, 'utf8'))
    assert.deepEqual(violations, [], `\n${violations.join('\n')}\n`)
  }
  for (const file of readdirSync(`${CENTER}/themes`)) {
    if (!file.endsWith('.css')) continue
    const id = file.slice(0, -'.css'.length)
    assert.ok(ids.has(id), `themes/${file} has no entry in themes.data.json`)
  }
})

/** The keys one dictionary declares, in the `key: "…"` form the files use. */
function dictionaryKeys(locale) {
  const source = readFileSync(`${CENTER}/i18n/${locale}.ts`, 'utf8')
  const keys = [...source.matchAll(/^\s{2}"?([A-Za-z_][\w-]*)"?:\s*"/gm)].map((match) => match[1])
  return new Set(keys)
}

it('carries both names and both descriptions for every theme', () => {
  for (const locale of ['en', 'zh']) {
    const keys = dictionaryKeys(locale)
    for (const theme of DATA) {
      for (const prefix of ['name', 'desc']) {
        assert.ok(keys.has(`${prefix}_${theme.id}`), `i18n/${locale}.ts declares no ${prefix}_${theme.id}`)
      }
    }
  }
})
