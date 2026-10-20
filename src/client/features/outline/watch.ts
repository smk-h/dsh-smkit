/**
 * The code outline, hung on whichever surface is showing the file.
 *
 * A source file appears in one of two places, and which one depends on what is
 * installed:
 *
 * - the host's read-only preview (`ui-sidebar-documentpreview`), whose header
 *   publishes `data-textpreview-tool="reload"`;
 * - an editor tab, when a file-editor plugin (`dsh-better-sidebar`) is loaded —
 *   its CodeMirror view replaces the preview wholesale, and the host's preview
 *   DOM is never rendered at all.
 *
 * The feature therefore decorates **both** and stands down for neither. An
 * earlier cut yielded whenever that plugin was loaded, on the assumption it drew
 * this outline itself; it does not (it only has a Markdown table of contents), so
 * yielding simply removed the feature for every reader who had it installed.
 *
 * ## Why the symbols come from the host, not from the DOM
 *
 * A long preview is paged: the host appends the next page as the reader nears
 * the bottom, so the DOM only ever holds the pages that have been loaded. An
 * outline built from the DOM would describe the first screen of a file and
 * silently stop. The panel asks the host half instead, which reads the whole
 * file and answers with the symbols; the client only names the file. The same
 * reasoning applies to an editor tab, whose CodeMirror view renders only the
 * visible lines.
 */

import { editorViewOf, revealEditorLine } from '../../platform/ui/editor-lines'
import type { EditorViewLike } from '../../platform/ui/editor-lines'
import { PREVIEW, revealPreviewLine } from '../../platform/ui/preview-lines'
import { outlineLanguageOf } from '../../../shared/outline/languages'
import type { OutlineSymbol } from '../../../shared/outline/contract'
import { iconSvg } from '../../platform/icons/Icon'
import type { ApiFn, Translator } from '../../platform/types'
import { LIST_TREE_ICON } from './icons/ListTreeIcon'

/** The host preview: its body, its path label, and its reload control. */
const BODY = '[data-textpreview-body]'
const PATH = '[data-textpreview-path]'
const RELOAD = '[data-textpreview-tool="reload"]'

/** An editor tab: the CodeMirror host, and the tab body the host publishes. */
const EDITOR = '.cm-editor'
const TAB = '[data-sidebar-right-tab]'
/**
 * The editor's header carries the file's absolute path as the input's `title`.
 *
 * It is the only place the path is published for an editor tab — the tab title
 * is a basename, and CodeMirror knows nothing about files.
 */
const PATH_INPUT = 'input[title]'

/**
 * Whether the host half will read this file.
 *
 * The suffix list lives in `shared/outline/languages`, so the toggle and the
 * route agree by construction: one cannot offer a file the other refuses.
 */
const readable = (path: string): boolean => outlineLanguageOf(path) !== undefined

/** Whether a string is an absolute path on either platform. */
const absolute = (value: string): boolean => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)

/** This feature's classes (see `style/outline.css`). */
const TOGGLE_CLASS = 'smkit-outline-toggle'
const PANEL_CLASS = 'smkit-outline-panel'
const ITEM_CLASS = 'smkit-outline-item'
const KIND_CLASS = 'smkit-outline-kind'
const NAME_CLASS = 'smkit-outline-name'
const NOTE_CLASS = 'smkit-outline-note'

/** The wash a landed line carries while the reader looks at it. */
const HIT = 'data-smkit-outline-hit'
const HIT_MS = 1200

/** The panel's width, in px — fixed, so it can be placed before it is measured. */
const PANEL_WIDTH = 264

/** One surface this feature decorates. */
type Surface =
  | { readonly kind: 'preview'; readonly root: Element }
  | { readonly kind: 'editor'; readonly root: Element; view: EditorViewLike }

/** One decorated surface, plus the state its panel renders from. */
interface Board {
  readonly surface: Surface
  readonly toggle: HTMLButtonElement
  /** Absolute path the surface currently shows. */
  path: string
  /**
   * Every path this surface has shown, `path` included.
   *
   * An editor tab keeps one surface across files, and switching files must not
   * throw the previous file's symbols away — the reader may switch back, and a
   * rescan would make that free move cost a request. So the entries stay while
   * the surface lives, and the whole set is released when the tab closes.
   */
  readonly shown: Set<string>
  /** The open panel, when one is open. */
  panel: HTMLElement | null
  /** Symbols for {@link path}, or null while they are unknown. */
  symbols: OutlineSymbol[] | null
  /** Why the last attempt failed, when it did. */
  note: string | null
  /** Whether a request for {@link path} is in flight. */
  pending: boolean
}

