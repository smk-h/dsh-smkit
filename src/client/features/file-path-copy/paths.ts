/**
 * The relative-path projection the context menu copies.
 *
 * Ported split-for-split from `dsh-better-sidebar` (`src/client/paths.ts`,
 * `relativeTo`), because the two menus must put the same text on the clipboard:
 * the base loses its trailing separators, both sides normalize `\` to `/` for
 * the comparison only, the prefix test is case-insensitive (Windows and macOS
 * resolve paths that way) while the returned tail keeps the caller's casing,
 * the base itself projects to `.`, and a path outside the base is returned
 * unchanged rather than truncated.
 */

/**
 * The path relative to the session's working directory.
 * @param cwd - the explorer root (absolute).
 * @param path - an absolute entry path from the file tree.
 * @returns the relative path with '/' separators ('.' for the cwd itself),
 *   or `path` unchanged when it lies outside the cwd.
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
