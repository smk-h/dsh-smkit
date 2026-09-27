/**
 * The one description of what a theme sheet has to be.
 *
 * A theme is written down twice — as metadata in `themes.data.json` and as rules
 * in `themes/<id>.css` — and the two are edited by hand. Nothing at runtime
 * compares them: `apply.ts` looks an id up and falls back to a blank sheet, and
 * the card falls back to the id itself. So a theme whose sheet was renamed, left
 * on the old `data-dsh-theme` scope, or handed a palette its swatch does not
 * advertise ships as a card that paints nothing or lies about what it paints,
 * with no error anywhere.
 *
 * The rule lives here rather than in either caller because two callers apply it:
 * `scripts/build-theme-data.mjs`, which publishes the metadata and so has to
 * check what it is about to write, and `test/theme-center-data.test.mjs`, which
 * is what CI runs. This is the same split `namespace-guard.mjs` makes between
 * the bundler and the suite — a rule written twice is a rule that drifts.
 *
 * The bundler has no counterpart here, and cannot have one: the CSS travels as
 * data and every rule is scoped, so a wrong scope paints nothing rather than
 * failing a build. That silently-wrong outcome is exactly why the check has to
 * exist beside the data.
 *
 * Everything is pure over text; callers do their own reading, so the same rule
 * serves a script with a file system and a test with whatever it read.
 */

/**
 * The body attribute every theme's rules are scoped on. Kept in step with
 * `THEME_ATTR` in `src/client/features/theme-center/apply.ts` — the runtime half
 * of the same contract. If the two disagree, every rule in every sheet stops
 * applying and the check below would not notice, which is why this constant is
 * the one thing here with a twin elsewhere.
 */
export const SCOPE_ATTR = 'data-smkit-theme'

/** The shell's own day/night flag, which the dark half of a theme hangs off. */
const DARK_ATTR = 'data-ds-dark-theme'

/**
 * The declarations of every `body[<scope>]` block, in source order. One sheet
 * opens several blocks on the same scope (the alias block, then the shiki one),
 * so a caller reads a token from the first block that declares it.
 *
 * The dark scope prefixes the light one, and the light pattern's negative
 * lookahead is what keeps the two apart — without it every dark block would also
 * answer a light read, and a dark token would be mistaken for the light one. A
 * compound selector (`body[…] .markdown-body pre {`) is not a block of the scope
 * and is skipped: the scope has to meet `{` with nothing but whitespace between.
 *
 * @param {string} css
 * @param {string} scope - the full `body[…]` selector to open blocks for.
 * @param {boolean} dark - whether that selector is the dark one.
 * @returns {string[]}
 */
export function blocksOf(css, scope, dark) {
  const escaped = scope.replace(/[[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    dark ? `${escaped}\\s*\\{([^}]*)\\}` : `${escaped}(?!\\[)\\s*\\{([^}]*)\\}`,
    'g',
  )
  return [...css.matchAll(pattern)].map((match) => match[1])
}

/**
 * `--token: value;` as declared anywhere in the given block list.
 * @param {string[]} blocks
 * @param {string} token
 * @returns {string|null} the value, lower-cased, or null.
 */
export function tokenOf(blocks, token) {
  for (const block of blocks) {
    const found = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(block)
    if (found) return found[1].trim().toLowerCase()
  }
  return null
}

/**
 * The value of a plain `property: value;` declaration in the given block list.
 * @param {string[]} blocks
 * @param {string} property - `color` or `background-color`.
 * @returns {string|null} the value, lower-cased, or null.
 */
export function plainOf(blocks, property) {
  for (const block of blocks) {
    const found = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+);`).exec(block)
    if (found) return found[1].trim().toLowerCase()
  }
  return null
}

/** One mode's scope selector: the light one, or the light one plus the shell's
 * day/night flag. */
const scopeOf = (id, dark) => `body[${SCOPE_ATTR}="${id}"]${dark ? `[${DARK_ATTR}]` : ''}`

/**
 * Everything wrong with one theme's sheet, as a list of messages; empty when the
 * two halves agree.
 *
 * Two things are checked, per mode. First that the sheet opens a block on the
 * scope it is supposed to — a sheet whose selectors were left on the attribute
 * this center used to carry paints nothing at all, and one that never got a
 * dark block paints its light palette at night. Second that the palette the card
 * advertises is the palette the sheet wears: the background and the body ink
 * have to be the very colors the swatch's first and last slot carry, because
 * those two are what the badge's contrast ratio is measured from. The center's
 * themes say so with `--dsw-alias-bg-base` / `--dsw-alias-label-primary`; the
 * ported skins paint the body with a plain `background-color` / `color` instead,
 * which is why those two are read with that fallback. The surface and the accent
 * have no single token to compare against — the skins put them on `--bg-1` and
 * `--dsw-specific-sidebar-fill`, the rest on `--dsw-alias-bg-layer-1` and
 * `--dsw-alias-brand-primary` — so each is only required to occur somewhere in
 * its own mode's blocks.
 *
 * @param {{ id: string, swatch: { light: string[], dark: string[] } }} theme
 * @param {string} sheet - the sheet's text.
 * @returns {string[]}
 */
export function themeSheetViolations(theme, sheet) {
  const out = []
  for (const [mode, dark] of [
    ['light', false],
    ['dark', true],
  ]) {
    const scope = scopeOf(theme.id, dark)
    const blocks = blocksOf(sheet, scope, dark)
    if (blocks.length === 0) {
      out.push(`themes/${theme.id}.css has no ${mode} block on ${scope}`)
      continue
    }
    const swatch = theme.swatch[mode]
    const painted = {
      bg: tokenOf(blocks, '--dsw-alias-bg-base') ?? plainOf(blocks, 'background-color'),
      ink: tokenOf(blocks, '--dsw-alias-label-primary') ?? plainOf(blocks, 'color'),
    }
    if (painted.bg !== swatch[0]) {
      out.push(
        `${theme.id} (${mode}): the card's swatch paints ${swatch[0]} behind the body, themes/${theme.id}.css paints ${painted.bg}`,
      )
    }
    if (painted.ink !== swatch[3]) {
      out.push(
        `${theme.id} (${mode}): the card's swatch reads ${swatch[3]} as body ink, themes/${theme.id}.css paints ${painted.ink}`,
      )
    }
    for (const [slot, value] of [
      ['surface', swatch[1]],
      ['accent', swatch[2]],
    ]) {
      if (!blocks.some((block) => block.toLowerCase().includes(value))) {
        out.push(
          `${theme.id} (${mode}): the card's ${slot} ${value} does not occur in themes/${theme.id}.css`,
        )
      }
    }
  }
  return out
}
