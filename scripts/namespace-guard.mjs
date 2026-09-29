/**
 * The one description of what a class name in this plugin has to look like.
 *
 * The refactor this file belongs to replaced a dozen ad-hoc prefixes
 * (`mm_`, `sk_`, `dt_`, `tp_`, `dsh-theme-set*` …) with one scheme, and the
 * rules below are that scheme written down once so the build and the tests read
 * the same thing — a rule nobody enforces decays, which is exactly how the old
 * prefixes drifted.
 *
 * The shape:
 *
 *     smkit-<scope>-<sheet>[-<block>[-<part>]]
 *     └──┬──┘ └──┬──┘ └──┬───┘
 *      root   feature  stylesheet
 *
 * `root` is the plugin's own namespace (`smkit`), and it is never anything
 * else — `dsh-` belongs to the host and to the `dsh-*` official plugins.
 * `scope` is short but stable, `sheet` is the stylesheet's own filename, and
 * the rest names the block inside it.
 *
 * Why the sheet is in the name at all: `custom-settings` ships four
 * stylesheets and all four define a `-panel`. Two features can share a word
 * safely; two sheets inside one feature cannot, and the sheet is what makes
 * them distinct.
 *
 * Everything is lower-case kebab-case, because the alternative — the old
 * `mm_rowHead` camel-tail — has to be normalised somewhere before it can be
 * checked, and every normalisation is a place to be wrong.
 *
 * The same root covers the other two alphabets a plugin writes into a document
 * — `data-smkit-*` attributes and `--smkit-*` custom properties — because a
 * collision there is silent rather than loud: a class that is wrong shows up as
 * an unstyled element, a property or attribute that is wrong shows up as
 * nothing at all until some other plugin happens to look for it.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * The plugin's root namespace. Every public name starts here.
 *
 * The same root names three different alphabets, and each has its own
 * punctuation: a class is `smkit-`, a `data-*` attribute is `data-smkit-`, a
 * custom property is `--smkit-`. They are spelled out rather than assembled at
 * a call site, because every one of them is read by a *browser*, not by this
 * code — `data-${ROOT}-x` would be legal here and invisible there.
 */
export const ROOT = 'smkit'

/** The prefix of a `data-*` attribute this plugin owns. */
export const DATA_ROOT = `data-${ROOT}`

/** The prefix of a custom property this plugin owns. */
export const PROPERTY_ROOT = `--${ROOT}`

/**
 * The prefix of the shell's own custom properties. A plugin stylesheet reads
 * these constantly — they are the design tokens the whole surface paints from —
 * and reads are not ownership, so they are allowed on the reading side only.
 */
export const HOST_PROPERTY_ROOT = '--dsw'

/**
 * The one kind of stylesheet the scheme does not apply to.
 *
 * A theme of the theme center is a skin over the host's document, not chrome of
 * this plugin. It **declares** the shell's own design tokens (`--dsw-alias-*`,
 * `--dsw-specific-*`), because repainting them is what a skin is; it **selects**
 * host classes (`.markdown-body`, `.arco-btn-*`), because those are the surfaces
 * it repaints; and it may **read** host data attributes
 * (`data-chat-flow-kind`) for the same reason. None of that is a name this
 * plugin owns, so none of it can be held to the root the scheme enforces — the
 * guard stops at the skins.
 *
 * Everything else is checked as before, the theme *cards* and the settings row
 * around them included: those are this plugin's own chrome and stay `smkit-*`.
 */
export const THEME_SHEETS = /(?:^|\/)client\/features\/theme-center\/themes\/[^/]+\.css$/

/**
 * The theme token tables, which the scheme exempts the same way it exempts a
 * sheet: `client/features/theme-center/tokens/*.ts`.
 *
 * A theme used to be a stylesheet that declared the host's `--dsw-alias-*` /
 * `--dsw-specific-*` tokens; it is a token table now (stacked through
 * `ctx.theme.overrideTokens`, see the feature's `apply.ts`), and it declares
 * exactly the same host names.
 * Repainting the host's tokens is what a theme is, so the property rule — which
 * holds this plugin's own `--smkit-*` properties to their root — has nothing to
 * check in these files either. Nothing else is exempt: the rest of the feature
 * (the row, the panel, the structural sheet) stays `smkit-*` throughout.
 */
export const THEME_TOKEN_TABLES = /(?:^|\/)client\/features\/theme-center\/tokens\/[^/]+\.ts$/

/**
 * Whether one TypeScript file is a theme token table, which the scheme exempts.
 * @param {string} relPath - `client/features/theme-center/tokens/zcode.ts`
 * @returns {boolean}
 */
export function isThemeTokenTable(relPath) {
  return THEME_TOKEN_TABLES.test(relPath)
}

