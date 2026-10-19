/**
 * What the reader typed into the go-to-line box, read as a line number.
 *
 * Kept apart from the watcher because it is the one rule with no DOM in it, and
 * pinned by its own tests: the box accepts the three spellings an editor's
 * "go to line" accepts — `120`, `:120`, and `120:8` (line 120, column 8) — and
 * this preview has no caret to put in a column, so the column is dropped.
 *
 * Everything else is a refusal: an empty box, a name, a zero or a negative.
 * The caller treats a refusal as "nothing to jump to" and closes quietly, which
 * is what pressing Enter in an untouched box should do.
 *
 * @param text - what the box holds.
 * @returns the 1-based line, or null when the text names none.
 */
export function parseLine(text: string): number | null {
  const match = /^\s*:?\s*(\d+)/.exec(text)
  if (match === null) return null
  const line = Number(match[1])
  return Number.isSafeInteger(line) && line >= 1 ? line : null
}
