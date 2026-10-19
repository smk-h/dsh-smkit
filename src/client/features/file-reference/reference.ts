/**
 * Turning one explorer row into an `@` reference in the current draft.
 *
 * Ported from `dsh-better-sidebar` (`src/client/reference-in-chat.ts`), where
 * the grammar had already been checked against the host: the token is spelled
 * against the session's WORKSPACE ROOT, never its cwd, because DSH's `@`
 * grammar is workspace-root relative. A cwd-relative guess silently names a
 * different file whenever the two differ, so an unresolved root is a logged
 * no-op rather than a fallback.
 *
 * The two kinds are inserted differently, exactly as the reference
 * implementation does it:
 *
 * - a FILE becomes a structured chip (`source: 'reference'`, basename label,
 *   `appearance: 'file'`, path in `ref`/`clipboardText`), so one reference is
 *   one link on send instead of a decorated leading folder. It goes in through
 *   the shell's own batch insert (`addFiles` → `insertFileReferences`); the
 *   `slash/input-insert-reference` event the picker emits is the fallback for
 *   hosts without that face.
 * - a FOLDER stays plain draft text (`@docs/`, quoted with the slash inside
 *   when the path has spaces): that text is what the shell's folder decoration
 *   and its completion are built on, and a chip would take both away. A file
 *   falls back to the same path when the host has no chip route at all.
 *
 * Deliberate deviation: the reference implementation appends everything at the
 * end of the draft (its file chip is span-CAS'd onto `draft.length`, and the
 * `<textarea>` caret probe never resolves on the real contenteditable
 * composer). This port inserts at the live caret instead — the shell's
 * `captureInsertion` is the one source that speaks the `span` coordinates — and
 * keeps the `<textarea>` probe only as the fallback for hosts whose composer
 * really is a textarea (see `platform/composer.ts`).
 *
 * Everything here degrades to a logged no-op: a missing conversation service,
 * an unready workspace snapshot, a session outside the workspace, or a path
 * the mention grammar cannot represent. It never guesses and never inserts an
 * absolute path.
 */

import type { ClientContext } from '../../platform/types'
import { appendToDraft, needsLeadingSpace, placeComposerCaretAfterInsert, probeInsertion, resolveInput } from '../../platform/composer'
import type { ConversationInput } from '../../platform/composer'

/** One reference chip, in the shape the shell builds its node from. */
interface ChipInsert {
  source: 'reference'
  ref: string
  label: string
  appearance: 'file' | 'folder'
  clipboardText: string
}

/** The write face of one session-scope context (cordis `emit`). */
interface ScopeContext {
  emit(name: string, payload: unknown): void
}

/** One workspace row of the host's `workspaces` snapshot. */
interface WorkspaceRow {
  path: string
  sessionIds: readonly string[]
}

/** The host-authoritative workspace snapshot, read at click time. */
interface WorkspaceSnapshot {
  phase?: string
  state?: string
  items?: readonly WorkspaceRow[]
}

/** The `workspaces` client service, as this feature uses it. */
interface WorkspacesService {
  list?: { getSnapshot(): WorkspaceSnapshot | undefined }
}

/**
 * Read one client service without declaring it in the bundle's `inject` list.
 *
 * Late on purpose: the workspace catalog is provided by a shell package this
 * plugin does not require, so a host missing it must lose the click, not the
 * whole client entry.
 */
function service<T>(ctx: ClientContext, name: string): T | undefined {
  try {
    return ctx.reflect?.get(name) as T | undefined
  } catch {
    return undefined
  }
}

/**
 * Mirror of the host's absolute-path notion (`fs-tree.requireAbsolute`): POSIX
 * roots, Windows drive letters, UNC shares in either separator style, and
 * `~`-rooted home paths. A superset on purpose — a form the host would reject
 * must still not be joined onto a relative token here.
 */
function isAbsolutePath(path: string): boolean {
  return path === '~' || path.startsWith('~/') || path.startsWith('~\\')
    || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]/.test(path)
}

/**
 * Project an absolute explorer path against the host-confirmed workspace root.
 *
 * Unlike a display helper, mention insertion must never fall back to an
 * absolute token: an unknown root, a traversal component, or a path outside
 * the workspace is refused. Windows drive/UNC paths compare case-insensitively;
 * POSIX paths keep their distinction. Separators normalize to `/` (the tree's
 * own spelling) before comparison, and trailing slashes are ignored.
 */
