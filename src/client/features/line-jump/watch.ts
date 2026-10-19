/**
 * Ctrl+G for the right sidebar's file previews: name a line, land on it.
 *
 * Two previews exist, depending on what the profile loaded:
 *
 * - the host's own document preview (`ui-sidebar-documentpreview`) — a code
 *   file is one Shiki block whose spans are numbered by a CSS counter, a plain
 *   file a row per line — which offers no way to REACH a line except dragging
 *   the scrollbar;
 * - `dsh-better-sidebar`'s file editor, a CodeMirror 6 view whose gutter numbers
 *   are just as inert, and whose `searchKeymap` has already claimed Mod-g for
 *   "find next" (Mod-f opens the panel; the go-to-line dialog is on Mod-Alt-g).
 *
 * Neither fills the gap, so this feature is a keyboard gesture and a small
 * floating box, on both surfaces:
 *
 * - Ctrl+G (Cmd+G on macOS) opens a one-field box at the top-right of the
 *   surface the reader is looking at, carrying the line range there (`1–471`,
 *   or `1–471+` while the host has pages left);
 * - Enter lands on that line — a third of the way down the viewport, the way an
 *   editor's go-to-line leaves it — marks it, and closes the box; Escape, blur
 *   and an empty box close it without moving anything;
 * - the mark stays until the next jump, and is repainted if the surface
 *   re-renders under it (a new page replaces every line node; CodeMirror
 *   replaces its rendered lines as the reader scrolls);
 * - a line the host has not rendered yet is reached by pressing the host's own
 *   "load more" until it appears (see "Pages" below); a line past the end of the
 *   document lands on the last line, as every editor's go-to-line does.
 *
 * ## Why this one does not yield to the neighbour
 *
 * The other features that decorate surfaces yield when `dsh-better-sidebar` is
 * loaded, because that plugin draws its own version of the same chrome (the
 * outline, the row menu, the `@` chip). This feature is not chrome: it is a
 * keystroke the previews do not offer at all, and its whole point is to work
 * where the reader is reading — which, with that plugin loaded, is its editor.
 * So it handles both surfaces and never stands down.
 *
 * ## Reaching the neighbour's editor
 *
 * The view is not published as a service method, and importing `@codemirror/view`
 * from here would risk a second copy of CodeMirror. CodeMirror itself resolves a
 * view from DOM through `contentDOM.cmTile.root.view`, which is exactly what its
 * own `EditorView.findFromDOM` does; `editorOf` walks the same path. A gutter is
 * required before an editor counts: that is what separates a file editor from a
 * CodeMirror-backed text box (the chat composer) — the latter has no line
 * numbers to name and must keep its keystrokes.
 *
 * Known gap, parked: in that editor the mark is an attribute on a RENDERED
 * line, and CodeMirror replaces those lines as the viewport moves. The observer
 * puts the mark back, but a repaint that lands between two of those passes can
 * lose it, so the tint sometimes disappears there. The jump itself (caret and
 * scroll) is unaffected, and the host preview's mark is stable — the follow-up
 * is to carry the mark as an editor decoration once the view is reachable
 * without a second copy of CodeMirror.
 *
 * ## Which surface the gesture means
 *
 * The sidebar can hold more than one preview (two panes, two files), so the box
 * opens for the surface the reader is working in: the one holding the focus
 * (clicking a code block or the editor focuses it), the one under the pointer,
 * and — the common case — the only one on screen. With two and neither claimed,
 * the gesture is left alone rather than guessing.
 *
 * ## Only where a line means something
 *
 * The host preview also renders Markdown and PDFs. A rendered document has no
 * line numbers to name — its fenced code blocks are `CodeBlock`s with
 * scrollports of their own, which is why the document anchor, not the presence
 * of a code block, decides (see `linesOf`) — and a PDF has no lines at all.
 * Ctrl+G on either does nothing (no box, no swallowed keystroke), and neither do
 * plain text fields. The neighbour's editor is jumpable only in its edit mode: a
 * Markdown file in preview mode renders no CodeMirror source at all.
 *
 * ## Pages
 *
 * The host loads a long document a page at a time and appends the next one when
 * the reader nears the bottom (`text-pages`), so lines past the last loaded page
 * are not in the DOM to scroll to. The host publishes a "load more" button while
 * pages remain (`data-textpreview-more`), and pressing it is the same call its
 * own scroll handler makes — so the jump presses it, waits a frame or two, and
 * looks again, up to {@link MAX_STEPS} times. Nothing is fetched by this plugin:
 * the host reads, the host pages, the box only names a line. The neighbour's
 * editor loads whole files, so there is nothing to climb there.
 */

