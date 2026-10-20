/**
 * The JavaScript / TypeScript profile: `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`,
 * `.tsx`, `.mts`, `.cts`.
 *
 * The same walk reads it; what differs is how a declaration is spelled. The
 * default "identifier before the first `(`" rule is not enough here, for four
 * reasons:
 *
 * - `class Name extends Base {` — the tag is not the last token before the
 *   brace, so the C family's rule would drop every subclass;
 * - `const name = (a) => { … }` — the name sits before an `=` and a parameter
 *   list, nowhere near the first `(`;
 * - `function f<T>(…)` — type parameters put `>` where the default looks for a
 *   name;
 * - `setTimeout(() => …)` — a call looks exactly like a call-shaped declaration
 *   to a language-blind rule, so this profile never defers to it: a JavaScript
 *   function is always introduced by `function`, by an assignment, or by a
 *   member assignment (`exports.f = function () {}`).
 *
 * Decorators are the fifth: `@Component({…}) class App {` must not report a
 * function called `Component`, and the class behind the decorator must still be
 * reported at its own brace.
 */

import type { OutlineKind } from '../../../../shared/outline/contract.js'
import { isIdentifier } from '../scan.js'
import type { Declaration, SourceProfile } from '../scan.js'
import type { Token } from '../syntax.js'

/**
 * Words that can stand where a name stands.
 *
 * `export default function () {}` puts `function` immediately before the
 * parameter list, and `class extends Base {}` puts `extends` where a tag would
 * be — neither is a declaration with that name.
 */
const TYPE_WORDS: ReadonlySet<string> = new Set([
  'function',
  'class',
  'interface',
  'async',
  'await',
  'export',
  'default',
  'new',
  'return',
  'typeof',
  'instanceof',
  'void',
  'delete',
  'extends',
  'implements',
  'super',
  'this',
  'yield',
  'in',
  'of',
  'type',
  'declare',
  'abstract',
  'readonly',
  'public',
  'private',
  'protected',
  'static',
])

/** Words that take parentheses but never declare anything here. */
const NOISE: ReadonlySet<string> = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'else',
  'do',
  'return',
  'typeof',
  'instanceof',
  'void',
  'delete',
  'new',
  'super',
  'this',
  'function',
  'async',
  'await',
  'yield',
])

/**
 * Tokens that begin a declaration, and so end the previous statement.
 *
 * Only consulted on a new line with all parentheses closed — see
 * {@link SourceProfile.startsStatement}.
 */
const STARTS_STATEMENT: ReadonlySet<string> = new Set([
  'export',
  'import',
  'const',
  'let',
  'var',
  'function',
  'class',
  'interface',
  'enum',
  'namespace',
  'module',
  'declare',
  'abstract',
  'type',
  'async',
])

/** `enum` keeps the default "tag last" rule; `class` and `interface` do not. */
const AGGREGATES: ReadonlyMap<string, OutlineKind> = new Map([['enum', 'enum']])

/** Whether a statement opens a block whose contents stay top-level. */
function containers(statement: readonly Token[]): boolean {
  return statement.some((token) => token.text === 'namespace' || token.text === 'module')
}

/** Index of the `=>` in a statement, or -1. */
function arrowAt(statement: readonly Token[]): number {
  return statement.findIndex((token, index) => token.text === '=' && statement[index + 1]?.text === '>')
}

/** The index of the first `=`, or -1. */
function equalsAt(statement: readonly Token[]): number {
  return statement.findIndex((token) => token.text === '=')
}

/**
 * The name of `const name = <function value>`, when the statement is one.
 *
 * The value has to look callable — `function`, an arrow, or a type-parameter
 * list followed by one of those. `const answer = 42` and `const box = { … }`
 * both fall through.
 */
function assignedFunction(statement: readonly Token[]): Token | null {
  const at = statement.findIndex(
    (token) => token.text === 'const' || token.text === 'let' || token.text === 'var',
  )
  if (at < 0) return null
  const name = statement[at + 1]
  if (name === undefined || !isIdentifier(name.text)) return null
  const equals = equalsAt(statement)
  if (equals <= at) return null

  const head = statement[equals + 1]?.text
  if (head === undefined) return null
  const callable = head === 'function' || head === '(' || head === 'async' || head === '<'
  if (!callable) return null
  // `function` is callable by itself; the others need an arrow to prove it, which
  // keeps `const x = (a + b) * c` out of the outline.
  if (head !== 'function' && arrowAt(statement) < 0) return null
  return name
}

