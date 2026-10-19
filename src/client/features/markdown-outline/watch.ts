/**
 * The Markdown preview's table of contents, ported from `dsh-better-sidebar`.
 *
 * The host draws the Markdown preview itself (`ui-sidebar-documentpreview`) and
 * offers no overlay seat inside its scroll body, so this feature decorates the
 * rendered document the way `file-reference` decorates the explorer: a
 * zero-height sticky bar is inserted as the rendered Markdown document's FIRST
 * child, and the toggle rides the preview header — the row that already carries
 * the viewer name and the reload control — immediately before reload. The bar
 * then holds only the popover the toggle opens. Everything else is behaviour.
 *
 * ## Why the header and not the corner
 *
 * Upstream pins the toggle inside the document, floating over the first lines of
 * prose. The shell already draws a header row for exactly this kind of control,
 * directly above the body and beside the reload the reader uses on the same
 * page, so a second floating square over the text competes with the prose it
 * covers for no gain. The popover stays in the document's bar: it must not be
 * clipped by the header, and it belongs under the header rather than inside it.
 * A host that does not draw that row (`data-textpreview-tool="reload"` absent)
 * keeps the floating square — the toggle then hangs in the bar, as upstream
 * does.
 *
 * ## The port is deliberately literal
 *
 * Upstream (`src/client/md-toc.tsx`, `MdToc`), in order:
 *
 * - collect `h1…h6` from the RENDERED DOM — not from the source — skipping
 *   headings whose text is empty, keeping document order and each heading's own
 *   `level`;
 * - show nothing at all until the document has {@link TOC_MIN_HEADINGS} of them
 *   ("fewer than this and the interval has no value");
 * - re-collect through a `MutationObserver` (a lazily loaded page, a
 *   re-highlighted block), with a text signature guard so an unchanged
 *   document never re-renders;
 * - the toggle opens a popover of `level` + text; a click on an entry expands a
 *   collapsed `<details>` ancestor, smooth-scrolls the heading to the top,
 *   flashes it for 1.2 s, and closes the popover;
 * - Escape, or a pointer press outside the bar, closes the popover;
 * - (the one deliberate addition) the popover opens on the section being read:
 *   the current heading is lit and brought into sight, instead of the list
 *   always starting at the top.
 *
 * Every value here — the 3-heading threshold, the 1.2 s flash, the indents, the
 * ordering of panel and toggle — is upstream's, so the two plugins behave the
 * same where their surfaces overlap. What the host changes is structural only:
 *
 * - the containers are found through the host's published anchors
 *   (`data-textpreview-body`, `data-document-markdown`), never through hashed
 *   class names;
 * - the nodes are built with the DOM rather than React, because the preview
 *   body is not this plugin's to render into. This is the same route the
 *   explorer chip takes, and the reason the icon is a data spec
 *   (`icons/ListPenIcon.ts`).
 *
 * ## Only one of the two outlines is ever on screen
 *
 * `dsh-better-sidebar` already draws this exact outline inside its own editor
 * tab. While that plugin is loaded it also takes the host's file preview over,
 * so the body this feature decorates is not rendered at all — but the decision
 * is still made explicitly, the same way the explorer chip makes it
 * (`platform/neighbour.ts`): a published `betterSidebar` service means the
 * neighbour owns the surface, and its own tab-type switches are not consulted.
 * The check runs on every scan and on every body re-render, so loading or
 * unloading that plugin takes effect without a reload.
 *
 * ## The one deliberate addition: it opens where the reader is
 *
 * Upstream opens at the top of the list every time. In a long document that
 * turns the outline into a search: the reader has to scroll the panel to find
 * which section they are in, and the list has no answer without that scroll.
 * This port opens on the section being read instead — the current heading is
 * marked, and the panel is scrolled so that row sits mid-panel. A scroll of the
 * preview while the panel is open keeps the mark current; the panel is only
 * re-centred when it is opened (or rebuilt), never while the reader is moving
 * around inside it.
 *
 * `scrollIntoView` is deliberately not used for that: it scrolls every
 * ancestor, so opening the outline would drag the preview to the heading as a
 * side effect. The panel's own `scrollTop` is the only thing that moves.
 *
 * ## The one real gap: `text-pages`
 *
 * The host's Markdown renderer loads a document in pages and appends the next
 * one only when the reader nears the bottom (or presses "load more"). Upstream
 * renders the whole file at once. So the outline lists the headings that exist
 * so far and grows as pages arrive — it cannot promise a complete outline for a
 * long document up front. `MutationObserver` closes the gap without a reload
 * whenever the page count changes.
 */

