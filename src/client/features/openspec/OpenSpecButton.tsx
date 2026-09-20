/**
 * The Session-header control that manages the workspace's OpenSpec.
 *
 * Mounted into DSH's `conversation.session.header.utilities` slot, beside the
 * session-delete control, so it sits with the header's own right-aligned
 * utilities on the current session only. It reads the workspace the session
 * runs in — the session row's `cwd`, else the workspace that accounts for the
 * session — and asks the host for that workspace's OpenSpec footprint.
 *
 * **Hover, not click, is the primary gesture**, which is why this control wears
 * no tooltip: the shell's bubble and the panel would be two answers to the same
 * hover, and the panel's own head names the control. The panel stays open while
 * the pointer travels from the button to it, and what keeps it open is a grace
 * period (`HOVER_GRACE_MS`) rather than a geometric test — the pointer has to
 * cross the gap, and for the panel's far half it does so diagonally, leaving the
 * control's small box through its side at a height no geometry can tell apart
 * from walking away. It closes on Escape, on a press outside it, on scroll or
 * resize, and of course once the grace period runs out with the pointer on
 * neither surface. The scroll and resize cases are because the panel is placed
 * from coordinates measured when it opened, so a header that moved under it
 * would leave it pointing at nothing.
 *
 * **The host decides everything shown here.** The panel renders what
 * `GET /openspec` answered: whether `openspec/` exists, its layout parts and
 * tree, and every `openspec-*` skill directory and `opsx*` command entry the
 * CLI's tool integrations left in the workspace. The browser never derives a
 * path, so the list and the delete cannot disagree about what is there — the
 * delete re-derives the same list on the host, from the same tool table.
 *
 * **One button, one confirmation.** The panel's delete removes the whole
 * footprint (the store counts as one entry, because it goes in one piece) and
 * reports inside the panel what survived, if anything: a half-removed OpenSpec
 * is a state a user can act on, and a partial failure must not read as a
 * success. The confirmation carries the same list, so the question and the
 * action name the same things.
 *
 * Nothing here reloads anything: the panel is a view over the filesystem, and
 * after a delete it simply reads again.
 */

import { createAtomIcon } from './icons/AtomIcon'
import { createChevronDownIcon } from '../../platform/icons/ChevronDownIcon'
import { createLoaderIcon } from '../../platform/icons/LoaderIcon'
import { createRefreshIcon } from '../../platform/icons/RefreshIcon'
import { createConfirmDialog } from '../../platform/ui/ConfirmDialog'
import { useAsyncAction } from '../../platform/ui/useAsyncAction'
import { clipBounds } from '../../platform/ui/tip'
import type {
  ApiResult,
  ClientDeps,
  SessionListSelector,
  Translator,
  WorkspaceSelector,
} from '../../platform/types'
import type {
  OpenSpecArtifacts,
  OpenSpecRemoveFailure,
  OpenSpecStore,
  OpenSpecTreeNode,
  OpenSpecView,
} from '../../../shared/openspec/contract'

/** Props the slot framework supplies to a session-scope header entry. */
export interface OpenSpecProps {
  /** Current session identity (the `sessionId` standard prop). */
  sessionId: string
  /** Translator bound to the `openspec` namespace (the registration declares `locale`). */
  t: Translator
  /** Session-list selector hook (the `useSessions` global standard prop). */
  useSessions: SessionListSelector
  /** Workspace selector hook (the `useWorkspaces` global standard prop). */
  useWorkspaces: WorkspaceSelector
}

/** How wide the panel wants to be, before the viewport has a say. */
const PANEL_WIDTH = 360
/** The gap between the control and the panel it opens. */
const PANEL_GAP = 6
/** Breathing room kept between the panel and a clipping edge. */
const PANEL_GUTTER = 6
/** The shortest panel worth showing: below this the other side is tried instead. */
const PANEL_MIN_ROOM = 180
/**
 * How long a leave is given before it is believed.
 *
 * The pointer has to cross the gap between the control and the panel, and a
 * user heading for the panel's far half moves diagonally — leaving the
 * control's 28px box through its *side*, at a height where no geometric test can
 * tell that move apart from walking away. So a leave starts a timer instead of
 * closing, and reaching either surface cancels it; the panel only goes once the
 * pointer has genuinely gone. Comfortably longer than any real crossing, short
 * enough that a real departure still feels immediate.
 */