import type { Translator } from '../../platform/types'
import { parseLine } from './parse'

/** The host preview's root, its scroll body, and the renderers that have lines. */
const PREVIEW = '[data-textpreview-state]'
const BODY = '[data-textpreview-body]'
/** A rendered document — no lines to name, whatever code blocks it may hold. */
const MARKDOWN = '[data-document-markdown]'
/** The preview's own highlighted renderer (the plain one has no wrapper). */
const CODE = '[data-code-preview]'
const CODE_SCROLL = '[data-code-block-content]'
const CODE_LINE = '.line'
/** The plain fallback: one row per line, each carrying its own number. */
const PLAIN_LINE = '[data-textpreview-line]'
/** The host's "load more" control, drawn while the document has pages left. */
const MORE = '[data-textpreview-more]'
/** The neighbour's editor: its root, content box, rendered line and gutter. */
const EDITOR = '.cm-editor'
const EDITOR_CONTENT = '.cm-content'
const EDITOR_LINE = '.cm-line'
const EDITOR_GUTTER = '.cm-lineNumbers'
/** Every field the reader may already be typing in — Ctrl+G there is theirs. */
const EDITABLE = 'input, textarea, [contenteditable="true"]'

/** This feature's markers, all inside the plugin's own namespace. */
const PANEL = 'data-smkit-line-jump'
const FIELD = 'data-smkit-line-jump-input'
const HINT = 'data-smkit-line-jump-hint'
const MARK = 'data-smkit-line-jump-mark'

/** This feature's classes (see `style/jump.css`). */
const PANEL_CLASS = 'smkit-line-jump-panel'
const FIELD_CLASS = 'smkit-line-jump-input'
const HINT_CLASS = 'smkit-line-jump-hint'

/** How long to wait for one page before looking again, in ms. */
const PAGE_WAIT_MS = 60
/** How many waits a jump may spend climbing pages before giving up. */
const MAX_STEPS = 120
/** The box's width, in px — fixed, so it can be placed before it is measured. */
const PANEL_WIDTH = 236

/** One renderer's lines: the element that scrolls, and how to find a line in it. */
interface Lines {
  /** The element whose `scrollTop` moves the document. */
  scroller: Element
  /** The rendered row for a 1-based line, or null while that line is not loaded. */
  at(line: number): Element | null
  /** How many lines are rendered right now. */
  count(): number
}

/**
 * A CodeMirror view, as much of it as this feature reads.
 *
 * Structural rather than imported: the neighbour owns the instance, and naming
 * its class here would tie the build to one copy of `@codemirror/view`. These
 * are the members CodeMirror's own public API documents.
 */
interface EditorView {
  dom: Element
  contentDOM: Element
  scrollDOM: Element & { clientHeight: number; scrollTop: number }
  state: { doc: { lines: number; line(number: number): { from: number; to: number } } }
  viewport: { from: number; to: number }
  domAtPos(position: number): { node: Node }
  lineBlockAt(position: number): { top: number }
  dispatch(spec: { selection: { anchor: number } }): void
  focus(): void
  requestMeasure(): void
}

/** What the gesture can act on: the host's preview, or the neighbour's editor. */
type Surface =
  | { kind: 'preview'; preview: Element }
  | { kind: 'editor'; view: EditorView }

/**
 * Watch for Ctrl+G and offer the go-to-line box on the surface it applies to.
 *
 * The neighbours are read from the DOM rather than from the context: this
 * feature decorates nothing they own, it only answers a keystroke they have
 * already claimed (see the module doc), so there is no service to consult.
 *
 * @param t - the copy lookup bound to this feature's namespace.
 * @returns the effect's disposer, which closes the box and clears the mark.
 */
