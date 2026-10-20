/**
 * The C family's profile: everything the walk needs to read C, C++ and the
 * dialects that keep their braces (`Arduino`'s `.ino`, Objective-C's `.m`).
 *
 * This is data plus two small hooks. The walk in `../scan.ts` does the rest, so
 * a new language is a sibling file rather than a branch in the scanner.
 */

import type { OutlineKind, OutlineSymbol } from '../../../../shared/outline/contract.js'
import type { MaskedSource, Token } from '../syntax.js'
import type { SourceProfile } from '../scan.js'

/**
 * Keywords that take parentheses but never declare anything.
 *
 * `sizeof` and friends matter because they are followed by `(` in ordinary code;
 * the rest are statements a top-level scan should never see, kept for the day a
 * brace is unbalanced.
 */
const NOISE: ReadonlySet<string> = new Set([
  'if',
  'for',
  'while',
  'switch',
  'do',
  'else',
  'return',
  'sizeof',
  'alignof',
  'typeof',
  '_Alignof',
  'case',
  'goto',
])

/**
 * Words that name a type rather than a function.
 *
 * They show up in the position a name occupies in a declaration — `static void
 * (*handler)(int) = 0;` puts `void` immediately before the first `(` — and a C
 * function cannot be called any of them.
 */
const TYPE_WORDS: ReadonlySet<string> = new Set([
  'void',
  'char',
  'short',
  'int',
  'long',
  'float',
  'double',
  'signed',
  'unsigned',
  '_Bool',
  'bool',
  'struct',
  'union',
  'enum',
  'const',
  'volatile',
  'static',
  'extern',
  'register',
  'inline',
])

/**
 * Keyword → the kind a reader expects.
 *
 * C++'s `class` is reported as `struct`: the outline vocabulary predates the
 * language split and both spell the same thing to someone scanning a file for
 * "where is the type".
 */
const AGGREGATES: ReadonlyMap<string, OutlineKind> = new Map([
  ['struct', 'struct'],
  ['union', 'union'],
  ['enum', 'enum'],
  ['class', 'struct'],
])

/** Suffixes whose prototypes belong in the outline. */
const HEADERS: ReadonlySet<string> = new Set(['.h', '.hh', '.hpp', '.hxx'])

/** A function-like macro: the `(` must touch the name, or it is an object-like one. */
const MACRO = /^#\s*define\s+([A-Za-z_]\w*)\(/

/**
 * Symbols that live outside the token walk.
 *
 * `#define list_push(l, v) …` reads as a function to anyone scanning a C file,
 * and its name is only visible on the directive line — which masking blanks.
 */
function macros(masked: MaskedSource): OutlineSymbol[] {
  const found: OutlineSymbol[] = []
  for (const directive of masked.directives) {
    const match = MACRO.exec(directive.text)
    if (match !== null) found.push({ kind: 'macro', name: match[1]!, line: directive.line })
  }
  return found
}

/**
 * Blocks whose declarations stay top-level.
 *
 * `namespace geometry {` and `extern "C" {` are containers, not code. The string
 * of a linkage specification is blanked before tokenising, so `extern "C"`
 * arrives as the single word `extern`; an `extern` variable declaration ends in
 * `;` and never reaches this hook.
 */
function containers(statement: readonly Token[]): boolean {
  const first = statement[0]
  if (first === undefined) return false
  if (first.text === 'namespace') return true
  return first.text === 'extern' && statement.length === 1
}

export const C_FAMILY: SourceProfile = {
  id: 'c-family',
  syntax: {
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: ['"', "'"],
    directives: true,
  },
  aggregates: AGGREGATES,
  noise: NOISE,
  typeWords: TYPE_WORDS,
  aliasKeyword: 'typedef',
  containers,
  markers: macros,
  prototypes: (suffix) => HEADERS.has(suffix),
}
