/**
 * The theme center's data file, built and measured.
 *
 * Two jobs, both over `src/client/features/theme-center/themes.data.json`:
 *
 * 1. **The retired skins fold in.** The plugin used to ship two theme surfaces
 *    with two apply mechanisms: the `theme` feature's three ported dsh-themes
 *    skins (one `body[data-dsh-<dataset>]` attribute each, its stylesheet
 *    always in the bundle) and the theme center's themes (one
 *    `body[data-dsh-theme="<id>"]` attribute, its stylesheet swapped into the
 *    active `<style>` element). The two never met, so they could not share a
 *    card, a selection or a storage key. Folding the skins in costs exactly one
 *    rewrite: every `body[data-dsh-nord]` selector becomes
 *    `body[data-smkit-theme="nord"]`, verbatim otherwise — same rules, same
 *    order, same specificity. The job runs only while the skin stylesheets are
 *    still reachable (the working tree before the merge, the pre-merge revision
 *    after it) and reports when it has nothing to fold, so a re-run on a merged
 *    tree is a no-op rather than an error.
 *
 * 2. **Every entry's grade is measured.** The badge on a card reports a fact
 *    about the palette, so it is computed here from the same two hex values the
 *    card paints — the base background and the body ink — rather than quoted
 *    from anywhere. It is written into the data because the browser half must
 *    not re-derive it per render, and because a hand-edited stylesheet then
 *    still shows the ratio of the palette it actually paints.
 *
 * The palettes are NOT re-derived: the three skins' are transcribed from the
 * retired `theme/skins.ts` (which took them from the stylesheets in the first
 * place) and each value is asserted to appear in its own stylesheet block, so a
 * swatch that drifted from the CSS fails the run instead of shipping. The
 * `surface` slot is the one value `skins.ts` never carried — the center's
 * swatch is `[bg, surface, accent, text]` and a skin shipped a triple — so it
 * is read from the skin's own block (`--bg-1`; zcode's
 * `--dsw-specific-sidebar-fill`) and asserted the same way.
 *
 * Run: node scripts/build-theme-data.mjs [--check]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DATA_PATH = `${ROOT}/src/client/features/theme-center/themes.data.json`
const SKIN_DIR = `${ROOT}/src/client/features/theme/style`

/**
 * The body attribute every theme's rules are scoped on. Kept in step with
 * `THEME_ATTR` in `src/client/features/theme-center/apply.ts` — they are two
 * halves of the same contract, the data side and the runtime side, and if they
 * disagree every rule in this file silently stops applying.
 */
const SCOPE_ATTR = 'data-smkit-theme'

/** The three skins, as `theme/skins.ts` shipped them plus the center's surface.
 * `previous` carries the grades that file published, as the oracle for
 * `--check`: a mismatch means the measurement or a palette moved. */
const SKINS = [
  {
    id: 'festival-dragonboat',
    file: 'skin-festival-dragonboat.css',
    dataset: 'dsh-festival-dragonboat',
    name: 'Dragon Boat Festival',
    nameZh: '端午',
    desc: 'Mugwort green and zongzi fragrance; dragon boats race in lacquer red',
    descZh: '艾草绿粽叶香，龙舟红漆竞渡忙',
    tags: ['light', 'green', 'festival'],
    surfaceToken: '--bg-1',
    previous: { day: 'AAA · 13.6:1', night: '16.3:1' },
    swatch: {
      light: { bg: '#f2f6ef', surface: '#fafcf8', accent: '#2e7d4f', text: '#1a2b21' },
      dark: { bg: '#0a120d', surface: '#101a14', accent: '#58b386', text: '#e6f0e9' },
    },
  },
  {
    id: 'nord',
    file: 'skin-nord.css',
    dataset: 'dsh-nord',
    name: 'Nord',
    nameZh: 'Nord',
    desc: 'Snow Storm daylight, Frost blue accents',
    descZh: 'Snow Storm 雪原昼色，Frost 冰蓝点缀',
    tags: ['light', 'cool', 'nordic'],
    surfaceToken: '--bg-1',
    previous: { day: 'AAA · 10.8:1', night: '10.3:1' },
    swatch: {
      light: { bg: '#eceff4', surface: '#e5e9f0', accent: '#5e81ac', text: '#2e3440' },
      dark: { bg: '#2e3440', surface: '#333b47', accent: '#88c0d0', text: '#e5e9f0' },
    },
  },
  {
    id: 'zcode',
    file: 'skin-zcode.css',
    dataset: 'dsh-zcode',
    name: 'ZCode',
    nameZh: 'ZCode',
    desc: 'ZCode desktop look: light day, deep night, monochrome CTA',
    descZh: 'ZCode 桌面端原味配色：昼浅夜深，黑白主键',
    tags: ['light', 'neutral', 'desktop'],
    surfaceToken: '--dsw-specific-sidebar-fill',
    previous: { day: 'AAA · 14.2:1', night: '12.2:1' },
    swatch: {
      light: { bg: '#f8f8f8', surface: '#ececee', accent: '#000000', text: '#262626' },
      dark: { bg: '#161616', surface: '#2b2b2b', accent: '#ffffff', text: '#d4d4d4' },
    },
  },
]