import type { ClientContext, Translator } from '../../platform/types'
import { betterSidebarOwnsSurfaces } from '../../platform/neighbour'
import type { IconSpec } from '../../platform/icons/Icon'
import { LIST_PEN_ICON } from './icons/ListPenIcon'

/** Fewer headings than this and the toggle stays hidden (no outline value). */
export const TOC_MIN_HEADINGS = 3

/** How long the jumped-to heading keeps its flash, in ms. */
const FLASH_MS = 1200

/**
 * How far below the scrollport's top edge the reader's eye sits, as a share of
 * the scrollport's own height.
 *
 * The mark follows this line rather than the edge itself. Pinned to the edge, a
 * section kept the mark until its heading had left the screen altogether: with
 * only the last lines of "2.1" still on view and the "2.1.1" heading already a
 * few lines down, the list still lit "2.1" — the section the reader had left,
 * not the one filling the screen. A quarter down is where the eye rests while
 * reading, so a heading that has carried that much of the scrollport is the
 * section being read, and the next section takes the mark as soon as it reaches
 * this line instead of waiting for the top edge.
 *
 * `jump` still leaves a heading at the very top: a section clicked in the list
 * stays marked unless its own successor starts within this quarter, in which
 * case the successor already fills what the reader is looking at.
 */
const READING_SHARE = 0.25

/** The floor of that inset, for a scrollport too short to give a quarter. */
const READING_MIN = 32

/** The host's preview scroll body, its Markdown document, and its headings. */
const PREVIEW_BODY = '[data-textpreview-body]'
const MARKDOWN_DOCUMENT = '[data-document-markdown]'
/** The preview's own root, its reload control: the tool row the toggle joins. */
const PREVIEW = '[data-textpreview-state]'
const RELOAD = '[data-textpreview-tool="reload"]'
const HEADINGS = 'h1, h2, h3, h4, h5, h6'
/**
 * A folded ancestor the jump unfolds first. The host's renderer emits raw HTML
 * as literal text (`ui-primitives/src/markdown/render.tsx`), so no markdown
 * `<details>` reaches the DOM today; the call is kept because upstream has it,
 * and a host that starts rendering HTML blocks would get the same behaviour.
 */
const COLLAPSED_DETAILS = 'details:not([open])'

/** This feature's markers, all inside the plugin's own namespace. */
const BAR = 'data-smkit-md-toc'
const PANEL = 'data-smkit-md-toc-panel'
const TOGGLE = 'data-smkit-md-toc-toggle'
const ITEM = 'data-smkit-md-toc-item'
const LEVEL = 'data-smkit-md-toc-level'
const ACTIVE = 'data-smkit-md-toc-active'
/** On the toggle and the bar while the toggle rides the preview header. */
const IN_HEADER = 'data-smkit-md-toc-in-header'

/** This feature's classes (see `style/toc.css`). */
const BAR_CLASS = 'smkit-outline-toc-bar'
const TOGGLE_CLASS = 'smkit-outline-toc-toggle'
const PANEL_CLASS = 'smkit-outline-toc-panel'
const ITEM_CLASS = 'smkit-outline-toc-item'
const LEVEL_CLASS = 'smkit-outline-toc-level'
const TEXT_CLASS = 'smkit-outline-toc-text'
const FLASH_CLASS = 'smkit-outline-toc-flash'

/** One collected outline entry; `el` is the live rendered heading element. */
interface TocEntry {
  level: number
  text: string
  el: HTMLElement
}

/** One decorated preview body, plus the state the bar renders from. */
interface Outline {
  body: Element
  observer: MutationObserver
  /** The document the bar currently hangs in (it is replaced on a tab swap). */
  doc: Element | null
  /** The zero-height bar; null while the body shows something else. */
  bar: HTMLElement | null
  toggle: HTMLButtonElement | null
  panel: HTMLElement | null
  /** The signature the open panel was built from (skip needless rebuilds). */
  panelSignature: string
  entries: TocEntry[]
  /** The text signature of the last scan (upstream's no-op guard). */
  signature: string
  open: boolean
  /** The entry last marked in `panel`; -1 when nothing is (or a fresh panel). */
  active: number
  /** The body's scroll listener (kept in step until it is released). */
  scroll: (() => void) | null
}

