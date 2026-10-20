/**
 * Making the tab strip scroll: the strip is one row (`ui/Tabs` draws it), and
 * this is what turns a wheel and the two arrow buttons beside it into movement.
 *
 * Two facts the row cannot state in CSS, measured here and published as one
 * attribute on the strip's root — `data-smkit-tabs-scroll`, tokens `start` and
 * `end`, the attribute absent while the row fits:
 *
 * - whether the row overflows at all, which is what seats the two arrows: the
 *   stylesheet reads the attribute, the component only renders them, and a row
 *   wide enough for its tabs shows neither;
 * - which way there is still room to move, so a direction used up dims instead
 *   of inviting a press that does nothing.
 *
 * It also keeps the tab the page just selected in sight: a strip whose
 * selection has scrolled out of the row reads as the wrong page, and the page
 * that restores the tab a reader was last on (`settings.ts`) lands there
 * routinely.
 *
 * ## Movement is one frame at a time
 *
 * Both gestures move the row through a single driver rather than handing the
 * browser one big jump:
 *
 * - an arrow press is a timed glide — it covers most of a view over
 *   `PRESS_MS` on an ease-out curve, so the eye follows the labels instead of
 *   being teleported past them;
 * - a wheel is a chase — the gesture moves a *target*, and the row closes a
 *   share of the remaining distance each frame, which is what a trackpad feels
 *   like and what keeps a burst of discrete wheel events from arriving as a
 *   burst of jumps.
 *
 * The two share the driver (and therefore the target) for a reason: CSS
 * `scroll-behavior: smooth` and `scrollBy` would each run their own animation,
 * and two animations on one `scrollLeft` fight — the wheel would stutter while
 * a press eased, and a press would yank the row back from wherever the wheel
 * had taken it. One target, one frame loop, and a direction change just re-aims
 * it. A press that is still running when the next comes re-aims from its
 * *target*, so pressing twice travels twice without waiting for the first.
 *
 * The arrows' presses are taken here rather than in `ui/Tabs`, because the
 * driver's state has to be shared with the wheel; the component renders the
 * buttons and names them, this decides what a press does. The listener sits on
 * the root (the buttons are the row's siblings) and is delegated, so re-render
 * does not re-bind it.
 *
 * ## What counts as somebody else's scroll
 *
 * A reader who grabs the row — a finger, a drag — must not be fought by a frame
 * loop still chasing an old target. The grab is caught where it starts: a
 * `pointerdown` on the row stops the loop and takes the row's current offset as
 * the new target. A running loop explains the scroll events it causes itself, so
 * only an idle row re-reads `scrollLeft` from those events; a reveal
 * (`scrollIntoView`) stops the loop explicitly before it moves the row.
 *
 * A trackpad's horizontal swipe needs none of this: it arrives as a wheel, and
 * the wheel is the gesture this module already owns.
 *
 * The wheel needs code for a reason worth naming: a vertical wheel over a
 * horizontally scrollable element scrolls the *page*, not the element, and
 * turning that around means `preventDefault` — which only works from a
 * non-passive listener, and React's own `onWheel` is registered passively at
 * the root. So the listener lives here, on the row itself, and is obeyed only
 * while the row can move that way: a gesture at either end, or on a row with
 * nothing to scroll, is left to the dialog behind the strip.
 *
 * The parts are found by the markers `ui/Tabs` writes (`data-smkit-tabs`,
 * `-row`, `-arrow`) and not by the class family, because a page may restyle the
 * strip with a family of its own and the behaviour must not go with it.
 *
 * Armed once for the plugin's life (`entry.ts`) rather than per strip: one
 * watch finds every strip in the document, present and future, so no strip has
 * to hand over a node — which is also what keeps this layer free of refs (see
 * `types.ts` on why `react` arrives as the narrow subset it does).
 */

/** The markers `ui/Tabs` writes. The stylesheet spells the same names. */
const ROOT = '[data-smkit-tabs]'
const ROW = '[data-smkit-tabs-row]'
const ARROW = '[data-smkit-tabs-arrow]'
/**
 * The host's own tab strip — `ui-dockkit`'s chip box in the right sidebar.
 *
 * It is a plain `overflow-x: auto` scroller with the scrollbar hidden and
 * `scroll-behavior: smooth`, and no wheel handler of its own: a vertical wheel
 * over it belongs to whatever scrolls behind, so the strip only moves sideways
 * while shift is held. Chromium does not remap the axis (Firefox does), which is
 * the whole reason this layer takes the host's strips too — same gesture, same
 * driver, no arrows (the host draws its own chrome and fades the hidden sides).
 */
