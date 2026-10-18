/**
 * The Markdown preview's table of contents, ported from `dsh-better-sidebar`.
 *
 * The host draws the Markdown preview itself (`ui-sidebar-documentpreview`) and
 * offers no overlay seat inside its scroll body, so this feature decorates the
 * rendered document the way `file-reference` decorates the explorer: a
 * zero-height sticky bar is inserted as the rendered Markdown document's FIRST
 * child, with the outline toggle pinned to its top-right. Everything else is
 * behaviour.
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
 * - Escape, or a pointer press outside the bar, closes the popover.
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
 * tab. While that plugin's `editor` tab type is enabled it also takes the
 * host's file preview over, so the body this feature decorates is not rendered
 * at all — but the decision is still made explicitly, the same way the explorer
 * chip makes it (`file-reference/watch.ts`): a published `betterSidebar`
 * service means the neighbour owns the surface, and only an explicit
 * `isTabEnabled('editor') === false` hands it back. The check runs on every
 * scan and on every body re-render, so enabling or disabling that type takes
 * effect without a reload.
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
import type { IconSpec } from '../../platform/icons/Icon'
import { LIST_PEN_ICON } from './icons/ListPenIcon'

/** Fewer headings than this and the toggle stays hidden (no outline value). */
export const TOC_MIN_HEADINGS = 3

/** How long the jumped-to heading keeps its flash, in ms. */
const FLASH_MS = 1200

/** The host's preview scroll body, its Markdown document, and its headings. */
const PREVIEW_BODY = '[data-textpreview-body]'
const MARKDOWN_DOCUMENT = '[data-document-markdown]'
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

/** The slice of `dsh-better-sidebar`'s client service this feature reads. */
interface BetterSidebarFace {
  /** Whether one of that plugin's tab types is enabled in its settings. */
  isTabEnabled?(id: string): boolean
}

/**
 * Whether `dsh-better-sidebar` is the one drawing the file preview right now.
 *
 * Its service being published is not enough: that plugin registers its `editor`
 * tab type — the one whose `MdToc` is this feature's twin — only while the type
 * is enabled, and hands the file preview back to the shell when the user
 * switches it off. Asking the same question the other plugin asks itself keeps
 * exactly one outline on screen in both states (the explorer chip asks the same
 * question about the same switch, in `file-reference/watch.ts`).
 *
 * Read through reflection because it is an optional neighbour: declaring it
 * would make this bundle unloadable without it.
 */
function betterSidebarOwnsPreview(ctx: ClientContext): boolean {
  try {
    const service = ctx.reflect?.get('betterSidebar') as BetterSidebarFace | undefined
    if (service === undefined) return false
    if (typeof service.isTabEnabled !== 'function') return true
    return service.isTabEnabled('editor') !== false
  } catch {
    // A service that answers by throwing must not cost the decoration: if it
    // does own the preview, the host's body is not rendered anyway.
    return false
  }
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

  /** Take the bar (and its state) out of one body, keeping the watch alive. */
  const clear = (outline: Outline): void => {
    outline.bar?.remove()
    outline.doc = null
    outline.bar = null
    outline.toggle = null
    outline.panel = null
    outline.panelSignature = ''
    outline.entries = []
    outline.signature = ''
    outline.open = false
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
    if (!toggle.isConnected) bar.appendChild(toggle)
    if (!outline.open) {
      outline.panel?.remove()
      outline.panel = null
      outline.panelSignature = ''
      return
    }
    if (outline.panel === null || outline.panelSignature !== outline.signature) {
      outline.panel?.remove()
      outline.panel = createPanel(outline)
      outline.panelSignature = outline.signature
    }
    // The panel precedes the toggle, as upstream renders it.
    if (!outline.panel.isConnected) bar.insertBefore(outline.panel, toggle)
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

  /** Rescan one body: (re)mount the bar, refresh entries, redraw. */
  const update = (outline: Outline): void => {
    // Checked here as well as in `scan`: a body that is already on screen can
    // see the neighbour take the surface over between two of its own renders.
    if (betterSidebarOwnsPreview(ctx)) {
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
    // editor had (12/16), which is what insets the toggle at rest. A re-render
    // that dropped the bar, or a tab that swapped the document, re-hangs it at
    // the top of whatever document is on screen now.
    if (outline.doc !== doc || outline.bar.parentNode !== doc || doc.firstChild !== outline.bar) {
      doc.insertBefore(outline.bar, doc.firstChild)
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
    clear(outline)
    outlines.delete(outline.body)
  }

  /**
   * Give the surface back: `dsh-better-sidebar` owns it. The document observer
   * stays armed, so the shell's own preview body — rendered again the moment
   * that plugin's editor type is switched off — starts a fresh scan.
   */
  const standDown = (): void => {
    for (const outline of Array.from(outlines.values())) release(outline)
    outlines.clear()
  }

  /** Scan the document for preview bodies, and for bodies that left it. */
  const scan = (): void => {
    scheduled = false
    frame = null
    if (betterSidebarOwnsPreview(ctx)) {
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
    }
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
   * A press outside the bar dismisses it. The bar itself is exempt, so a second
   * press on the toggle still toggles instead of being eaten by the dismiss —
   * the same reason upstream listens at `pointerdown` rather than `click`.
   */
  const onPointerDown = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Node)) return
    for (const outline of outlines.values()) {
      if (!outline.open) continue
      const bar = outline.bar
      if (bar !== null && bar.contains(target)) continue
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
