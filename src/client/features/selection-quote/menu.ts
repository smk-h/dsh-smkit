/**
 * The right-click card on the host's read-only surfaces: one row that quotes the
 * selection into the composer draft, one that copies it — the only row of the
 * browser's own native menu that was about the passage the reader selected.
 *
 * ## Why a card under the pointer
 *
 * This feature began with a floating button over the selection, and that shape
 * has one defect no amount of clamping fixes: the button hangs off where the
 * gesture ended, which at a surface's edges is not a place a card fits. Released
 * against the top of a preview it sits under the preview's own header and the tab
 * strip above it; released past the bottom of the window it is drawn off-screen.
 * A right-click points at the passage by definition, and the card opens where the
 * pointer is — always inside the surface the reader is looking at — while the
 * shell's `Menu` measures itself back inside the viewport against every edge.
 *
 * It is also the honest replacement for what a right-click does on a read-only
 * preview: the browser's menu offers `copy`, `select all` and the inspector, and
 * only the first of those is about the passage — so this card keeps `copy` and
 * adds the one row the browser cannot know about. When a selection exists this
 * card takes the gesture over; when it does not, the native menu stays (a
 * terminal's own right-click behaviour rides on it).
 *
 * ## Copying
 *
 * The shell's own `writeClipboard` does the write when the platform table has
 * it: it carries an `execCommand` fallback, which is what still works on a
 * page the async Clipboard API refuses (dsh reached over a LAN address is not a
 * secure context). Without it the modern API is the fallback, and a refused
 * write simply shows nothing — the selection is still on screen, and the reader
 * has `Ctrl+C`. The caller's `copied` callback is what draws the confirmation
 * (see `watch.ts`), because the card has closed by then.
 *
 * ## Why the shell's own `Menu`
 *
 * The same reason `features/explorer-menu` mounts it (see that module's doc):
 * the card, its hover fill, row height, keyboard walk, focus return and viewport
 * flipping are all that component's, and re-drawing them would be a look-alike
 * at best. It is mounted in a React root of this feature's own; a host whose
 * platform table carries neither `Menu` nor `createRoot` gets no menu at all —
 * `createQuoteMenu` answers `undefined` and the gesture keeps the browser's.
 *
 * Nothing is drawn until a right-click asks: no React root, no node in the body
 * — the whole host is built on the first quote the gesture offers, and the card
 * itself is then portalled by the shell.
 */

import type { ClientDeps, Translator } from '../../platform/types'
import { COPY_ICON } from '../../platform/icons/CopyIcon'
import { iconElement } from '../../platform/icons/Icon'
import { CONVERSATION_ICON } from './icons/ConversationIcon'

/** The React factory the client bundle threads in as `h`. */
type ElementFactory = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => unknown

/** The host modules this menu cannot work without. */
interface QuoteMenuRuntime {
  /** The shell's menu card/rows/keyboard, exactly as the neighbour uses it. */
  Menu: (props: Record<string, unknown>) => unknown
  /** React root for the (single) menu host. */
  createRoot: (container: Element) => { render(node: unknown): void; unmount(): void }
  /**
   * The shell's clipboard write (async API, `execCommand` fallback). Optional:
   * a host without it falls back to `navigator.clipboard`.
   */
  writeClipboard?: (text: string) => Promise<boolean>
}

/** Marker on the empty node the menu's React root mounts in. */
const ROOT = 'data-smkit-quote-menu-root'

/** The card's two rows, in order. */
const QUOTE = 'quote'
const COPY = 'copy'

/** The host modules, resolved once; undefined makes the menu a no-op. */
function loadRuntime(h: ElementFactory | undefined): QuoteMenuRuntime | undefined {
  if (typeof h !== 'function') return undefined
  try {
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives') as {
      Menu?: unknown
      writeClipboard?: unknown
    }
    const client = require('react-dom/client') as { createRoot?: unknown }
    if (typeof primitives.Menu !== 'function') return undefined
    if (typeof client.createRoot !== 'function') return undefined
    return {
      Menu: primitives.Menu as QuoteMenuRuntime['Menu'],
      createRoot: client.createRoot as QuoteMenuRuntime['createRoot'],
      writeClipboard: typeof primitives.writeClipboard === 'function'
        ? primitives.writeClipboard as QuoteMenuRuntime['writeClipboard']
        : undefined,
    }
  } catch {
    // An older shell may not seed either module: the reader keeps the browser's
    // menu instead of this feature failing the bundle.
    return undefined
  }
}

/**
 * Put one passage on the clipboard.
 *
 * The shell's write first, then the async API (see the module doc). A refusal
 * answers `false` rather than throwing: a copy the browser blocked is a
 * confirmation that must not be drawn, not an error worth a console line.
 */