/** The signature used to skip no-op rescans (identity-safe re-render guard). */
function signatureOf(entries: readonly TocEntry[]): string {
  return entries.map((entry) => `${entry.level}:${entry.text}`).join('\n')
}

/** Build the toggle's `<svg>` from the shared icon spec (same drawing, DOM API). */
function glyph(spec: IconSpec): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(spec.size ?? 16))
  svg.setAttribute('height', String(spec.size ?? 16))
  svg.setAttribute('viewBox', spec.viewBox)
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  for (const node of spec.nodes) {
    const child = document.createElementNS('http://www.w3.org/2000/svg', node.tag)
    for (const [name, value] of Object.entries(node.attrs)) child.setAttribute(name, String(value))
    svg.appendChild(child)
  }
  return svg
}

/**
 * The preview header's reload control — the stable end of its tool row.
 *
 * The header belongs to `ui-sidebar-documentpreview` and its classes are
 * build-time hashes; `data-textpreview-tool="reload"` is the anchor the host
 * publishes for its own control, so the outline rides in just before it.
 *
 * @param body - the preview body this feature decorates.
 * @returns the reload control, or null on a host that draws no header row.
 */
function reloadAnchor(body: Element): Element | null {
  const preview = body.closest(PREVIEW)
  if (preview === null) return null
  const reload = preview.querySelector(RELOAD)
  return reload !== null && reload.parentNode !== null ? reload : null
}

/**
 * Move the bar's sticky offset onto the document's own top padding.
 *
 * The bar is the document's first in-flow child, so its static position sits
 * one prose padding (10px) below the scrollport edge — while `top: 0` pins it
 * to the edge itself. The toggle therefore rose by exactly that padding the
 * moment the reader scrolled, and dropped back when the document returned to
 * the top. Upstream never shows this: its bar is mounted on the scroll
 * container itself, where the resting and pinned positions coincide. Reading
 * the padding keeps the two together here as well, and follows a host that
 * re-tunes its prose inset.
 *
 * Only a document swap needs the read: the inline value rides the bar through
 * every later re-hang, and a fresh bar (a non-Markdown preview in between, or
 * a remount) is attached to a document it has not measured yet.
 */
function pinToDocumentPadding(bar: HTMLElement, doc: Element): void {
  // A harness with no layout answers nothing: the stylesheet's `top: 0` stays
  // in force instead of this throwing.
  if (typeof getComputedStyle !== 'function') return
  const styled = bar as unknown as { style?: CSSStyleDeclaration }
  if (styled.style === undefined) return
  const padding = getComputedStyle(doc).paddingTop
  if (padding !== '') styled.style.top = padding
}

/**
 * Watch every Markdown preview body in the document and hang an outline on it.
 *
 * @param ctx - the client context (the neighbour probe and the locale refresh).
 * @param t - the copy lookup bound to this feature's namespace.
 * @returns the effect's disposer, which removes every bar it added.
 */
