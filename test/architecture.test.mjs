/**
 * Architecture guards: the rules the feature boundaries stand on.
 *
 * Cheap, dependency-free checks over the SOURCES — not the bundle: a feature is
 * a directory, the platform layer is another, and what matters is what may
 * import what. They exist so a feature added later cannot quietly reintroduce
 * the coupling the split removed: by importing a sibling feature, by reaching
 * up from the platform layer, or by copy-pasting a file.
 *
 * Two deliberate exemptions in the copy check: an `i18n` dictionary may carry a
 * key name that another namespace also has (that is what namespaces are for),
 * and `types.ts` files may look alike (two features can declare the same-shaped
 * props). Anything else byte-identical between two features is a copy, not a
 * coincidence.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'
import {
  DATA_ROOT,
  FOREIGN_DATA_ATTRS,
  FROZEN,
  HOST_PROPERTY_ROOT,
  MODIFIERS,
  PROPERTY_ROOT,
  ROOT,
  dataAttributes,
  definedProperties,
  findStylesheets,
  prefixesOf,
  referencedClasses,
  sheetViolations,
  usedProperties,
  withoutComments,
} from '../scripts/namespace-guard.mjs'

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url))

/** Every file under `dir`, as an absolute path, filtered by `match`. */
function walk(dir, match) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    return entry.isDirectory() ? walk(path, match) : match(path) ? [path] : []
  })
}

/** An absolute path as a repo-relative one (`host/features/mcp/types.ts`). */
const rel = (absolute) => absolute.slice(SRC_DIR.length + 1).replaceAll('\\', '/')

const isTypeScript = (path) => /\.tsx?$/.test(path)

/** Every relative import specifier of one source file. */
const relativeImports = (source) =>
  [...source.matchAll(/\bfrom\s+'(\.[^']*)'/g)].map((match) => match[1])

/** Resolve one specifier against the file that wrote it. */
function resolveFrom(file, spec) {
  return posix.normalize(posix.join(posix.dirname(rel(file)), spec)).replace(/\.js$/, '')
}

/** The feature a path belongs to, or undefined for the platform layer. */
const featureOf = (path) => /^(?:host|client)\/features\/([^/]+)\//.exec(path)?.[1]

/** Every source file of every feature, in both halves. */
const featureFiles = () => [
  ...walk(`${SRC_DIR}/host/features`, isTypeScript),
  ...walk(`${SRC_DIR}/client/features`, isTypeScript),
]

it('keeps a feature from importing another feature', () => {
  for (const file of featureFiles()) {
    const from = rel(file)
    for (const spec of relativeImports(readFileSync(file, 'utf8'))) {
      const target = resolveFrom(file, spec)
      const targetFeature = featureOf(target)
      assert.ok(
        targetFeature === undefined || targetFeature === featureOf(from),
        `${from} imports ${spec} (${target}): features must not import each other`,
      )
    }
  }
})

it('keeps the platform layer from importing any feature', () => {
  const files = [
    ...walk(`${SRC_DIR}/host/platform`, isTypeScript),
    ...walk(`${SRC_DIR}/client/platform`, isTypeScript),
  ]
  for (const file of files) {
    for (const spec of relativeImports(readFileSync(file, 'utf8'))) {
      assert.equal(
        featureOf(resolveFrom(file, spec)),
        undefined,
        `${rel(file)} imports ${spec}: the platform layer must not know a feature`,
      )
    }
  }
})

/**
 * The namespace guards: every name this plugin puts on the page has to carry
 * the root it is nameable under.
 *
 * The prefix scheme replaced a dozen hand-kept ones (`mm_`, `sk_`, `dt_`,
 * `dsh-theme-set*` …) that had quietly cross-pollinated — the platform layer
 * was wearing the MCP feature's `mm_`, one feature carried four different
 * prefixes, and some of them squatted on `dsh-`, which belongs to the host.
 * None of that was written down anywhere enforceable, which is exactly why it
 * drifted.
 *
 * A stylesheet owns `smkit-<scope>-<sheet>` plus anything hanging off it, and
 * that is derived from its path rather than remembered. Components are checked
 * more loosely — reaching for another layer's button is legitimate — so what is
 * enforced there is only that the name is ours at all.
 *
 * The class rule is applied from `scripts/namespace-guard.mjs` rather than
 * written here, because the bundler applies the same one (`tsdown.config.ts`):
 * a sheet that would fail below cannot be built either. The attribute and
 * property rules have no such counterpart, but they are the two that were
 * missing when a rename left `data-on` behind in a tool and nothing noticed —
 * the class guard covered the class names in the same file and said nothing
 * about the attribute beside them.
 *
 * Prose is stripped first (`withoutComments`): these files explain themselves
 * at length and name the very things they must not carry.
 */