/**
 * Whether one stylesheet is a theme skin, which the scheme exempts.
 * @param {string} relPath - `client/features/theme-center/themes/ocean.css`
 * @returns {boolean}
 */
export function isThemeSheet(relPath) {
  return THEME_SHEETS.test(relPath)
}

/**
 * The stylesheets the scheme applies to: every one of them but the skins.
 * @param {string[]} relPaths
 * @returns {string[]}
 */
export function guardableSheets(relPaths) {
  return relPaths.filter((relPath) => !isThemeSheet(relPath))
}

/**
 * `data-*` names that are deliberately not ours, and are not to be prefixed.
 * Both are read, never written: the shell owns the element and the name.
 */
export const FOREIGN_DATA_ATTRS = [
  /** The shell's own day/night flag; themes scope their dark half on it. */
  'data-ds-dark-theme',
  /** The shell stamps its dialog slots with this; the MCP feature looks one up. */
  'data-slot',
  /**
   * The layout package's own anchors, which the workbench card skin selects on
   * (`style/workbench.css`). They are the stable half of a frame whose class
   * names are build-time hashes: `data-shell-overlay` marks the floating
   * layer, `data-rightbar-col` the right column, `data-side` the drag handles,
   * `data-dragging` the handle under the pointer's drag, and the
   * `*-collapsed` flag the frame's own state. Read, never written — the skin
   * moves one attribute of its own and nothing else.
   *
   * `data-sidebar-right-panel` is the same kind of anchor one package over:
   * the right column's board is painted by the panel that fills it, not by the
   * column, so the skin has to name that panel to give it corners. Its value
   * (`push` / `fullscreen`) is the panel's own mode, and its sibling
   * `data-sidebar-right-open` is the flag for whether the deck is out — the
   * element outlives the panel being put away, so the skin has to ask.
   *
   * The dockkit pair is the deck's own panes, one package further in:
   * `data-dockkit-pane` marks a pane, `data-dockkit-column` its index in the
   * dock. The pane in column 0 is the one at the board's seam, and it draws a
   * left rule of its own there — so the skin has to name it to take that rule
   * over (see `style/workbench.css`). Host structure, never written.
   */
  'data-shell-overlay',
  'data-rightbar-col',
  'data-side',
  'data-dragging',
  'data-rightbar-collapsed',
  'data-sidebar-right-panel',
  'data-sidebar-right-open',
  'data-dockkit-pane',
  'data-dockkit-column',
  /**
   * The desktop preload's Windows marker (`apps/desktop/src/preload-windows.ts`),
   * set on the ROOT element. It is what tells the caption row's platform apart
   * from the web shell: ui-layout gives `[data-windows-titlebar] .frame` a
   * `padding-top` seat for the native menu bar, so the workbench skin has to
   * name the same attribute to put that seat back after its own padding
   * shorthand takes it away (see `style/workbench.css`). Read, never written —
   * and because it lives on the root rather than the body, nothing this plugin
   * does on the web can match a rule that hangs off it.
   */
  'data-windows-titlebar',
  /**
   * The settings panel carries this (`SettingsRoot` in ui-settings-general);
   * the shell-restore fallback reads it to tell the settings dialog from any
   * other `role="dialog"` surface before touching the trigger. Read, never
   * written.
   */
  'data-shortcut-modal',
  /**
   * The conversation's width handle carries this (`ConversationRoot`); the
   * floating-surface sheet excludes it so its border reaches only the tooltip
   * bubbles among the `[data-side]` elements. Read, never written.
   */
  'data-width-handle',
]

/**
 * Custom properties that are deliberately not ours, and are not tokens either.
 *
 * `HOST_PROPERTY_ROOT` covers the shell's design tokens: the `--dsw-*` ramp
 * every surface paints from. These are the host's *other* vocabulary — geometry
 * the layout publishes for its own frame, read by a child that has to line up
 * with it. Reading one is not repainting the shell, and none of them is ours to
 * rename, so they are listed one by one rather than matched by a prefix: a
 * blanket `--dsh-` allowance would wave through a mistyped name of our own just
 * as happily.
 */
export const FOREIGN_PROPERTIES = [
  /**
   * The height of the Windows caption row, written on the root by the desktop
   * preload (`apps/desktop/src/preload-windows.ts`) and spent by ui-layout's
   * `[data-windows-titlebar] .frame` as its `padding-top` — the seat the native
   * menu bar and the sidebar's brand strip sit in. The workbench card skin
   * pads the frame with a shorthand, which clears that seat, so it reads this
   * to hand the seat back at its own height plus its gutter (see
   * `style/workbench.css`). Read, never written.
   */
  '--dsh-windows-titlebar-height',
]

