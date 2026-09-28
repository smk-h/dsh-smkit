/**
 * The one description of what a theme has to be, in the revision where a theme
 * is a token table rather than a stylesheet.
 *
 * A theme is still written down twice — as metadata in `themes.data.json` and
 * as colors in a table under `tokens/` — and the two are edited by hand. Nothing
 * at runtime compares them: `apply.ts` looks an id up and stacks whatever table
 * it finds (a theme with no table stacks nothing and paints the shell's
 * palette), and the card falls back to the id itself. So a theme whose table was
 * renamed, or handed a palette its swatch does not advertise, ships as a card
 * that paints nothing or lies about what it paints, with no error anywhere.
 *
 * The rule lives here rather than in either caller because two callers apply
 * it: `scripts/build-theme-data.mjs`, which rewrites the metadata and so has to
 * check what it is about to write, and `test/theme-center-data.test.mjs`, which
 * is what CI runs. This is the same split `namespace-guard.mjs` makes between
 * the bundler and the suite — a rule written twice is a rule that drifts.
 *
 * Everything is pure over text; callers do their own reading, so the same rule
 * serves a script with a file system and a test with whatever it read. The
 * module that joins ids to tables (`themes.data.ts`) is TypeScript, so both
 * callers hand its source in as text and read the join with the small parser
 * below rather than importing it.
 *
 * The body attribute a theme's *rules* hang off is not here: it belongs to
 * `apply.ts` (`THEME_ATTR`), which writes it, and to the one sheet scoped on it
 * (`style/zcode-cards.css`). A token table has no attribute.
 */

/** The `id: CONSTANT` pairs of the `TOKENS` map in `themes.data.ts`. */
function tokenMapOf(moduleSource) {
  const block = /const TOKENS[^{]*\{([^}]*)\}/s.exec(moduleSource)
  if (block === null) return null
  const out = new Map()
  for (const match of block[1].matchAll(/['"]?([\w-]+)['"]?\s*:\s*([A-Z_][\w]*)/g)) {
    out.set(match[1], match[2])
  }
  return out
}

/** Every constant the module imports, mapped to its specifier. */
function importsOf(moduleSource) {
  const out = new Map()
  for (const match of moduleSource.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const name of match[1]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')) {
      out.set(name, match[2])
    }
  }
  return out
}

/**
 * The `./tokens/<file>` one entry's colors are declared in, or null when the
 * module maps none. Read out of `themes.data.ts` rather than remembered, so the
 * guard cannot drift from the join it is checking.
 *
 * @param {string} moduleSource - `themes.data.ts`, as text.
 * @param {string} id - the entry's id.
 * @returns {string|null} `./tokens/zcode`, or null.
 */
export function tokenTableOf(moduleSource, id) {
  const constant = tokenMapOf(moduleSource)?.get(id)
  if (constant === undefined) return null
  for (const [name, specifier] of importsOf(moduleSource)) {
    if (name === constant) return specifier
  }
  return null
}

/**
 * Every `./tokens/…` specifier the module imports, so a caller can check that
 * no table sits unclaimed beside the entries.
 *
 * @param {string} moduleSource - `themes.data.ts`, as text.
 * @returns {string[]} relative specifiers, in source order.
 */
export function importedTables(moduleSource) {
  const out = []
  for (const specifier of importsOf(moduleSource).values()) {
    if (specifier.startsWith('./tokens/') && !out.includes(specifier)) out.push(specifier)
  }
  return out
}

/**
 * Everything wrong with one theme's table, as a list of messages; empty when
 * the pair agrees.
 *
 * Two things are checked. First that the entry declares a palette half the
 * shell's registry accepts — it is the field the shell flips
 * `body[data-ds-dark-theme]` from, so a theme that gets it wrong is a theme
 * that lifts the flag on the wrong palette. Second that the palette the card
 * advertises is the palette the table wears: every color of both swatch halves
 * has to occur in the table, because those four are what the card paints and
 * what the badge's contrast ratio is measured from. A fixed-scheme theme
 * repeats its palette on both sides, so the same four values are looked for
 * twice — stated once, checked twice, which is what keeps the two halves from
 * drifting apart in the data.
 *
 * @param {{ id: string, colorScheme?: string, swatch?: { light?: string[], dark?: string[] } }} theme
 * @param {string} table - the table's text (`tokens/<family>.ts`).
 * @returns {string[]}
 */
export function themeTableViolations(theme, table) {
  const out = []
  if (theme.colorScheme !== 'light' && theme.colorScheme !== 'dark') {
    out.push(
      `${theme.id}: colorScheme is ${JSON.stringify(theme.colorScheme)} — a theme here is one palette, ` +
        'and applying it pins the shell preference to that half',
    )
  }
  for (const half of ['light', 'dark']) {
    const swatch = theme.swatch?.[half]
    if (!Array.isArray(swatch) || swatch.length !== 4) {
      out.push(`${theme.id}: the ${half} swatch must carry four colors — bg, surface, accent, ink`)
      continue
    }
    for (const value of swatch) {
      if (!table.includes(value)) {
        out.push(`${theme.id} (${half}): the card paints ${value}, which does not occur in the table`)
      }
    }
  }
  return out
}