const HOST_ROW = '[data-dockkit-strip-tabs]'
/** The attribute the strip marks its selected tab with, and that tab itself. */
const SELECTED_ATTRIBUTE = 'data-smkit-active'
const SELECTED = `[${SELECTED_ATTRIBUTE}=true]`
/** Attribute the root carries while its row overflows, as `start`/`end` tokens. */
const SCROLL = 'data-smkit-tabs-scroll'
/** A wheel in `deltaMode` 1 counts lines, not pixels. */
const LINE_PX = 16
/** How much of the row one arrow press moves, as a share of what is on screen. */
const PRESS_SHARE = 0.8
/** How long a press takes: long enough to read as movement, short enough to obey. */
const PRESS_MS = 320
/** The share of the remaining distance the chase covers in one frame. */
const CHASE = 0.22
/** Below this many pixels the chase has arrived and snaps to its target. */
const SETTLE_PX = 0.5

/** One row's movement: where it is headed and what is carrying it there. */
interface Glide {
  /** Where the row is headed. */
  target: number
  /** The frame in flight, when there is one. */
  frame: number | null
  /** A press's takeoff point and start time; absent while chasing a wheel. */
  press: { from: number; at: number } | null
}

/** How much room the row has to move, never negative. */
const roomOf = (row: HTMLElement): number => Math.max(row.scrollWidth - row.clientWidth, 0)

/**
 * Put a row at `left`, ignoring any `scroll-behavior: smooth` on it.
 *
 * The host's chip box ships that rule (a newly selected tab glides into view),
 * and a plain `scrollLeft =` would start an animation of its own — one per frame
 * of the chase, each cancelling the last, which reads as the row refusing to
 * move. `behavior: 'instant'` is the one assignment the stylesheet cannot
 * override; an engine too old to know it is left with the plain write.
 */
const write = (row: HTMLElement, left: number): void => {
  if (typeof row.scrollTo === 'function') {
    try {
      row.scrollTo({ left, behavior: 'instant' as ScrollBehavior })
      return
    } catch {
      // Older engines reject the third enum value; the plain write is the fallback.
    }
  }
  row.scrollLeft = left
}

/** Whether the reader asked for less motion, in which case nothing is animated. */
const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Watch every tab strip in the document: publish what each row can do
 * (`data-smkit-tabs-scroll`), scroll it on a wheel and on its arrows, and keep
 * its selected tab in sight.
 *
 * Two kinds of strip are watched: this plugin's own rows (`ui/Tabs`, arrows and
 * all) and the host's chip box in the right sidebar, which gets the same wheel
 * treatment and nothing else — that one is why a plain wheel scrolls the file
 * tabs sideways instead of belonging to the page behind them.
 * @returns Disposer for the caller's effect cleanup.
 */
