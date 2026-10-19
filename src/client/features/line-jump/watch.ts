/**
 * Ctrl+G for the host's text preview: name a line, land on it.
 *
 * The preview (`ui-sidebar-documentpreview`) draws its own line numbers — a
 * code file is one Shiki block whose spans are numbered by a CSS counter, a
 * plain file a row per line — but it offers no way to REACH a line except
 * dragging the scrollbar. `dsh-better-sidebar` does not fill that gap either:
 * its editor is CodeMirror, where Mod-g is the search panel's "next match" and
 * the go-to-line dialog sits behind Mod-Alt-g, in its own tab rather than on
 * this preview.
 *
 * So this feature is a keyboard gesture and a small floating box, nothing else:
 *
 * - Ctrl+G (Cmd+G on macOS) opens a one-field box at the top-right of the
 *   preview the reader is looking at, pre-filled with nothing and carrying the
 *   line range that is rendered so far (`1–471`, or `1–471+` while the host has
 *   more pages);
 * - Enter lands on that line — scrolled a third of the way down the viewport,
 *   the way an editor's go-to-line leaves it — marks it, and closes the box;
 *   Escape, blur and an empty box close it without moving anything;
 * - a line the host has not rendered yet is reached by pressing the host's own
 *   "load more" until it appears (see "Pages" below); a line past the end of the
 *   document lands on the last line, as every editor's go-to-line does;
 * - the mark stays on the landed-on line until the next jump. A flash was the
 *   first shape of this, and it was the wrong one: the line is where the reader
 *   asked to be, so losing the tint 1.2 s later lost the only trace of the
 *   answer to "where did I land". The mark is repainted if the host re-renders
 *   the block under it (a new page replaces every line node), so scrolling on
 *   does not quietly wipe it either.
 *
 * ## Which preview the gesture means
 *
 * The right sidebar can hold more than one preview (two panes, two files), so
 * the box is opened for the one the reader is working in, in this order: the
 * preview holding the focus (clicking a code block focuses it — the host gives
 * that `<pre>` a tabindex), the preview under the pointer, and — the common case
 * — the only preview on screen. With two previews and neither claimed, the
 * gesture is left alone rather than guessing.
 *
 * ## Only where a line means something
 *
 * The preview also renders Markdown and PDFs. A rendered Markdown document has
 * no line numbers to name — its fenced code blocks are `CodeBlock`s with
 * scrollports of their own, which is exactly why the document anchor, not the
 * presence of a code block, decides (see `linesOf`) — and a PDF has no lines at
 * all. Ctrl+G on either does nothing (no box, no swallowed keystroke). The
 * composer and every other text field are excluded too: Ctrl+G while typing a
 * prompt stays the browser's.
 *
 * ## Pages
 *
 * The host loads a long document a page at a time and appends the next one when
 * the reader nears the bottom (`text-pages`), so the lines past the last loaded
 * page are not in the DOM to scroll to. The host publishes a "load more" button
 * while pages remain (`data-textpreview-more`), and pressing it is the same call
 * its own scroll handler makes — so the jump presses it, waits a frame or two,
 * and looks again, up to {@link MAX_STEPS} times. Nothing is fetched by this
 * plugin: the host reads, the host pages, the box only names a line.
 *
 * Like the outline, this decorates a surface `dsh-better-sidebar` takes over
 * when it is loaded, so it stands down for that neighbour at every keystroke.
 */

import type { ClientContext, Translator } from '../../platform/types'
import { betterSidebarOwnsSurfaces } from '../../platform/neighbour'
import { parseLine } from './parse'

/** The preview's root, its scroll body, and the two renderers that have lines. */
const PREVIEW = '[data-textpreview-state]'
const BODY = '[data-textpreview-body]'
/** A rendered document — no lines to name, whatever code blocks it may hold. */
const MARKDOWN = '[data-document-markdown]'
/** The preview's own highlighted renderer (the plain one has no wrapper). */
const CODE = '[data-code-preview]'
/** The highlighted code renderer: its own scrollport, and one `.line` per line. */
const CODE_SCROLL = '[data-code-block-content]'
const CODE_LINE = '.line'
/** The plain fallback: one row per line, each carrying its own number. */
const PLAIN_LINE = '[data-textpreview-line]'
/** The host's "load more" control, drawn while the document has pages left. */
const MORE = '[data-textpreview-more]'
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
 * Watch for Ctrl+G and offer the go-to-line box on the preview it applies to.
 *
 * @param ctx - the client context (the neighbour probe).
 * @param t - the copy lookup bound to this feature's namespace.
 * @returns the effect's disposer, which closes the box and clears every mark.
 */
