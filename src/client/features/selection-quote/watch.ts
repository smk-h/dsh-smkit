/**
 * "Add to conversation" for the host's read-only file previews.
 *
 * The previews (`ui-sidebar-documentpreview`) render a file as text that can be
 * selected and nothing else: no editor, no way to hand a passage to the
 * conversation. `dsh-better-sidebar` grows exactly this affordance inside its own
 * viewer — a floating button over the selection whose press drops a fenced code
 * block into the composer draft — and this feature is that behaviour for the
 * host's preview, so a profile without the neighbour is not a downgrade.
 *
 * ## The gesture
 *
 * A mouse-up with a live selection inside a preview anchors one small button
 * just above the point the gesture ended at (`position: fixed`, portaled to
 * `document.body` so no scrollport can clip it). The press commits:
 *
 *     ```src/a.ts:12-15
 *     <the selected lines>
 *     ```
 *
 * — the info line carries the previewed path relative to the session's cwd and
 * the line span, so the model can open the file at the right place instead of
 * guessing from pasted code. A selection over {@link SELECTION_LIMIT}
 * characters is only the info line (the content would flood the draft), and a
 * rendered Markdown document — whose blocks are prose, not source lines — is
 * the path alone (see `payload.ts`).
 *
 * ## Why the pointer, not the selection's box
 *
 * The button is anchored to where the gesture ended, never to the selection's
 * bounding rectangle: a selection taller than the preview (the reader drags to
 * the bottom edge, the surface auto-scrolls, the block keeps growing) has a box
 * whose top is at best at the viewport's edge and at worst far above it — the
 * button would be placed off-screen above the window, which is exactly how a
 * large selection used to lose its button. The pointer is on screen by
 * construction, and it sits at the end of the selection the reader just made,
 * which is also where their eye is. The surface is still named by the selection
 * (its endpoints), not by the mouse-up's target, so a drag released a few pixels
 * past the preview's edge keeps its button.
 *
 * ## Only the host's preview
 *
 * While `dsh-better-sidebar` is loaded it owns the file previews and draws this
 * very popup in its own editor, so this watch stands down on every gesture
 * (the same rule the outline and the explorer chip follow, see
 * `platform/neighbour`). The host's Markdown preview, which that plugin does not
 * take over, still answers here — one popup, never two.
 *
 * ## When the button goes away
 *
 * The button is anchored to a live selection, so it dies with it: an outside
 * press, Escape, a collapsed selection, the preview scrolling under the anchor,
 * the surface leaving the viewport, the document being hidden or the window
 * losing focus all remove it. Its own press is exempt from the outside-press
 * rule and preventDefaults its `mousedown`: moving focus would collapse the
 * selection and take the anchor (and the payload) with it before the click
 * lands — the same contract the reference implementation documents.
 *
 * ## Where the path and the lines come from
 *
 * The preview header prints the file path with the complete string in its
 * `title` (`PathLabel` in ui-primitives), which is the anchor this feature
 * reads — the header's classes are build-time hashes. The session comes from the
 * right sidebar container (`data-sidebar-right-session`, the host's own lookup),
 * and the cwd from the session list, which is what makes the inserted path
 * relative; an unknown cwd leaves the absolute path in place.
 *
 * Line numbers are read from the rendered DOM, not from the source: the
 * highlighted renderer numbers its rows by position (the gutter is a CSS
 * counter), the plain renderer stamps each row with its number, and neither
 * exists in a rendered Markdown document. A selection that starts or ends
 * outside those rows simply reports no line span.
 */

import type { ClientContext, Translator } from '../../platform/types'
import { betterSidebarOwnsSurfaces } from '../../platform/neighbour'
import { appendToDraft } from '../../platform/composer'
import { sessionOfRow } from '../../platform/session'
import { buildQuote } from './payload'
import type { SelectionLines } from './payload'

/** One text preview: its root, scroll body, path label, and the two renderers. */
const PREVIEW = '[data-textpreview-state="text"]'
const BODY = '[data-textpreview-body]'
const PATH = '[data-textpreview-path]'
/** A rendered document — prose, so a selection has no source lines. */
const MARKDOWN = '[data-document-markdown]'
/** The highlighted renderer: a `CodeBlock` scrollport with one `.line` per line. */
const CODE = '[data-code-preview]'
const CODE_SCROLL = '[data-code-block-content]'
const CODE_LINE = '.line'
/** The plain renderer: one row per line, each carrying its own number. */
const PLAIN_LINE_ATTR = 'data-textpreview-line'
const PLAIN_LINE = `[${PLAIN_LINE_ATTR}]`

