/**
 * The line model of the host's read-only preview, plus the page climb a jump
 * needs to reach a line that is not loaded yet.
 *
 * Two renderers, two shapes: the highlighted one keeps a single scrollport with
 * a `.line` span per line (no numbers in the DOM — the counter is CSS), the
 * plain one a row per line that carries its number as an attribute. The Markdown
 * renderer has neither and has to be turned away by name: a fenced code block in
 * a rendered document is a `CodeBlock` too, so looking for that scrollport alone
 * would happily offer to "jump" to line 3 of a fence.
 *
 * The host loads a long document a page at a time and appends the next one when
 * the reader nears the bottom, so lines past the last loaded page are not in the
 * DOM to scroll to. The host publishes a "load more" button while pages remain
 * (`data-textpreview-more`), and pressing it is the same call its own scroll
 * handler makes — so a jump presses it, waits a frame or two, and looks again,
 * up to {@link MAX_STEPS} times. Nothing is fetched by the plugin: the host
 * reads, the host pages, this module only names a line.
 *
 * `line-jump` carries its own copy of the climb, because it also draws the mark
 * that a jump leaves; folding it onto this module is a follow-up, not a
 * prerequisite for the callers that only need the model.
 */

/** The host preview's root, its scroll body, and the renderers that have lines. */
export const PREVIEW = '[data-textpreview-state]'
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

/** How long to wait for one page before looking again, in ms. */
const PAGE_WAIT_MS = 60
/** How many waits a jump may spend climbing pages before giving up. */
const MAX_STEPS = 120

/** One renderer's lines: the element that scrolls, and how to find a line in it. */
export interface PreviewLines {
  /** The element whose `scrollTop` moves the document. */
  scroller: Element
  /** Where the rows live: a click anywhere else on the preview is not a line. */
  region: Element
  /** Every rendered row, in document order. */
  rows(): Element[]
  /** The 1-based line one rendered row carries, or null when it carries none. */
  numberOf(row: Element): number | null
  /** The rendered row for a 1-based line, or null while that line is not loaded. */
  at(line: number): Element | null
  /** How many lines are rendered right now. */
  count(): number
}

/**
 * Read the lines of one preview.
 *
 * @param preview - the preview root, or any element inside it.
 * @returns the line model, or null on a surface that has no lines (a rendered
 * Markdown document, a PDF, an image).
 */
export function previewLinesOf(preview: Element): PreviewLines | null {
  const body = preview.querySelector(BODY)
  if (body === null) return null
  if (body.querySelector(MARKDOWN) !== null) return null
  const code = body.querySelector(CODE)
  const scroll = code === null ? null : code.querySelector(CODE_SCROLL)
  if (scroll !== null) {
    const rows = (): Element[] => Array.from(scroll.querySelectorAll(CODE_LINE))
    return {
      scroller: scroll,
      region: scroll,
      rows,
      numberOf: (row) => {
        const index = rows().indexOf(row)
        return index < 0 ? null : index + 1
      },
      at: (line) => rows()[line - 1] ?? null,
      count: () => rows().length,
    }
  }
  if (body.querySelector(PLAIN_LINE) === null) return null
  return {
    scroller: body,
    region: body,
    rows: () => Array.from(body.querySelectorAll(PLAIN_LINE)),
    numberOf: (row) => {
      const number = Number(row.getAttribute('data-textpreview-line'))
      return Number.isFinite(number) && number >= 1 ? number : null
    },
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

/** How a caller learns where a reveal ended up. */
export interface RevealOptions {
  /**
   * Called once, with the line the reader landed on — the requested one, or the
   * last rendered line when the page budget ran out first.
   */
  onLand?(line: number, row: Element | null): void
  /** Waits this reveal may spend climbing pages; defaults to the module budget. */
  steps?: number
}

/**
 * Scroll one preview to a line, loading pages on the way when it must.
 *
 * The retry is a timer rather than a loop because each page is the host's fetch:
 * after a press the button spends a moment disabled, and only the next look can
 * tell whether the page arrived. The step count is the whole budget — once it is
 * spent, the last rendered line is where the reader lands.
 *
 * @param preview - the preview root.
 * @param line - the 1-based line to reveal.
 * @param options - the landing callback and the page budget.
 */
export function revealPreviewLine(preview: Element, line: number, options: RevealOptions = {}): void {
  const steps = options.steps ?? MAX_STEPS
  const walk = (remaining: number): void => {
    if (!preview.isConnected) return
    const lines = previewLinesOf(preview)
    if (lines === null) return
    const row = lines.at(line)
    if (row !== null) {
      place(lines, row)
      options.onLand?.(line, row)
      return
    }
    const more = preview.querySelector(MORE)
    if (more === null || remaining <= 0) {
      const last = lines.count()
      const fallback = last >= 1 ? lines.at(last) : null
      if (fallback !== null) place(lines, fallback)
      options.onLand?.(fallback === null ? 0 : last, fallback)
      return
    }
    // A host that is already fetching spends a moment with the button disabled;
    // pressing it then would do nothing but burn a step.
    if (!more.hasAttribute('disabled')) (more as HTMLElement).click()
    // A harness with no timers cannot wait for a page: look once more with no
    // budget, which lands on whatever is rendered and returns.
    if (typeof setTimeout !== 'function') {
      walk(0)
      return
    }
    setTimeout(() => { walk(remaining - 1) }, PAGE_WAIT_MS)
  }
  walk(steps)
}

/** Put one row a third of the way down the scrollport, the way a jump lands. */
function place(lines: PreviewLines, row: Element): void {
  if (typeof row.getBoundingClientRect !== 'function') return
  const scroller = lines.scroller as Element & { scrollTop?: number; clientHeight?: number }
  if (typeof scroller.scrollTop !== 'number' || typeof scroller.clientHeight !== 'number') return
  const box = row.getBoundingClientRect()
  const frame = lines.region.getBoundingClientRect()
  scroller.scrollTop = Math.max(0, scroller.scrollTop + (box.top - frame.top) - scroller.clientHeight / 3)
}
