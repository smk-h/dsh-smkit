/**
 * The shell profile: `.sh`, `.bash`, `.zsh`, `.ksh`, plus the rc files that have
 * no suffix at all (`.bashrc`, `.zshrc`, `.profile`, …).
 *
 * Shell is a simpler language to outline than C — a script declares functions and
 * little else — but two things defeat a naive tokeniser:
 *
 * - `#` is a comment only at the start of a word. `${path#prefix}` and `$#` are
 *   expansions, and blanking them as comments would swallow the closing brace and
 *   leave the rest of the file inside a function that never ends;
 * - a heredoc turns everything up to its terminator into data. `cat <<EOF`
 *   followed by shell-looking prose would otherwise read as declarations.
 *
 * Both are handled before the walk: the comment rule by the masker, the heredoc
 * by {@link blankHeredocs}.
 */

import { isIdentifier } from '../scan.js'
import type { Declaration, SourceProfile } from '../scan.js'
import type { Token } from '../syntax.js'

/** `<<EOF`, `<<-'EOF'`, `<<"EOF"` — an opener and the word that ends it. */
const HEREDOC = /<<(-?)[ \t]*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][\w-]*))/

/**
 * Blank heredoc bodies, keeping every line break.
 *
 * An opener with no terminator is not a heredoc — it is a `<<` inside a string or
 * a shift in `$(( … ))`, and blanking to the end of the file would lose the whole
 * script. That case returns the source untouched.
 *
 * @param source - the script's text.
 * @returns the text with heredoc bodies (and terminators) blanked.
 */
function blankHeredocs(source: string): string {
  const lines = source.split('\n')
  const kept: string[] = []
  let terminator: { word: string; stripTabs: boolean } | null = null

  for (const line of lines) {
    if (terminator !== null) {
      const candidate = terminator.stripTabs ? line.replace(/^\t+/, '') : line
      if (candidate.trimEnd() === terminator.word) {
        terminator = null
        kept.push('')
        continue
      }
      kept.push('')
      continue
    }
    kept.push(line)
    const open = HEREDOC.exec(line)
    if (open !== null) {
      const word = open[2] ?? open[3] ?? open[4] ?? ''
      if (word !== '') terminator = { word, stripTabs: open[1] === '-' }
    }
  }

  return terminator === null ? kept.join('\n') : source
}

/**
 * The shell classifier: `name() {` or `function name {`.
 *
 * Nothing else at the top level of a script declares a callable, so this never
 * defers to the default rules — a command line can contain parentheses
 * (`$(…)`, arrays) and must not be read as a declaration.
 *
 * @param statement - tokens since the last boundary, at the top level.
 * @returns the function the statement declares, or null.
 */
function classify(statement: readonly Token[]): Declaration | null {
  if (statement.length === 0) return null

  const keyword = statement.findIndex((token) => token.text === 'function')
  if (keyword >= 0) {
    const name = statement[keyword + 1]
    if (name !== undefined && isIdentifier(name.text)) {
      return { kind: 'function', name: name.text, line: statement[0]!.line }
    }
    return null
  }

  // `name() {`, and the same with a space before the parentheses.
  if (
    statement.length === 3
    && isIdentifier(statement[0]!.text)
    && statement[1]!.text === '('
    && statement[2]!.text === ')'
  ) {
    return { kind: 'function', name: statement[0]!.text, line: statement[0]!.line }
  }

  return null
}

export const SHELL_FAMILY: SourceProfile = {
  id: 'shell-family',
  syntax: {
    // A `#` inside `${var#pattern}` or `$#` is not a comment; the masker only
    // takes it at the start of a word.
    lineCommentsAfterSpace: ['#'],
    strings: ['"', "'", '`'],
    directives: false,
  },
  accept: classify,
  preprocess: blankHeredocs,
  /**
   * A newline ends a command.
   *
   * Shell has no semicolons between commands, so without this the statement
   * buffer would run from the top of the file into the first `{` and swallow the
   * function being declared: `COUNT=$#` followed by `log() {` would arrive as one
   * nine-token statement that matches nothing.
   */
  startsStatement: () => true,
}
