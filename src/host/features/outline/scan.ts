/**
 * The walk behind every outline: token stream in, declarations out.
 *
 * This file is deliberately language-blind. It knows three things — a brace
 * opens a scope, a statement is what sits between two boundaries, and a profile
 * may recognise that statement — and nothing about C. The vocabulary (which
 * keyword names an aggregate, which words are noise, whether `#` starts a
 * directive) comes in as a {@link SourceProfile}; the C family's is
 * `profiles/c.ts`, and adding a language means adding a profile, not editing
 * this walk.
 *
 * The algorithm:
 *
 * 1. `syntax.ts` masks comments, literals and directive lines, and tokenises
 *    what is left;
 * 2. this walk keeps a stack of open braces, each marked *transparent* (a
 *    container whose contents are still top-level, like a namespace) or opaque
 *    (a body, whose contents are not);
 * 3. a statement is classified only when it ends at a boundary in the top level:
 *    `{` (a definition is about to start) or `;` (a prototype, when the caller
 *    asked for those).
 *
 * Known limits come from being syntactic rather than semantic: a body hidden
 * behind `#if 0` still counts, macro-generated declarations never appear, and a
 * declarator shaped in a way the profile's heuristic does not recognise is
 * skipped. See `docs/LV510-代码大纲.md` for the trade-off this is buying.
 */

import type { OutlineKind, OutlineSymbol } from '../../../shared/outline/contract.js'
import { mask, tokenize } from './syntax.js'
import type { MaskedSource, MaskRules, Token } from './syntax.js'

/** What one top-level statement turned out to be. */
export type Declaration =
  | { readonly kind: OutlineKind; readonly name: string; readonly line: number }
  /** `typedef struct { … }` — the name arrives after the closing brace. */
  | { readonly anonymous: OutlineKind; readonly line: number }

/** The half of a declaration the walk can list on the spot, name and all. */
type NamedDeclaration = Extract<Declaration, { readonly name: string }>

/**
 * Everything the walk needs to know about one language.
 *
 * All of it is optional except the id and the lexical rules: a brace language
 * with no aggregates and no preprocessor is already readable with just those
 * two, and each field that is filled in buys a little more precision.
 */
export interface SourceProfile {
  /** Stable id; also what a refusal message names. */
  readonly id: string
  /** Comments, literals and directive lines. */
  readonly syntax: MaskRules
  /**
   * A last rewrite before masking, for regions the lexical rules cannot express.
   *
   * Shell heredocs are the case this exists for: `cat <<EOF` turns every
   * following line into data until the terminator, and a tokeniser that reads
   * that data finds functions that were never declared. The hook must blank, not
   * delete — line numbers have to survive.
   */
  readonly preprocess?: (source: string) => string
  /**
   * Keyword → the kind it declares, e.g. `struct → struct`, `class → struct`.
   *
   * A token listed here is also what lets `enum class Name` work: consecutive
   * aggregate keywords are skipped, and the name is the token after them.
   */
  readonly aggregates?: ReadonlyMap<string, OutlineKind>
  /** Words that take parentheses but never declare anything (`if`, `sizeof`). */
  readonly noise?: ReadonlySet<string>
  /** Words that can stand where a name stands, and so are never a name. */
  readonly typeWords?: ReadonlySet<string>
  /** Keyword that makes an unnamed aggregate's trailing name meaningful (`typedef`). */
  readonly aliasKeyword?: string
  /** Whether a statement opens a block that keeps its contents top-level. */
  readonly containers?: (statement: readonly Token[]) => boolean
  /**
   * Whether a token begins a new declaration, which ends the previous statement
   * without a `;`.
   *
   * Languages with automatic semicolon insertion need this: `const twice = n =>
   * n * 2` followed by `export const other = …` is two declarations, and a walk
   * that only stops at `;` or `{` would merge them into one. C has no such rule
   * and leaves this undefined, so a missing semicolon there stays exactly as
   * wrong as it is in the compiler.
   */
  readonly startsStatement?: (token: Token) => boolean
  /** Symbols that live outside the walk — C's function-like macros. */
  readonly markers?: (masked: MaskedSource) => readonly OutlineSymbol[]
  /**
   * Whether a file with this suffix lists prototypes, e.g. C headers.
   *
   * A language without separate headers simply omits this: nothing is a
   * prototype there, and `;`-terminated statements stay out of the outline.
   */
  readonly prototypes?: (suffix: string) => boolean
  /**
   * Full control over classification, for a language whose declarations do not
   * fit the default heuristics.
   *
   * When present it *replaces* the default rather than filtering it, so a
   * profile that only needs to add shapes delegates explicitly:
   * `return classifyDeclaration(statement, profile)`. The difference matters:
   * a hook that returns null means "nothing here", not "fall back".
   */
  readonly accept?: (statement: readonly Token[], profile: SourceProfile) => Declaration | null
}

