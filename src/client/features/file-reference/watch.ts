/**
 * The hover `@` chip this plugin adds to the shell's own file tree.
 *
 * The shell's explorer (`@deepseek-ai/dsh-client-ui-sidebar-files`) draws its
 * rows itself and offers no per-row extension point, so this feature decorates
 * the rendered tree instead of replacing it: every `li[data-files-entry]` gets
 * one chip beside the row button, shown on hover/focus by the stylesheet. The
 * rows are found by the attribute anchors the shell publishes
 * (`data-files-state`, `data-files-entry`, `data-files-path`), never by its
 * hashed class names, which differ between builds.
 *
 * ## Only one of us is ever active
 *
 * The same affordance exists in `dsh-better-sidebar`, which owns the `files`
 * page whenever it is loaded. Two chips on one row would be a defect, so this
 * watch stands down in that case — and it re-checks on every scan, so a
 * sidebar loaded after this bundle still wins. The test is whether that
 * plugin's `betterSidebar` service is published (`platform/neighbour.ts`):
 * loaded means yield, its own tab-type switches are not consulted. A future
 * host that grows the affordance itself is handled separately: a row carrying
 * another `@`-labelled control (not ours) marks the whole tree as already
 * served. The decision is published through the `smkitFileReference` service
 * so a cooperating plugin can yield in the other direction.
 *
 * ## Why it costs nothing while idle
 *
 * The chip is pure CSS state (no React, no hover listeners on rows). Node
 * tracking is observer-driven: one document observer watches for elements
 * arriving inside the right sidebar, one observer per tree catches the
 * shell's own re-renders, and injections are coalesced into one animation
 * frame. Conversation streaming never enters the loop: those mutations are
 * outside the right sidebar and are skipped by a single `closest` check.
 */

import type { ClientContext, Translator } from '../../platform/types'
import { betterSidebarOwnsSurfaces } from '../../platform/neighbour'
import { insertWorkspaceReference, sessionOfRow } from './reference'

/** The tree body once a listing has arrived, and one row inside it. */
const TREE = '[data-files-state="tree"]'
const ENTRY = 'li[data-files-entry]'
/** The right sidebar's session owner; every panel inside it hangs off this. */
const SIDEBAR = '[data-sidebar-right-session]'
/** This feature's markers: the decorated row, and the chip inside it. */
const OWNER = 'data-smkit-file-ref'
const CHIP = 'data-smkit-file-ref-button'
/** The chip's namespaced class (see `style/ref.css`). */
const CHIP_CLASS = 'smkit-file-ref-button'
/**
 * The width the ROW must reserve for the chip, cached per tree (and keyed by
 * the label it was measured for) so a locale or font change re-measures.
 */
const CHIP_WIDTH = 'data-smkit-file-ref-width'
const CHIP_SPACE = '--smkit-file-ref-chip'

/** What the feature decided at its last scan, published to other plugins. */
export interface FileReferenceStatus {
  /** Whether this plugin is the one providing the affordance right now. */
  active: boolean
  /** `active`, or why it stood down. */
  reason: 'active' | 'better-sidebar' | 'host-affordance' | 'no-dom'
}

/** Whether one tree already carries an `@` affordance this plugin did not add. */
function hostHasAffordance(tree: Element): boolean {
  for (const entry of Array.from(tree.querySelectorAll(ENTRY))) {
    const row = entry.querySelector(':scope > button')
    for (const candidate of Array.from(entry.querySelectorAll('button[aria-label], button[title]'))) {
      if (candidate === row || candidate.hasAttribute(CHIP)) continue
      const label = `${candidate.getAttribute('aria-label') ?? ''} ${candidate.getAttribute('title') ?? ''}`.trim()
      if (label.startsWith('@')) return true
    }
  }
  return false
}

/** Keep one existing chip's copy in step with the active locale. */
function refreshLabel(chip: Element, label: string): void {
  if (chip.textContent !== label) chip.textContent = label
  if (chip.getAttribute('aria-label') !== label) chip.setAttribute('aria-label', label)
  if (chip.getAttribute('title') !== label) chip.setAttribute('title', label)
}

