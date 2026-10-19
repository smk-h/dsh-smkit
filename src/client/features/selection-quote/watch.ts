/**
 * "Add to conversation" for the host's read-only surfaces: file previews and
 * terminals.
 *
 * The previews (`ui-sidebar-documentpreview`) render a file as text that can be
 * selected and nothing else, and the sidebar terminal (`ui-sidebar-terminal`)
 * gives a screen the reader can select with no way out either: neither can hand
 * a passage to the conversation. `dsh-better-sidebar` grows this affordance
 * inside its own viewer — a floating button over the selection whose press drops
 * a fenced block into the composer draft — and this feature is that behaviour for
 * the host's surfaces, so a profile without the neighbour is not a downgrade.
 *
 * ## The gesture
 *
 * A mouse-up with a live selection inside a surface anchors one small button
 * just above the point the gesture ended at (`position: fixed`, portaled to
 * `document.body` so no scrollport can clip it). On a preview the press commits:
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
 * ## Terminals
 *
 * The sidebar's terminal tab is xterm.js: its selection lives in the emulator's
 * own model, not in the document — the screen is a renderer and the root is
 * `user-select: none`, so `window.getSelection()` never sees it. The way out is
 * the copy path xterm installs on its own root: a dispatched `copy` event that
 * carries a `clipboardData` sink is answered with the selection text, without
 * touching the real clipboard, without a keyboard shortcut, and without the
 * `Terminal` instance (which xterm keeps private and the host exposes no
 * selection face for).
 *
 * A terminal selection names no path and no line numbers, so its payload is the
 * text alone in a fenced `console` block — at every length: a header would point
 * at nothing, and the reader chose those lines deliberately. Its session comes
 * from the same right-sidebar container as a preview's, because the terminal tab
 * lives in that sidebar.
 *
 * ## Why the pointer, not the selection's box
 *
 * The button is anchored to where the gesture ended, never to the selection's
 * bounding rectangle: a selection taller than the surface (the reader drags to
 * the bottom edge, the surface auto-scrolls, the block keeps growing) has a box
 * whose top is at best at the viewport's edge and at worst far above it — the
 * button would be placed off-screen above the window, which is exactly how a
 * large selection used to lose its button. The pointer is on screen by
 * construction, and it sits at the end of the selection the reader just made,
 * which is also where their eye is. A preview is still named by the selection
 * (its endpoints), not by the mouse-up's target, so a drag released a few pixels
 * past the preview's edge keeps its button.
 *
 * ## Only the host's surfaces
 *
 * While `dsh-better-sidebar` is loaded it owns both the file previews and the
 * terminal, and draws this very popup in its own editor, so this watch stands
 * down on every gesture (the same rule the outline and the explorer chip follow,
 * see `platform/neighbour`). The host's Markdown preview, which that plugin does
 * not take over, still answers here — one popup, never two.
 *
 * ## When the button goes away
 *
 * The button is anchored to a live selection, so it dies with it: an outside
 * press, Escape, a collapsed preview selection, the surface scrolling under the
 * anchor, the surface leaving the viewport, the document being hidden or the
 * window losing focus all remove it. Its own press is exempt from the
 * outside-press rule and preventDefaults its `mousedown`: moving focus would
 * collapse the selection and take the anchor (and the payload) with it before the
 * click lands — the same contract the reference implementation documents. A
 * terminal's selection is not a document selection, so there is nothing to watch
 * collapse there: a press anywhere else is what closes its button.
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

/** The sidebar terminal's root: xterm's own class, and the surface that copies. */
const TERMINAL = '.xterm'

/**
 * The fence info line a terminal passage goes into.
 *
 * There is no path and no language to name — the output may be anything — so
 * the conventional `console` is the honest label. It tells the model the block
 * is a session transcript rather than source to read from a file.
 */
const TERMINAL_INFO = 'console'

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

/**
 * One quote, ready to press: what would be inserted, and the surface it came
 * from.
 */
interface Quote {
  /** The text the press writes into the composer draft. */
  insert: string
  /** The surface's session, where the draft lives. */
  sessionId: string
  /** The element the button is attached to (leaving the viewport closes it). */
  surface: Element
  /**
   * The preview body whose DOM selection keeps the button alive, or null for a
   * terminal (whose selection is the emulator's, not the document's).
   */
  selectionBody: Element | null
  /** Where the gesture ended, in viewport coordinates. */
  point: { x: number; y: number }
}

/** The open button, and the selection it belongs to. */
interface Open {
  button: HTMLButtonElement
  /** The surface's selection body, when it has one: the button dies with it. */
  selectionBody: Element | null
  /** Watches the surface until it leaves the viewport (null on a host without one). */
  observer: IntersectionObserver | null
}

