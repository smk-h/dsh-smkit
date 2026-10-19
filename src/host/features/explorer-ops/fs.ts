/**
 * The two creating operations behind the file tree's "new folder" / "new file"
 * rows.
 *
 * Ported from `dsh-better-sidebar` (`src/fs-operations.ts`: `mkdirWorkspaceEntry`
 * and `createWorkspaceFile`), minus its workspace resolution — the browser half
 * hands over the absolute directory the row carries, so there is no session cwd
 * to project against here.
 *
 * Kept rules, all of them the ones that turn a mistake into a sentence instead
 * of a bare `EPERM` on one platform and nothing at all on the others:
 *
 * - the name is ONE path segment, and it must survive a Windows host even when
 *   this one is not Windows (the same workspace gets opened on both);
 * - an existing destination is refused — file, folder, or a dangling symlink —
 *   and a new file is written with `wx`, so a name that appears between the
 *   check and the write is refused rather than truncated;
 * - the parent must be a directory; nothing is created recursively.
 */

import { lstat, mkdir, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { ExplorerCreateRefusal } from '../../../shared/explorer-ops/contract.js'

/** Which of the two rows asked. */
export type CreateKind = 'file' | 'folder'

/** What one creation came to, in the shape the route maps onto HTTP. */
export type CreateOutcome =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly code: ExplorerCreateRefusal; readonly message: string }

/**
 * Characters Windows refuses in a NAME (control characters are refused beside
 * these, see {@link nameProblem}). Checked on every platform on purpose.
 */
const ILLEGAL_NAME_CHARS = /[<>:"|?*\u0000-\u001f]/

/**
 * Windows device names, reserved in every directory with or without an
 * extension (`NUL.txt` names the device too, so the check is on the segment
 * before the first dot).
 */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
])

/** The longest name Windows stores (UTF-16 units, its own limit). */
const MAX_NAME_LENGTH = 255

/**
 * Why one typed name cannot be created, or undefined when it can.
 *
 * Iterating (not indexing) keeps astral characters whole, so an emoji name is
 * never mistaken for two illegal halves.
 * @param name - the trimmed name from the inline editor.
 * @returns the sentence to show beside the input, or undefined.
 */
export function nameProblem(name: string): string | undefined {
  if (name === '' || name === '.' || name === '..') return 'a name is required'
  if (name.includes('/') || name.includes('\\')) return 'a name cannot contain a path separator'
  if (name.length > MAX_NAME_LENGTH) return 'a name cannot be longer than 255 characters'
  for (const char of name) {
    if (ILLEGAL_NAME_CHARS.test(char)) {
      return `a name cannot contain ${JSON.stringify(char)}`
    }
  }
  if (RESERVED_NAMES.has(name.split('.')[0]!.toLowerCase())) {
    return `"${name}" is a reserved device name on Windows`
  }
  // Windows silently drops a trailing dot or space, so `<name>` and `<name>.`
  // would name the same entry there and differ here.
  if (process.platform === 'win32' && /[. ]$/.test(name)) {
    return 'a name cannot end with a dot or a space on Windows'
  }
  return undefined
}

/** Whether any entry — including a dangling symlink — occupies `path`. */
async function occupied(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Create one entry inside `directory`.
 * @param kind - file (empty, `wx`) or folder (one level, no recursion).
 * @param directory - absolute path of the directory the row names.
 * @param name - one path segment, already trimmed by the caller.
 * @returns the new entry's absolute path, or the refusal to map onto HTTP.
 */
export async function createEntry(kind: CreateKind, directory: string, name: string): Promise<CreateOutcome> {
  const problem = nameProblem(name)
  if (problem !== undefined) return { ok: false, code: 'explorer/invalid-name', message: problem }

  if (!isAbsolute(directory)) {
    return { ok: false, code: 'explorer/not-directory', message: `"${directory}" is not an absolute directory path` }
  }
  const parent = resolve(directory)
  try {
    if (!(await stat(parent)).isDirectory()) {
      return { ok: false, code: 'explorer/not-directory', message: `"${directory}" is not a directory` }
    }
  } catch {
    return { ok: false, code: 'explorer/not-directory', message: `"${directory}" is not a directory` }
  }

  const destination = join(parent, name)
  if (await occupied(destination)) {
    return { ok: false, code: 'explorer/exists', message: `"${name}" already exists` }
  }

  try {
    if (kind === 'folder') await mkdir(destination)
    else await writeFile(destination, '', { flag: 'wx', encoding: 'utf8' })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const message = error instanceof Error ? error.message : String(error)
    if (code === 'EEXIST' || code === 'ENOTEMPTY') {
      return { ok: false, code: 'explorer/exists', message: `"${name}" already exists` }
    }
    if (code === 'ENAMETOOLONG' || code === 'EINVAL') {
      return { ok: false, code: 'explorer/invalid-name', message }
    }
    return { ok: false, code: 'explorer/unavailable', message }
  }

  return { ok: true, path: destination }
}
