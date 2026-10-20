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
 * ## The gesture: the right-click card
 *
 * A right-click on a live selection opens a card at the pointer — the shell's
 * own `Menu`, drawn by `menu.ts` — with two rows. The first commits:
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
 * the path alone (see `payload.ts`). The second row copies the selection's own
 * text, which is the one row of the browser's native menu that was about the
 * passage; a write the browser accepted leaves a short confirmation where the
 * card was.
 *
 * There is deliberately no floating button over the selection. It was the first
 * shape of this feature and it cannot be placed reliably: anchored to the
 * gesture's end, a release against a surface's top edge puts it under the
 * preview's own header and the tab strip above it, and a release past the
 * window's bottom edge puts it off-screen. The pointer of a right-click is
 * always inside the surface the reader is looking at, and the host's `Menu`
 * measures and flips itself against every viewport edge — one affordance, and
 * the one that works at the edges.
 *
 * Claiming the native menu needs both a quote and the pointer on that quote's
 * surface: a selection left in the preview must not turn a right-click in the
 * composer (paste, spellcheck) into this card, and a right-click on the
 * preview's header keeps that surface's own menu. Without a selection the
 * native menu stays, and with it the terminal's own right-click behaviour.
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
 * ## Where the quote is anchored
 *
 * The card opens at the pointer, and the copy confirmation stays there. A
 * preview's quote is still named by the selection's endpoints rather than by the
 * pointer: a right-click inside a block always aims at that block. A synthetic
 * `contextmenu` with no coordinates (the keyboard's menu key) falls back to the
 * end of the selection, or to the terminal's own top edge.
 *
 * ## Coexisting with `dsh-better-sidebar`
 *
 * This watch does not stand down for the neighbour, unlike the outline, the `@`
 * reference chip and the explorer's row menu (`platform/neighbour`). There is
 * nothing to collide with: the neighbour's editor is its own tab body
 * (`[data-dsh-native-tab-host]`, CodeMirror or its Markdown renderer), which
 * carries none of the host markers this file reads, and it registers no
 * `contextmenu` handler of its own — its selection popup hangs off `mouseup`
 * inside that same editor. So its editor keeps its own affordance, the host's
 * previews and terminals keep this card, and a file the neighbour declines to
 * open (host-owned extensions such as images and PDFs) still lands on the host's
 * preview, where this card is the only affordance there is.
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

import type { ClientContext, ClientDeps, Translator } from '../../platform/types'
import { appendToDraft } from '../../platform/composer'
import { sessionOfRow } from '../../platform/session'
import { createQuoteMenu } from './menu'
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

/** The copy confirmation's class (see `style/action.css`) and its marker. */
const NOTE_CLASS = 'smkit-quote-action-note'
const COPIED = 'data-smkit-quote-copied'

/** How long the copy confirmation stays, in ms. */
const COPIED_MS = 1200

/**
 * Vertical room an anchored label needs: its 28px height, the 8px gap the
 * stylesheet lifts it by, and an 8px viewport margin. An anchor higher than this
 * is pushed down that much, so the lift cannot take the label off the window's
 * top edge; the matching ceiling keeps an anchor past the bottom edge inside.
 */
const ABOVE_ROOM = 44

/**
 * One quote, ready to commit: what the card's rows would write, and the surface
 * it came from.
 */
interface Quote {
  /** The text the quote row writes into the composer draft. */
  insert: string
  /** The selection's own text, unabridged: what the copy row puts on the clipboard. */
  text: string
  /** The surface's session, where the draft lives. */
  sessionId: string
  /** The surface the quote came from: the card must be opened on it. */
  surface: Element
  /** The preview body, or null for a terminal (whose selection is the emulator's). */
  selectionBody: Element | null
  /** Where the card opens, in viewport coordinates. */
  point: { x: number; y: number }
}

/**
 * Watch the host's read-only surfaces (previews and terminals) for a right-click
 * on a selection, and offer the passage to the draft.
 *
 * @param ctx - the client context (services are resolved at gesture time).
 * @param deps - the client deps; only `h` is used (the card's rows and icons).
 * @param t - the copy lookup bound to this feature's namespace.
 * @returns the effect's disposer, which removes the card and the listener.
 */
export function watchSelectionQuote(ctx: ClientContext, deps: ClientDeps, t: Translator): () => void {
  // `document` is absent outside a browser (the hook test harness runs the
  // bundle in a bare context) — the same guard the platform watchers carry.
  if (typeof document === 'undefined' || document.body === null || document.body === undefined) return () => {}

  // The card (see `menu.ts`). Undefined on a host whose platform table carries
  // no `Menu`, which leaves the native menu in place and no affordance of ours.
  const menu = createQuoteMenu(deps, t)
  /** The copy confirmation still on screen, and when it goes away. */
  let copiedNote: HTMLElement | null = null
  let copiedTimer: number | null = null

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

  /** The viewport height, or 0 outside a laid-out browser (the harness). */
  const viewportHeight = (): number => {
    if (typeof window === 'undefined') return 0
    const height = window.innerHeight
    return typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 0
  }

  /** Take the copy confirmation off screen, if one is up. Idempotent. */
  const hideCopied = (): void => {
    if (copiedTimer !== null) {
      clearTimeout(copiedTimer)
      copiedTimer = null
    }
    copiedNote?.remove()
    copiedNote = null
  }

  /**
   * Say the copy landed, where the card was, for a moment.
   *
   * The card is gone by then (see `menu.ts`), so without this a copy is a silent
   * act — and the shell's own menus answer a copy with a label in the row for
   * the same reason.
   */
  const flashCopied = (point: { x: number; y: number }): void => {
    hideCopied()
    const note = document.createElement('span')
    note.className = NOTE_CLASS
    note.setAttribute(COPIED, '')
    note.setAttribute('role', 'status')
    note.textContent = t('copied')
    note.style.left = `${Math.round(point.x)}px`
    note.style.top = `${anchoredTop(point.y)}px`
    document.body.appendChild(note)
    clampIntoViewport(note)
    copiedNote = note
    copiedTimer = setTimeout(hideCopied, COPIED_MS)
  }

  /**
   * Nudge the confirmation back inside the window horizontally, after it has
   * been laid out.
   *
   * Measured, not assumed: the copy's width is the locale's business, so only
   * the laid-out box can say where it ends. A harness without layout measures
   * zero, and nothing is adjusted there. The vertical axis needs no measurement
   * — the label is lifted off its anchor, so its box ends at the anchor, which
   * `anchoredTop` already keeps inside the window.
   */
  const clampIntoViewport = (note: HTMLElement): void => {
    const width = viewportWidth()
    if (width <= 0 || typeof note.getBoundingClientRect !== 'function') return
    const box = note.getBoundingClientRect()
    if (!(box.width > 0)) return
    let dx = 0
    if (box.left < 8) dx = 8 - box.left
    else if (box.right > width - 8) dx = width - 8 - box.right
    if (dx === 0) return
    const left = Number.parseFloat(note.style.left) || 0
    note.style.left = `${Math.round(left + dx)}px`
  }

  /**
   * Where an anchored label's anchor sits vertically: the point, floored so the
   * stylesheet's 8px lift cannot push it off the top edge, and ceiled so a point
   * past the window's bottom edge cannot push it off there.
   */
  const anchoredTop = (y: number): number => {
    const height = viewportHeight()
    const floored = Math.max(y, ABOVE_ROOM)
    return Math.round(height > 0 ? Math.min(floored, height - 8) : floored)
  }

  /**
   * Where the card opens.
   *
   * The pointer when the host reports one — it is where the reader aimed, and
   * the card belongs under it. A `contextmenu` from the keyboard reports 0,0,
   * so the end of the selection is used instead (or, for a terminal, the
   * surface's own top): the same place for the same intent.
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
   * The quote one terminal holds, or null when it selected nothing.
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
      text,
      sessionId,
      surface: root,
      selectionBody: null,
      point: pointOf(event, null, root),
    }
  }

  /**
   * The quote one preview selection means, or null when it names nothing.
   *
   * Named by the selection's endpoints, never by the pointer: both endpoints
   * have to sit in the same preview's body, because a selection that reaches out
   * of it names nothing this payload could describe.
   */
  const previewQuote = (event: MouseEvent): Quote | null => {
    const selection = selectionOf()
    if (selection === null || selection.isCollapsed === true || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    const start = elementOf(range.startContainer)
    const preview = start === null ? null : start.closest(PREVIEW)
    if (preview === null) return null
    const body = preview.querySelector(BODY)
    if (body === null) return null
    if (!inside(body, range.startContainer) || !inside(body, range.endContainer)) return null
    const text = selection.toString()
    if (text.trim() === '') return null
    const path = pathOf(preview)
    if (path === undefined) return null
    const sessionId = sessionOfRow(ctx, preview)
    if (sessionId === undefined) {
      console.warn('[smkit] selection quote skipped: the preview names no session')
      return null
    }
    return {
      insert: buildQuote(path, cwdOf(sessionId), linesOf(body, range), text),
      text,
      sessionId,
      surface: preview,
      selectionBody: body,
      point: pointOf(event, range, preview),
    }
  }

  /**
   * The quote a right-click on one surface means, or null when it names nothing.
   *
   * A terminal is asked first and by target: its selection never reaches the
   * document (see the module doc), so the target is the only witness, and a
   * stale preview selection must not answer for it. A preview is named by its
   * selection's endpoints instead (see `previewQuote`).
   */
  const quoteOf = (event: MouseEvent): Quote | null => {
    const target = event.target
    const element = target instanceof Element ? target : null
    const terminal = element === null ? null : element.closest(TERMINAL)
    return terminal === null ? previewQuote(event) : terminalQuote(terminal, event)
  }

  /**
   * A right-click with a live selection opens the card (see the module doc).
   *
   * The native menu is claimed only once a quote exists AND the pointer itself
   * is on that surface: a selection left in the preview must not turn a
   * right-click in the composer (paste, spellcheck) into this card, and a
   * right-click on the preview's header keeps that surface's own menu.
   */
  const onContextMenu = (event: MouseEvent): void => {
    if (menu === undefined) return
    const quote = quoteOf(event)
    if (quote === null) return
    const target = event.target
    const scope = quote.selectionBody ?? quote.surface
    if (!(target instanceof Node) || !scope.contains(target)) return
    event.preventDefault()
    event.stopPropagation()
    // The confirmation of the previous copy gives the card its place back.
    hideCopied()
    const { insert, text, sessionId, point } = quote
    menu.open(point, {
      add: () => { appendToDraft(ctx, sessionId, insert) },
      // The selection itself, not the fenced block: a copy is what the reader
      // would have got from the native menu, and pasting it back into a file
      // must not bring the fence along.
      copy: text,
      copied: () => { flashCopied(point) },
    })
  }

  document.addEventListener('contextmenu', onContextMenu, true)

  return () => {
    document.removeEventListener('contextmenu', onContextMenu, true)
    hideCopied()
    menu?.dispose()
  }
}