/** This feature's marker and class (see `style/action.css`). */
const ACTION = 'data-smkit-quote-action'
const ACTION_CLASS = 'smkit-quote-action'

/**
 * Vertical room one anchored button needs: its 28px height, the 8px gap the
 * stylesheet lifts it by, and an 8px viewport margin. A gesture that ends
 * higher than this is anchored that much lower, so the button stays inside the
 * window instead of being lifted off its top edge.
 */
const ABOVE_ROOM = 44

/**
 * How long a scroll is ignored after the button opens.
 *
 * A drag that reaches the surface's edge makes it auto-scroll, and the last
 * step of that scroll can be dispatched after the mouse-up that opened the
 * button — which would otherwise close it in the same frame it appeared, the
 * way a large selection used to lose its button.
 */
const SCROLL_GRACE_MS = 300

/** The open button, and the selection it belongs to. */
interface Open {
  button: HTMLButtonElement
  /** The preview body the selection lives in: the button dies with it. */
  body: Element
  /** Watches the surface until it leaves the viewport (null on a host without one). */
  observer: IntersectionObserver | null
}

/**
 * Watch the host's previews for selections and offer to add them to the draft.
 *
 * @param ctx - the client context (services are resolved at gesture time).
 * @param t - the copy lookup bound to this feature's namespace.
 * @returns the effect's disposer, which removes the button and the listeners.
 */