const HOVER_GRACE_MS = 240
/** The panel's own class, so document-level listeners can tell it from the page. */
const PANEL_CLASS = 'os_panel'

/**
 * The refusals `openspec init` can answer with, as the copy that turns them
 * into an instruction. A code that is not here — the CLI ran and refused —
 * falls through to the CLI's own diagnostic, which is the actionable text in
 * that case; the host's `openspec/failed` is deliberately absent for exactly
 * that reason.
 */
const INIT_REFUSAL_KEYS: Record<string, string | undefined> = {
  'openspec/not-installed': 'openSpecInitNotInstalled',
  'openspec/timeout': 'openSpecInitTimeout',
}

/** The anchor's viewport geometry, captured when the panel opens. */
interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
}

/**
 * Where the panel goes: pinned to the control's right edge (the header's
 * utilities hug the right edge of the window, so a centred panel would hang off
 * it), pulled inside the panel that clips the header, and opened on the side
 * with room for it.
 */
interface PanelBox {
  left: number
  width: number
  /** Whether the panel hangs below the control rather than above it. */
  below: boolean
  /** Distance from the viewport's top (`below`) or bottom (otherwise), in px. */
  offset: number
  maxHeight: number
}

/** One open panel, from the control that placed it. */
interface Anchor {
  /** The control that placed it, so re-entering the same one is not a reopen. */
  node: HTMLElement
  box: PanelBox
}

/** One row of the confirmation's fact block. */
interface ConfirmRow {
  label: string
  value: string
  hint: string
}

/**
 * Place the panel for one anchor.
 *
 * @param rect - the control's viewport rect.
 * @param node - the control itself; its ancestors are what `clipBounds` walks.
 */
function panelBox(rect: AnchorRect, node: HTMLElement): PanelBox {
  const bounds = clipBounds(node, PANEL_GUTTER)
  const width = Math.min(PANEL_WIDTH, Math.max(bounds.right - bounds.left, 0))
  // Right-aligned to the control, then clamped: `bounds.right - width` is the
  // rightmost left edge that still fits, and `bounds.left` the leftmost, so a
  // narrowed bound (a panel narrower than 360px) keeps the panel whole.
  const left = Math.min(
    Math.max(rect.right - width, bounds.left),
    Math.max(bounds.right - width, bounds.left),
  )
  const roomBelow = bounds.bottom - PANEL_GAP - rect.bottom
  const roomAbove = rect.top - PANEL_GAP - bounds.top
  // Below when there is room there, or when it is the roomier side — and
  // otherwise above, growing upward from its own bottom edge so no height has
  // to be predicted.
  const below = roomBelow >= PANEL_MIN_ROOM || roomBelow >= roomAbove
  const room = below ? roomBelow : roomAbove
  return {
    left,
    width,
    below,
    offset: below ? rect.bottom + PANEL_GAP : window.innerHeight - (rect.top - PANEL_GAP),
    // Never more than the room the clip boundary left, but never so little that
    // the panel is a slit: past that point its body scrolls, which is what the
    // body is for.
    maxHeight: Math.max(room, PANEL_MIN_ROOM),
  }
}

/** The box as the inline geometry the panel is rendered with. */
function panelStyle(box: PanelBox): Record<string, string> {
  const style: Record<string, string> = {
    left: `${box.left}px`,
    width: `${box.width}px`,
    maxHeight: `${box.maxHeight}px`,
  }
  if (box.below) style.top = `${box.offset}px`
  else style.bottom = `${box.offset}px`
  return style
}