export function watchLineJump(ctx: ClientContext, t: Translator): () => void {
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
  let mark: { preview: Element; line: number } | null = null
  /**
   * Watches the marked preview for re-renders.
   *
   * A page arriving replaces the whole highlighted block, line nodes included,
   * so an attribute put on one of them survives only until the next page. The
   * reader asked for this line; the mark is put back on it as long as the
   * preview lives (attributes are not observed, so a repaint cannot loop).
   */
  const keep = typeof MutationObserver === 'function'
    ? new MutationObserver(() => { repaint() })
    : null

  /**
   * The lines of one preview, or null on a surface that has none.
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

  /** The previews this gesture could act on, in document order. */
  const candidates = (): Element[] => {
    const found: Element[] = []
    for (const preview of Array.from(document.querySelectorAll(PREVIEW))) {
      if (linesOf(preview) !== null) found.push(preview)
    }
    return found
  }

  /** The preview the reader means: focused, else pointed at, else the only one. */
  const pick = (found: readonly Element[]): Element | null => {
    const active = document.activeElement
    if (active instanceof Element) {
      const owner = active.closest(PREVIEW)
      if (owner !== null && found.includes(owner)) return owner
    }
    if (pointer !== null && typeof document.elementFromPoint === 'function') {
      const under = document.elementFromPoint(pointer.x, pointer.y)
      const owner = under instanceof Element ? under.closest(PREVIEW) : null
      if (owner !== null && found.includes(owner)) return owner
    }
    return found.length === 1 ? found[0] : null
  }

  /** The rendered range, as the box's hint: `1–471`, or `1–471+` with pages left. */
  const rangeOf = (preview: Element): string => {
    const lines = linesOf(preview)
    if (lines === null) return ''
    const last = lines.count()
    return preview.querySelector(MORE) === null ? `1–${last}` : `1–${last}+`
  }

  /** Take the mark off, wherever it currently sits. */
  const clearMark = (): void => {
    if (mark !== null) {
      const lines = linesOf(mark.preview)
      const row = lines === null ? null : lines.at(mark.line)
      row?.removeAttribute(MARK)
    }
    mark = null
    keep?.disconnect()
  }

  /**
   * Put the mark back on the line it names, after the host re-rendered over it.
   *
   * Nothing is scrolled here: the reader may have moved on, and yanking the
   * document back would be worse than a mark that waits where it was put. If the
   * line is not rendered at the moment (the block is mid-replace), the mark is
   * simply lost — the next paint has no row to carry it.
   */
  const repaint = (): void => {
    if (mark === null) return
    const lines = linesOf(mark.preview)
    if (lines === null) {
      // The preview stopped being something with lines (a rendered document took
      // the tab): the line the mark names is gone, and so is the mark's reason.
      clearMark()
      return
    }
    const row = lines.at(mark.line)
    if (row !== null && !row.hasAttribute(MARK)) row.setAttribute(MARK, '')
  }

  /** Keep one row marked until the next jump, watching it against re-renders. */
  const markLine = (preview: Element, line: number, row: Element): void => {
    clearMark()
    mark = { preview, line }
    row.setAttribute(MARK, '')
    keep?.observe(preview, { childList: true, subtree: true })
  }

  /** Land on one row: a third of the viewport down, then keep it marked. */
  const land = (preview: Element, lines: Lines, row: Element, line: number): void => {
    const scroller = lines.scroller
    if (typeof row.getBoundingClientRect === 'function') {
      const box = scroller.getBoundingClientRect()
      const offset = row.getBoundingClientRect().top - box.top + scroller.scrollTop
      scroller.scrollTop = Math.max(0, offset - box.height / 3)
    }
    markLine(preview, line, row)
  }

  /**
   * Look for one line, pressing the host's "load more" while it is still ahead.
   *
   * The retry is a timer rather than a loop because each page is the host's
   * fetch: after a press the button spends a moment disabled, and only the next
   * look can tell whether the page arrived. The step count is the whole budget —
   * once it is spent, the last rendered line is where the reader lands.
   */
  const seek = (preview: Element, line: number, steps: number): void => {
    if (!preview.isConnected) return
    const lines = linesOf(preview)
    if (lines === null) return
    const row = lines.at(line)
    if (row !== null) {
      land(preview, lines, row, line)
      return
    }
    const more = preview.querySelector(MORE)
    if (more === null || steps <= 0) {
      const last = lines.at(lines.count())
      if (last !== null) land(preview, lines, last, lines.count())
      return
    }
    // A host that is already fetching spends a moment with the button disabled;
    // pressing it then would do nothing but burn a step.
    if (!more.hasAttribute('disabled')) (more as HTMLElement).click()
    if (climb !== null) clearTimeout(climb)
    climb = setTimeout(() => {
      climb = null
      seek(preview, line, steps - 1)
    }, PAGE_WAIT_MS) as unknown as number
  }

  /** Close the box, committing nothing. Idempotent. */
  const close = (): void => {
    const open = panel
    panel = null
    open?.remove()
  }

  /** Open the box on one preview, replacing any box already open. */
  const show = (preview: Element): void => {
    close()
    const body = preview.querySelector(BODY)
    if (body === null) return

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
    hint.textContent = rangeOf(preview)

    box.appendChild(field)
    box.appendChild(hint)
    field.addEventListener('keydown', (event: KeyboardEvent) => {
      // An IME's Enter confirms the composition, not the jump.
      if (event.isComposing === true) return
      if (event.key === 'Enter') {
        event.preventDefault()
        const line = parseLine(field.value)
        close()
        if (line !== null) seek(preview, line, MAX_STEPS)
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

    // Pinned inside the preview's top-right corner — the seat an editor puts
    // its own find/go-to box in, and the one place it cannot cover the lines
    // the reader is about to name.
    const rect = body.getBoundingClientRect()
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
    if (target instanceof Element && target.closest(EDITABLE) !== null) return
    if (betterSidebarOwnsSurfaces(ctx)) return
    const found = candidates()
    if (found.length === 0) return
    const preview = pick(found)
    if (preview === null) return
    event.preventDefault()
    show(preview)
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