const CLIENT_DIR = `${SRC_DIR}/client`
const SHEETS = findStylesheets(CLIENT_DIR, SRC_DIR)
const PREFIXES = prefixesOf(SHEETS)

/** Every file the attribute and property guards read. */
const nameBearingFiles = () => [
  ...walk(CLIENT_DIR, (path) => path.endsWith('.css')),
  ...walk(CLIENT_DIR, isTypeScript),
]

it('keeps every class inside the namespace of some stylesheet', () => {
  for (const file of SHEETS) {
    const css = readFileSync(`${SRC_DIR}/${file}`, 'utf8')
    const messages = sheetViolations(file, css, PREFIXES)
    assert.deepEqual(messages, [], `\n${messages.join('\n')}\n`)
  }
})

it('keeps every class a component asks for inside the plugin namespace', () => {
  for (const file of walk(CLIENT_DIR, isTypeScript)) {
    for (const name of referencedClasses(readFileSync(file, 'utf8'))) {
      if (MODIFIERS.includes(name)) continue
      assert.ok(
        name.startsWith(`${ROOT}-`),
        `${rel(file)}: "${name}" is outside the plugin namespace — every class a component wears must start with ${ROOT}-`,
      )
    }
  }
})

it('keeps every data attribute this plugin writes inside its own namespace', () => {
  for (const file of nameBearingFiles()) {
    const source = withoutComments(readFileSync(file, 'utf8'))
    for (const name of dataAttributes(source)) {
      if (FOREIGN_DATA_ATTRS.includes(name)) continue
      assert.ok(
        name.startsWith(`${DATA_ROOT}-`),
        `${rel(file)}: "${name}" — a data attribute this plugin reads or writes must start with ${DATA_ROOT}-, unless the host owns it and it is listed in FOREIGN_DATA_ATTRS`,
      )
    }
  }
})

it('namespaces every custom property this plugin defines and reads', () => {
  for (const file of nameBearingFiles()) {
    const source = withoutComments(readFileSync(file, 'utf8'))
    for (const name of definedProperties(source)) {
      assert.ok(
        name.startsWith(`${PROPERTY_ROOT}-`),
        `${rel(file)}: defines "${name}" — a custom property this plugin owns must start with ${PROPERTY_ROOT}-`,
      )
    }
    for (const name of usedProperties(source)) {
      assert.ok(
        name.startsWith(`${PROPERTY_ROOT}-`) || name.startsWith(`${HOST_PROPERTY_ROOT}-`),
        `${rel(file)}: reads "${name}" — a plugin stylesheet may read its own ${PROPERTY_ROOT}-* properties or the shell's ${HOST_PROPERTY_ROOT}-* tokens, and nothing else`,
      )
    }
  }
})

it('keeps the names that are deliberately not renamed', () => {
  for (const frozen of FROZEN) {
    const file = `${SRC_DIR.replace(/src$/, '')}${frozen.where}`
    assert.ok(existsSync(file), `frozen name ${frozen.name}: ${frozen.where} is gone`)
    const source = readFileSync(file, 'utf8')
    assert.ok(
      source.includes(frozen.name),
      `${frozen.where} no longer contains "${frozen.name}" — ${frozen.why}. ` +
        `If the rename is intended, change FROZEN in scripts/namespace-guard.mjs in the same commit.`,
    )
  }
})

it('finds no implementation file copied between features', () => {
  const exempt = (path) => path.includes('/i18n/') || /\/types\.ts$/.test(path)
  const seen = new Map()
  for (const file of featureFiles()) {
    if (exempt(file)) continue
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex')
    const twin = seen.get(hash)
    assert.equal(twin, undefined, `${rel(file)} is byte-identical to ${twin === undefined ? '' : rel(twin)}`)
    seen.set(hash, file)
  }
})