/**
 * Watch the host's read-only surfaces (previews and terminals) for selections
 * and offer to add them to the draft.
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
  /** Where the last press landed: a terminal's selection is a drag (see `onMouseUp`). */
  let pressAt: { x: number; y: number } | null = null

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

  /** Close the button as soon as its surface leaves the viewport (a tab swap hides one). */
  const watchSurface = (surface: Element): IntersectionObserver | null => {
    if (typeof IntersectionObserver !== 'function') return null
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) hide()
      }
    }, { threshold: 0 })
    observer.observe(surface)
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
   * of the selection (or, for a terminal, the surface's own top), which is the
   * same place for a synthetic mouse-up that carried no coordinates. A pointer
   * at 0,0 is that spelling too.
   */
  const pointOf = (event: MouseEvent, range: Range | null, surface: Element): { x: number; y: number } => {
    const x = event.clientX
    const y = event.clientY
    if (Number.isFinite(x) && Number.isFinite(y) && (x > 0 || y > 0)) return { x, y }
    if (range !== null) {
      if (typeof range.getClientRects === 'function') {
        const rects = range.getClientRects()
        const last = rects.length > 0 ? rects[rects.length - 1] : null
        if (last !== null && last !== undefined) return { x: last.left + last.width / 2, y: Math.max(last.top, 0) }
      }
      const box = range.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: Math.max(box.top, 0) }
    }
    const box = surface.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: Math.max(box.top + 8, 8) }
  }

  /**
   * The text one terminal holds selected.
   *
   * Read through xterm's own copy path (see the module doc): a synthetic `copy`
   * event with a `clipboardData` sink on the terminal's root is answered with
   * the selection, no clipboard and no keyboard needed. It does not bubble, so
   * the shell's own copy handlers never see the probe, and xterm's handler only
   * asks its selection service — the renderer in use makes no difference.
   */
  const terminalText = (root: Element): string => {
    if (typeof Event !== 'function' || typeof root.dispatchEvent !== 'function') return ''
    let text: string | undefined
    try {
      const probe = new Event('copy', { cancelable: true })
      Object.defineProperty(probe, 'clipboardData', {
        configurable: true,
        value: { setData: (_type: string, value: string) => { text = value } },
      })
      root.dispatchEvent(probe)
    } catch (error) {
      console.warn('[smkit] terminal selection unreadable:', error)
    }
    return text ?? ''
  }

  /**
   * The quote one terminal mouse-up means, or null when it selected nothing.
   *
   * The terminal's session comes from the sidebar container it lives in, like a
   * preview's; the payload is the text in a fenced `console` block, with no
   * length cap — a terminal passage has no path or line span to fall back to, so
   * a header-only quote would say nothing at all (see the module doc).
   */
  const terminalQuote = (root: Element, event: MouseEvent): Quote | null => {
    const text = terminalText(root)
    if (text.trim() === '') return null
    const sessionId = sessionOfRow(ctx, root)
    if (sessionId === undefined) {
      console.warn('[smkit] selection quote skipped: the terminal names no session')
      return null
    }
    return {
      insert: `\`\`\`${TERMINAL_INFO}\n${text}\n\`\`\``,
      sessionId,
      surface: root,
      selectionBody: null,
      point: pointOf(event, null, root),
    }
  }

  /**
   * Open the button for one quote: anchor it to the point the gesture ended at
   * and arm its press.
   *
   * The button is a fresh element every time, so its listener can close over
   * the payload that is current: reusing one node would mean mutating what its
   * listener inserts, and the winner of that race would be invisible.
   */
  const openButton = (quote: Quote): void => {
    const { insert, sessionId, point } = quote

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
    open = { button, selectionBody: quote.selectionBody, observer: watchSurface(quote.surface) }
  }

  /** How far the pointer travelled between the press and the release, in CSS pixels. */
  const travel = (to: MouseEvent): number => {
    if (pressAt === null) return Number.POSITIVE_INFINITY
    const dx = to.clientX - pressAt.x
    const dy = to.clientY - pressAt.y
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0
    return Math.hypot(dx, dy)
  }

  /**
   * A mouse-up that leaves a live selection offers the button.
   *
   * A terminal is asked first and by target: its selection never reaches the
   * document (see the module doc), so the target is the only witness, and a
   * stale preview selection must not answer for it. A preview is then named by
   * its selection's endpoints, not by the release point, so a drag that ends a
   * few pixels past the block's edge (the usual end of a long selection) keeps
   * its button; a click elsewhere has already collapsed that selection.
   */
  const onMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) return
    const target = event.target
    // The button's own mouse-up: its click is about to commit.
    if (open !== null && target instanceof Node && (target === open.button || open.button.contains(target))) return
    hide()
    if (betterSidebarOwnsSurfaces(ctx)) return
    const element = target instanceof Element ? target : null
    const terminal = element === null ? null : element.closest(TERMINAL)
    if (terminal !== null) {
      // A plain click is not a selection: xterm can keep its old selection
      // through one, and re-offering the button for it on every click would be
      // noise. A drag (the pointer moved) or a multi-click (a word, a line) is
      // what produced the text.
      if (event.detail < 2 && travel(event) < 3) return
      const quote = terminalQuote(terminal, event)
      if (quote !== null) openButton(quote)
      return
    }
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
    const path = pathOf(preview)
    if (path === undefined) return
    const sessionId = sessionOfRow(ctx, preview)
    if (sessionId === undefined) {
      console.warn('[smkit] selection quote skipped: the preview names no session')
      return
    }
    openButton({
      insert: buildQuote(path, cwdOf(sessionId), linesOf(body, range), text),
      sessionId,
      surface: preview,
      selectionBody: body,
      point: pointOf(event, range, preview),
    })
  }

  /** A press anywhere but the button closes it (the button exempts itself). */
  const onMouseDown = (event: MouseEvent): void => {
    pressAt = { x: event.clientX, y: event.clientY }
    if (open === null) return
    const target = event.target
    if (target instanceof Node && (target === open.button || open.button.contains(target))) return
    hide()
  }

  /** Escape closes it, like every other floating surface of the shell. */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (open !== null && event.key === 'Escape') hide()
  }

  /**
   * The button belongs to a live preview selection: a collapsed or moved-away
   * one drops it. A terminal's selection is the emulator's own, invisible to
   * this event — its button is closed by a press elsewhere instead.
   */
  const onSelectionChange = (): void => {
    if (open === null || open.selectionBody === null) return
    const selection = selectionOf()
    if (selection === null || selection.isCollapsed === true || selection.rangeCount === 0) {
      hide()
      return
    }
    const range = selection.getRangeAt(0)
    if (!inside(open.selectionBody, range.startContainer) || !inside(open.selectionBody, range.endContainer)) hide()
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
