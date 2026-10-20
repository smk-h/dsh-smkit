/**
 * The language-agnostic half of the scanner: masking and tokenising.
 *
 * A profile supplies the rules (what a comment looks like, what quotes a
 * literal, whether `#` lines are directives); everything here is mechanical and
 * knows nothing about declarations. Keeping the two apart is what lets a second
 * language be added as data: the walk in `scan.ts` reads the token stream, not
 * the language.
 *
 * Everything is line-preserving. Masked characters are replaced one for one and
 * newlines are never removed, so a token's line is the line the reader sees in
 * the preview and a jump lands on the right row.
 */

/** The lexical rules one language needs. */
export interface MaskRules {
  /** Comment openers that run to the end of the line, e.g. `//`. */
  readonly lineComments?: readonly string[]
  /**
   * Markers that only begin a comment at the start of a word — shell's `#`.
   *
   * `foo#bar` is a parameter expansion (`${x#prefix}`), not a comment, and
   * treating it as one would blank the closing brace and unbalance the file.
   */
  readonly lineCommentsAfterSpace?: readonly string[]
  /** Pairs that run until the closing marker, e.g. `/*` … `*``/`. */
  readonly blockComments?: readonly (readonly [open: string, close: string])[]
  /** Quote characters a literal may open with, e.g. `"` and `'`. */
  readonly strings?: readonly string[]
  /**
   * Whether a line whose first non-space character is `#` is a directive, and
   * whether a trailing backslash continues it.
   *
   * True for C, false for the many brace languages where `#` is an operator or a
   * private-field marker.
   */
  readonly directives?: boolean
}

/** One directive line the masker stepped over. */
export interface Directive {
  /** 1-based line the directive starts on. */
  readonly line: number
  /** The line as written, trimmed, continuations not joined. */
  readonly text: string
}

/** What masking leaves behind. */
export interface MaskedSource {
  /** The source with comments, literals and directives blanked. */
  readonly text: string
  /** Directive lines in file order — the raw material for macro symbols. */
  readonly directives: readonly Directive[]
}

/** One lexical token of the masked source. */
export interface Token {
  readonly text: string
  /** 1-based line the token starts on. */
  readonly line: number
}

/**
 * Blank everything that cannot hold a declaration.
 *
 * Directives go first and line by line: whether the next line is part of the
 * same directive depends on this one's trailing backslash, so the two cannot be
 * decided independently. The directive text is kept for the profile — once the
 * line is blank, a `#define`'s name is unrecoverable.
 *
 * @param source - the file's text.
 * @param rules - the language's lexical rules.
 * @returns the blanked text (newlines intact) and the directives it stepped over.
 */
export function mask(source: string, rules: MaskRules): MaskedSource {
  const directives: Directive[] = []
  const lines = source.split('\n')
  const kept: string[] = []
  let continuing = false

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const trimmed = line.trimStart()
    const directive = rules.directives === true && (continuing || trimmed.startsWith('#'))
    if (directive) {
      if (!continuing) directives.push({ line: index + 1, text: trimmed })
      continuing = line.endsWith('\\')
      kept.push('')
      continue
    }
    kept.push(line)
  }

  const text = blankLiterals(kept.join('\n'), rules)
  return { text, directives }
}

/**
 * Replace comments and literals with spaces, keeping every newline.
 *
 * A block comment spanning lines is why this is a character scan rather than a
 * line scan: blanking the line boundaries would shift every later line number.
 *
 * @param text - source with directives already blanked.
 * @param rules - the language's lexical rules.
 * @returns the same text, same length per line, with nothing readable inside comments or literals.
 */
function blankLiterals(text: string, rules: MaskRules): string {
  const lineComments = rules.lineComments ?? []
  const wordComments = rules.lineCommentsAfterSpace ?? []
  const blockComments = rules.blockComments ?? []
  const strings = rules.strings ?? []
  let clean = ''
  let at = 0

  while (at < text.length) {
    const wordComment = wordComments.some(
      (marker) => text.startsWith(marker, at) && (at === 0 || /\s|[;|&(]/.test(text[at - 1]!)),
    )
    const lineComment = wordComment
      ? true
      : lineComments.find((marker) => text.startsWith(marker, at)) !== undefined
    if (lineComment) {
      while (at < text.length && text[at] !== '\n') {
        clean += ' '
        at++
      }
      continue
    }

    const block = blockComments.find(([open]) => text.startsWith(open, at))
    if (block !== undefined) {
      const [open, close] = block
      clean += ' '.repeat(open.length)
      at += open.length
      while (at < text.length && !text.startsWith(close, at)) {
        clean += text[at] === '\n' ? '\n' : ' '
        at++
      }
      if (at < text.length) {
        clean += ' '.repeat(close.length)
        at += close.length
      }
      continue
    }

    const char = text[at]!
    if (strings.includes(char)) {
      clean += ' '
      at++
      while (at < text.length && text[at] !== char) {
        if (text[at] === '\\') {
          clean += ' '
          at++
          if (at < text.length) {
            clean += text[at] === '\n' ? '\n' : ' '
            at++
          }
          continue
        }
        clean += text[at] === '\n' ? '\n' : ' '
        at++
      }
      if (at < text.length) {
        clean += ' '
        at++
      }
      continue
    }

    clean += char
    at++
  }

  return clean
}

/**
 * Split masked text into identifiers and single-character punctuation.
 *
 * Numbers are dropped: no declaration is named by one, and keeping them would
 * only add tokens for the walk to step over.
 *
 * @param text - masked source.
 * @returns the tokens, in order, each carrying its 1-based line.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let line = 1
  let at = 0
  while (at < text.length) {
    const char = text[at]!
    if (char === '\n') {
      line++
      at++
      continue
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      at++
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = at + 1
      while (end < text.length && /\w/.test(text[end]!)) end++
      tokens.push({ text: text.slice(at, end), line })
      at = end
      continue
    }
    if (/\d/.test(char)) {
      let end = at + 1
      while (end < text.length && /[\w.]/.test(text[end]!)) end++
      at = end
      continue
    }
    tokens.push({ text: char, line })
    at++
  }
  return tokens
}