export function watchMarkdownOutline(ctx: ClientContext, t: Translator): () => void {
  // `document`/`MutationObserver` are absent outside a browser (the hook test
  // harness runs the bundle in a bare context) — the same guard the platform
  // watchers carry.
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const root = document.documentElement
  if (root === null || root === undefined) return () => {}

  const outlines = new Map<Element, Outline>()
  /** Whether a scan is already queued for the next frame. */
  let scheduled = false
  /** The frame (or timeout) a queued scan rides. */
  let frame: number | null = null

  /** Collect the outline of one rendered document, in document order. */
  const collect = (doc: Element): TocEntry[] => {
    const found: TocEntry[] = []
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>(HEADINGS))) {
      const text = (el.textContent ?? '').trim()
      if (text === '') continue
      found.push({ level: Number(el.tagName.charAt(1)), text, el })
    }
    return found
  }

  /** Build the popover for the entries the outline currently holds. */
  const createPanel = (outline: Outline): HTMLElement => {
    const panel = document.createElement('div')
    panel.className = PANEL_CLASS
    panel.setAttribute(PANEL, '')
    for (const entry of outline.entries) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = ITEM_CLASS
      item.setAttribute(ITEM, '')
      item.setAttribute(LEVEL, String(entry.level))
      item.title = entry.text
      const level = document.createElement('span')
      level.className = LEVEL_CLASS
      level.textContent = String(entry.level)
      const text = document.createElement('span')
      text.className = TEXT_CLASS
      text.textContent = entry.text
      item.appendChild(level)
      item.appendChild(text)
      item.addEventListener('click', () => { jump(outline, entry) })
      panel.appendChild(item)
    }
    return panel
  }

  /**
   * Hang the toggle where it belongs: beside the header's reload control when
   * the host draws that row, else in the bar (upstream's floating square).
   *
   * Re-asserted on every draw: the header is React's, so a re-render may append
   * a tool after ours and leave the button a place out of line, and a host that
   * swaps the preview under us would otherwise strand it.
   */
  const hangToggle = (outline: Outline, toggle: HTMLButtonElement): void => {
    const bar = outline.bar
    const anchor = reloadAnchor(outline.body)
    if (anchor === null || anchor.parentNode === null) {
      toggle.removeAttribute(IN_HEADER)
      bar?.removeAttribute(IN_HEADER)
      if (bar !== null && !toggle.isConnected) bar.appendChild(toggle)
      return
    }
    toggle.setAttribute(IN_HEADER, '')
    bar?.setAttribute(IN_HEADER, '')
    const row = anchor.parentNode
    if (toggle.parentNode !== row || toggle.nextSibling !== anchor) row.insertBefore(toggle, anchor)
  }

  /** Take the bar (and its state) out of one body, keeping the watch alive. */
  const clear = (outline: Outline): void => {
    outline.bar?.remove()
    // The toggle lives in the host's header, not in the bar: it is this
    // feature's node and nobody else takes it away.
    outline.toggle?.remove()
    outline.doc = null
    outline.bar = null
    outline.toggle = null
    outline.panel = null
    outline.panelSignature = ''
    outline.entries = []
    outline.signature = ''
    outline.open = false
    outline.active = -1
  }

  /** Draw the bar's current state: toggle only when it earns its place. */
  const render = (outline: Outline): void => {
    const bar = outline.bar
    if (bar === null) return
    const label = t('toc')
    const visible = outline.entries.length >= TOC_MIN_HEADINGS
    if (!visible) {
      outline.open = false
      outline.panel?.remove()
      outline.toggle?.remove()
      outline.panel = null
      outline.toggle = null
      outline.panelSignature = ''
      return
    }
    if (outline.toggle === null) {
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = TOGGLE_CLASS
      toggle.setAttribute(TOGGLE, '')
      toggle.appendChild(glyph(LIST_PEN_ICON))
      toggle.addEventListener('click', () => { setOpen(outline, !outline.open) })
      outline.toggle = toggle
    }
    const toggle = outline.toggle
    if (toggle.getAttribute('aria-label') !== label) {
      toggle.setAttribute('aria-label', label)
      toggle.title = label
    }
    toggle.setAttribute('aria-expanded', outline.open ? 'true' : 'false')
    hangToggle(outline, toggle)
    if (!outline.open) {
      outline.panel?.remove()
      outline.panel = null
      outline.panelSignature = ''
      return
    }
    const rebuilt = outline.panel === null || outline.panelSignature !== outline.signature
    if (rebuilt) {
      outline.panel?.remove()
      outline.panel = createPanel(outline)
      outline.panelSignature = outline.signature
      // A fresh list carries no mark, whatever the last one ended on.
      outline.active = -1
    }
    // The panel precedes the toggle, as upstream renders it — where the toggle
    // rides the header, the bar holds the panel alone.
    const panel = outline.panel
    if (panel !== null && !panel.isConnected) {
      bar.insertBefore(panel, toggle.parentNode === bar ? toggle : bar.firstChild)
    }
    // Where the reader is: marked on every draw, centred only when the list has
    // just been built (a fresh open, or a rebuild after a page arrived), never
    // while the reader is moving around inside it.
    markActive(outline)
    if (rebuilt) revealActive(outline)
  }

  /** Set the popover's state and draw it. */
  const setOpen = (outline: Outline, open: boolean): void => {
    outline.open = open
    render(outline)
  }

  /** Scroll to one entry, flash it, and close the popover (upstream's `jump`). */
  const jump = (outline: Outline, entry: TocEntry): void => {
    entry.el.closest(COLLAPSED_DETAILS)?.setAttribute('open', '')
    entry.el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const el = entry.el
    el.classList.add(FLASH_CLASS)
    setTimeout(() => { el.classList.remove(FLASH_CLASS) }, FLASH_MS)
    setOpen(outline, false)
  }

  /**
   * The entry the reader is in: the last heading whose top has passed the
   * reading line (a {@link READING_SHARE} of the scrollport down from its edge).
   * Before any heading reaches it — the very top of a document — the first entry
   * is the section about to be read. A body that reports no height has not been
   * laid out (the hook harness), and nothing is marked.
   */
  const activeIndex = (outline: Outline): number => {
    if (outline.entries.length === 0) return -1
    const body = outline.body
    if (typeof body.getBoundingClientRect !== 'function') return -1
    const view = body.getBoundingClientRect()
    if (!(view.height > 0)) return -1
    const line = view.top + Math.max(READING_MIN, view.height * READING_SHARE)
    let active = 0
    for (const [index, entry] of outline.entries.entries()) {
      if (!entry.el.isConnected || typeof entry.el.getBoundingClientRect !== 'function') continue
      if (entry.el.getBoundingClientRect().top <= line) active = index
    }
    return active
  }

  /**
   * Light the row of the section the reader is in, if the popover is open.
   *
   * Only the two rows that change are touched, and only when the section does:
   * the mark's attribute is what the stylesheet selects on, so rewriting all N
   * rows on every scroll event would dirty N elements for nothing. In the steady
   * state (one section) a scroll costs the rect reads and no DOM write at all.
   */
  const markActive = (outline: Outline): void => {
    const panel = outline.panel
    if (panel === null) return
    const at = activeIndex(outline)
    if (at === outline.active) return
    outline.active = at
    const previous = panel.querySelector(`[${ITEM}][${ACTIVE}]`)
    previous?.removeAttribute(ACTIVE)
    previous?.removeAttribute('aria-current')
    if (at < 0) return
    const item = panel.querySelectorAll(`[${ITEM}]`)[at]
    if (item === undefined) return
    item.setAttribute(ACTIVE, '')
    item.setAttribute('aria-current', 'true')
  }

  /**
   * Bring the marked row to the middle of the panel — by moving the panel's own
   * scroll only. `scrollIntoView` would scroll every ancestor, so opening the
   * outline would drag the preview to that heading as a side effect.
   */
  const revealActive = (outline: Outline): void => {
    const panel = outline.panel
    if (panel === null || typeof panel.getBoundingClientRect !== 'function') return
    const item = panel.querySelector(`[${ITEM}][${ACTIVE}]`)
    if (item === null || typeof item.getBoundingClientRect !== 'function') return
    const height = panel.clientHeight
    if (!(height > 0)) return
    const view = panel.getBoundingClientRect()
    const row = item.getBoundingClientRect()
    const offset = row.top - view.top + panel.scrollTop
    panel.scrollTop = Math.max(0, offset - (height - row.height) / 2)
  }

  /** Rescan one body: (re)mount the bar, refresh entries, redraw. */
  const update = (outline: Outline): void => {
    // Checked here as well as in `scan`: a body that is already on screen can
    // see the neighbour take the surface over between two of its own renders.
    if (betterSidebarOwnsSurfaces(ctx)) {
      standDown()
      return
    }
    if (!outline.body.isConnected) {
      release(outline)
      return
    }
    const doc = outline.body.querySelector(MARKDOWN_DOCUMENT)
    if (doc === null) {
      clear(outline)
      return
    }
    if (outline.bar === null) {
      const bar = document.createElement('div')
      bar.className = BAR_CLASS
      bar.setAttribute(BAR, '')
      outline.bar = bar
    }
    // The bar rides the DOCUMENT, not the scroll body: upstream's contract is
    // "a direct child of the scroll container", and this document is the host's
    // equivalent — it carries the same 10/12px prose padding the upstream
    // editor had (12/16), so the toggle rests on the same inset. That padding
    // is also why the sticky offset is measured from it: pinned at the bare
    // scrollport edge the toggle sat 10px higher than at rest, and rose the
    // moment scrolling began. A re-render that dropped the bar, or a tab that
    // swapped the document, re-hangs it at the top of whatever document is on
    // screen now.
    if (outline.doc !== doc || outline.bar.parentNode !== doc || doc.firstChild !== outline.bar) {
      doc.insertBefore(outline.bar, doc.firstChild)
      if (outline.doc !== doc) pinToDocumentPadding(outline.bar, doc)
      outline.doc = doc
    }
    const found = collect(doc)
    const signature = signatureOf(found)
    if (signature !== outline.signature) {
      outline.signature = signature
      outline.entries = found
    }
    render(outline)
  }

  /** Stop watching one body and take its bar away. */
  const release = (outline: Outline): void => {
    outline.observer.disconnect()
    if (outline.scroll !== null) outline.body.removeEventListener('scroll', outline.scroll)
    outline.scroll = null
    clear(outline)
    outlines.delete(outline.body)
  }

  /**
   * Give the surface back: `dsh-better-sidebar` owns it. The document observer
   * stays armed, so the shell's own preview body — rendered again the moment
   * that plugin is unloaded — starts a fresh scan.
   */
  const standDown = (): void => {
    for (const outline of Array.from(outlines.values())) release(outline)
    outlines.clear()
  }

  /** Scan the document for preview bodies, and for bodies that left it. */
  const scan = (): void => {
    scheduled = false
    frame = null
    if (betterSidebarOwnsSurfaces(ctx)) {
      standDown()
      return
    }
    for (const body of Array.from(document.querySelectorAll(PREVIEW_BODY))) {
      const known = outlines.get(body)
      if (known === undefined) watch(body)
      else update(known)
    }
    for (const outline of Array.from(outlines.values())) {
      if (outline.body.isConnected) continue
      release(outline)
    }
  }

  /** Queue one scan for the next frame (coalesced: a tab switch arrives in batches). */
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(scan)
    else frame = setTimeout(scan, 0) as unknown as number
  }

  /** Take up one preview body: hang its bar, and re-render on its own changes. */
  function watch(body: Element): void {
    // A bar a previous mount left behind has no listeners; it is replaced below.
    for (const stale of Array.from(body.querySelectorAll(`[${BAR}]`))) stale.remove()
    const outline: Outline = {
      body,
      observer: new MutationObserver(() => { update(outline) }),
      doc: null,
      bar: null,
      toggle: null,
      panel: null,
      panelSignature: '',
      entries: [],
      signature: '',
      open: false,
      active: -1,
      scroll: null,
    }
    // While the popover is open, the mark follows the reader. Only the mark:
    // re-centring the panel here would fight a reader scrolling inside it.
    outline.scroll = () => {
      if (outline.open) markActive(outline)
    }
    body.addEventListener('scroll', outline.scroll, { passive: true })
    outline.observer.observe(body, { childList: true, subtree: true })
    outlines.set(body, outline)
    update(outline)
  }

  /** Escape closes every open popover (upstream listens on the document). */
  const onKeyDown = (event: Event): void => {
    if ((event as KeyboardEvent).key !== 'Escape') return
    for (const outline of outlines.values()) {
      if (outline.open) setOpen(outline, false)
    }
  }

  /**
   * A press outside the bar dismisses it. The bar and the toggle are exempt, so
   * a second press on the toggle still toggles instead of being eaten by the
   * dismiss — the same reason upstream listens at `pointerdown` rather than
   * `click`. The toggle needs naming separately now that it rides the preview
   * header: without it the press would close the panel and the click that
   * follows would reopen it, leaving the button dead.
   */
  const onPointerDown = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Node)) return
    for (const outline of outlines.values()) {
      if (!outline.open) continue
      const bar = outline.bar
      if (bar !== null && bar.contains(target)) continue
      if (outline.toggle !== null && outline.toggle.contains(target)) continue
      setOpen(outline, false)
    }
  }

  /**
   * The document observer answers one question: did a preview body arrive or
   * leave? Mutations inside a body are the body observer's business — the check
   * per node is one `closest`, and this feature's own bar is skipped so opening
   * the popover never starts a scan.
   */
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type !== 'childList') continue
      if (touchesPreview(record.addedNodes) || touchesPreview(record.removedNodes)) {
        schedule()
        return
      }
    }
  })

  /** Whether one batch of nodes includes a preview body (or something inside). */
  const touchesPreview = (nodes: ArrayLike<Node>): boolean => {
    for (const node of Array.from(nodes)) {
      if (!(node instanceof Element)) continue
      if (node.closest(`[${BAR}]`) !== null) continue
      if (node.closest(PREVIEW_BODY) !== null) return true
    }
    return false
  }

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('pointerdown', onPointerDown)
  observer.observe(root, { childList: true, subtree: true })
  // A locale switch is not a DOM change; the toggle's two names are re-read here.
  const offLocale = ctx.on?.('locale/change', () => {
    for (const outline of outlines.values()) render(outline)
  })
  scan()

  return () => {
    observer.disconnect()
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('pointerdown', onPointerDown)
    offLocale?.()
    if (frame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      else clearTimeout(frame)
    }
    for (const outline of Array.from(outlines.values())) release(outline)
    outlines.clear()
  }
}