/**
 * Watch every surface that shows a readable file and hang an outline on it.
 *
 * @param api - the plugin's one channel to its host half.
 * @param t - the copy lookup bound to this feature's namespace.
 * @returns the effect's disposer, which removes every node it added.
 */
export function watchOutline(api: ApiFn, t: Translator): () => void {
  // `document`/`MutationObserver` are absent outside a browser (the hook test
  // harness runs the bundle in a bare context) — the same guard the platform
  // watchers carry.
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const root = document.documentElement
  if (root === null || root === undefined) return () => {}

  const boards = new Map<Element, Board>()
  /**
   * Symbols already fetched, by absolute path — held for as long as some
   * surface that has shown that file is still open.
   *
   * Switching files on one surface keeps the entries: the reader may switch
   * back, and a rescan would turn that free move into a request. A tab that
   * closes releases every path it showed, so the memory follows the open tabs
   * rather than the session's history — a page left open for days does not grow
   * one array per file ever looked at. Reopening a file starts with nothing and
   * only the click spends a scan, which the measurement puts at tens of
   * milliseconds for the usual few-thousand-line file (the outline doc,
   * chapter 6).
   */
  const cache = new Map<string, OutlineSymbol[]>()

  /**
   * Release the symbols one closing surface held, for the paths no other open
   * surface still shows (the same file may be open as a preview and as an
   * editor tab at once).
   */
  const forget = (leaving: Board): void => {
    for (const path of leaving.shown) {
      let elsewhere = false
      for (const board of boards.values()) {
        if (board !== leaving && board.shown.has(path)) {
          elsewhere = true
          break
        }
      }
      if (!elsewhere) cache.delete(path)
    }
  }
  let queued = false
  let timer: number | null = null
  let frame: number | null = null

  /** The absolute path one preview shows, or '' when it names none. */
  const pathOfPreview = (preview: Element): string => {
    const label = preview.querySelector(PATH)
    if (label === null) return ''
    const titled = (label.getAttribute('title') ?? '').trim()
    return titled === '' ? (label.textContent ?? '').trim() : titled
  }

  /** The header row of one editor tab, found through the path input. */
  const headerOfEditor = (host: Element): { header: Element; path: string } | null => {
    const tab = host.closest(TAB) ?? host
    for (const input of Array.from(tab.querySelectorAll(PATH_INPUT))) {
      const title = (input.getAttribute('title') ?? '').trim()
      if (!absolute(title)) continue
      const header = input.parentElement
      if (header === null) continue
      return { header, path: title }
    }
    return null
  }

  /** Take one board's panel out of the document, keeping its symbols. */
  const close = (board: Board): void => {
    board.panel?.remove()
    board.panel = null
    board.toggle.setAttribute('aria-expanded', 'false')
  }

  /** Forget one board entirely — along with the symbols only it was holding. */
  const drop = (board: Board): void => {
    close(board)
    board.toggle.remove()
    forget(board)
    boards.delete(board.surface.root)
  }

  /** Put the panel under the toggle, kept inside the viewport. */
  const place = (board: Board): void => {
    const panel = board.panel
    if (panel === null) return
    if (typeof board.toggle.getBoundingClientRect !== 'function') return
    const box = board.toggle.getBoundingClientRect()
    const view = typeof window === 'undefined' ? 1024 : window.innerWidth || 1024
    const left = Math.min(Math.max(8, box.right - PANEL_WIDTH), Math.max(8, view - PANEL_WIDTH - 8))
    panel.style.left = `${left}px`
    panel.style.top = `${box.bottom + 6}px`
  }

  /** Mark one rendered row so the reader can see where the jump landed. */
  const flash = (row: Element): void => {
    row.setAttribute(HIT, '')
    // A harness with no timer keeps the wash: it costs nothing there, and
    // reaching for `setTimeout` unconditionally would cost the whole mount.
    if (typeof setTimeout === 'function') setTimeout(() => { row.removeAttribute(HIT) }, HIT_MS)
  }

  /** The label for one symbol kind. */
  const kindLabel = (symbol: OutlineSymbol): string => {
    switch (symbol.kind) {
      case 'function': return t('kindFunction')
      case 'union': return t('kindUnion')
      case 'enum': return t('kindEnum')
      case 'macro': return t('kindMacro')
      default: return t('kindStruct')
    }
  }

  /** Jump to one symbol, then leave the panel the way a menu would. */
  const jump = (board: Board, symbol: OutlineSymbol): void => {
    close(board)
    const surface = board.surface
    if (surface.kind === 'preview') {
      revealPreviewLine(surface.root, symbol.line, {
        onLand: (_line, row) => {
          if (row !== null) flash(row)
        },
      })
      return
    }
    // An editor renders only the visible lines, so there is no row to wash: the
    // caret and the scroll are the feedback.
    revealEditorLine(surface.view, symbol.line)
  }

  /** Repaint one panel from the state its board currently holds. */
  const render = (board: Board): void => {
    const panel = board.panel
    if (panel === null) return
    panel.replaceChildren()

    if (board.pending) {
      const note = document.createElement('div')
      note.className = NOTE_CLASS
      note.textContent = t('loading')
      panel.appendChild(note)
      return
    }

    if (board.note !== null) {
      const note = document.createElement('div')
      note.className = NOTE_CLASS
      note.textContent = t('failed', { message: board.note })
      panel.appendChild(note)
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = ITEM_CLASS
      retry.textContent = t('retry')
      retry.addEventListener('click', () => { void load(board) })
      panel.appendChild(retry)
      return
    }

    const symbols = board.symbols ?? []
    if (symbols.length === 0) {
      const note = document.createElement('div')
      note.className = NOTE_CLASS
      note.textContent = t('empty')
      panel.appendChild(note)
      return
    }

    for (const symbol of symbols) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = ITEM_CLASS
      item.title = t('jump', { line: symbol.line })
      const kind = document.createElement('span')
      kind.className = KIND_CLASS
      kind.textContent = kindLabel(symbol)
      const name = document.createElement('span')
      name.className = NAME_CLASS
      name.textContent = symbol.name
      item.appendChild(kind)
      item.appendChild(name)
      item.addEventListener('click', () => { jump(board, symbol) })
      panel.appendChild(item)
    }
  }

  /**
   * Fetch the outline of the file one board shows.
   *
   * The answer is checked against the path it was asked for: a reader who flips
   * to another file while the first request is in flight must not get that
   * file's symbols under the new title.
   */
  const load = async (board: Board): Promise<void> => {
    const path = board.path
    const cached = cache.get(path)
    if (cached !== undefined) {
      board.symbols = cached
      board.note = null
      render(board)
      return
    }
    board.pending = true
    board.note = null
    render(board)
    try {
      const answer = await api(`/outline?path=${encodeURIComponent(path)}`)
      if (board.path !== path) return
      if (answer.ok) {
        const symbols = Array.isArray(answer.body.symbols)
          ? (answer.body.symbols as OutlineSymbol[])
          : []
        cache.set(path, symbols)
        board.symbols = symbols
      } else {
        board.symbols = null
        board.note = typeof answer.body.error === 'string' ? answer.body.error : `HTTP ${answer.status}`
      }
    } catch {
      if (board.path !== path) return
      board.symbols = null
      board.note = 'network'
    } finally {
      if (board.path === path) {
        board.pending = false
        render(board)
      }
    }
  }

  /** Open one board's panel, fetching the symbols the first time it is asked. */
  const open = (board: Board): void => {
    if (board.panel !== null) return
    const panel = document.createElement('div')
    panel.className = PANEL_CLASS
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('toggle'))
    document.body.appendChild(panel)
    board.panel = panel
    board.toggle.setAttribute('aria-expanded', 'true')
    place(board)
    if (board.symbols === null && !board.pending) {
      void load(board)
      return
    }
    render(board)
  }

  /** Build the toggle, wire it to its board, and register the board. */
  const attach = (surface: Surface, path: string, hang: (toggle: HTMLElement) => void): Board => {
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = TOGGLE_CLASS
    // A mark, not a word: the row is the preview's own tool row, where every
    // other control is a glyph. The name stays as the accessible label and the
    // hover bubble, so nothing is lost for a reader who cannot see the shape.
    toggle.appendChild(iconSvg(LIST_TREE_ICON))
    toggle.setAttribute('aria-label', t('toggle'))
    toggle.title = t('toggle')
    toggle.setAttribute('aria-haspopup', 'dialog')
    toggle.setAttribute('aria-expanded', 'false')
    hang(toggle)

    const board: Board = {
      surface,
      toggle,
      path,
      shown: new Set([path]),
      panel: null,
      symbols: cache.get(path) ?? null,
      note: null,
      pending: false,
    }
    toggle.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (board.panel === null) open(board)
      else close(board)
    })
    boards.set(surface.root, board)
    return board
  }

  /** The header's reload control: where a preview's toggle rides. */
  const reloadOf = (preview: Element): Element | null => {
    const reload = preview.querySelector(RELOAD)
    return reload !== null && reload.parentNode !== null ? reload : null
  }

  /** Make sure one preview has a toggle, and that it names the file on screen. */
  const ensurePreview = (preview: Element): void => {
    const path = pathOfPreview(preview)
    const known = boards.get(preview)
    if (known === undefined) {
      const anchor = reloadOf(preview)
      if (path === '' || !readable(path) || anchor === null) return
      attach({ kind: 'preview', root: preview }, path, (toggle) => {
        anchor.parentNode?.insertBefore(toggle, anchor)
      })
      return
    }
    // A host that swaps the file under the same preview re-renders the header:
    // the toggle is this feature's node, so it is put back where it belongs.
    const anchor = reloadOf(preview)
    if (anchor !== null && known.toggle.nextSibling !== anchor) {
      anchor.parentNode?.insertBefore(known.toggle, anchor)
    }
    follow(known, path)
  }

  /** Make sure one editor tab has a toggle, and that it names the file in it. */
  const ensureEditor = (host: Element, view: EditorViewLike): void => {
    const located = headerOfEditor(host)
    if (located === null) return
    const known = boards.get(host)
    if (known === undefined) {
      if (!readable(located.path)) return
      attach({ kind: 'editor', root: host, view }, located.path, (toggle) => {
        located.header.appendChild(toggle)
      })
      return
    }
    // The editor plugin re-renders its header on a file switch; the toggle is
    // this feature's node, so it is put back at the end of that row.
    if (known.toggle.parentNode !== located.header) located.header.appendChild(known.toggle)
    if (known.surface.kind === 'editor') known.surface.view = view
    follow(known, located.path)
  }

  /** Point one board at the file currently on screen, or close it when it moved. */
  const follow = (board: Board, path: string): void => {
    if (board.path === path) return
    // Another file: symbols belong to the old path, so the panel goes away. The
    // old entry stays in the cache — it leaves with the tab, not with the
    // switch — so switching back costs nothing.
    close(board)
    board.path = path
    board.shown.add(path)
    board.symbols = cache.get(path) ?? null
    board.note = null
    board.pending = false
  }

  /** Reconcile the boards with the surfaces on screen. */
  const scan = (): void => {
    const seen = new Set<Element>()

    for (const preview of Array.from(document.querySelectorAll(PREVIEW))) {
      if (preview.querySelector(BODY) === null) continue
      seen.add(preview)
      ensurePreview(preview)
    }

    for (const host of Array.from(document.querySelectorAll(EDITOR))) {
      const view = editorViewOf(host)
      if (view === null) continue
      seen.add(host)
      ensureEditor(host, view)
    }

    for (const [element, board] of Array.from(boards)) {
      if (!seen.has(element) || !element.isConnected) drop(board)
    }
  }

  /**
   * Coalesce a burst of mutations into one pass.
   *
   * A frame when the host has one, a timeout when it only has timers, and a
   * plain call in a harness with neither — that last case is what the hook
   * tests run in, and it is also why the mount must not assume a scheduler.
   */
  const schedule = (): void => {
    if (queued) return
    queued = true
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(() => {
        queued = false
        frame = null
        scan()
      })
      return
    }
    if (typeof setTimeout === 'function') {
      timer = setTimeout(() => {
        queued = false
        timer = null
        scan()
      }, 50) as unknown as number
      return
    }
    queued = false
    scan()
  }

  /** Close the open panel when a click lands outside it and outside its toggle. */
  const onPointerDown = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    for (const board of Array.from(boards.values())) {
      if (board.panel === null) continue
      if (board.panel.contains(target) || board.toggle.contains(target)) continue
      close(board)
    }
  }

  /** Escape closes the panel, as it does for any popover the shell draws. */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    for (const board of Array.from(boards.values())) close(board)
  }

  /** A resize or a scroll moves the control the panel is pinned to. */
  const onLayout = (): void => {
    for (const board of Array.from(boards.values())) place(board)
  }

  const observer = new MutationObserver(() => { schedule() })
  observer.observe(root, { childList: true, subtree: true, characterData: true })

  const listener = onPointerDown as EventListener
  document.addEventListener('pointerdown', listener, true)
  document.addEventListener('keydown', onKeyDown as EventListener, true)
  globalThis.addEventListener?.('resize', onLayout)
  document.addEventListener('scroll', onLayout, true)

  schedule()

  return () => {
    observer.disconnect()
    document.removeEventListener('pointerdown', listener, true)
    document.removeEventListener('keydown', onKeyDown as EventListener, true)
    globalThis.removeEventListener?.('resize', onLayout)
    document.removeEventListener('scroll', onLayout, true)
    if (timer !== null) clearTimeout(timer)
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    for (const board of Array.from(boards.values())) drop(board)
  }
}
