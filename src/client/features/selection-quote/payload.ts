/**
 * The block one preview selection becomes in the composer.
 *
 * Ported from `dsh-better-sidebar` (`src/client/selection-payload.ts`), where
 * the shape was agreed with the product owner and proven against the host:
 *
 * - a selection of at most {@link SELECTION_LIMIT} characters becomes a fenced
 *   code block whose info line is `path:start-end` (a single line is `path:12`,
 *   an unknown line span just `path`), and whose body is the selected text;
 * - a longer selection becomes the bare `path:start-end` line: an empty fenced
 *   block would only take up room in the draft;
 * - the path is relative to the session's working directory (what the reader
 *   sees in the preview header, minus the noise to their left), and an unknown
 *   cwd falls back to the absolute path.
 *
 * Everything here is string math — no DOM, no context — so the tests drive it
 * through the bundle's behaviour and the rules stay readable.
 */

/** Max inserted selection length, in UTF-16 code units (i.e. JS `.length`). */
export const SELECTION_LIMIT = 500

/** The source line span a selection covers (1-based, inclusive). */
export interface SelectionLines {
  start: number
  end: number
}

/**
 * The path relative to the session's working directory.
 *
 * The same projection as the reference implementation's `relativeTo`: a prefix
 * test tolerant of separator style and, because a Windows or macOS volume may
 * hand the two halves back with different casing, of case as well. A path
 * outside the cwd has no relative spelling, so it is returned unchanged — an
 * absolute path is still a usable answer in the draft.
 *
 * @param cwd - the session's working directory (absolute).
 * @param path - the previewed file's path, as the preview header spells it.
 * @returns the relative path with `/` separators (`'.'` for the cwd itself).
 */
export function relativeTo(cwd: string, path: string): string {
  const base = cwd.replace(/[\\/]+$/, '')
  const norm = (value: string): string => value.replace(/\\/g, '/')
  const nBase = norm(base)
  const nPath = norm(path)
  if (nPath === nBase) return '.'
  if (nPath.toLowerCase().startsWith(`${nBase.toLowerCase()}/`)) return nPath.slice(nBase.length + 1)
  return path
}

/**
 * The fence's info line: `path[:start[-end]]`.
 *
 * @param path - the previewed file's path.
 * @param cwd - the session's working directory, when it is known.
 * @param lines - the lines the selection covers, when the preview can say.
 * @returns the header, e.g. `src/a.ts:12-15`.
 */
export function quoteHeader(path: string, cwd: string | undefined, lines?: SelectionLines): string {
  const relative = cwd === undefined ? path : relativeTo(cwd, path)
  if (lines === undefined) return relative
  return lines.end > lines.start ? `${relative}:${lines.start}-${lines.end}` : `${relative}:${lines.start}`
}

/**
 * The text appended to the composer draft for one selection.
 *
 * @param path - the previewed file's path.
 * @param cwd - the session's working directory, when it is known.
 * @param lines - the lines the selection covers, when the preview can say.
 * @param selected - the selected text, exactly as the reader selected it.
 * @returns the fenced block, or just the header when the text is too long.
 */
export function buildQuote(
  path: string,
  cwd: string | undefined,
  lines: SelectionLines | undefined,
  selected: string,
): string {
  const header = quoteHeader(path, cwd, lines)
  if (selected.length > SELECTION_LIMIT) return header
  return `\`\`\`${header}\n${selected}\n\`\`\``
}
