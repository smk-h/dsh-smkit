/**
 * The on-disk session layout, mirrored from the harness's JSONL persistence
 * backend.
 *
 * Deleting a session means removing its artifact directory, and the harness
 * exposes no `delete` on the persistence seam (see the removal note below), so
 * the path has to be rebuilt here. The two builders below are ported verbatim
 * from `@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts`
 * (`encodeSegment`, `projectKey`, `projectDir`, `sessionDir`) — the plugin
 * never imports `@deepseek-ai/*` code, and these are pure functions with no
 * dependency of their own.
 *
 * The port is a *fallback*, not the primary lookup: `session-delete.ts` first
 * asks the persistence service itself (`resolveCurrentLog`, the backend's own
 * configured root) and only rebuilds a path when the service cannot answer.
 * Pinning the harness's default root here would be wrong for a deployment that
 * points the backend somewhere else, so the default (`$DSH_HOME/sessions`) is
 * the last resort rather than the assumption.
 *
 * ## Why not just archive?
 *
 * The harness can only *hide* a session: `WorkspaceRegistry.archiveSession`
 * writes the id into a registry-global display set, and the sidebar drops the
 * row while the log stays on disk. Hiding is exactly the wrong thing for an
 * unwanted session, and hidden-not-deleted is what this feature removes.
 */

import { join } from 'node:path'

/**
 * Encode an arbitrary string as one safe path segment, injectively over all JS
 * strings (including lone surrogates). A session id is an unvalidated branded
 * string, so this neutralises `../`, absolute paths, NUL, and separators before
 * any filesystem use; `.` and `..` are special-cased so an otherwise safe
 * segment cannot traverse.
 * @param raw - the string to encode; must be non-empty.
 * @returns the escaped single path segment.
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

/**
 * Build the human-navigable project directory key for one workspace path:
 * filesystem and drive separators collapse into `-`, unsafe code units use the
 * same `~XXXX` escape as session ids, and the key is bounded for filesystem
 * component limits. Separator collapsing and truncation are intentionally
 * lossy, matching the harness convention.
 * @param cwd - the session's project directory.
 * @returns a single filesystem-safe project directory name.
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/**
 * The project directory a session groups under; a session without a `cwd`
 * lives in `_no-cwd`.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory, or undefined.
 * @returns the project directory path under `root`.
 */
export function projectDir(root: string, cwd: string | undefined): string {
  if (cwd === undefined) return join(root, '_no-cwd')
  return join(root, projectKey(cwd))
}

/**
 * The directory owned by one session: its log, its write lock, and any future
 * session-local artifacts. This is the unit `session-delete.ts` removes.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory.
 * @param id - the session id, encoded to one safe path segment.
 * @returns the session directory beneath its project directory.
 */
export function sessionDir(root: string, cwd: string | undefined, id: string): string {
  return join(projectDir(root, cwd), encodeSegment(id))
}
