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