/** Take this plugin's chips out of one tree (a stand-down, or teardown). */
function removeChips(tree: Element): void {
  for (const chip of Array.from(tree.querySelectorAll(`[${CHIP}]`))) chip.remove()
  for (const owner of Array.from(tree.querySelectorAll(`[${OWNER}]`))) owner.removeAttribute(OWNER)
}

/**
 * Watch the shell's file tree and decorate its rows with the `@` chip.
 *
 * @param ctx - the client context (services are resolved at click time).
 * @param status - the decision record, kept current for the published service.
 * @param t - the copy lookup bound to this feature's namespace.
 * @returns the effect's disposer, which removes every chip it added.
 */
export function watchFileReferences(
  ctx: ClientContext,
  status: FileReferenceStatus,
  t: Translator,
): () => void {
  // `document`/`MutationObserver` are absent outside a browser (the hook test
  // harness runs the bundle in a bare context) — the same guard the platform
  // watchers carry.
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    status.active = false
    status.reason = 'no-dom'
    return () => {}
  }
  const root = document.documentElement
  if (root === null || root === undefined) {
    status.active = false
    status.reason = 'no-dom'
    return () => {}
  }

  /** This mount's identity, so a chip left by an earlier bundle is replaced. */
  const generation = `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  /** Per tree: how to let go of it again. */
  const watched = new Map<Element, () => void>()
  /** Whether a scan is already queued for the next frame. */
  let scheduled = false
  /** The frame (or timeout) a queued scan rides. */
  let frame: number | null = null

  /**
   * Stop decorating, and take back what this mount added: the chips go, and so
   * do the per-tree observers (they exist only to decorate). The document
   * observer stays — if the owner that displaced this plugin ever unloads,
   * the next sidebar change starts the scan again.
   */
  const standDown = (reason: FileReferenceStatus['reason']): void => {
    status.active = false
    status.reason = reason
    for (const [tree, release] of Array.from(watched)) {
      release()
      watched.delete(tree)
    }
  }

  /**
   * Reserve the chip's width on the row, the way the reference implementation
   * does by keeping the chip in the row's flex flow: the filename is the item
   * that gives way, so a name too long for the row ends in an ellipsis instead
   * of running underneath the chip.
   *
   * The chip itself has to stay a sibling of the shell's row button (a
   * `<button>` cannot live inside one), so the space is reserved with padding
   * on that button — and CSS cannot read a sibling's width, hence one
   * measurement per tree. It is taken with the hidden chip temporarily laid
   * out (visibility hidden, so nothing paints), then cached against the label
   * it was measured for: a locale change re-measures on the next pass.
   */
  const measureChip = (tree: Element, label: string, chip: Element): void => {
    if (tree.getAttribute(CHIP_WIDTH) === label) return
    const styled = chip as unknown as { style?: CSSStyleDeclaration; offsetWidth?: number }
    const target = tree as unknown as { style?: CSSStyleDeclaration }
    if (styled.style === undefined || target.style === undefined) return
    const display = styled.style.display
    const visibility = styled.style.visibility
    styled.style.visibility = 'hidden'
    styled.style.display = 'inline-flex'
    const width = styled.offsetWidth ?? 0
    styled.style.display = display
    styled.style.visibility = visibility
    if (!Number.isFinite(width) || width <= 0) return
    target.style.setProperty(CHIP_SPACE, `${width}px`)
    tree.setAttribute(CHIP_WIDTH, label)
  }

  /** Add or update the chips of one tree. */
  const decorate = (tree: Element): void => {
    if (!tree.isConnected) return
    if (betterSidebarOwnsSurfaces(ctx)) {
      standDown('better-sidebar')
      return
    }
    if (hostHasAffordance(tree)) {
      removeChips(tree)
      status.active = false
      status.reason = 'host-affordance'
      return
    }
    status.active = true
    status.reason = 'active'
    const label = t('referenceFile')
    for (const entry of Array.from(tree.querySelectorAll(ENTRY))) {
      const kind = entry.getAttribute('data-files-entry')
      if (kind !== 'file' && kind !== 'directory') continue
      const marker = entry.getAttribute(OWNER)
      const existing = entry.querySelector(`:scope > [${CHIP}]`)
      if (marker === generation && existing !== null) {
        refreshLabel(existing, label)
        continue
      }
      // Either undecorated, or carrying a chip a previous mount left behind:
      // that chip's click listener died with the mount, so it is replaced.
      for (const stale of Array.from(entry.querySelectorAll(`:scope > [${CHIP}]`))) stale.remove()
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = CHIP_CLASS
      chip.setAttribute(CHIP, '')
      chip.setAttribute('aria-label', label)
      chip.title = label
      chip.textContent = label
      entry.appendChild(chip)
      entry.setAttribute(OWNER, generation)
    }
    const sample = tree.querySelector(`[${CHIP}]`)
    if (sample !== null) measureChip(tree, label, sample)
  }

  /** Scan the document for trees, and for trees that left it. */
  const scan = (): void => {
    scheduled = false
    frame = null
    if (betterSidebarOwnsSurfaces(ctx)) {
      standDown('better-sidebar')
    } else {
      for (const tree of Array.from(document.querySelectorAll(TREE))) {
        if (!watched.has(tree)) watch(tree)
        else decorate(tree)
      }
    }
    // A tree the shell unmounted keeps no observer and loses its chips.
    for (const [tree, release] of Array.from(watched)) {
      if (tree.isConnected) continue
      release()
      watched.delete(tree)
    }
  }

  /** Queue one scan for the next frame (coalesced: sidebar batches arrive together). */
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(scan)
    else frame = setTimeout(scan, 0) as unknown as number
  }

  /** Take up one tree: decorate it now, and re-decorate on its own changes. */
  function watch(tree: Element): void {
    if (watched.has(tree)) {
      decorate(tree)
      return
    }
    decorate(tree)
    // Decoration may have stood this plugin down (another owner, or a host
    // that already has the chip): a tree it may not touch needs no observer.
    if (!status.active) return
    const observer = new MutationObserver(() => decorate(tree))
    observer.observe(tree, { childList: true, subtree: true })
    watched.set(tree, () => {
      observer.disconnect()
      removeChips(tree)
    })
  }

  /**
   * The chip's press. Registered in the CAPTURE phase on the document so a
   * press that becomes a reference never reaches the row: the reference
   * implementation stops propagation in its own handler, and stopping here
   * before React's root listener does the same for a chip that is a sibling
   * of (not a child of) the row button. It stops whether or not the insert
   * landed — a chip press is never a row activation.
   *
   * Focus is left where the press put it, also like the reference
   * implementation: the row stays revealed through `:focus-within` until the
   * focus leaves the tree.
   */
  const onClick = (event: MouseEvent): void => {
    const target = event.composedPath().find(node => node instanceof Element) as Element | undefined
    const chip = target?.closest(`[${CHIP}]`) as Element | null | undefined
    if (chip === null || chip === undefined) return
    const entry = chip.closest(ENTRY)
    if (entry === null) return
    const path = entry.getAttribute('data-files-path')
    const kind = entry.getAttribute('data-files-entry')
    if (path === null || path === '' || (kind !== 'file' && kind !== 'directory')) return
    if (betterSidebarOwnsSurfaces(ctx)) {
      standDown('better-sidebar')
      return
    }
    event.stopPropagation()
    const sessionId = sessionOfRow(ctx, entry)
    if (sessionId === undefined) return
    insertWorkspaceReference(ctx, sessionId, path, kind === 'directory')
  }

  /**
   * The document observer only answers one question: did something arrive
   * inside the right sidebar (its mount, a tab switch, a tree body)? Text
   * streaming into the conversation is skipped by one `closest` check per
   * added element, so a long reply never triggers a tree scan.
   */
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type !== 'childList') continue
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element && node.closest(SIDEBAR) !== null) {
          schedule()
          return
        }
      }
      // A removal can take a tree away (tab closed, sidebar collapsed to a
      // different session): prune the ledger on the next scan.
      for (const node of Array.from(record.removedNodes)) {
        if (node instanceof Element && (node.closest(SIDEBAR) !== null || node.matches(TREE))) {
          schedule()
          return
        }
      }
    }
  })
  observer.observe(root, { childList: true, subtree: true })
  document.addEventListener('click', onClick, true)
  scan()

  return () => {
    observer.disconnect()
    document.removeEventListener('click', onClick, true)
    if (frame !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      else clearTimeout(frame)
    }
    for (const release of watched.values()) release()
    watched.clear()
    status.active = false
  }
}