export function workspaceRelativePath(root: string | undefined, path: string): string | undefined {
  if (root === undefined || !isAbsolutePath(root) || !isAbsolutePath(path)) return undefined
  const norm = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = norm(root)
  const target = norm(path)
  if ([base, target].some(value => value.split('/').some(part => part === '.' || part === '..'))) return undefined
  const windows = /^[A-Za-z]:\//.test(root.replace(/\\/g, '/')) || /^[\\/]{2}/.test(root)
  const compare = (value: string): string => (windows ? value.toLowerCase() : value)
  if (compare(target) === compare(base)) return '.'
  if (!compare(target).startsWith(`${compare(base)}/`)) return undefined
  const relative = target.slice(base.length + 1)
  return relative === '' || isAbsolutePath(relative) ? undefined : relative
}

/** The final segment of a `/`- or `\`-separated path. */
function baseName(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * The DSH `@` spelling for one relative path, mirroring the host grammar:
 * plain when there is no whitespace, quoted when there is, and `undefined`
 * when the path carries a control character or an embedded quote the grammar
 * cannot represent.
 *
 * A folder's trailing slash sits INSIDE the quotes (`@"my dir/"`): the host's
 * folder token matcher only classifies a quoted directory once the quote
 * closes, and an unquoted `@my dir/` decorates as a file chip covering just
 * `my`.
 */
export function mentionFor(
  relativePath: string,
  kind: 'file' | 'folder',
): { mention: string; label: string } | undefined {
  const path = relativePath.replace(/[\\/]+$/, '')
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point of this guard
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined
  const target = kind === 'folder' ? `${path}/` : path
  const mention = /\s/u.test(target) ? `@"${target}"` : `@${target}`
  return { mention, label: baseName(path) }
}

/**
 * Build the chip one FILE becomes: the native picker's shape, with the
 * basename as its copy — the tree the row was clicked in already said where
 * the file lives, and the path travels in `ref` / `clipboardText` instead.
 *
 * Directories never come through here: they stay plain draft text (`@docs/`),
 * which is what keeps the host's own folder decoration and completion working
 * (`src/client/reference-in-chat.ts` in the reference implementation).
 */
function chipFor(relativePath: string): ChipInsert | undefined {
  const reference = mentionFor(relativePath, 'file')
  if (reference === undefined) return undefined
  return {
    source: 'reference',
    ref: reference.mention,
    label: reference.label,
    appearance: 'file',
    clipboardText: reference.mention,
  }
}

/**
 * Insert one FILE reference as a structured chip, exactly as the native `@`
 * picker does: the chip shows the basename but serializes to the workspace
 * relative path — one link from trigger to basename instead of a decorated
 * leading folder.
 *
 * The shell's `addFiles` is the host's own batch insert (the picker's
 * `insertFileReferences`): it writes at the LIVE caret, appends the space a chip
 * needs and prefixes one when the caret follows a word, so the caret and the
 * word boundary are its business, not this feature's — and it answers with a
 * boolean instead of a revision to compare. Hosts without it only have the
 * insert event, which is why that path still exists (see `emitReferenceChip`).
 *
 * Three outcomes, because "no chip" and "refused" are different situations:
 * `true` — the chip is in the draft; `false` — the host was asked and refused
 * (a busy draft), so nothing else may be written, exactly as the native picker
 * leaves the composer alone; `undefined` — this host has no chip route at all,
 * and the caller is free to fall back to plain draft text.
 */
export function insertFileReference(
  ctx: ClientContext,
  sessionId: string,
  relativePath: string,
): boolean | undefined {
  const chip = chipFor(relativePath)
  if (chip === undefined) return undefined
  try {
    const input = resolveInput(ctx, sessionId)
    if (input === undefined) return undefined
    const added = input.addFiles?.([chip], [])
    if (added !== undefined) return added
    // No batch face: the insert event is the only chip route left, and a host
    // that does not take it has no chip route at all.
    return emitReferenceChip(ctx, sessionId, input, chip) ? true : undefined
  } catch (error) {
    console.warn('[smkit] file-reference insert failed:', error)
    return undefined
  }
}

/**
 * The older route: hand the chip to the composer's insert event.
 *
 * Only reached when the shell has no `addFiles`, so the caret's detect span and
 * the word boundary become this feature's job — the event writes its trailing
 * space but never a leading one, and a chip glued to a word is a chip the `@`
 * grammar no longer sees.
 */
function emitReferenceChip(
  ctx: ClientContext,
  sessionId: string,
  input: ConversationInput,
  chip: ChipInsert,
): boolean {
  const actx = ctx.sessions?.scope?.(sessionId) as ScopeContext | undefined
  if (actx === undefined) return false
  let snapshot = input.state.getSnapshot()
  if (snapshot.draftRev === undefined) return false
  let point = probeInsertion(input, snapshot.draft)
  if (point !== null && point.source === 'host' && point.start === point.end
    && needsLeadingSpace(input, point)) {
    const spaced = input.actions?.insertText?.(' ', {
      start: point.start,
      end: point.end,
      draftRev: snapshot.draftRev,
    })
    if (spaced === true) {
      snapshot = input.state.getSnapshot()
      if (snapshot.draftRev === undefined) return false
      point = probeInsertion(input, snapshot.draft)
    }
  }
  // The session-scope context's typed `emit` is keyed to the host's closed
  // event map; this internal composer event is deliberately string-loose.
  actx.emit('slash/input-insert-reference', {
    reference: chip,
    span: {
      draftRev: snapshot.draftRev,
      start: point?.start ?? snapshot.draft.length,
      end: point?.end ?? snapshot.draft.length,
    },
  })
  const after = input.state.getSnapshot()
  if (after.draftRev === snapshot.draftRev) return false
  if (point !== null && point.source === 'dom') {
    // A DOM caret is a string index, so it has to be re-derived from the
    // committed text: the host owns the token's spelling (quotes, the space
    // after a chip), hence the length measured against the draft rather than
    // the mention's own length. A host caret needs no help — the editor's
    // own insert already leaves the selection after the new chip.
    const replaced = point.end - point.start
    const inserted = after.draft.length - snapshot.draft.length + replaced
    placeComposerCaretAfterInsert(after.draft, point.start + Math.max(0, inserted))
  }
  return true
}

/**
 * Reference one absolute entry path in the session's conversation draft.
 *
 * The workspace root is read from the public snapshot at click time, so a
 * reconnect or a session change cannot leave a captured root stale; membership
 * is matched by exact session id, the same lookup the native conversation
 * shell performs. Missing/unready membership and unrepresentable paths are
 * logged no-ops.
 *
 * @returns whether the draft changed. The chip's caller ignores it for the
 *   row's sake: the chip is a sibling of the row button, so a press never
 *   reaches the row either way.
 */
export function insertWorkspaceReference(
  ctx: ClientContext,
  sessionId: string,
  path: string,
  isDir: boolean,
): boolean {
  try {
    const workspaces = service<WorkspacesService>(ctx, 'workspaces')
    const snapshot = workspaces?.list?.getSnapshot()
    const root = snapshot?.phase === 'ready' && snapshot.state === 'idle'
      ? snapshot.items?.find(workspace => workspace.sessionIds.includes(sessionId))?.path
      : undefined
    const relative = workspaceRelativePath(root, path)
    if (relative === undefined) {
      console.warn('[smkit] reference insert skipped: workspace root unavailable or path outside workspace')
      return false
    }
    // One constructor for both kinds, so the quoting rule cannot drift between
    // them; a folder's separators normalize to '/' like the tree's spelling.
    const mention = isDir
      ? mentionFor(relative.replace(/\\/g, '/'), 'folder')?.mention
      : mentionFor(relative, 'file')?.mention
    if (mention === undefined) {
      console.warn('[smkit] reference insert skipped: path cannot be represented as a mention')
      return false
    }
    // Files: a structured chip, so the reference stays one link. Folders: plain
    // draft text, which is what keeps the host's folder decoration and its
    // completion working — `@docs/` is a folder token to DSH, a chip is not.
    if (!isDir) {
      const inserted = insertFileReference(ctx, sessionId, relative)
      if (inserted !== undefined) return inserted
    }
    // No chip (a folder, or a host without the chip route): plain draft text at
    // the caret. A folder carries its own trailing separator — text has no chip
    // to add one, and the next reference needs the boundary.
    return appendToDraft(ctx, sessionId, isDir ? `${mention} ` : mention)
  } catch (error) {
    console.warn('[smkit] workspace-reference insert failed:', error)
    return false
  }
}