export function watchTabsScroll(): () => void {
  // `document` is absent outside a browser (the hook test harness runs the
  // bundle in a bare context) — the same guard the pickers carry.
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}

  /** Per strip: how to let go of it again, keyed by its root. */
  const watched = new Map<Element, () => void>()
  /** Per host chip box: how to let go of it again, keyed by the box itself. */
  const hostRows = new Map<Element, () => void>()
  /** Per row: the frame loop moving it, and where to. */
  const glides = new Map<HTMLElement, Glide>()

  /** What one row can do right now, written where the stylesheet reads it. */
  const mark = (root: Element, row: HTMLElement): void => {
    // A row that fits has nothing to say: the arrows hang off the attribute.
    const room = roomOf(row)
    if (room <= 1) {
      root.removeAttribute(SCROLL)
      return
    }
    const ends: string[] = []
    if (row.scrollLeft > 0) ends.push('start')
    if (row.scrollLeft < room - 1) ends.push('end')
    root.setAttribute(SCROLL, ends.join(' '))
  }

  /** One row's movement, created the first time something asks to move it. */
  const glideOf = (row: HTMLElement): Glide => {
    const existing = glides.get(row)
    if (existing !== undefined) return existing
    const created: Glide = { target: row.scrollLeft, frame: null, press: null }
    glides.set(row, created)
    return created
  }

  /** Abandon whatever was moving the row; the target stays where it was. */
  const halt = (glide: Glide): void => {
    if (glide.frame !== null) cancelAnimationFrame(glide.frame)
    glide.frame = null
  }

  /**
   * One frame of movement. A press eases from its takeoff to its target by a
   * deadline; a wheel closes a share of the distance left, which is a chase
   * with inertia rather than an animation. Both write `scrollLeft` and both
   * re-aim when the target changes under them.
   */
  const step = (row: HTMLElement, glide: Glide, now: number): void => {
    glide.frame = null
    glide.target = Math.min(Math.max(glide.target, 0), roomOf(row))
    const press = glide.press
    if (press === null) {
      const left = glide.target - row.scrollLeft
      if (Math.abs(left) < SETTLE_PX) {
        write(row, glide.target)
        return
      }
      const before = row.scrollLeft
      write(row, before + left * CHASE)
      // An engine that snaps the fractional step back to the pixel it came from
      // would otherwise leave the chase a pixel short of its target for ever.
      if (row.scrollLeft === before) {
        write(row, glide.target)
        return
      }
      glide.frame = requestAnimationFrame((next) => step(row, glide, next))
      return
    }
    const elapsed = (now - press.at) / PRESS_MS
    if (elapsed >= 1) {
      write(row, glide.target)
      glide.press = null
      return
    }
    // Ease-out cubic: quick off the mark, settling onto the last tab.
    const eased = 1 - (1 - elapsed) ** 3
    write(row, press.from + (glide.target - press.from) * eased)
    glide.frame = requestAnimationFrame((next) => step(row, glide, next))
  }

  /** Start moving the row towards its target, unless a frame already is. */
  const run = (row: HTMLElement, glide: Glide): void => {
    if (glide.frame !== null) return
    glide.frame = requestAnimationFrame((now) => step(row, glide, now))
  }

  /**
   * One arrow press: most of a view, on a glide. Aiming from the target when a
   * glide is still in flight is what makes two presses travel two views instead
   * of the second one restarting from wherever the first had got to.
   */
  const onPress = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const arrow = target.closest<HTMLElement>(ARROW)
    if (arrow === null) return
    const row = arrow.closest(ROOT)?.querySelector<HTMLElement>(ROW)
    if (row === null || row === undefined) return
    const room = roomOf(row)
    if (room <= 1) return
    const glide = glideOf(row)
    const from = row.scrollLeft
    const base = glide.frame === null ? from : glide.target
    const direction = arrow.dataset.smkitTabsArrow === 'start' ? -1 : 1
    const next = Math.min(Math.max(base + direction * row.clientWidth * PRESS_SHARE, 0), room)
    if (next === base) return
    halt(glide)
    glide.target = next
    // Reduced motion still moves the row, it just does not travel there.
    if (prefersReducedMotion()) {
      row.scrollLeft = next
      glide.press = null
      return
    }
    glide.press = { from, at: performance.now() }
    run(row, glide)
  }

  /**
   * One wheel over one row. `deltaX` wins when the gesture is already
   * horizontal (a trackpad, or shift+wheel); `deltaY` is what a mouse reports.
   * `deltaMode` says whether that number came in pixels, lines or pages — a
   * Windows mouse reports lines, which read as pixels would be a crawl.
   *
   * The gesture moves the target rather than the row: a mouse sends its wheel in
   * notches, and assigning those to `scrollLeft` would be a notch per jump. The
   * chase turns the same notches into one continuous movement.
   */
  const onWheel = (event: WheelEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    // Either strip: ours (a row inside its root) or the host's chip box itself.
    const row = target.closest<HTMLElement>(`${ROW}, ${HOST_ROW}`)
    if (row === null) return
    const room = roomOf(row)
    if (room <= 1) return
    const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    const raw = sideways ? event.deltaX : event.deltaY
    const delta =
      event.deltaMode === 1 ? raw * LINE_PX : event.deltaMode === 2 ? raw * row.clientWidth : raw
    const glide = glideOf(row)
    // A chase that finished leaves a stale target; start from where the row is.
    if (glide.frame === null && glide.press === null) glide.target = row.scrollLeft
    const next = Math.min(Math.max(glide.target + delta, 0), room)
    // At the end of the row the gesture belongs to the dialog again.
    if (next === glide.target) return
    event.preventDefault()
    halt(glide)
    glide.press = null
    glide.target = next
    if (prefersReducedMotion()) {
      write(row, next)
      return
    }
    run(row, glide)
  }

  /**
   * Bring the selected tab back into the row's view, the way a tab strip keeps
   * the page it shows and the tab it marks in the same place. `nearest` on both
   * axes moves the row and leaves every other scroll position alone, and this is
   * asked only when the selection changes or a strip first appears — never on a
   * scroll of the row's own, so a reader is free to scroll away from the
   * selection.
   */
  const reveal = (row: HTMLElement): void => {
    const selected = row.querySelector(SELECTED)
    if (selected === null) return
    const glide = glides.get(row)
    if (glide !== undefined) {
      halt(glide)
      glide.press = null
    }
    selected.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  /** Take up one strip, or re-read a strip already under watch. */
  const watch = (root: Element): void => {
    const row = root.querySelector<HTMLElement>(ROW)
    if (row === null) return
    if (watched.has(root)) {
      // Re-read rather than re-arm: a locale switch rewrites the labels in
      // place, which changes what fits without changing the row's box, and this
      // is what catches it.
      mark(root, row)
      return
    }
    const sync = (): void => mark(root, row)
    /**
     * A reader taking hold of the row: the one moment a loop in flight must give
     * way. It is caught where it begins rather than guessed from scroll events,
     * which a loop's own writes would look exactly like.
     */
    const onGrab = (): void => {
      const glide = glides.get(row)
      if (glide === undefined) return
      halt(glide)
      glide.press = null
      glide.target = row.scrollLeft
    }
    /**
     * An idle row follows its own offset — a scroll the loop did not cause, or
     * the tail of one it did. While a loop is running, the loop is the writer
     * and already knows where the row is.
     */
    const onScroll = (): void => {
      sync()
      const glide = glides.get(row)
      if (glide === undefined || glide.frame !== null) return
      glide.target = row.scrollLeft
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    observer?.observe(row)
    row.addEventListener('scroll', onScroll, { passive: true })
    row.addEventListener('wheel', onWheel, { passive: false })
    row.addEventListener('pointerdown', onGrab, { passive: true })
    root.addEventListener('click', onPress)
    // The selection is watched on the row alone (an attribute filter, one
    // subtree): a tab taking the marker is the one moment the row may move on
    // its own, and the reveal below is what it does with it.
    const selection = new MutationObserver(() => reveal(row))
    selection.observe(row, { subtree: true, attributes: true, attributeFilter: [SELECTED_ATTRIBUTE] })
    watched.set(root, () => {
      observer?.disconnect()
      selection.disconnect()
      row.removeEventListener('scroll', onScroll)
      row.removeEventListener('wheel', onWheel)
      row.removeEventListener('pointerdown', onGrab)
      root.removeEventListener('click', onPress)
      const glide = glides.get(row)
      if (glide !== undefined) halt(glide)
      glides.delete(row)
    })
    sync()
    // The strip may arrive with its selection already made — the merged section
    // restores the tab the reader was last on — which no change will announce.
    reveal(row)
  }

  /**
   * Take up one of the host's chip boxes: the wheel and the grab, nothing else.
   *
   * The host owns everything around them — no arrows of its own, the selected
   * tab brought into view by its own layout effect, and the edge fades written
   * as `data-dockkit-strip-scroll` — so what is wired here is exactly the two
   * gestures that have no home over there. A grab halts a chase for the same
   * reason it does on our own row: the reader's finger wins.
   */
  const watchHost = (row: HTMLElement): void => {
    if (hostRows.has(row)) return
    const onGrab = (): void => {
      const glide = glides.get(row)
      if (glide === undefined) return
      halt(glide)
      glide.press = null
      glide.target = row.scrollLeft
    }
    row.addEventListener('wheel', onWheel, { passive: false })
    row.addEventListener('pointerdown', onGrab, { passive: true })
    hostRows.set(row, () => {
      row.removeEventListener('wheel', onWheel)
      row.removeEventListener('pointerdown', onGrab)
      const glide = glides.get(row)
      if (glide !== undefined) halt(glide)
      glides.delete(row)
    })
  }

  /** Re-read every strip under watch, and let go of the ones that left. */
  const refresh = (): void => {
    for (const [root, release] of watched) {
      if (!root.isConnected) {
        release()
        watched.delete(root)
        continue
      }
      watch(root)
    }
    for (const [row, release] of hostRows) {
      if (!row.isConnected) {
        release()
        hostRows.delete(row)
      }
    }
  }

  /** Every strip in the document: new ones start being watched, gone ones stop. */
  const scan = (): void => {
    for (const root of document.querySelectorAll(ROOT)) watch(root)
    for (const row of document.querySelectorAll<HTMLElement>(HOST_ROW)) watchHost(row)
    refresh()
  }

  /** Whether a batch brought an element — the only way a strip can arrive. */
  const broughtAnElement = (record: MutationRecord): boolean =>
    record.type === 'childList' && [...record.addedNodes].some((node) => node instanceof Element)

  // One observer serves both halves of the job: a strip that mounts later (a
  // section's page swapping under the dialog) and a label that changes size
  // without its row changing box. The guard is the price of being armed for the
  // plugin's whole life: a conversation streams text into the page batch after
  // batch, and a batch of text cannot have brought a strip — so the document is
  // asked for its strips only when something structural happened, and every
  // other batch is re-read in place.
  const observer = new MutationObserver((records) => {
    if (records.some(broughtAnElement)) scan()
    else refresh()
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  scan()
  return () => {
    observer.disconnect()
    for (const [root, release] of watched) {
      release()
      // The marks are this watch's, and go with it: a strip left behind by a
      // reload would otherwise keep arrows no one is measuring any more.
      root.removeAttribute(SCROLL)
    }
    watched.clear()
    for (const release of hostRows.values()) release()
    hostRows.clear()
    // A frame still owed would write to a row this watch no longer owns.
    for (const glide of glides.values()) halt(glide)
    glides.clear()
  }
}