export function watchSelectionQuote(ctx: ClientContext, t: Translator): () => void {
  // `document` is absent outside a browser (the hook test harness runs the
  // bundle in a bare context) — the same guard the platform watchers carry.
  if (typeof document === 'undefined' || document.body === null || document.body === undefined) return () => {}

  /** The open button, or null. */
  let open: Open | null = null
  /** When the open button stops ignoring scrolls (see `onScroll`). */
  let settleUntil = 0

  /** The document's selection, read through the one call that may be absent. */
  const selectionOf = (): Selection | null => {
    if (typeof document.getSelection !== 'function') return null
    return document.getSelection()
  }

  /** The element one selection endpoint sits in (a text node's parent). */
  const elementOf = (node: Node | null): Element | null => {
    if (node === null) return null
    return node.nodeType === 1 ? (node as Element) : node.parentElement
  }

  /** Whether one node sits inside an element. */
  const inside = (host: Element, node: Node | null): boolean => {
    const element = elementOf(node)
    return element !== null && host.contains(element)
  }

  /**
   * The previewed file's path, as the header prints it.
   *
   * `PathLabel` keeps the complete path in `title` (its visible text is split
   * into directory and file name, and may be clipped), so that is the answer;
   * a host that renders a plain label has its text read instead.
   */
  const pathOf = (preview: Element): string | undefined => {
    const label = preview.querySelector(PATH)
    if (label === null) return undefined
    const titled = (label.getAttribute('title') ?? '').trim()
    const path = titled === '' ? (label.textContent ?? '').trim() : titled
    return path === '' ? undefined : path
  }

  /** The rendered rows of one preview, when it renders source lines at all. */
  const rowsOf = (body: Element): Element[] | null => {
    if (body.querySelector(MARKDOWN) !== null) return null
    const code = body.querySelector(CODE)
    const scroll = code === null ? null : code.querySelector(CODE_SCROLL)
    if (scroll !== null) return Array.from(scroll.querySelectorAll(CODE_LINE))
    if (body.querySelector(PLAIN_LINE) !== null) return Array.from(body.querySelectorAll(PLAIN_LINE))
    return null
  }

  /**
   * The number of one rendered row: the plain renderer stamps it, the
   * highlighted one numbers by position (the gutter is a CSS counter, there is
   * no number in the DOM).
   */
  const numberOf = (rows: readonly Element[], row: Element): number | null => {
    const labelled = row.getAttribute(PLAIN_LINE_ATTR)
    if (labelled !== null && Number(labelled) >= 1) return Number(labelled)
    const at = rows.indexOf(row)
    return at < 0 ? null : at + 1
  }

  /**
   * The source lines a selection covers, or undefined when the preview cannot
   * say — a rendered document, or an endpoint outside the rendered rows.
   */
  const linesOf = (body: Element, range: Range): SelectionLines | undefined => {
    const rows = rowsOf(body)
    if (rows === null || rows.length === 0) return undefined
    const rowOf = (node: Node | null): Element | undefined => {
      const element = elementOf(node)
      return element === null ? undefined : rows.find((row) => row.contains(element))
    }
    const from = rowOf(range.startContainer)
    const to = rowOf(range.endContainer)
    if (from === undefined || to === undefined) return undefined
    const first = numberOf(rows, from)
    const last = numberOf(rows, to)
    if (first === null || last === null) return undefined
    return { start: Math.min(first, last), end: Math.max(first, last) }
  }

  /**
   * The session's working directory, read from the host-authoritative session
   * list. Optional on purpose: the payload keeps the absolute path when it is
   * unknown rather than naming a file relative to the wrong root.
   */
  const cwdOf = (sessionId: string): string | undefined => {
    try {
      const snapshot = ctx.sessions?.list?.getSnapshot() as unknown as
        | { byId?: Readonly<Record<string, { cwd?: string } | undefined>> }
        | undefined
      const cwd = snapshot?.byId?.[sessionId]?.cwd
      return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
    } catch {
      return undefined
    }
  }

  /** The viewport width, or 0 outside a laid-out browser (the harness). */
  const viewportWidth = (): number => {
    if (typeof window === 'undefined') return 0
    const width = window.innerWidth
    return typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 0
  }

  /** Hide the button, if one is open. Idempotent. */
  const hide = (): void => {
    const current = open
    if (current === null) return
    open = null
    current.observer?.disconnect()
    current.button.remove()
  }

  /** Close the button as soon as its preview leaves the viewport (a tab swap hides one). */
  const watchSurface = (preview: Element): IntersectionObserver | null => {
    if (typeof IntersectionObserver !== 'function') return null
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) hide()
      }
    }, { threshold: 0 })
    observer.observe(preview)
    return observer
  }

  /**
   * Nudge the button back inside the window after it has been laid out.
   *
   * Measured, not assumed: the copy's width is the locale's business. A harness
   * without layout measures zero, and nothing is adjusted there.
   */
  const clampIntoViewport = (button: HTMLButtonElement): void => {
    const width = viewportWidth()
    if (width <= 0 || typeof button.getBoundingClientRect !== 'function') return
    const box = button.getBoundingClientRect()
    if (!(box.width > 0)) return
    let dx = 0
    if (box.left < 8) dx = 8 - box.left
    else if (box.right > width - 8) dx = width - 8 - box.right
    if (dx === 0) return
    const left = Number.parseFloat(button.style.left) || 0
    button.style.left = `${Math.round(left + dx)}px`
  }

  /**
   * Where the button belongs: the point the gesture ended at.
   *
   * The pointer when the host reports one — it is where the reader's eye is, and
   * it sits at the end of the selection they just made — and otherwise the end
   * of the selection itself, which is the same place for a synthetic mouse-up
   * that carried no coordinates (a pointer at 0,0 is that spelling too).
   */
  const pointOf = (event: MouseEvent, range: Range): { x: number; y: number } => {
    const x = event.clientX
    const y = event.clientY
    if (Number.isFinite(x) && Number.isFinite(y) && (x > 0 || y > 0)) return { x, y }
    if (typeof range.getClientRects === 'function') {
      const rects = range.getClientRects()
      const last = rects.length > 0 ? rects[rects.length - 1] : null
      if (last !== null && last !== undefined) return { x: last.left + last.width / 2, y: Math.max(last.top, 0) }
    }
    const box = range.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: Math.max(box.top, 0) }
  }

  /**
   * Open the button for one selection: build the payload, anchor the button to
   * the point the gesture ended at, and arm its press.
   *
   * The button is a fresh element every time, so its listener can close over
   * the payload that is current: reusing one node would mean mutating what its
   * listener inserts, and the winner of that race would be invisible.
   */
  const openAt = (
    preview: Element,
    body: Element,
    range: Range,
    text: string,
    sessionId: string,
    point: { x: number; y: number },
  ): void => {
    const path = pathOf(preview)
    if (path === undefined) return
    const insert = buildQuote(path, cwdOf(sessionId), linesOf(body, range), text)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = ACTION_CLASS
    button.setAttribute(ACTION, '')
    button.textContent = t('addToConversation')
    button.title = t('addToConversation')
    // Keep the selection — and with it the anchor — alive until the click
    // commits. A press that moved focus would collapse it and take the payload
    // with it; the reference implementation carries the same guard.
    button.addEventListener('mousedown', (event: Event) => { event.preventDefault() })
    button.addEventListener('click', () => {
      // The draft write may fail (no conversation service, no scope); the
      // button goes either way — a dead button over a live selection is worse
      // than a gesture that did nothing.
      appendToDraft(ctx, sessionId, insert)
      hide()
    })

    // Anchored to the pointer, never to the selection's box (see the module
    // doc): a selection taller than the viewport has no on-screen box to hang
    // the button from. The stylesheet centres the button on the point and lifts
    // it 8px clear; the floor keeps that lift inside the window when the reader
    // releases against the top edge.
    button.style.left = `${Math.round(point.x)}px`
    button.style.top = `${Math.round(Math.max(point.y, ABOVE_ROOM))}px`

    document.body.appendChild(button)
    clampIntoViewport(button)
    settleUntil = Date.now() + SCROLL_GRACE_MS
    open = { button, body, observer: watchSurface(preview) }
  }

  /**
   * A mouse-up that leaves a live selection inside a preview offers the button.
   *
   * The selection names the surface, not the release point: a drag that ends a
   * few pixels past the block's edge (the usual end of a long selection) keeps
   * its button. A click elsewhere has already collapsed the selection, so it
   * still shows nothing.
   */
  const onMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) return
    const target = event.target
    // The button's own mouse-up: its click is about to commit.
    if (open !== null && target instanceof Node && (target === open.button || open.button.contains(target))) return
    hide()
    if (betterSidebarOwnsSurfaces(ctx)) return
    const selection = selectionOf()
    if (selection === null || selection.isCollapsed === true || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    const start = elementOf(range.startContainer)
    const preview = start === null ? null : start.closest(PREVIEW)
    if (preview === null) return
    const body = preview.querySelector(BODY)
    if (body === null) return
    if (!inside(body, range.startContainer) || !inside(body, range.endContainer)) return
    const text = selection.toString()
    if (text.trim() === '') return
    const sessionId = sessionOfRow(ctx, preview)
    if (sessionId === undefined) {
      console.warn('[smkit] selection quote skipped: the preview names no session')
      return
    }
    openAt(preview, body, range, text, sessionId, pointOf(event, range))
  }

  /** A press anywhere but the button closes it (the button exempts itself). */
  const onMouseDown = (event: MouseEvent): void => {
    if (open === null) return
    const target = event.target
    if (target instanceof Node && (target === open.button || open.button.contains(target))) return
    hide()
  }

  /** Escape closes it, like every other floating surface of the shell. */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (open !== null && event.key === 'Escape') hide()
  }

  /** The button belongs to a live selection: a collapsed or moved-away one drops it. */
  const onSelectionChange = (): void => {
    if (open === null) return
    const selection = selectionOf()
    if (selection === null || selection.isCollapsed === true || selection.rangeCount === 0) {
      hide()
      return
    }
    const range = selection.getRangeAt(0)
    if (!inside(open.body, range.startContainer) || !inside(open.body, range.endContainer)) hide()
  }

  const onVisibilityChange = (): void => {
    if (open !== null && document.hidden === true) hide()
  }

  /** A scrolling surface moves the anchor out from under the button. */
  const onScroll = (): void => {
    if (open === null) return
    // A long drag makes the surface auto-scroll, and the last step of that
    // scroll can be dispatched after the mouse-up that opened the button: give
    // the gesture a moment to settle before a scroll counts as the reader
    // moving on (see `SCROLL_GRACE_MS`).
    if (Date.now() < settleUntil) return
    hide()
  }

  /** Switching away from the window takes the selection with it. */
  const onWindowBlur = (): void => { hide() }

  document.addEventListener('mouseup', onMouseUp, true)
  document.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('visibilitychange', onVisibilityChange)
  document.addEventListener('scroll', onScroll, true)
  const windowBlur = typeof window !== 'undefined' && typeof window.addEventListener === 'function'
  if (windowBlur) window.addEventListener('blur', onWindowBlur)

  return () => {
    document.removeEventListener('mouseup', onMouseUp, true)
    document.removeEventListener('mousedown', onMouseDown, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    document.removeEventListener('scroll', onScroll, true)
    if (windowBlur) window.removeEventListener('blur', onWindowBlur)
    hide()
  }
}