/** Whether an event target is part of the panel (or of the control hosting it). */
function insideOwnSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(`.${PANEL_CLASS}`) !== null || target.closest('.os_host') !== null
}

/**
 * Whether a pointer position is still inside a box of its own.
 *
 * A reported `mouseleave` is not always a leave. A right-press opens the
 * browser's own menu under the pointer, and the browser then reports the
 * element under it losing the pointer even though the pointer never moved; the
 * event's coordinates are the tell, because a leave the user actually made is
 * reported from outside the box. Skipping the spurious ones is what keeps a
 * right-click inside the panel — which is how a path gets copied out of it —
 * from dismissing the thing being read.
 */
function insideBox(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/**
 * Format a byte count for one row: whole bytes below 1 KiB, then one decimal up
 * to 10 units and whole units above, so a column of figures stays scannable.
 * Not localized on purpose — the units read the same in both dictionaries, and
 * `t` carries the surrounding copy.
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = value < 10 ? value.toFixed(1) : String(Math.round(value))
  return `${rounded} ${units[unit]}`
}

export function createOpenSpecButton(deps: ClientDeps): (props: OpenSpecProps) => JSX.Element {
  const { h, react, api, createPortal } = deps
  const ConfirmDialog = createConfirmDialog(deps)
  const AtomIcon = createAtomIcon(deps)
  const ChevronDownIcon = createChevronDownIcon(deps)
  const RefreshIcon = createRefreshIcon(deps)
  const LoaderIcon = createLoaderIcon(deps)
  /**
   * The pending "the pointer left" dismissal, if any.
   *
   * It lives here rather than in a state cell on purpose: it is a scalar written
   * by one event handler and read by the next one, and those two events
   * routinely straddle a re-render, so a state cell would be read stale.
   */
  let closeTimer: number | undefined
  /** Believe the last leave no longer: the pointer came back. */
  const cancelClose = (): void => {
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer)
      closeTimer = undefined
    }
  }
  /** Start believing it: close unless the pointer reaches a surface first. */
  const scheduleClose = (close: () => void): void => {
    cancelClose()
    closeTimer = setTimeout(close, HOVER_GRACE_MS)
  }

  return function OpenSpecButton({
    sessionId,
    t,
    useSessions,
    useWorkspaces,
  }: OpenSpecProps): JSX.Element {
    const [open, setOpen] = react.useState(false)
    const [anchor, setAnchor] = react.useState<Anchor | null>(null)
    const [view, setView] = react.useState<OpenSpecView | undefined>(undefined)
    const [reading, setReading] = react.useState(false)
    const [error, setError] = react.useState('')
    const [failures, setFailures] = react.useState<OpenSpecRemoveFailure[]>([])
    /** Whether the generated-entry list is showing; closed until it is asked for. */
    const [artifactsOpen, setArtifactsOpen] = react.useState(false)
    const [asking, setAsking] = react.useState(false)
    /** What the CLI said the last time it was run, kept until the next open. */
    const [initOutput, setInitOutput] = react.useState('')
    const { busy, error: removeError, run } = useAsyncAction(react)
    const { busy: initing, error: initError, run: runInit } = useAsyncAction(react)
    // Both hooks run on every render: they are ordinary store subscriptions
    // whose order must stay stable across renders.
    const cwd = useSessions(state => state.byId[sessionId]?.cwd)
    const workspacePath = useWorkspaces(state =>
      state.items.find(item => item.sessionIds.includes(sessionId))?.path)
    // The session's own directory is the better half of the target — it is the
    // workspace being worked in — and the accounting row is the fallback for a
    // session that has not been given one yet.
    const target = typeof cwd === 'string' && cwd !== '' ? cwd : workspacePath

    // A panel placed from measured coordinates cannot survive the page moving
    // under it, and a box that ignores Escape is a trap. The listeners are
    // installed only while it is open, and the `true` on the scroll listener is
    // what catches a scroll in any container, not just the window.
    react.useEffect(() => {
      if (!open || typeof document === 'undefined') return undefined
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') setOpen(false)
      }
      // A pending leave belongs to the panel being open: closing it — or
      // unmounting the control — takes the timer with it.
      const cancel = cancelClose

      const onDown = (event: PointerEvent): void => {
        // A press inside the panel (its own buttons, or the text between them)
        // or on the control is not a dismissal; the control's own click toggle
        // owns that case. A press on the confirmation is not one either: that
        // dialog is a step *inside* the panel's own flow, and the panel has to
        // survive it to show what the delete left behind.
        if (asking || insideOwnSurface(event.target)) return
        setOpen(false)
      }
      /**
       * A scroll anywhere but inside the panel is a reason to close: the box is
       * placed from coordinates measured when it opened, so a page that moved
       * under it would leave it pointing at nothing.
       *
       * A scroll *inside* it is the opposite — the panel scrolls its own body
       * when a store is longer than the panel, and that is reading it, not
       * leaving it — so the event's target decides. The capture flag is what
       * lets the listener see a scroll from any container at all rather than
       * only the document's own.
       */
      const onScroll = (event: Event): void => {
        if (insideOwnSurface(event.target)) return
        setOpen(false)
      }
      const onResize = (): void => setOpen(false)
      document.addEventListener('keydown', onKey)
      document.addEventListener('pointerdown', onDown)
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', onResize)
      return () => {
        cancel()
        document.removeEventListener('keydown', onKey)
        document.removeEventListener('pointerdown', onDown)
        window.removeEventListener('scroll', onScroll, true)
        window.removeEventListener('resize', onResize)
      }
    }, [open, asking])

    /**
     * The host's message for one refused or failed call: the localized copy
     * when the refusal is one this panel knows how to phrase, the host's own
     * text otherwise (which is where the CLI's diagnostic arrives).
     */
    const messageFor = (result: ApiResult, fallbackKey: string): string => {
      const localized = typeof result.body.code === 'string' ? INIT_REFUSAL_KEYS[result.body.code] : undefined
      if (localized !== undefined) return t(localized)
      return typeof result.body.error === 'string' && result.body.error !== ''
        ? result.body.error
        : t(fallbackKey, { status: result.status })
    }

    /** Read the current workspace's footprint, and show what came back. */
    const load = async (): Promise<void> => {
      if (target === undefined) {
        setView(undefined)
        setError(t('openSpecNoWorkspace'))
        return
      }
      setReading(true)
      setError('')
      try {
        const result = await api(`/openspec?cwd=${encodeURIComponent(target)}`)
        if (result.ok) setView(result.body as OpenSpecView)
        else setError(messageFor(result, 'openSpecLoadFailed'))
      } catch {
        // A thrown call has no status to report; the message is the point.
        setError(t('openSpecLoadFailed', { status: 0 }))
      } finally {
        setReading(false)
      }
    }

    const show = (node: HTMLElement): void => {
      // Whatever the pointer crossed on its way here, it is back: the last leave
      // is not to be believed after all.
      cancelClose()
      // Re-entering the control from the panel (the pointer crossed the gap
      // back) must not throw the reading away and start another one.
      if (open && anchor !== null && anchor.node === node) return
      const rect = node.getBoundingClientRect()
      const box = panelBox(rect, node)
      setAnchor({ node, box })
      setOpen(true)
      setFailures([])
      setInitOutput('')
      // Every open re-reads: the panel's whole subject is what is on disk right
      // now, and the user may have just run `openspec init` in a terminal.
      void load()
    }

    const close = (): void => {
      setOpen(false)
      setAnchor(null)
    }

    /**
     * Dismiss unless the confirmation is up. Clicking the panel's delete moves
     * the pointer to the dialog, which is a leave — and the one leave the panel
     * must survive, because the answer to the question is what it is there to
     * show.
     */
    const dismiss = (): void => {
      if (!asking) close()
    }

    const confirm = (): void => {
      void run(async () => {
        if (target === undefined) return t('openSpecNoWorkspace')
        const result = await api('/openspec/delete', {
          method: 'POST',
          body: JSON.stringify({ cwd: target }),
        })
        if (!result.ok) return messageFor(result, 'openSpecRemoveFailed')
        const failed: unknown = result.body.failed
        setAsking(false)
        setFailures(Array.isArray(failed) ? (failed as OpenSpecRemoveFailure[]) : [])
        await load()
        return undefined
      })
    }

    /**
     * Create the store, then read it back.
     *
     * The CLI is the only actor here: this plugin never writes an `openspec/`
     * directory by hand, because the layout is the CLI's to own — a store
     * assembled in the browser would be one `openspec update` away from being
     * rewritten, and the version markers the CLI leaves behind are exactly what
     * that command reconciles. So this is one spawn, then the same read the
     * panel always does.
     */
    const initialize = (): void => {
      void runInit(async () => {
        if (target === undefined) return t('openSpecNoWorkspace')
        const result = await api('/openspec/init', {
          method: 'POST',
          body: JSON.stringify({ cwd: target }),
        })
        if (!result.ok) return messageFor(result, 'openSpecInitFailed')
        setInitOutput(typeof result.body.output === 'string' ? result.body.output : '')
        await load()
        return undefined
      })
    }

    /** The delete's confirmation, which names exactly what the request will remove. */
    const confirmRows = (current: OpenSpecView): ConfirmRow[] => {
      const rows: ConfirmRow[] = []
      if (current.store !== undefined) {
        rows.push({ label: t('openSpecStore'), value: current.store.rel, hint: current.store.path })
      }
      for (const group of current.artifacts) {
        // What the group's directory keeps is part of the answer, not a
        // footnote: `.agents/skills` is where a machine keeps every skill, and
        // the question "does this take my other skills with it" has to be
        // answerable from the question itself.
        const kept = group.keptCount > 0 ? ` · ${t('openSpecKeptShort', { count: group.keptCount })}` : ''
        rows.push({
          label: kindLabel(group.kind),
          value: `${group.rel} · ${t('openSpecEntries', { count: group.entries.length })}${kept}`,
          hint: group.path,
        })
      }
      return rows
    }

    /**
     * The tree as the `tree` command prints one: every entry carries its own
     * branch connector (`├──`, `└──` for the last of a level), and a directory
     * that is not last continues its `│` down through its children — so the
     * block reads as a shape, not as a list of indented names. A directory's
     * child count would be redundant here, where the children are on screen.
     */
    const treeRows = (nodes: OpenSpecTreeNode[], prefix: string): unknown[] =>
      nodes.flatMap((node, index) => {
        const last = index === nodes.length - 1
        return [
          <div className="os_node" key={node.rel}>
            <span className="os_branch">{`${prefix}${last ? '└── ' : '├── '}`}</span>
            <span className="os_name" data-kind={node.kind}>{node.name}</span>
            {node.kind === 'file' ? <span className="os_size">{formatBytes(node.bytes)}</span> : null}
          </div>,
          ...(node.children === undefined
            ? []
            : treeRows(node.children, `${prefix}${last ? '    ' : '│   '}`)),
        ]
      })

    const kindLabel = (kind: OpenSpecArtifacts['kind']): string =>
      kind === 'skills'
        ? t('openSpecKindSkills')
        : kind === 'commands'
          ? t('openSpecKindCommands')
          : t('openSpecKindExtra')

    /**
     * The one thing a tree cannot say: the layout expects something and the
     * disk does not have it. Everything else the store's parts could report —
     * which of them exist, what is under each — is what the tree below already
     * draws, so the panel draws it once: a listing of `specs`, `changes` and
     * `config.yaml` above a tree that shows the same three names is the same
     * answer twice.
     *
     * The parts an earlier CLI never wrote are deliberately not in here: a
     * `project.md` a current `openspec init` has no reason to create is not a
     * missing part, and reporting it as one would make every healthy store look
     * half-built.
     */
    const missingParts = (store: OpenSpecStore): string[] =>
      store.parts.filter(part => part.required && !part.exists).map(part => part.name)

    /** The store as a tree — the panel's one picture of what is on disk. */
    const treeSection = (store: OpenSpecStore): JSX.Element => {
      const missing = missingParts(store)
      return (
        <div className="os_section">
          <div className="os_sectionTitle">
            {t('openSpecTree')}
            <span className="os_count">
              {t('openSpecFiles', { count: store.files })}
              {' · '}
              {t('openSpecDirs', { count: store.dirs })}
            </span>
          </div>
          <div className="os_tree">
            <div className="os_node">
              <span className="os_root">{store.rel}</span>
            </div>
            {treeRows(store.tree, '')}
          </div>
          {missing.length === 0
            ? null
            : <div className="os_error">{t('openSpecMissing', { names: missing.join(' · ') })}</div>}
        </div>
      )
    }

    /**
     * The generated entries, behind a toggle that starts closed.
     *
     * The count in the heading is the answer most openings want — "six of them
     * are installed" — and the list of twenty names it stands for is the one
     * thing here that is long without being about *this* workspace's state. So
     * the heading stays a heading and the list becomes something asked for;
     * whether it is open is remembered for as long as the control is mounted,
     * because a user who opened it once is reading it, not asking a one-off
     * question.
     */
    const artifactsSection = (groups: OpenSpecArtifacts[]): JSX.Element => {
      const count = groups.reduce((sum, group) => sum + group.entries.length, 0)
      return (
        <div className="os_section">
          <button
            className="os_toggle"
            type="button"
            aria-expanded={artifactsOpen}
            title={artifactsOpen ? t('openSpecCollapse') : t('openSpecExpand')}
            onClick={() => setArtifactsOpen(!artifactsOpen)}
          >
            <span className="os_caret" data-open={artifactsOpen ? 'true' : undefined}>
              <ChevronDownIcon size={12} />
            </span>
            {t('openSpecArtifacts')}
            <span className="os_count">{t('openSpecEntries', { count })}</span>
          </button>
          {artifactsOpen ? groups.map(group => (
            <div className="os_group" key={`${group.kind}:${group.rel}`}>
              <div className="os_groupHead">
                <span className="os_kind">{kindLabel(group.kind)}</span>
                <span className="os_path" title={group.path}>{group.rel}</span>
                <span className="os_count">{t('openSpecEntries', { count: group.entries.length })}</span>
              </div>
              {/* A directory several tools write into is worth naming: it is why
               * one removal here takes the skills of three editors with it. */}
              {group.tools.length > 1
                ? <div className="os_note">{t('openSpecSharedBy', { tools: group.tools.join(' · ') })}</div>
                : null}
              <div className="os_chips">
                {group.entries.map(entry => (
                  <span
                    className={entry.marker ? 'os_chipItem os_chipMarker' : 'os_chipItem'}
                    key={entry.rel}
                    // The marker is the one entry here that is not a skill or a
                    // command, so hovering it says what it is instead of only
                    // where it lives.
                    title={entry.marker ? t('openSpecMarker', { path: entry.path }) : entry.path}
                  >
                    {entry.name}
                  </span>
                ))}
              </div>
            </div>
          )) : null}
        </div>
      )
    }

    const facts = view === undefined
      ? null
      : (
        <div className="os_section">
          <div className="os_grid">
            <span className="os_label">{t('openSpecRoot')}</span>
            <span className="os_value" title={view.root}>{view.root}</span>
            <span className="os_label">{t('openSpecStore')}</span>
            <span className="os_value" title={view.store?.path}>
              {view.store === undefined ? t('openSpecStatusAbsent') : view.store.rel}
            </span>
          </div>
        </div>
      )

    // Everything the last read or action had to say travels as one block, so
    // the dividers fall between the panel's four answers rather than between
    // two lines of the same message.
    const messages = (
      <div className="os_messages">
        {error === '' ? null : <div className="os_error">{error}</div>}
        {initError === '' ? null : <div className="os_error">{initError}</div>}
        {initing ? <div className="os_note">{t('openSpecInitRunning')}</div> : null}
        {failures.length === 0 ? null : (
          <div className="os_section">
            <div className="os_error">{t('openSpecPartial')}</div>
            {failures.map(failure => (
              <div className="os_note" key={failure.rel} title={failure.error}>{failure.rel}</div>
            ))}
          </div>
        )}
        {initOutput === '' ? null : (
          <div className="os_section">
            <div className="os_sectionTitle">{t('openSpecInitDone')}</div>
            <div className="os_output">{initOutput}</div>
          </div>
        )}
        {reading && view === undefined ? <div className="os_note">{t('openSpecReading')}</div> : null}
      </div>
    )
    const hasMessages =
      error !== '' ||
      initError !== '' ||
      initing ||
      failures.length > 0 ||
      initOutput !== '' ||
      (reading && view === undefined)

    const body = (
      <div className="os_body">
        {hasMessages ? messages : null}
        {facts}
        {/* The generated entries above the tree: what OpenSpec put in the
         * workspace is the question the control was clicked for, and the store's
         * own layout is the reference it is read against. */}
        {view === undefined
          ? null
          : view.artifacts.length > 0
            ? artifactsSection(view.artifacts)
            : view.initialized
              ? null
              : <div className="os_note">{t('openSpecEmpty')}</div>}
        {view?.store === undefined ? null : treeSection(view.store)}
        {view !== undefined && view.truncated ? (
          <div className="os_note">{t('openSpecTruncated')}</div>
        ) : null}
      </div>
    )

    // The two actions are keyed to what is actually there, not to which state
    // the panel happens to be in: an uninitialised workspace offers the
    // initialise, an initialised one offers the delete, and a workspace whose
    // store was deleted by hand but whose skills are still installed offers
    // both — which is the honest description of that half-removed state.
    const canInit = view !== undefined && !view.initialized
    const canRemove = view !== undefined && view.totalEntries > 0
    const panel = (
      <div
        className={PANEL_CLASS}
        style={anchor === null ? undefined : panelStyle(anchor.box)}
        role="dialog"
        aria-label={t('manageOpenSpec')}
        // Reaching the panel is the whole point of the grace period: it is what
        // cancels the leave that started on the control.
        onMouseEnter={cancelClose}
        // Leaving the panel — including for a control inside it, which is a
        // leave only in the sense that the pointer moved — starts the same
        // timer, except while the confirmation is what the pointer went to, and
        // except for a leave the pointer did not actually make (a right-press
        // and its menu).
        onMouseLeave={(event) => {
          if (insideBox(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)) return
          scheduleClose(dismiss)
        }}
      >
        <div className="os_head">
          <AtomIcon size={14} />
          <span className="os_title">{t('manageOpenSpec')}</span>
          {view === undefined ? null : (
            <span className="os_chip" data-ready={view.initialized ? 'true' : 'false'}>
              {view.initialized ? t('openSpecStatusReady') : t('openSpecStatusAbsent')}
            </span>
          )}
          <button
            className="os_refresh"
            type="button"
            aria-label={t('openSpecRefresh')}
            title={t('openSpecRefresh')}
            disabled={reading}
            onClick={() => void load()}
          >
            {reading ? <LoaderIcon className="mm_statusSpin" size={13} /> : <RefreshIcon size={13} />}
          </button>
        </div>
        {body}
        <div className="os_foot">
          {canInit ? (
            <button
              className="mm_btn primary os_init"
              type="button"
              // The command the click runs, shown rather than described: the
              // tool it configures (`--tools agents`) is the whole question, and
              // a translation of it would be a translation of a command line.
              title={t('openSpecInitCommand')}
              disabled={initing}
              data-pending={initing ? 'true' : undefined}
              aria-busy={initing}
              onClick={initialize}
            >
              {t('openSpecInit')}
            </button>
          ) : null}
          {canRemove ? (
            <button
              className="mm_btn danger os_remove"
              type="button"
              disabled={busy}
              onClick={() => setAsking(true)}
            >
              {t('openSpecRemove')}
            </button>
          ) : null}
        </div>
      </div>
    )

    const details = view === undefined
      ? undefined
      : (
        <div className="os_confirm">
          {confirmRows(view).flatMap(row => [
            <span className="os_confirmLabel" key={`${row.label}-${row.hint}-label`}>{row.label}</span>,
            <span className="os_confirmValue" key={`${row.label}-${row.hint}-value`} title={row.hint}>
              {row.value}
            </span>,
          ])}
        </div>
      )

    const dialog = asking
      ? (
        <ConfirmDialog
          title={t('openSpecRemove')}
          body={t('openSpecConfirm')}
          busy={busy}
          {...(details === undefined ? {} : { details })}
          {...(removeError === '' ? {} : { error: removeError })}
          onCancel={() => { if (!busy) setAsking(false) }}
          onConfirm={confirm}
        />
      )
      : null

    // Both floating layers are portaled to the body: the header is a shallow
    // strip inside the app frame's own stacking and clipping layers, and a
    // fixed box rendered from there would ride those ancestors. Without
    // react-dom they still render inline — cramped, never broken.
    const portal = (node: JSX.Element): unknown =>
      createPortal && typeof document !== 'undefined' ? createPortal(node, document.body) : node
    const floating = open && anchor !== null ? portal(panel) : null
    const overlay = dialog === null ? null : portal(dialog)

    return (
      <span
        className="os_host"
        onMouseEnter={(event) => show(event.currentTarget)}
        // Keyboard focus opens it too: a control whose only affordance is a
        // hover would be unusable from the keyboard.
        onFocus={(event) => show(event.currentTarget)}
        onBlur={(event) => {
          // Keyboard focus moving to another control is a walk away.
          //
          // Focus landing on nothing in particular is not: a press on a part of
          // the panel that cannot be focused — its text, the tree, a chip —
          // moves focus to `null` or to the document body, because that is where
          // a press on a non-focusable area puts it, and reading the panel is
          // the last thing that should dismiss it. The press is what decides
          // instead: the document's own `pointerdown` closes the panel for a
          // press outside it, and leaves a press inside it alone. Focus moving
          // into the panel's own buttons is not a walk away either, since they
          // live in a portaled subtree this host does not contain.
          const next = event.relatedTarget as Element | null
          if (next === null || (typeof document !== 'undefined' && next === document.body)) return
          if (next.closest(`.${PANEL_CLASS}`) !== null || event.currentTarget.contains(next)) return
          close()
        }}
        onMouseLeave={(event) => {
          if (anchor === null) return
          // A right-press on the control itself: the menu is the browser's, the
          // pointer never moved, and the coordinates are still inside the box.
          if (insideBox(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)) return
          // The gap between the control and the panel is not part of the host,
          // so crossing it fires this leave as well. Whether this is a crossing
          // or a departure is not decided here — no geometry can tell the two
          // apart for a diagonal move — but by the grace period: reaching the
          // panel (or coming back) cancels it, and nothing cancels it otherwise.
          if (!open) return
          scheduleClose(close)
        }}
      >
        <button
          className="mm_iconBtn os_btn"
          type="button"
          aria-label={t('manageOpenSpec')}
          aria-expanded={open}
          data-open={open ? 'true' : undefined}
          // Opening is idempotent, and closing is deliberately not this
          // button's job: hover has already opened the panel by the time a
          // mouse gets here, so a toggle would make the click that follows a
          // hover dismiss what the user is looking at — and on a touch screen,
          // where focus and click both arrive, it would open and immediately
          // close. Dismissal is the pointer leaving, Escape, or a press
          // anywhere else.
          onClick={(event) => show((event as JSX.AnchorEventLike).currentTarget)}
        >
          {reading && view === undefined
            ? <LoaderIcon className="mm_statusSpin" size={15} />
            : <AtomIcon size={15} />}
        </button>
        {floating}
        {overlay}
      </span>
    )
  }
}