/** Options a caller varies per file. */
export interface ScanOptions {
  /**
   * Report prototypes (`int f(void);`) as functions.
   *
   * True for headers, where the prototype *is* the API. False for sources, where
   * the same file usually carries both a prototype and the definition, and
   * listing both would double every entry.
   */
  readonly prototypes?: boolean
}

/** Shared empty vocabulary, so a profile without noise words allocates nothing. */
const EMPTY_WORDS: ReadonlySet<string> = new Set<string>()

/** Whether a lexeme can be a declared name. */
export function isIdentifier(text: string): boolean {
  return /^[A-Za-z_]\w*$/.test(text)
}

/** How many parentheses are still open inside one statement. */
function openParens(statement: readonly Token[]): number {
  let open = 0
  for (const token of statement) {
    if (token.text === '(') open++
    else if (token.text === ')') open--
  }
  return open
}

/**
 * The default classification: a call-shaped statement is a function, an
 * aggregate keyword with its tag last is a type.
 *
 * Both are heuristics, and both are stated here rather than in a profile because
 * brace languages share them; a profile that needs something else overrides
 * {@link SourceProfile.accept}.
 *
 * @param statement - tokens since the last boundary, at the top level.
 * @param profile - the language's vocabulary.
 * @returns what the statement declares, or null when it declares nothing.
 */
export function classifyDeclaration(
  statement: readonly Token[],
  profile: SourceProfile,
): Declaration | null {
  if (statement.length === 0) return null

  const noise = profile.noise ?? EMPTY_WORDS
  const typeWords = profile.typeWords ?? EMPTY_WORDS

  const open = statement.findIndex((token) => token.text === '(')
  if (open > 0) {
    const name = statement[open - 1]!
    const closes = statement.some((token, index) => index > open && token.text === ')')
    if (closes && isIdentifier(name.text) && !noise.has(name.text) && !typeWords.has(name.text)) {
      return { kind: 'function', name: name.text, line: statement[0]!.line }
    }
  }

  const aggregates = profile.aggregates
  if (aggregates === undefined) return null

  const keyword = statement.findIndex((token) => aggregates.has(token.text))
  if (keyword < 0) return null

  // `enum class Shape` / `struct node *p`: skip any further aggregate keywords
  // (`enum class`) before taking the tag.
  let tag = keyword + 1
  while (tag < statement.length && aggregates.has(statement[tag]!.text)) tag++
  const name = statement[tag]

  // The tag must be the last thing before the brace. `struct Point p = {0};`
  // puts a declarator after it, and that statement defines a variable, not a
  // type — reading it as `struct Point` would invent an entry at the wrong line
  // and duplicate a type declared elsewhere.
  if (name !== undefined && isIdentifier(name.text)) {
    if (tag + 1 === statement.length) {
      return { kind: aggregates.get(statement[keyword]!.text)!, name: name.text, line: statement[0]!.line }
    }
    return null
  }

  // `typedef struct {` / `struct {` — the name, when a reader has one to give it,
  // follows the closing brace, and only an alias declaration gives it one.
  const aliased = profile.aliasKeyword !== undefined
    && statement.some((token) => token.text === profile.aliasKeyword)
  return aliased
    ? { anonymous: aggregates.get(statement[keyword]!.text)!, line: statement[0]!.line }
    : null
}

/**
 * Read the symbols out of one source file.
 *
 * @param source - the file's text.
 * @param profile - the language's rules and vocabulary.
 * @param options - whether prototypes belong in the result.
 * @returns the top-level declarations, in file order.
 */
