/**
 * Turning one explorer row into an `@` reference in the current draft.
 *
 * Ported from `dsh-better-sidebar` (`src/client/reference-in-chat.ts` and
 * `src/client/conversation-draft.ts`), where the grammar had already been
 * checked against the host: the token is spelled against the session's
 * WORKSPACE ROOT, never its cwd, because DSH's `@` grammar is workspace-root
 * relative. A cwd-relative guess silently names a different file whenever the
 * two differ, so an unresolved root is a logged no-op rather than a fallback.
 *
 * The two insertion paths are the host's own, not an imitation:
 *
 * - a FILE goes through `slash/input-insert-reference`, the event the shell's
 *   native `@` picker emits. The conversation input machine mints one
 *   occurrence that covers the whole reference, so the sent message carries a
 *   single link instead of decorating only the leading folder. The event is
 *   span-CAS'd (`draftRev`), which is also how success is detected: the draft
 *   revision only moves when the machine accepted the insert.
 * - a FOLDER is plain draft text through the conversation input service, and
 *   a FILE falls back to that same path when the host did not handle the
 *   event. Plain text keeps the shell's folder decoration and completion
 *   working, at the cost of the file name never being part of the chip.
 *
 * The draft store exposes no caret API — only the whole string — so the live
 * caret is read from the composer's `<textarea>` (guarded by a value-sync
 * check) and restored after the programmatic commit, which is the only way
 * stacked inserts stay at the running position.
 *
 * Everything here degrades to a logged no-op: a missing conversation service,
 * an unready workspace snapshot, a session outside the workspace, or a path
 * the mention grammar cannot represent. It never guesses and never inserts an
 * absolute path.
 */

import type { ClientContext } from '../../platform/types'

/** A resolved composer caret/selection in draft coordinates. */
interface DraftCaret {
  start: number
  end: number
}

/** The spliced draft plus the caret index (in that draft) right after the text. */
interface SpliceResult {
  draft: string
  caretAfter: number
}

/** The composer draft face reached through `ctx.conversation.input`. */
interface ConversationInput {
  state: { getSnapshot(): { draft: string; draftRev?: number } }
  setDraft(text: string): void
}

/** The `conversation` client service, as this feature uses it. */
interface ConversationService {
  input: { for(actx: unknown): ConversationInput }
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

/** The right sidebar's navigation face, read for its session when the DOM has none. */
interface SidebarRightService {
  mounted?: { getSnapshot(): string | undefined }
}

/**
 * Read one client service without declaring it in the bundle's `inject` list.
 *
 * Late on purpose: the conversation input, the workspace catalog and the
 * right sidebar are provided by shell packages this plugin does not require,
 * so a host missing one must lose the click, not the whole client entry.
 */
function service<T>(ctx: ClientContext, name: string): T | undefined {
  try {
    return ctx.reflect?.get(name) as T | undefined
  } catch {
    return undefined
  }
}

/**
 * Splice `text` into `draft` at `caret` (replacing any live selection) with
 * whitespace-aware joins, reporting the caret position right after the
 * inserted text. `caret === null` (position unknown) appends at the end.
 */
function spliceInsert(draft: string, text: string, caret: DraftCaret | null): SpliceResult {
  if (caret === null || draft === '') {
    const next = draft.trim() === '' ? text : `${draft}${/\s$/.test(draft) ? '' : ' '}${text}`
    return { draft: next, caretAfter: next.length }
  }
  const prefix = draft.slice(0, caret.start)
  const suffix = draft.slice(caret.end)
  if (prefix === '' && suffix === '') return { draft: text, caretAfter: text.length }
  // One separating space, but never doubled against adjacent whitespace (or
  // the string edges) — the way typing in the middle of a sentence behaves.
  const left = prefix === '' || /\s$/.test(prefix) ? '' : ' '
  const right = suffix === '' || /^\s/.test(suffix) || /\s$/.test(text) ? '' : ' '
  return {
    draft: `${prefix}${left}${text}${right}${suffix}`,
    caretAfter: prefix.length + left.length + text.length,
  }
}

/**
 * Locate the composer `<textarea>`: the `data-phase`-tagged one inside the
 * conversation column, falling back to any textarea in that column and then to
 * a bare `data-phase` textarea on hosts whose column carries no slot marker.
 */
function findComposerTextarea(): HTMLTextAreaElement | null {
  if (typeof document === 'undefined') return null
  const column = document.querySelector('#root [data-slot="conversation"]')
  const find = (scope: ParentNode): HTMLTextAreaElement | null =>
    scope.querySelector<HTMLTextAreaElement>('textarea[data-phase]') ?? scope.querySelector<HTMLTextAreaElement>('textarea')
  return column !== null
    ? find(column)
    : document.querySelector<HTMLTextAreaElement>('textarea[data-phase]')
}

/**
 * Resolve the composer's live caret from its DOM `<textarea>`.
 *
 * The value-sync check (`el.value === draft`) discards stale or wrong-composer
 * reads: a caret must never be applied against a draft it was not measured on.
 * Null when the composer is missing, disabled, out of sync, or reports no
 * measurable selection.
 */
function probeComposerCaret(draft: string): DraftCaret | null {
  const el = findComposerTextarea()
  if (el === null || el.disabled || el.readOnly) return null
  if (el.value !== draft) return null
  let start = el.selectionStart
  let end = el.selectionEnd
  if (typeof start !== 'number' || typeof end !== 'number') return null
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  start = Math.max(0, Math.min(start, draft.length))
  end = Math.max(start, Math.min(end, draft.length))
  return { start, end }
}

/**
 * Restore the composer caret after a programmatic `setDraft` commit.
 *
 * A controlled textarea resets its caret when React commits the value, so the
 * placement is scheduled and retried across at most two animation frames, and
 * only applied while the textarea still matches `expectedDraft` — a newer edit
 * or a different composer wins the race untouched.
 */
function placeComposerCaretAfterInsert(expectedDraft: string, caretIndex: number): void {
  let remaining = 2
  let scheduled = false
  const schedule = (fn: () => void): void => {
    if (scheduled) return
    scheduled = true
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn)
    else setTimeout(fn, 0)
  }
  const place = (): void => {
    scheduled = false
    if (remaining <= 0) return
    remaining -= 1
    const el = findComposerTextarea()
    if (el === null || el.disabled || el.readOnly) return
    if (el.value !== expectedDraft) {
      // The commit has not landed yet (or a competing edit won): one more frame.
      schedule(place)
      return
    }
    const clamped = Math.max(0, Math.min(caretIndex, el.value.length))
    el.setSelectionRange(clamped, clamped)
  }
  schedule(place)
}