export function watchLineJump(t: Translator): () => void {
  // `document` is absent outside a browser (the hook test harness runs the
  // bundle in a bare context) — the same guard the platform watchers carry.
  if (typeof document === 'undefined' || document.body === null || document.body === undefined) return () => {}

  /** The open box, or null. */
  let panel: HTMLElement | null = null
  /** The pointer's last position, for choosing between two open previews. */
  let pointer: { x: number; y: number } | null = null
  /** The pending page-climb timer. */
  let climb: number | null = null
  /** The line the reader last named: what keeps the mark, and where it belongs. */
  let mark: { surface: Surface; line: number } | null = null
  /**
   * Watches the marked surface for re-renders.
   *
   * A page arriving replaces the whole highlighted block, line nodes included,
   * and CodeMirror replaces the lines it renders as the viewport moves, so an
   * attribute put on one of them survives only until the next paint. The reader
   * asked for this line; the mark is put back on it as long as the surface lives
   * (attributes are not observed, so a repaint cannot loop).
   */
  const keep = typeof MutationObserver === 'function'
    ? new MutationObserver(() => { repaint() })
    : null

  /**
   * The lines of one host preview, or null on a surface that has none.
   *
   * Two renderers, two shapes: the highlighted one keeps a single scrollport
   * with a `.line` span per line (no numbers in the DOM — the counter is CSS),
   * the plain one a row per line that carries its number as an attribute.
   *
   * The Markdown renderer has neither, and has to be turned away by name: a
   * fenced code block in a rendered document is a `CodeBlock` too, with a
   * `data-code-block-content` of its own, so looking for that scrollport alone
   * would happily offer to "jump" to line 3 of a fence. The document anchor is
   * the one thing a rendered Markdown preview always carries and a code
   * preview never does.
   */
  const linesOf = (preview: Element): Lines | null => {
    const body = preview.querySelector(BODY)
    if (body === null) return null
    if (body.querySelector(MARKDOWN) !== null) return null
    const code = body.querySelector(CODE)
    const scroll = code === null ? null : code.querySelector(CODE_SCROLL)
    if (scroll !== null) {
      return {
        scroller: scroll,
        at: (line) => scroll.querySelectorAll(CODE_LINE)[line - 1] ?? null,
        count: () => scroll.querySelectorAll(CODE_LINE).length,
      }
    }
    if (body.querySelector(PLAIN_LINE) === null) return null
    return {
      scroller: body,
      at: (line) => body.querySelector(`[data-textpreview-line="${line}"]`),
      count: () => {
        let last = 0
        for (const row of Array.from(body.querySelectorAll(PLAIN_LINE))) {
          const number = Number(row.getAttribute('data-textpreview-line'))
          if (number > last) last = number
        }
        return last
      },
    }
  }

  /**
   * The CodeMirror view inside one editor box, when that box is a file editor.
   *
   * The gutter is the filter: a CodeMirror instance without line numbers is a
   * text box (the chat composer), and Ctrl+G belongs to it. The view itself is
   * reached the way CodeMirror's `findFromDOM` reaches it — the content box
   * carries the tile, the tile's root is the doc tile, and the doc tile holds
   * the view.
   */
  const editorOf = (host: Element): EditorView | null => {
    if (host.querySelector(EDITOR_GUTTER) === null) return null
    const content = host.querySelector(EDITOR_CONTENT) as
      | (Element & { cmTile?: { root?: { view?: EditorView } } })
      | null
    const view = content?.cmTile?.root?.view
    return view === undefined || view === null ? null : view
  }

  /** The surfaces this gesture could act on, in document order. */
  const candidates = (): Surface[] => {
    const found: Surface[] = []
    for (const preview of Array.from(document.querySelectorAll(PREVIEW))) {
      if (linesOf(preview) !== null) found.push({ kind: 'preview', preview })
    }
    for (const host of Array.from(document.querySelectorAll(EDITOR))) {
      const view = editorOf(host)
      if (view !== null) found.push({ kind: 'editor', view })
    }
    return found
  }

  /** Whether one element sits inside a surface. */
  const owns = (surface: Surface, element: Element): boolean =>
    surface.kind === 'preview' ? surface.preview.contains(element) : surface.view.dom.contains(element)

  /** The surface the reader means: focused, else pointed at, else the only one. */
  const pick = (found: readonly Surface[]): Surface | null => {
    const active = document.activeElement
    if (active instanceof Element) {
      const owner = found.find((surface) => owns(surface, active))
      if (owner !== undefined) return owner
    }
    if (pointer !== null && typeof document.elementFromPoint === 'function') {
      const under = document.elementFromPoint(pointer.x, pointer.y)
      if (under instanceof Element) {
        const owner = found.find((surface) => owns(surface, under))
        if (owner !== undefined) return owner
      }
    }
    return found.length === 1 ? found[0] : null
  }

  /** Where the box pins: the host preview's body, or the editor's own box. */
  const anchorOf = (surface: Surface): Element | null =>
    surface.kind === 'preview' ? surface.preview.querySelector(BODY) : surface.view.dom

  /** What the mark's observer watches: the whole preview, or the editor's lines. */
  const watchNodeOf = (surface: Surface): Element | null =>
    surface.kind === 'preview' ? surface.preview : surface.view.contentDOM

  /** The rendered range, as the box's hint. */
  const rangeOf = (surface: Surface): string => {
    if (surface.kind === 'editor') return `1–${surface.view.state.doc.lines}`
    const lines = linesOf(surface.preview)
    if (lines === null) return ''
    const last = lines.count()
    return surface.preview.querySelector(MORE) === null ? `1–${last}` : `1–${last}+`
  }

  /**
   * The rendered node for one line, on either surface.
   *
   * CodeMirror renders only its viewport, so a line outside it has no node — and
   * `domAtPos` would answer with the nearest rendered position, marking the
   * wrong line. The viewport check keeps the mark honest; the observer paints it
   * once the line scrolls back in.
   */
  const rowOf = (surface: Surface, line: number): Element | null => {
    if (surface.kind === 'preview') {
      const lines = linesOf(surface.preview)
      return lines === null ? null : lines.at(line)
    }
    const view = surface.view
    const doc = view.state.doc
    if (line < 1 || line > doc.lines) return null
    const target = doc.line(line)
    if (target.to < view.viewport.from || target.from > view.viewport.to) return null
    const at = view.domAtPos(target.from)
    const node = at.node as Node | null
    const element = node === null || node === undefined
      ? null
      : node.nodeType === 1
        ? (node as Element)
        : node.parentElement
    return element?.closest(EDITOR_LINE) ?? null
  }

  /** Take the mark off, wherever it currently sits. */
  const clearMark = (): void => {
    if (mark !== null) rowOf(mark.surface, mark.line)?.removeAttribute(MARK)
    mark = null
    keep?.disconnect()
  }

  /**
   * Put the mark back on the line it names, after the surface re-rendered over it.
   *
   * Nothing is scrolled here: the reader may have moved on, and yanking the
   * document back would be worse than a mark that waits where it was put. If the
   * line is not rendered at the moment (the block is mid-replace, or CodeMirror
   * has virtualized it away), the mark waits for the paint that brings it back.
   */
  const repaint = (): void => {
    if (mark === null) return
    if (mark.surface.kind === 'preview' && linesOf(mark.surface.preview) === null) {
      // The preview stopped being something with lines (a rendered document took
      // the tab): the line the mark names is gone, and so is the mark's reason.
      clearMark()
      return
    }
    const row = rowOf(mark.surface, mark.line)
    if (row !== null && !row.hasAttribute(MARK)) row.setAttribute(MARK, '')
  }

  /** Keep one line marked until the next jump, watching it against re-renders. */
  const markLine = (surface: Surface, line: number): void => {
    clearMark()
    mark = { surface, line }
    rowOf(surface, line)?.setAttribute(MARK, '')
    const watched = watchNodeOf(surface)
    if (watched !== null) keep?.observe(watched, { childList: true, subtree: true })
  }

  /** Land on one line: a third of the viewport down, then keep it marked. */
  const land = (surface: Surface, line: number): void => {
    if (surface.kind === 'preview') {
      const lines = linesOf(surface.preview)
      const row = lines === null ? null : lines.at(line)
      if (lines === null || row === null) return
      const scroller = lines.scroller
      if (typeof row.getBoundingClientRect === 'function') {
        const box = scroller.getBoundingClientRect()
        const offset = row.getBoundingClientRect().top - box.top + scroller.scrollTop
        scroller.scrollTop = Math.max(0, offset - box.height / 3)
      }
    } else {
      const view = surface.view
      const doc = view.state.doc
      const target = Math.min(Math.max(line, 1), doc.lines)
      const start = doc.line(target).from
      // A collapsed caret, not a selection: the neighbour's editor grows a
      // floating "add to conversation" button over any non-empty selection, and
      // the mark below already says where the line is.
      view.dispatch({ selection: { anchor: start } })
      view.focus()
      const block = view.lineBlockAt(start)
      view.scrollDOM.scrollTop = Math.max(0, block.top - view.scrollDOM.clientHeight / 3)
      view.requestMeasure()
    }
    markLine(surface, line)
  }

  /**
   * Look for one line, pressing the host's "load more" while it is still ahead.
   *
   * The retry is a timer rather than a loop because each page is the host's
   * fetch: after a press the button spends a moment disabled, and only the next
   * look can tell whether the page arrived. The step count is the whole budget —
   * once it is spent, the last rendered line is where the reader lands. The
   * neighbour's editor loads whole files, so it lands directly.
   */
  const seek = (surface: Surface, line: number, steps: number): void => {
    if (surface.kind === 'editor') {
      land(surface, line)
      return
    }
    const preview = surface.preview
    if (!preview.isConnected) return
    const lines = linesOf(preview)
    if (lines === null) return
    const row = lines.at(line)
    if (row !== null) {
      land(surface, line)
      return
    }
    const more = preview.querySelector(MORE)
    if (more === null || steps <= 0) {
      const last = lines.count()
      if (last >= 1) land(surface, last)
      return
    }
    // A host that is already fetching spends a moment with the button disabled;
    // pressing it then would do nothing but burn a step.
    if (!more.hasAttribute('disabled')) (more as HTMLElement).click()
    if (climb !== null) clearTimeout(climb)
    climb = setTimeout(() => {
      climb = null
      seek(surface, line, steps - 1)
    }, PAGE_WAIT_MS) as unknown as number
  }

  /** Close the box, committing nothing. Idempotent. */
  const close = (): void => {
    const open = panel
    panel = null
    open?.remove()
  }

  /** Open the box on one surface, replacing any box already open. */
  const show = (surface: Surface): void => {
    close()
    const anchor = anchorOf(surface)
    if (anchor === null) return

    const box = document.createElement('div')
    box.className = PANEL_CLASS
    box.setAttribute(PANEL, '')

    const field = document.createElement('input')
    field.className = FIELD_CLASS
    field.setAttribute(FIELD, '')
    field.setAttribute('type', 'text')
    field.setAttribute('spellcheck', 'false')
    field.setAttribute('autocomplete', 'off')
    field.setAttribute('placeholder', t('linePlaceholder'))
    field.setAttribute('aria-label', t('gotoLine'))

    const hint = document.createElement('span')
    hint.className = HINT_CLASS
    hint.setAttribute(HINT, '')
    hint.textContent = rangeOf(surface)

    box.appendChild(field)
    box.appendChild(hint)
    field.addEventListener('keydown', (event: KeyboardEvent) => {
      // An IME's Enter confirms the composition, not the jump.
      if (event.isComposing === true) return
      if (event.key === 'Enter') {
        event.preventDefault()
        const line = parseLine(field.value)
        close()
        if (line !== null) seek(surface, line, MAX_STEPS)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    })
    // Blur is "clicked somewhere else": nothing is named, so nothing moves.
    field.addEventListener('blur', () => { close() })

    document.body.appendChild(box)
    panel = box

    // Pinned inside the surface's top-right corner — the seat an editor puts
    // its own find/go-to box in, and the one place it cannot cover the lines
    // the reader is about to name.
    const rect = anchor.getBoundingClientRect()
    box.style.top = `${Math.round(rect.top + 8)}px`
    box.style.left = `${Math.round(Math.max(rect.left + 8, rect.right - PANEL_WIDTH - 14))}px`
    field.focus()
    if (typeof field.select === 'function') field.select()
  }

  /** Ctrl+G (Cmd+G on macOS), and nothing else. */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented === true || event.isComposing === true) return
    if (event.altKey === true || event.shiftKey === true) return
    if (event.ctrlKey !== true && event.metaKey !== true) return
    if (typeof event.key !== 'string' || event.key.toLowerCase() !== 'g') return
    const target = event.target
    const element = target instanceof Element ? target : null

    // The neighbour's editor first: its content box is `contenteditable`, so the
    // field check below would otherwise hand the keystroke back — to a keymap
    // that reads Mod-g as "find next". Claiming it here also stops the event
    // from ever reaching CodeMirror's handler.
    const host = element === null ? null : element.closest(EDITOR)
    const editor = host === null ? null : editorOf(host)
    if (editor !== null) {
      event.preventDefault()
      event.stopPropagation()
      show({ kind: 'editor', view: editor })
      return
    }

    if (element !== null && element.closest(EDITABLE) !== null) return
    const found = candidates()
    if (found.length === 0) return
    const surface = pick(found)
    if (surface === null) return
    event.preventDefault()
    show(surface)
  }

  /** Remember where the pointer is, so the gesture follows the reader's eye. */
  const onPointerMove = (event: PointerEvent): void => {
    pointer = { x: event.clientX, y: event.clientY }
  }

  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('pointermove', onPointerMove, true)

  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('pointermove', onPointerMove, true)
    if (climb !== null) clearTimeout(climb)
    climb = null
    clearMark()
    close()
  }
}
