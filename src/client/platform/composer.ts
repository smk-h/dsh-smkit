/**
 * Writing text into the conversation composer.
 *
 * The draft store only exposes the whole string (`getSnapshot().draft` +
 * `setDraft(text)`), so a caller that wants its text at the reader's caret has
 * to find that caret elsewhere and splice the draft itself. This module is that
 * one route, shared by the two features that write into a draft: the explorer's
 * `@` reference chip (`file-reference`) and the preview's selection popup
 * (`selection-quote`). It was lifted out of `file-reference/reference.ts` when
 * the second caller appeared — a feature may not import another feature, and a
 * second copy of this arithmetic would be a second set of bugs.
 *
 * Ported from `dsh-better-sidebar` (`src/client/conversation-draft.ts`), where
 * it had been checked against the host:
 *
 * - the input shell's `captureInsertion` is the only source that speaks the
 *   coordinates a `span` is written in (the editor's DETECT projection, where a
 *   chip is one token); the composer's `<textarea>` is the fallback for hosts
 *   whose input really is a textarea, and appending at the end the last resort;
 * - the shell's `insertText` replaces the caret's span in place — the same call
 *   the host makes for its own text inserts, which keeps the editor's chips and
 *   their undo entry intact; only a host without that face gets the whole draft
 *   rewritten through `setDraft`;
 * - a programmatic `setDraft` commit resets the controlled textarea's caret, so
 *   the caret is restored to just after the inserted text once the value lands
 *   (see `placeComposerCaretAfterInsert`), which is what keeps stacked inserts
 *   at their running position instead of drifting to the start.
 *
 * Everything degrades to a logged no-op: a missing conversation service, an
 * unresolved session scope, or a composer that cannot be measured.
 */

import type { ClientContext } from './types'

/** A resolved composer caret/selection in draft coordinates. */
export interface DraftCaret {
  start: number
  end: number
}

/**
 * The spliced draft plus the caret index (in that draft) right after the
 * inserted text — the left-side separating space shifts the caret by one, which
 * naive `start + text.length` misses (it would land before the tail).
 */
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
 * append at the end of the draft).
 */
export interface InputActions {
  /**
   * The composer's live selection as a detect-coordinate span, with the draft
   * revision it was measured on — the host's own caret source for reference
   * and text insertion.
   */
  captureInsertion?(): { start: number; end: number; draftRev?: number }
  /** Replace one detect-coordinate span with plain text (span-CAS'd). */
  insertText?(text: string, span: { start: number; end: number; draftRev: number }): boolean
}

/** One reference chip, in the shape the shell builds its node from. */
export interface FileReferenceChip {
  source: 'reference'
  ref: string
  label: string
  appearance: 'file' | 'folder'
  clipboardText: string
}

/** The composer draft face reached through `ctx.conversation.input`. */
export interface ConversationInput {
  state: { getSnapshot(): { draft: string; draftRev?: number } }
  setDraft(text: string): void
  actions?: InputActions
  /**
   * Append reference chips at the live caret — the shell's own batch insert,
   * and the call the host's file picker makes. False when the draft is busy
   * (adjudicating/submitting) or the editor refused the edit.
   */
  addFiles?(references: readonly FileReferenceChip[], attachmentIds: readonly string[]): boolean
  /**
   * The editor's published projection. `detectText` is the string span offsets
   * index into — the same coordinates `captureInsertion` answers in, and the
   * only place a word-boundary question can be asked, since a chip serializes
   * to a different length in the clipboard `draft`.
   */
  projection?: { detectText?: string }
}

/**
 * One resolved insertion point, and what its offsets mean.
 *
 * `host` offsets are DETECT coordinates: the host's own text projection, where
 * a chip counts as one serialized token. They are meaningless as JavaScript
 * string indices, so they are only ever handed back to the host. `dom` offsets
 * are plain string indices of a real `<textarea>` draft.
 */
export interface InsertionPoint extends DraftCaret {
  source: 'host' | 'dom'
}

/** The `conversation` client service, as this layer uses it. */
interface ConversationService {
  input: { for(actx: unknown): ConversationInput }
}

/**
 * Read one client service without declaring it in the bundle's `inject` list.
 *
 * Late on purpose: the conversation input is provided by a shell package this
 * plugin does not require, so a host missing it must lose the insert, not the
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
 * The composer input of one session: its draft store, its caret face and its
 * projection. Undefined (and logged) when the session scope or the conversation
 * service is unavailable — the caller then has nothing to write into.
 */
export function resolveInput(ctx: ClientContext, sessionId: string): ConversationInput | undefined {
  try {
    const actx = ctx.sessions?.scope?.(sessionId)
    if (actx === undefined) {
      console.warn('[smkit] draft insert skipped: no session scope', sessionId)
      return undefined
    }
    const conversation = service<ConversationService>(ctx, 'conversation')
    if (conversation === undefined) {
      console.warn('[smkit] draft insert skipped: conversation service unavailable')
      return undefined
    }
    return conversation.input.for(actx)
  } catch (error) {
    console.warn('[smkit] draft insert skipped:', error)
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
 * The point an insert belongs at: the composer's live selection.
 *
 * The input shell answers first, through the same `captureInsertion()` the host
 * hands its own composer slots. That is the only source that speaks the
 * coordinates `span` is written in — the editor's DETECT projection, where each
 * chip is one token — and the only one that survives a draft made of editor
 * nodes, which the host's composer is. The DOM textarea is a fallback for hosts
 * whose input really is a textarea, and `null` (append at the end) is the last
 * resort: an unreadable caret must not block the insert.
 */
export function probeInsertion(input: ConversationInput, draft: string): InsertionPoint | null {
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
export function needsLeadingSpace(input: ConversationInput, point: InsertionPoint): boolean {
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
export function placeComposerCaretAfterInsert(expectedDraft: string, caretIndex: number): void {
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
export function appendToDraft(ctx: ClientContext, sessionId: string, text: string): boolean {
  const input = resolveInput(ctx, sessionId)
  if (input === undefined) return false
  try {
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