/**
 * Names that deliberately do **not** follow `ROOT` — on-disk facts and host
 * contracts that outlive any rename. Renaming a file on the user's disk or a
 * host-remembered id silently orphans data, so they are frozen instead.
 *
 * A codemod once rewrote `~/.dsh/mcp-manager.json` into `~/.dsh/smkit.json`
 * inside comments and UI copy while the actual `join(homedir(), ...)` kept the
 * old name, leaving the settings page advertising a file that does not exist.
 * The test asserts these literals still occur, so the next sweep fails loudly
 * rather than drifting again.
 *
 * `where` is the file that must still contain `name`.
 */
export const FROZEN = [
  {
    name: 'mcp-manager.json',
    where: 'src/host/features/mcp/constants.ts',
    why: 'profile state file: server configs plus OAuth tokens; renaming orphans tokens',
  },
  {
    name: 'dshmm',
    where: 'src/host/features/mcp/constants.ts',
    why: 'per-workspace config dir, may be committed to git and shared across machines',
  },
  {
    name: "id: 'mcp-manager'",
    where: 'src/client/settings.ts',
    why: 'settings section id the host remembers to reopen the last tab',
  },
]

/**
 * Directory to short scope, longest first so `client/features/mcp` wins over
 * `client/platform` for a path that is under both. Keep these in sync with the
 * feature list in the docs; adding a feature means adding a line here.
 */
export const SCOPES = [
  ['client/platform', 'ui'],
  ['client/settings', 'shell'],
  ['client/features/custom-settings', 'cs'],
  ['client/features/local-cache', 'cache'],
  ['client/features/mcp', 'mcp'],
  ['client/features/openspec', 'spec'],
  ['client/features/session-delete', 'del'],
  ['client/features/session-manager', 'sess'],
  ['client/features/skills', 'skill'],
  ['client/features/theme-center', 'theme'],
]

const normalised = [...SCOPES].sort((a, b) => b[0].length - a[0].length)

/**
 * The scope one source file belongs to, from its repo-relative path.
 * @param {string} relPath - `client/features/mcp/style/card.css`
 * @returns {string|null} `mcp`, or null outside any known scope.
 */
export function scopeOf(relPath) {
  const found = normalised.find(([dir]) => relPath.startsWith(dir + '/'))
  return found ? found[1] : null
}

/**
 * camelCase / snake_tail -> kebab-case.
 * @param {string} name
 * @returns {string}
 */
export function kebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

/**
 * The class prefix a stylesheet owns: `<root>-<scope>-<sheet>`.
 *
 * The sheet is the filename without its extension, in kebab-case — `.css` for
 * a stylesheet, but also `.tsx` for the components that are checked with the
 * same rule, where the old version left the extension in the name and produced
 * `smkit-ui-CheckChip.tsx`.
 *
 * @param {string} relPath - `client/features/mcp/style/card.css`
 * @returns {string|null} `smkit-mcp-card`, or null for a non-scoped file.
 */
export function ownedPrefix(relPath) {
  const scope = scopeOf(relPath)
  if (scope === null) return null
  const sheet = kebab(relPath.split('/').pop().replace(/\.[^.]+$/, ''))
  return `${ROOT}-${scope}-${sheet}`
}

/**
 * Every `.css` file under `dir`, as a path relative to `relBase`.
 *
 * `relBase` has to be the `src` directory: `SCOPES` matches `client/…` paths,
 * so anything else would silently scope nothing. Sorted, so the build and the
 * test suite see the same order.
 *
 * @param {string} dir - absolute directory to walk.
 * @param {string} relBase - absolute directory the result is relative to.
 * @returns {string[]}
 */
export function findStylesheets(dir, relBase) {
  if (!existsSync(dir)) return []
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (path.endsWith('.css')) out.push(relative(relBase, path).replaceAll('\\', '/'))
    }
  }
  walk(dir)
  return out.sort()
}

/**
 * Every prefix a set of stylesheets owns.
 * @param {string[]} relPaths
 * @returns {Set<string>}
 */
export function prefixesOf(relPaths) {
  return new Set(relPaths.map(ownedPrefix).filter((prefix) => prefix !== null))
}

/**
 * Why one stylesheet's declarations are not valid, as a list of messages; empty
 * when the file is clean.
 *
 * This is the one place the rule is applied, so the bundler and the test suite
 * cannot disagree about it — a sheet that would fail a test cannot be built,
 * which is the whole point of having the rule in a module and not in a test.
 *
 * @param {string} relPath
 * @param {string} css
 * @param {Iterable<string>} prefixes
 * @returns {string[]}
 */
export function sheetViolations(relPath, css, prefixes) {
  const out = []
  for (const name of declaredClasses(css)) {
    if (MODIFIERS.includes(name)) continue
    const why = violation(name, relPath, prefixes)
    if (why !== null) out.push(`${relPath}: ${why}`)
  }
  return out
}

/**
 * Every `data-*` attribute name one file mentions.
 * @param {string} source
 * @returns {string[]}
 */
