/**
 * One theme is written down in three places, two of them by hand: its metadata
 * in `themes.data.json`, its colors in a table under `tokens/`, and its name
 * and description in the two dictionaries. Nothing at runtime compares them —
 * `apply.ts` looks an id up and registers whatever table it finds, and the card
 * falls back to the id itself — so a missed half ships as a card that paints
 * nothing, or that advertises a palette the theme does not wear.
 *
 * The pairing rule is what this file owns, and it is not written here: it lives
 * in `scripts/theme-sheet-guard.mjs`, which `scripts/build-theme-data.mjs`
 * applies at publish time. This is the run that makes it CI's business, with no
 * second copy to drift from that one.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'
import { importedTables, themeTableViolations, tokenTableOf } from '../scripts/theme-sheet-guard.mjs'

const CENTER = fileURLToPath(new URL('../src/client/features/theme-center', import.meta.url))
const DATA = JSON.parse(readFileSync(`${CENTER}/themes.data.json`, 'utf8'))
const MODULE = readFileSync(`${CENTER}/themes.data.ts`, 'utf8')

it('pairs every entry with the token table that paints the swatch it advertises', () => {
  const ids = new Set()
  const claimed = new Set()
  for (const theme of DATA) {
    assert.ok(!ids.has(theme.id), `duplicate theme id: ${theme.id}`)
    ids.add(theme.id)
    assert.equal(
      theme.css,
      undefined,
      `${theme.id}: the colors belong in tokens/ — the data carries metadata only`,
    )
    const specifier = tokenTableOf(MODULE, theme.id)
    assert.ok(specifier, `${theme.id}: themes.data.ts maps no token table for it`)
    claimed.add(specifier)
    const path = `${CENTER}/${specifier.replace('./', '')}.ts`
    assert.ok(existsSync(path), `${theme.id}: ${specifier}.ts is missing`)
    const violations = themeTableViolations(theme, readFileSync(path, 'utf8'))
    assert.deepEqual(violations, [], `\n${violations.join('\n')}\n`)
  }
  for (const specifier of importedTables(MODULE)) {
    assert.ok(
      claimed.has(specifier),
      `${specifier} is imported by the TOKENS map but no entry maps it — a table nothing selects is dead weight`,
    )
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
