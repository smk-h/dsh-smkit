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
 * really is a textarea.
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

/** One reference chip, in the shape the shell builds its node from. */
interface ChipInsert {
  source: 'reference'
  ref: string
  label: string
  appearance: 'file' | 'folder'
  clipboardText: string
}

/** The spliced draft plus the caret index (in that draft) right after the text. */
interface SpliceResult {
  draft: string
  caretAfter: number
}

/**
 * The input shell's action face (`SessionInputShell.actions`), which the host
 * also hands to its own composer slots as `inputActions`.
 *
 * Optional on purpose: it is the newest part of that shell, so a host too old
 * to carry it still gets the plugin's textarea probe (and, failing that, the
 * append this feature used to do).
 */
interface InputActions {
  /**
   * The composer's live selection as a detect-coordinate span, with the draft
   * revision it was measured on — the host's own caret source for reference
   * and text insertion.
   */
  captureInsertion?(): { start: number; end: number; draftRev?: number }
  /** Replace one detect-coordinate span with plain text (span-CAS'd). */
  insertText?(text: string, span: { start: number; end: number; draftRev: number }): boolean
}

/** The composer draft face reached through `ctx.conversation.input`. */
interface ConversationInput {
  state: { getSnapshot(): { draft: string; draftRev?: number } }
  setDraft(text: string): void
  actions?: InputActions
  /**
   * The editor's published projection. `detectText` is the string span offsets
   * index into — the same coordinates `captureInsertion` answers in, and the
   * only place a word-boundary question can be asked, since a chip serializes
   * to a different length in the clipboard `draft`.
   */
  projection?: { detectText?: string }
  /**
   * Append reference chips at the live caret — the shell's own batch insert,
   * and the call the host's file picker makes. False when the draft is busy
   * (adjudicating/submitting) or the editor refused the edit.
   */
  addFiles?(references: readonly ChipInsert[], attachmentIds: readonly string[]): boolean
}

/**
 * One resolved insertion point, and what its offsets mean.
 *
 * `host` offsets are DETECT coordinates: the host's own text projection, where
 * a chip counts as one serialized token. They are meaningless as JavaScript
 * string indices, so they are only ever handed back to the host. `dom` offsets
 * are plain string indices of a real `<textarea>` draft.
 */
interface InsertionPoint extends DraftCaret {
  source: 'host' | 'dom'
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
 * Locate a composer `<textarea>`: the `data-phase`-tagged one inside the
 * conversation column, falling back to any textarea in that column and then to
 * a bare `data-phase` textarea on hosts whose column carries no slot marker.
 *
 * Only a fallback: the host composer is a Lexical contenteditable (the
 * `data-phase` attribute sits on it, and the chips in the draft are editor
 * nodes, not text), so `probeInsertion` asks the input shell first and this
 * lookup only serves hosts whose composer really is a plain textarea.
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
 * The point a reference belongs at: the composer's live selection.
 *
 * The input shell answers first, through the same `captureInsertion()` the host
 * hands its own composer slots. That is the only source that speaks the
 * coordinates `span` is written in — the editor's DETECT projection, where each
 * chip is one token — and the only one that survives a draft made of editor
 * nodes, which the host's composer is. The DOM textarea is a fallback for hosts
 * whose input really is a textarea, and `null` (append at the end) is the last
 * resort: an unreadable caret must not block the insert.
 */
function probeInsertion(input: ConversationInput, draft: string): InsertionPoint | null {
  const captured = input.actions?.captureInsertion?.()
  if (captured !== undefined && Number.isFinite(captured.start) && Number.isFinite(captured.end)) {
    const start = Math.max(0, captured.start)
    return { start, end: Math.max(start, captured.end), source: 'host' }
  }
  const caret = probeComposerCaret(draft)
  return caret === null ? null : { start: caret.start, end: caret.end, source: 'dom' }
}

/**
 * One character of the editor's text projection, or `undefined` when the editor
 * publishes none (or the offset falls outside it).
 */
function projectedChar(input: ConversationInput, at: number): string | undefined {
  const text = input.projection?.detectText
  if (typeof text !== 'string' || at < 0 || at > text.length) return undefined
  return text.slice(at, at + 1)
}

/**
 * Whether a mention written at `point` would be glued to the word before it.
 *
 * A glued mention is not a mention: DSH's `@` grammar needs a word boundary, so
 * `asdf@lib/` stays flat text while `@lib/` becomes a chip. An unknown
 * projection answers `true` — losing the decoration is the failure worth
 * avoiding, and the space it costs is invisible.
 */
function needsLeadingSpace(input: ConversationInput, point: InsertionPoint): boolean {
  if (point.start === 0) return false
  const char = projectedChar(input, point.start - 1)
  if (char === undefined) return true
  return char !== '' && !/\s/u.test(char)
}

/**
 * `text` with the separators its surroundings need: a leading one when the
 * mention would otherwise be glued to a word, and no doubled trailing space
 * where the projection already shows whitespace.
 */
function withSeparators(input: ConversationInput, point: InsertionPoint, text: string): string {
  const lead = needsLeadingSpace(input, point) ? ' ' : ''
  const next = projectedChar(input, point.end)
  const spaced = / $/u.test(text) && next !== undefined && next !== '' && /\s/u.test(next)
  return `${lead}${spaced ? text.replace(/ $/u, '') : text}`
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
 *
 * Two paths, in order of authority. The input shell's `insertText` replaces the
 * caret's detect span in place — the same call the host makes for its own text
 * inserts, which keeps the editor's chips (and their undo entry) intact. Only a
 * host without that face falls back to rewriting the whole draft through
 * `setDraft`, which is why the offsets are then taken from the textarea alone:
 * string indices and detect coordinates are not interchangeable once a draft
 * holds chips.
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
    const before = input.state.getSnapshot()
    const point = probeInsertion(input, before.draft)
    if (point !== null && point.source === 'host' && before.draftRev !== undefined) {
      const applied = input.actions?.insertText?.(withSeparators(input, point, text), {
        start: point.start,
        end: point.end,
        draftRev: before.draftRev,
      })
      if (applied === true) return true
    }
    const caret = point !== null && point.source === 'dom' ? { start: point.start, end: point.end } : null
    const { draft: next, caretAfter } = spliceInsert(before.draft, text, caret)
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
    const actx = ctx.sessions?.scope?.(sessionId)
    if (actx === undefined) return undefined
    const conversation = service<ConversationService>(ctx, 'conversation')
    if (conversation === undefined) return undefined
    const input = conversation.input.for(actx)
    const added = input.addFiles?.([chip], [])
    if (added !== undefined) return added
    // No batch face: the insert event is the only chip route left, and a host
    // that does not take it has no chip route at all.
    return emitReferenceChip(actx, input, chip) ? true : undefined
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
function emitReferenceChip(actx: unknown, input: ConversationInput, chip: ChipInsert): boolean {
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
  ;(actx as ScopeContext).emit('slash/input-insert-reference', {
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
