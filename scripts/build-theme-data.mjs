/**
 * The theme center's data file, measured and checked.
 *
 * One job, over `src/client/features/theme-center/`: the badge on a card
 * reports a fact about the palette, so it is computed here from the same two
 * hex values the card paints — the base background and the body ink — rather
 * than quoted from anywhere. It is written into the metadata because the
 * browser half must not re-derive it per render, and because a hand-edited
 * table then still shows the ratio of the palette it actually paints.
 *
 * The palettes are NOT re-derived: each entry's swatch is transcribed by hand,
 * and the pairing rule in `theme-sheet-guard.mjs` asserts every one of those
 * values occurs in the table that will paint it — so a swatch that drifted from
 * its table fails this run instead of shipping a card that lies.
 *
 * This run used to do one more thing, and the history is worth keeping: it
 * folded the three retired `theme/skins` stylesheets into the center, rewriting
 * their `body[data-dsh-*]` scopes onto `data-smkit-theme` and writing each as
 * `themes/<id>.css`. That is done — the sheets are gone from the tree and the
 * three entries live here — and the second revision moved every theme's colors
 * out of stylesheets and into the `tokens/` tables the shell's registry takes,
 * so there is nothing left to fold. What remains is the measurement and the
 * check, which is what CI runs.
 *
 * Run: node scripts/build-theme-data.mjs [--check]
 *   `--check` rewrites nothing and exits non-zero when the file is not current.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { importedTables, themeTableViolations, tokenTableOf } from './theme-sheet-guard.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CENTER_DIR = `${ROOT}/src/client/features/theme-center`
const DATA_PATH = `${CENTER_DIR}/themes.data.json`
const MODULE_PATH = `${CENTER_DIR}/themes.data.ts`

/* ------------------------------------------------------------- WCAG 2.1 */

/** One sRGB channel (0-255) as its linear-light value. */
const linear = (channel) => {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of a `#rrggbb` color. */
function luminance(hex) {
  const match = /^#([0-9a-f]{6})$/.exec(hex.toLowerCase())
  if (match === null) throw new Error(`not a 6-digit hex color: ${hex}`)
  const value = parseInt(match[1], 16)
  return (
    0.2126 * linear((value >> 16) & 0xff) +
    0.7152 * linear((value >> 8) & 0xff) +
    0.0722 * linear(value & 0xff)
  )
}

/** The contrast ratio between two `#rrggbb` colors, 1:1 to 21:1. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** A ratio as the day badge reads it: `AAA · 13.6:1`. Most palettes the plugin
 * ships clear AAA; the AA rungs fall through only so a future theme cannot
 * quietly publish a grade it did not earn. */
function dayGrade(ratio) {
  const level = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'AA18'
  return `${level} · ${ratio.toFixed(1)}:1`
}

/** A ratio as the night strip reads it — the number alone; the label around it
 * is copy and lives in the dictionaries. */
const nightGrade = (ratio) => `${ratio.toFixed(1)}:1`

/** Grade one entry from its own two palettes, each `[bg, surface, accent, ink]`. */
function gradesOf(swatch) {
  return {
    gradeDay: dayGrade(contrastRatio(swatch.light[0], swatch.light[3])),
    gradeNight: nightGrade(contrastRatio(swatch.dark[0], swatch.dark[3])),
  }
}

/**
 * One entry's metadata rewritten into the file's canonical key order, grades
 * included. The colors are deliberately absent: they live in `tokens/`, and a
 * `css` key from the revision that inlined a stylesheet is dropped here rather
 * than carried forward.
 */
function canonical(entry) {
  const swatch = { light: [...entry.swatch.light], dark: [...entry.swatch.dark] }
  return {
    id: entry.id,
    name: entry.name,
    nameZh: entry.nameZh,
    desc: entry.desc,
    descZh: entry.descZh,
    tags: [...entry.tags],
    colorScheme: entry.colorScheme,
    swatch,
    ...gradesOf(swatch),
  }
}

/* --------------------------------------------------------------- the run */

const existing = JSON.parse(readFileSync(DATA_PATH, 'utf8'))
const moduleSource = readFileSync(MODULE_PATH, 'utf8')
const merged = existing.map(canonical)

// The metadata list and the tables are separate files that have to agree: an
// entry without a table registers with no colors at all, and a table nothing
// maps is dead weight. Every check runs before the JSON is written, so a
// failing run leaves the tree as it found it rather than half-written.
const claimed = new Set()
for (const entry of merged) {
  const specifier = tokenTableOf(moduleSource, entry.id)
  if (specifier === null) throw new Error(`${entry.id}: themes.data.ts maps no token table for it`)
  claimed.add(specifier)
  const violations = themeTableViolations(
    entry,
    readFileSync(`${CENTER_DIR}/${specifier.slice(2)}.ts`, 'utf8'),
  )
  if (violations.length > 0) throw new Error(violations.join('\n'))
}
for (const specifier of importedTables(moduleSource)) {
  if (!claimed.has(specifier)) {
    throw new Error(`${specifier} is imported by the TOKENS map but no entry maps it`)
  }
}

const serialized = `${JSON.stringify(merged, null, 2)}\n`
const current = readFileSync(DATA_PATH, 'utf8')
const stale = current !== serialized

const report = (entry) =>
  `  ${entry.id.padEnd(20)} ${entry.colorScheme.padEnd(6)} ${entry.gradeDay.padEnd(14)} night ${entry.gradeNight.padEnd(8)} ${entry.swatch.light.join(' ')}`

if (process.argv.includes('--check')) {
  for (const entry of merged) console.log(report(entry))
  if (stale) {
    console.error('\nthemes.data.json is not current — run `node scripts/build-theme-data.mjs`')
    process.exit(1)
  }
  console.log('\nthemes.data.json is current')
} else {
  writeFileSync(DATA_PATH, serialized)
  for (const entry of merged) console.log(report(entry))
  console.log(
    `themes.data.json: ${merged.length} entries, ${readFileSync(DATA_PATH).length} bytes` +
      `${stale ? ' (rewritten)' : ' (already current)'}`,
  )
}