export function scanSource(
  source: string,
  profile: SourceProfile,
  options: ScanOptions = {},
): OutlineSymbol[] {
  const prepared = profile.preprocess === undefined ? source : profile.preprocess(source)
  const masked = mask(prepared, profile.syntax)
  const tokens = tokenize(masked.text)
  const symbols: OutlineSymbol[] = [...(profile.markers?.(masked) ?? [])]
  const classify = (statement: readonly Token[]): Declaration | null =>
    profile.accept === undefined
      ? classifyDeclaration(statement, profile)
      : profile.accept(statement, profile)

  /**
   * The declaration's own text, quoted out of the source the reader sees.
   *
   * Tokens carry a line and a column, and masking keeps both intact (it blanks
   * one character for one; only directive lines, which no declaration starts on,
   * lose their width). So a slice from the first token's position to the last
   * token's end is the declaration as written: the return type, the name and the
   * parameter list, without the brace that opens the body — that brace ends the
   * statement and is never in it.
   *
   * Line breaks and indentation inside a wrapped parameter list collapse to one
   * space, because the label it feeds is a single-line tooltip.
   */
  const sourceLines = prepared.split('\n')
  const signatureOf = (statement: readonly Token[]): string | undefined => {
    const first = statement[0]
    const last = statement[statement.length - 1]
    if (first === undefined || last === undefined) return undefined
    const end = last.column + last.text.length
    const text = first.line === last.line
      ? (sourceLines[first.line - 1] ?? '').slice(first.column, end)
      : [
        (sourceLines[first.line - 1] ?? '').slice(first.column),
        ...sourceLines.slice(first.line, last.line - 1),
        (sourceLines[last.line - 1] ?? '').slice(0, end),
      ].join(' ')
    // A wrapped list leaves a space just inside its parentheses; the label reads
    // better without them, and nothing else in a declaration does that.
    const flat = text
      .replace(/\s+/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .trim()
    return flat === '' ? undefined : flat
  }

  /** One classified statement as an entry, with a function's signature attached. */
  const emit = (statement: readonly Token[], found: NamedDeclaration): void => {
    const signature = found.kind === 'function' ? signatureOf(statement) : undefined
    symbols.push(signature === undefined
      ? { kind: found.kind, name: found.name, line: found.line }
      : { kind: found.kind, name: found.name, line: found.line, signature })
  }

  /**
   * One entry per open brace: whether it is transparent.
   *
   * A container — `namespace`, `extern "C"` — holds declarations a reader still
   * counts as top-level, so its braces do not hide them. Every other brace is
   * opaque, and nothing inside is classified.
   */
  const scopes: boolean[] = []
  const atTop = (): boolean => scopes.every((transparent) => transparent)
  let statement: Token[] = []
  /** An anonymous aliased aggregate waiting for the name after its closing brace. */
  let awaiting: { readonly anonymous: OutlineKind; readonly line: number } | null = null

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!

    if (token.text === '{') {
      if (atTop()) {
        const found = classify(statement)
        if (found !== null) {
          if ('name' in found) emit(statement, found)
          else awaiting = { anonymous: found.anonymous, line: found.line }
        }
        scopes.push(found === null && (profile.containers?.(statement) ?? false))
        statement = []
        continue
      }
      scopes.push(false)
      continue
    }

    if (token.text === '}') {
      const popped = scopes.pop()
      if (popped === false && atTop()) {
        statement = []
        if (awaiting !== null) {
          // The alias name is the first identifier between here and the `;`.
          let peek = index + 1
          while (peek < tokens.length && tokens[peek]!.text !== ';' && tokens[peek]!.text !== '{') {
            const candidate = tokens[peek]!
            if (isIdentifier(candidate.text)) {
              symbols.push({ kind: awaiting.anonymous, name: candidate.text, line: awaiting.line })
              break
            }
            peek++
          }
          awaiting = null
        }
      }
      continue
    }

    if (!atTop()) continue

    // A declaration keyword on a new line ends the previous statement in a
    // language that omits semicolons. Parentheses must be closed first, or a
    // parameter list spanning lines would be split after its first argument.
    if (
      statement.length > 0
      && profile.startsStatement?.(token) === true
      && token.line > statement[statement.length - 1]!.line
      && openParens(statement) === 0
    ) {
      if (options.prototypes === true) {
        const found = classify(statement)
        if (found !== null && 'name' in found) emit(statement, found)
      }
      statement = []
    }

    if (token.text === ';') {
      if (options.prototypes === true) {
        const found = classify(statement)
        if (found !== null && 'name' in found) emit(statement, found)
      }
      statement = []
      continue
    }

    statement.push(token)
  }

  // A language that ends statements by keyword can end the file mid-statement:
  // `const twice = (n) => n * 2` on the last line never meets a `;`. C cannot —
  // a declaration there is malformed — so the flush is the ASI profile's alone.
  if (statement.length > 0 && profile.startsStatement !== undefined && options.prototypes === true) {
    const found = classify(statement)
    if (found !== null && 'name' in found) emit(statement, found)
  }

  return symbols.sort((left, right) => left.line - right.line || left.name.localeCompare(right.name))
}