/**
 * The name in `exports.name = function () {}` / `Thing.prototype.name = …`.
 *
 * CommonJS assigns functions to members far more often than to `const`s, and a
 * prototype method is the only place a `.cjs` file declares one.
 */
function memberFunction(statement: readonly Token[]): Token | null {
  const equals = equalsAt(statement)
  if (equals < 2) return null
  const head = statement[equals + 1]?.text
  if (head === undefined) return null
  const callable = head === 'function' || head === '(' || head === 'async'
  if (!callable) return null
  if (head !== 'function' && arrowAt(statement) < 0) return null
  const name = statement[equals - 1]
  if (name === undefined || !isIdentifier(name.text)) return null
  // The member shape is `a.b` or `a.b.c`; a plain `x = function` is not one.
  if (statement[equals - 2]?.text !== '.') return null
  return name
}

/** The name after `function`, skipping a generator's `*` and type parameters. */
function declaredFunction(statement: readonly Token[]): Token | null {
  const at = statement.findIndex((token) => token.text === 'function')
  if (at < 0) return null
  let index = at + 1
  if (statement[index]?.text === '*') index++
  const name = statement[index]
  if (name === undefined || !isIdentifier(name.text) || TYPE_WORDS.has(name.text)) return null
  const next = statement[index + 1]?.text
  // `function name(` or `function name<T>(`
  if (next !== '(' && next !== '<') return null
  return name
}

/**
 * The JavaScript / TypeScript classifier.
 *
 * @param statement - tokens since the last boundary, at the top level.
 * @returns what the statement declares, or null.
 */
function classify(statement: readonly Token[]): Declaration | null {
  if (statement.length === 0) return null

  // A statement that opens with `(` is an expression — an IIFE, a wrapped arrow
  // — never a declaration.
  if (statement[0]!.text === '(') return null

  // Checked before the decorator rule: `@sealed export class A extends B {` is
  // one statement, and the class is what it declares.
  const typeAt = statement.findIndex((token) => token.text === 'class' || token.text === 'interface')
  if (typeAt >= 0) {
    const name = statement[typeAt + 1]
    if (name !== undefined && isIdentifier(name.text) && !TYPE_WORDS.has(name.text)) {
      return { kind: 'struct', name: name.text, line: statement[0]!.line }
    }
    return null
  }

  const enumAt = statement.findIndex((token) => token.text === 'enum')
  if (enumAt >= 0) {
    const name = statement[enumAt + 1]
    if (name !== undefined && isIdentifier(name.text)) {
      return { kind: 'enum', name: name.text, line: statement[0]!.line }
    }
    return null
  }

  // A decorator by itself declares nothing; the decorated class is the next
  // statement, and reports itself there.
  if (statement.some((token) => token.text === '@')) return null

  const assigned = assignedFunction(statement)
  if (assigned !== null) return { kind: 'function', name: assigned.text, line: statement[0]!.line }
  // A `const`/`let`/`var` statement that is not callable is a variable.
  if (statement.some((token) => token.text === 'const' || token.text === 'let' || token.text === 'var')) {
    return null
  }

  const member = memberFunction(statement)
  if (member !== null) return { kind: 'function', name: member.text, line: statement[0]!.line }

  const declared = declaredFunction(statement)
  if (declared !== null) return { kind: 'function', name: declared.text, line: statement[0]!.line }

  return null
}

export const JS_FAMILY: SourceProfile = {
  id: 'js-family',
  syntax: {
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    // Template literals are masked as a whole: an outline does not need the
    // expressions inside `${…}`, and leaving them readable would let a backtick
    // in ordinary prose run away with the rest of the file.
    strings: ['"', "'", '`'],
    // `#` is a private-field marker or a shebang, never a directive.
    directives: false,
  },
  aggregates: AGGREGATES,
  noise: NOISE,
  typeWords: TYPE_WORDS,
  containers,
  accept: classify,
  startsStatement: (token) => STARTS_STATEMENT.has(token.text),
  /**
   * Every `;`-terminated declaration counts, and so does every statement ended
   * by {@link STARTS_STATEMENT}.
   *
   * The C family splits headers (prototypes are the API) from sources (the same
   * function usually appears twice); JavaScript has no such split, and an
   * expression-bodied arrow — `const twice = (n) => n * 2;` — only ever appears
   * as a statement without a brace.
   */
  prototypes: () => true,
}