/**
 * One skin's stylesheet, or null once the merge has landed. The working tree
 * carries it until this script's own output is committed; afterwards the file
 * is gone from HEAD too, so the lookup simply reports nothing left to fold
 * instead of failing — the three entries are already in the data by then.
 */
function readSkinCss(skin) {
  const path = `${SKIN_DIR}/${skin.file}`
  if (existsSync(path)) return readFileSync(path, 'utf8')
  for (const ref of ['HEAD^', 'HEAD']) {
    try {
      return execFileSync('git', ['show', `${ref}:src/client/features/theme/style/${skin.file}`], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      // That revision does not carry the file; try the next one.
    }
  }
  return null
}

/** The declarations of one `body[<scope>]` block, in source order. The dark
 * scope prefixes the light one, so the light pattern needs a negative
 * lookahead to keep the two blocks apart. */
function blockOf(css, dataset, dark) {
  const scope = dark ? `body[data-${dataset}][data-ds-dark-theme]` : `body[data-${dataset}]`
  const escaped = scope.replace(/[[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    dark ? `${escaped}\\s*\\{([^}]*)\\}` : `${escaped}(?!\\[)\\s*\\{([^}]*)\\}`,
    'g',
  )
  const blocks = [...css.matchAll(pattern)].map((match) => match[1])
  if (blocks.length === 0) throw new Error(`${dataset}: no ${dark ? 'dark' : 'light'} block found`)
  return blocks
}

/** `--token: value;` as declared anywhere in the given block list. */
function tokenOf(blocks, token) {
  for (const block of blocks) {
    const found = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(block)
    if (found) return found[1].trim().toLowerCase()
  }
  return null
}

/** The value of the `color` / `background-color` declaration a block sets. */
function plainOf(blocks, property) {
  for (const block of blocks) {
    const found = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+);`).exec(block)
    if (found) return found[1].trim().toLowerCase()
  }
  return null
}

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

/** A ratio as the day badge reads it: `AAA · 13.6:1`. Every palette the plugin
 * ships clears AAA; the AA rungs fall through only so a future theme cannot
 * quietly publish a grade it did not earn. */
function dayGrade(ratio) {
  const level = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'AA18'
  return `${level} · ${ratio.toFixed(1)}:1`
}

/** A ratio as the night strip reads it — the number alone; the label around it
 * is copy and lives in the dictionaries. */
const nightGrade = (ratio) => `${ratio.toFixed(1)}:1`

/** Grade one entry from its own two palettes, each `[bg, surface, accent, text]`. */
function gradesOf(tuple) {
  return {
    gradeDay: dayGrade(contrastRatio(tuple.light[0], tuple.light[3])),
    gradeNight: nightGrade(contrastRatio(tuple.dark[0], tuple.dark[3])),
  }
}

/** One entry rewritten into the file's canonical key order, grades included. */
function canonical(entry) {
  const tuple = { light: [...entry.swatch.light], dark: [...entry.swatch.dark] }
  return {
    id: entry.id,
    name: entry.name,
    nameZh: entry.nameZh,
    desc: entry.desc,
    descZh: entry.descZh,
    tags: [...entry.tags],
    swatch: { light: tuple.light, dark: tuple.dark },
    css: entry.css,
    ...gradesOf(tuple),
  }
}

/* --------------------------------------------------------------- the run */

/** The skin CSS with its scope rewritten to the center's attribute. A verbatim
 * port otherwise: only the `body[...]` prefix moves, so every rule keeps the
 * specificity and the order the skin shipped with — including the compound
 * selectors (`body[data-dsh-nord] [class*='sider'] …`), which share the prefix
 * and therefore the rewrite. */
function rescope(css, skin) {
  const from = `body[data-${skin.dataset}]`
  const to = `body[${SCOPE_ATTR}="${skin.id}"]`
  const rewritten = css.split(from).join(to)
  if (!rewritten.includes(to)) throw new Error(`${skin.id}: nothing to rescope`)
  return rewritten
}

function buildEntry(skin, css) {
  const light = blockOf(css, skin.dataset, false)
  const dark = blockOf(css, skin.dataset, true)
  const modes = [
    ['light', light, skin.swatch.light],
    ['dark', dark, skin.swatch.dark],
  ]
  for (const [mode, blocks, palette] of modes) {
    // Every transcribed color must exist in its own stylesheet, so a palette
    // that drifted from the CSS fails here rather than shipping a wrong preview.
    for (const value of [palette.bg, palette.text, palette.accent]) {
      if (!blocks.some((block) => block.toLowerCase().includes(value))) {
        throw new Error(`${skin.id} (${mode}): ${value} does not appear in its stylesheet block`)
      }
    }
    const declared = tokenOf(blocks, skin.surfaceToken)
    if (declared !== palette.surface) {
      throw new Error(
        `${skin.id} (${mode}): ${skin.surfaceToken} is ${declared} in the CSS, not ${palette.surface}`,
      )
    }
    // The pair a grade is measured from must be the pair the CSS paints.
    const bg = plainOf(blocks, 'background-color')
    const fg = plainOf(blocks, 'color')
    if (bg !== palette.bg || fg !== palette.text) {
      throw new Error(
        `${skin.id} (${mode}): the CSS paints ${bg} on ${fg}, transcribed ${palette.bg} on ${palette.text}`,
      )
    }
  }
  const pick = (mode) => [mode.bg, mode.surface, mode.accent, mode.text]
  return canonical({
    id: skin.id,
    name: skin.name,
    nameZh: skin.nameZh,
    desc: skin.desc,
    descZh: skin.descZh,
    tags: skin.tags,
    swatch: { light: pick(skin.swatch.light), dark: pick(skin.swatch.dark) },
    css: rescope(css, skin),
  })
}

/**
 * Put every theme's rules back on the attribute the runtime actually sets.
 *
 * Themes used to be scoped on `data-dsh-theme`, a name this plugin shared with
 * the separate `dsh-theme` it grew out of; both wrote `body[data-dsh-theme="<id>"]`
 * from their own rows, which is how one ended up driving the other's choices.
 * The scope is now ours alone (`data-smkit-theme`, matching `THEME_ATTR` in
 * `features/theme-center/apply.ts`) — but this file is checked in, and nothing
 * in the fold-in path below revisits entries that are already in it. Without
 * this pass a rebuild would keep whatever attribute it found, including the old
 * one, and there would be no reason to look twice.
 */
function rescopecheck(css) {
  return css.replaceAll('data-dsh-theme', SCOPE_ATTR)
}

const existing = JSON.parse(readFileSync(DATA_PATH, 'utf8')).map((entry) => ({
  ...entry,
  css: rescopecheck(entry.css),
}))
const foldable = SKINS.map((skin) => ({ skin, css: readSkinCss(skin) })).filter(
  (candidate) => candidate.css !== null,
)
const migrated = foldable.map(({ skin, css }) => buildEntry(skin, css))
const known = new Set(existing.map((entry) => entry.id))
const merged = [...existing.map(canonical), ...migrated.filter((entry) => !known.has(entry.id))]
writeFileSync(DATA_PATH, `${JSON.stringify(merged, null, 2)}\n`)

for (const entry of merged) {
  console.log(
    `  ${entry.id.padEnd(20)} ${entry.gradeDay.padEnd(14)} night ${entry.gradeNight.padEnd(8)} ${entry.swatch.light.join(' ')}`,
  )
}
console.log(
  migrated.length > 0
    ? `folded in ${migrated.length} retired skins: ${migrated.map((entry) => entry.id).join(', ')}`
    : 'no skin stylesheets left to fold in — graded the entries already in the data',
)
console.log(`themes.data.json: ${merged.length} entries, ${readFileSync(DATA_PATH).length} bytes`)

if (process.argv.includes('--check')) {
  if (migrated.length === 0) {
    console.log('\ngrade oracle: skipped, the skins are already folded in')
  } else {
    console.log('\ngrade oracle (retired skins.ts vs this measurement):')
    for (const skin of SKINS) {
      const entry = migrated.find((candidate) => candidate.id === skin.id)
      if (entry === undefined) continue
      const day = entry.gradeDay === skin.previous.day ? 'ok' : `DIFFERS (was ${skin.previous.day})`
      const night =
        entry.gradeNight === skin.previous.night ? 'ok' : `DIFFERS (was ${skin.previous.night})`
      console.log(`  ${skin.id.padEnd(20)} day ${day}; night ${night}`)
    }
  }
}