export function dataAttributes(source) {
  const out = new Set()
  for (const match of source.matchAll(/(?<![\w-])(data-[a-z][a-z0-9-]*)/g)) out.add(match[1])
  return [...out]
}

/**
 * Every custom property one file **defines**: a `--x:` declaration in a
 * stylesheet, or a `'--x':` key in an inline style object.
 * @param {string} source
 * @returns {string[]}
 */
export function definedProperties(source) {
  const out = new Set()
  for (const match of source.matchAll(/(?:^|[\s;{,])'?(--[a-z][a-z0-9-]*)'?\s*:/gm)) out.add(match[1])
  return [...out]
}

/**
 * Every custom property one file **reads**: through `var(--x…)`, or through
 * `setProperty('--x', …)`.
 * @param {string} source
 * @returns {string[]}
 */
export function usedProperties(source) {
  const out = new Set()
  for (const match of source.matchAll(/var\(\s*(--[a-z][a-z0-9-]*)/g)) out.add(match[1])
  for (const match of source.matchAll(/setProperty\(\s*['"](--[a-z][a-z0-9-]*)['"]/g)) out.add(match[1])
  return [...out]
}

/**
 * Comments off, so a file's own prose is not read as its code.
 *
 * Load-bearing: these sources explain themselves at length and quote the names
 * they must *not* carry (`apply.ts` names the key it used to delete, `row.css`
 * spells out the prefixes it must not touch). A guard that read those would
 * punish exactly the documentation that keeps the rule comprehensible.
 *
 * Trailing `//` comments are left in place — stripping them needs to know when
 * `//` is a URL, and a stray attribute name at the end of a line is rare enough
 * that a loud failure and a one-line move is the better trade.
 *
 * @param {string} source
 * @returns {string}
 */
export function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * Every class name one stylesheet declares, as written.
 *
 * Comments come off first: these files open with long explanations that quote
 * class names on purpose (`row.css` spells out which prefixes it must not
 * touch), and those are prose, not declarations.
 * @param {string} css
 * @returns {string[]}
 */
export function declaredClasses(css) {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Set()
  for (const match of code.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) out.add(match[1])
  return [...out]
}

/**
 * Class names referenced from TypeScript — `className="..."`, `class: '...'`
 * and anything else that carries them. Deliberately *not* scoped to the
 * file's own feature: a component reaching for another layer's shared button
 * is legitimate, so what is checked here is only that the name at least
 * belongs to this plugin.
 * @param {string} source
 * @returns {string[]}
 */
export function referencedClasses(source) {
  const out = new Set()
  for (const match of source.matchAll(/class(?:Name)?\s*[=:]\s*['"`]([^'"`]+)['"`]/g)) {
    for (const token of match[1].trim().split(/\s+/)) {
      if (token) out.add(token)
    }
  }
  return [...out].filter((token) => /^[a-z][A-Za-z0-9_-]*$/.test(token))
}

/**
 * The bare words allowed on an element: every one of them is a modifier that
 * only ever appears beside a namespaced class (`.smkit-mcp-pill-badge.error`,
 * `.smkit-ui-button.primary`). Their left side is already namespaced, so
 * prefixing them would buy nothing; leaving them bare is what lets them read
 * as modifiers. Anything *new* has to be added here deliberately — that is the
 * whole point of keeping it short.
 */
export const MODIFIERS = [
  'authorizing',
  'conflict',
  'connected',
  'connecting',
  'custom',
  'danger',
  'disabled',
  'error',
  'needs-auth',
  'primary',
  'reconnecting',
  'wide',
]

/**
 * Why one class name is not valid in one file, or null when it is.
 *
 * Declaring a class is stricter than reaching for one. A component legitimately
 * wears another layer's shared button, and a stylesheet legitimately writes a
 * compound selector against it — `.mi_cardHead>.mm_cardContent` was always
 * legal, and still is. What must never happen is a name belonging to nobody:
 * an old hand-kept prefix, a bare English word, or something squatting on the
 * host's `dsh-`. So every name has to fall under *some* stylesheet's prefix,
 * and `prefixes` is how the caller supplies the full set.
 *
 * @param {string} name - the class as written.
 * @param {string} relPath - where it was written.
 * @param {Iterable<string>} [prefixes] - every stylesheet's prefix; without
 *   it, only the file's own prefix is accepted.
 * @returns {string|null}
 */
export function violation(name, relPath, prefixes) {
  const expected = ownedPrefix(relPath)
  if (expected === null) return null
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    return `not lower-case kebab-case: "${name}"`
  }
  if (name === expected || name.startsWith(expected + '-')) return null
  const borrowed = prefixes ? [...prefixes].some((p) => name === p || name.startsWith(p + '-')) : false
  if (borrowed) return null
  return `outside every stylesheet's namespace (expected ${expected} or ${expected}-…): "${name}"`
}
