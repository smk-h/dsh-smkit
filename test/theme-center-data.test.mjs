/**
 * One theme is written down in four places, three of them by hand: its metadata
 * in `themes.data.json`, its rules in `themes/<id>.css`, its name and its
 * description in the two dictionaries, and the palette its card paints inside
 * the metadata again. Nothing at runtime compares them — `apply.ts` looks an id
 * up and falls back to a blank sheet, and the card falls back to the id itself —
 * so a missed half ships as a card with no paint, or with its id for a title.
 *
 * The sheet pairing is what the split into `themes/` introduced: the rules used
 * to travel inside the entry, so an entry could not exist without them. It can
 * now, and an entry whose sheet is missing, misnamed or scoped on the wrong
 * attribute paints nothing at all — silently, because the body attribute still
 * goes on. `scripts/build-theme-data.mjs` makes the same three checks at build
 * time; this is the one CI runs.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'

const CENTER = fileURLToPath(new URL('../src/client/features/theme-center', import.meta.url))
const SCOPE_ATTR = 'data-smkit-theme'
const DATA = JSON.parse(readFileSync(`${CENTER}/themes.data.json`, 'utf8'))

it('pairs every entry with one stylesheet, scoped and named after it', () => {
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
    const css = readFileSync(path, 'utf8')
    assert.ok(
      css.includes(`body[${SCOPE_ATTR}="${theme.id}"]`),
      `themes/${theme.id}.css is not scoped on body[${SCOPE_ATTR}="${theme.id}"]`,
    )
    assert.ok(
      css.includes(`body[${SCOPE_ATTR}="${theme.id}"][data-ds-dark-theme]`),
      `themes/${theme.id}.css carries no dark block`,
    )
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