async function writeText(runtime: QuoteMenuRuntime, text: string): Promise<boolean> {
  if (runtime.writeClipboard !== undefined) {
    try {
      return (await runtime.writeClipboard(text)) === true
    } catch {
      return false
    }
  }
  try {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** What the card's two rows do, and what its caller shows afterwards. */
export interface QuoteMenuActions {
  /** The quote row: write the fenced block into the composer draft. */
  add: () => void
  /** The copy row: the selection's own text, unabridged — not the fenced block. */
  copy: string
  /** Called after a write the browser accepted, so the caller can say so. */
  copied?: () => void
}

/** The open menu: where it opened, and what its rows commit. */
interface Pending extends QuoteMenuActions {
  x: number
  y: number
}

/** One menu host: opened at a pointer, closed on selection, Escape or outside press. */
export interface QuoteMenu {
  /** Open the card at one viewport point, offering these two rows. */
  open(at: { x: number; y: number }, actions: QuoteMenuActions): void
  /** Close the card, dropping the pending action. Idempotent. */
  close(): void
  /** Unmount the root and remove its empty node (the effect's disposer). */
  dispose(): void
}

/**
 * Build the menu host for one watch, or undefined when the shell cannot draw it.
 *
 * @param deps - the client deps; only `h` is used (to build the menu's elements).
 * @param t - the copy lookup bound to this feature's namespace.
 * @returns the menu handle, or undefined on a host without the shell's `Menu`.
 */
export function createQuoteMenu(deps: ClientDeps, t: Translator): QuoteMenu | undefined {
  // `document` is absent outside a browser (the hook test harness runs the
  // bundle in a bare context) — the same guard the platform watchers carry.
  if (typeof document === 'undefined' || document.body === null || document.body === undefined) return undefined

  const h = deps.h as unknown as ElementFactory | undefined
  const runtime = loadRuntime(h)
  if (runtime === undefined || h === undefined) return undefined

  /** The open menu, or null. Rendered on every change. */
  let pending: Pending | null = null

  /**
   * The React root and its empty node, created on the first right-click.
   *
   * Lazy on purpose: this watch runs on every page of every session, and a menu
   * that is never opened should cost neither a root nor a node in the body.
   */
  let host: { root: { render(node: unknown): void; unmount(): void }; container: Element } | undefined

  /** The anchor rectangle the card hangs from: the pointer, with no size. */
  const anchorRect = (): DOMRect | null => {
    if (pending === null || typeof DOMRect !== 'function') return null
    return new DOMRect(pending.x, pending.y, 0, 0)
  }

  /**
   * One row chosen. The card closes first, as the source menu does, so the
   * insert (and the confirmation) land on a menu-free surface; the pending
   * action is read before the close.
   */
  const select = (id: string): void => {
    const open = pending
    close()
    if (open === null) return
    if (id === QUOTE) {
      open.add()
      return
    }
    if (id === COPY) void writeText(runtime, open.copy).then((ok) => { if (ok) open.copied?.() })
  }

  /** Draw the menu's current state through the host component. */
  const draw = (): void => {
    if (host === undefined) return
    const open = pending
    host.root.render(
      h(runtime.Menu, {
        open: open !== null,
        anchor: h('span', null),
        items: open === null
          ? []
          : [
              { id: QUOTE, label: t('addToConversation'), icon: iconElement(h, CONVERSATION_ICON) },
              { id: COPY, label: t('copy'), icon: iconElement(h, COPY_ICON) },
            ],
        onSelect: (id: string) => { select(id) },
        onClose: () => { close() },
        portal: true,
        // Deliberately NOT `compact`. The shell's compact list is a different
        // design — 24px rows, 11px text, `2px 6px` item padding and a 12px icon
        // slot — which leaves the icon 10px from the card's edge and the label at
        // 27px, visibly tighter than the menus this one sits beside. The standard
        // row is 34px tall, 13px text with `6px 8px` padding: the icon starts
        // 12px in and the label at 32px, the same left room the shell's own
        // menus (and the editor this sidebar lives in) give their rows.
        align: 'start',
        getAnchorRect: anchorRect,
      }),
    )
  }

  /** Close the card, dropping whatever it would have committed. Idempotent. */
  const close = (): void => {
    if (pending === null) return
    pending = null
    draw()
  }

  /** Build the root on first use: a zero-size div in the body, portalled from. */
  const mount = (): void => {
    const container = document.createElement('div')
    container.setAttribute(ROOT, '')
    container.style.display = 'none'
    document.body.appendChild(container)
    host = { root: runtime.createRoot(container), container }
  }

  return {
    open(at, actions) {
      pending = { x: at.x, y: at.y, ...actions }
      if (host === undefined) mount()
      draw()
    },
    close,
    dispose() {
      pending = null
      host?.root.unmount()
      host?.container.remove()
      host = undefined
    },
  }
}
