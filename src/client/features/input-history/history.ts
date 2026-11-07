/**
 * `/mcp` command history for the conversation composer: press ↑ to bring the
 * last command back, ↓ to walk forward again.
 *
 * The shell's composer has no history of its own — `ArrowUp` there only scrolls
 * the viewport (`ui-chat`'s scroll keys) — and the shell keeps the submitted
 * lines nowhere this plugin can read: the client `conversation` service exposes
 * the draft store and nothing else. So the plugin records what it can see: the
 * moment the composer is submitted with a line this command owns.
 *
 * ## Only `/mcp` lines, only a handful
 *
 * Recording every message would turn ↑ into "recall a random paragraph" and
 * would write prose into storage. The scope is therefore one command: lines
 * matching `/^\/mcp(?:\s|$)/`. They are short, they are the ones worth
 * repeating, and a workspace keeps at most {@link LIMIT} of them.
 *
 * ## What a keypress costs
 *
 * One capture-phase `keydown` listener. Every key is a string comparison and
 * returns; only `Enter` reads the composer's text, and that read is
 * `textContent` — never `innerText`, which would force a layout on every
 * submission. A write happens once per submitted command, and a failed write
 * (private mode, quota) is swallowed: history is a convenience, not state.
 *
 * ## Where the history lives
 *
 * `localStorage` under the session's workspace path, so two projects do not
 * share commands. The session is read from the client session list — the
 * session the main view retains, or the list's `current` — the same answer the
 * shell's own navigation uses.
 *
 * ## When it stays out of the way
 *
 * ↑ is only claimed while the draft is empty, or while a recall is already in
 * progress; editing a draft keeps the caret where the shell put it. A session
 * whose conversation input cannot be resolved (a brand-new session, before its
 * agent exists) simply does not recall.
 */

import { resolveInput } from '../../platform/composer'
import type { ClientContext } from '../../platform/types'

/** Storage key prefix; the workspace path (or `*`) follows it. */
const KEY_PREFIX = 'smkit.mcp-history:'

/** How many commands one workspace keeps. */
const LIMIT = 50

/** A submitted line this feature owns: the `/mcp` command, with or without args. */
const OWNED = /^\/mcp(?:\s|$)/u

/** The conversation composer's editable box. */
const COMPOSER = '[role="textbox"][contenteditable="true"]'

/** The session whose history is being read. */
interface SessionRef {
  id: string
  /** Workspace path; absent when the host does not publish one. */
  cwd?: string
}

/** The row shape this feature reads out of the client session list. */
interface SessionRow {
  cwd?: string
  retainedBy?: Readonly<Record<string, number | undefined>>
}

/**
 * The session the main view is showing.
 *
 * `byId` carries `retainedBy.mainView` for the session on screen, and newer
 * hosts also publish `current` on the list itself; both are consulted, and the
 * retained row wins when they disagree (it is the one being drawn).
 *
 * @param ctx - the client context (a reflection read only).
 * @returns the session id and workspace, or `undefined` when the list is absent.
 */
function shownSession(ctx: ClientContext): SessionRef | undefined {
  const list = ctx.sessions?.list?.getSnapshot() as
    | { current?: string; byId?: Readonly<Record<string, SessionRow | undefined>> }
    | undefined
  const byId = list?.byId ?? {}
  for (const id of Object.keys(byId)) {
    if (byId[id]?.retainedBy?.mainView !== undefined) {
      const cwd = byId[id]?.cwd
      return cwd === undefined ? { id } : { id, cwd }
    }
  }
  const current = list?.current
  if (current === undefined) return undefined
  const cwd = byId[current]?.cwd
  return cwd === undefined ? { id: current } : { id: current, cwd }
}

/** The storage key one session's history lives under. */
function keyFor(session: SessionRef): string {
  return KEY_PREFIX + (session.cwd ?? '*')
}

/** Read one key's history, oldest first, tolerating anything stored there. */
function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    // A key another build wrote, or a storage that refuses reads: no history.
    return []
  }
}

/** Write one key's history, newest first. */
function write(key: string, entries: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(entries.slice(0, LIMIT)))
  } catch {
    // Private mode or a full quota: history is a convenience, not state.
  }
}

/** The composer an event happened in, when it is the conversation's own box. */
function composerOf(target: EventTarget | null): Element | undefined {
  if (!(target instanceof Element)) return undefined
  return target.closest(COMPOSER) ?? undefined
}

/** The text a composer currently holds. `textContent` never forces a layout. */
function draftOf(box: Element): string {
  return (box.textContent ?? '').trim()
}

/**
 * Watch the composer for `/mcp` submissions and answer ↑ / ↓.
 *
 * @param ctx - the client context (the draft store is resolved per press).
 * @returns the effect's disposer, which removes both listeners.
 */
export function watchCommandHistory(ctx: ClientContext): () => void {
  if (typeof document === 'undefined' || typeof localStorage === 'undefined') return () => {}

  /** The entries an in-progress recall walks, newest first. */
  let recall: { entries: string[]; index: number } | null = null

  const remember = (box: Element): void => {
    const line = draftOf(box)
    if (!OWNED.test(line)) return
    const session = shownSession(ctx)
    if (session === undefined) return
    const key = keyFor(session)
    // Newest first, no duplicates: repeating a command moves it to the front.
    write(key, [line, ...read(key).filter((entry) => entry !== line)])
  }

  const apply = (session: SessionRef, text: string): boolean => {
    const input = resolveInput(ctx, session.id)
    if (input === undefined) return false
    input.setDraft(text)
    return true
  }

  /**
   * Move one step through the history (-1 forward, +1 back).
   * @returns whether the key was consumed.
   */
  const step = (delta: -1 | 1): boolean => {
    const session = shownSession(ctx)
    if (session === undefined) {
      recall = null
      return false
    }
    if (recall === null) {
      if (delta === -1) return false
      const entries = read(keyFor(session))
      if (entries.length === 0) return false
      if (!apply(session, entries[0] ?? '')) return false
      recall = { entries, index: 0 }
      return true
    }
    const next = recall.index + delta
    if (next < 0) {
      // Past the newest entry: an empty draft, and the recall ends.
      const cleared = apply(session, '')
      recall = null
      return cleared
    }
    if (next >= recall.entries.length) return true
    if (!apply(session, recall.entries[next] ?? '')) return false
    recall.index = next
    return true
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    // A composition or a chord belongs to the shell; so does a modified arrow.
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const box = composerOf(event.target)
    if (box === undefined) return

    if (event.key === 'Enter' && !event.shiftKey) {
      remember(box)
      recall = null
      return
    }
    if (event.key === 'Escape') {
      recall = null
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // A draft the reader is typing keeps its own caret behaviour; only an
      // empty box — or a recall already in flight — answers to ↑ / ↓.
      if (draftOf(box) !== '' && recall === null) return
      const handled = step(event.key === 'ArrowUp' ? 1 : -1)
      if (handled) event.preventDefault()
      return
    }
    // Anything else that edits the draft ends the recall: the reader moved on.
    if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') {
      recall = null
    }
  }

  document.addEventListener('keydown', onKeyDown, true)
  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
  }
}