/**
 * Insert `text` into the session's draft at the composer's live caret,
 * appending when the caret cannot be resolved. False (and logged) when the
 * conversation service or the session scope is unavailable.
 */
function appendToDraft(ctx: ClientContext, sessionId: string, text: string): boolean {
  try {
    const actx = ctx.sessions?.scope?.(sessionId)
    if (actx === undefined) {
      console.warn('[smkit] reference insert skipped: no session scope', sessionId)
      return false
    }
    const conversation = service<ConversationService>(ctx, 'conversation')
    if (conversation === undefined) {
      console.warn('[smkit] reference insert skipped: conversation service unavailable')
      return false
    }
    const input = conversation.input.for(actx)
    const draft = input.state.getSnapshot().draft
    const caret = probeComposerCaret(draft)
    const { draft: next, caretAfter } = spliceInsert(draft, text, caret)
    input.setDraft(next)
    placeComposerCaretAfterInsert(next, caretAfter)
    return true
  } catch (error) {
    console.warn('[smkit] draft insert failed:', error)
    return false
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
 * Insert one FILE reference as a structured chip, exactly as the native `@`
 * picker does. The chip shows the basename but serializes to the workspace
 * relative path. False when the host did not take the event (or is too old to
 * have it), which the caller answers by falling back to plain draft text.
 */
export function insertFileReference(ctx: ClientContext, sessionId: string, relativePath: string): boolean {
  const reference = mentionFor(relativePath, 'file')
  if (reference === undefined) return false
  try {
    const actx = ctx.sessions?.scope?.(sessionId)
    if (actx === undefined) return false
    const conversation = service<ConversationService>(ctx, 'conversation')
    if (conversation === undefined) return false
    const input = conversation.input.for(actx)
    const before = input.state.getSnapshot()
    if (before.draftRev === undefined) return false
    // The session-scope context's typed `emit` is keyed to the host's closed
    // event map; this internal composer event is deliberately string-loose.
    ;(actx as ScopeContext).emit('slash/input-insert-reference', {
      reference: {
        source: 'reference',
        ref: reference.mention,
        label: reference.label,
        appearance: 'file',
        clipboardText: reference.mention,
      },
      span: {
        draftRev: before.draftRev,
        start: before.draft.length,
        end: before.draft.length,
      },
    })
    const after = input.state.getSnapshot()
    return after.draftRev !== before.draftRev
  } catch (error) {
    console.warn('[smkit] file-reference insert failed:', error)
    return false
  }
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
    if (!isDir && insertFileReference(ctx, sessionId, relative)) return true
    // The host adds space after a file chip, but not before it: a complete
    // folder insert needs its own separator for the next click.
    return appendToDraft(ctx, sessionId, isDir ? `${mention} ` : mention)
  } catch (error) {
    console.warn('[smkit] workspace-reference insert failed:', error)
    return false
  }
}

/**
 * The session a file row belongs to.
 *
 * The row's right-sidebar container is the primary authority: the shell itself
 * maps an element back to its session with
 * `element.closest('[data-sidebar-right-session]')?.dataset.sidebarRightSession`
 * (`ui-sidebar-right`'s pane targeting), so reading the same attribute is the
 * same lookup the tab owner would hand a plugin as a prop — and it stays
 * correct with docks, floating panes and several sessions' sidebars on screen.
 *
 * `sidebarRight.mounted` covers host versions whose markup predates that
 * attribute (0.1.5 still had the service, not the attribute) and is the
 * sidebar's own session, not a guess. Below that there is nothing
 * authoritative left — the session list has no `current` field to borrow — so
 * the answer is `undefined` and the press becomes a no-op rather than a
 * reference in the wrong conversation.
 */
export function sessionOfRow(ctx: ClientContext, row: Element): string | undefined {
  try {
    const owner = row.closest('[data-sidebar-right-session]')
    const fromDom = owner?.getAttribute('data-sidebar-right-session')
    if (typeof fromDom === 'string' && fromDom !== '') return fromDom
    const sidebar = service<SidebarRightService>(ctx, 'sidebarRight')
    const mounted = sidebar?.mounted?.getSnapshot()
    if (typeof mounted === 'string' && mounted !== '') return mounted
    return undefined
  } catch {
    // A service that answers by throwing costs this one press, not the tree.
    return undefined
  }
}
