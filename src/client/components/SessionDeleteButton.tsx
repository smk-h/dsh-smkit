/**
 * The Session-header control that deletes the current session for good.
 *
 * Mounted into DSH's `conversation.session.header.utilities` slot, so it sits
 * with the header's own right-aligned utilities on the current session only —
 * there is no "delete some other row" state to keep consistent.
 *
 * On hover the control names itself in the shell's own bubble (`Tooltip` of the
 * platform's ui-primitives module), the same one DSH's header buttons wear, so
 * the bubble hangs under the button, slides back inside the viewport when the
 * control sits near an edge, and flips above it when the header is low on the
 * page. Where the module table cannot supply it, the browser's `title` bubble
 * stands in.
 *
 * The control asks before acting, and the question carries the answer's facts:
 * clicking fetches the host's *dry run* (`GET /sessions/preview`), which applies
 * the delete's own preconditions and measures the stores it would remove, and
 * only then does the dialog open — already populated. The indirection is
 * deliberate on two counts:
 *
 * - the user sees which session it is, where its data lives and how much of it
 *   there is, and a session that could not be deleted says so before anything
 *   is clicked (the confirm action re-validates on the host anyway: a session
 *   can start running between the two calls);
 * - the dialog is laid out exactly once. Rendering a placeholder first and
 *   swapping the facts in afterwards grows the card by a hundred pixels a frame
 *   after it appears — under a vertically centered overlay that reads as a
 *   flash/jump, not as content arriving.
 *
 * A refusal is reported *inside* the dialog, because by the time the answer
 * arrives there is no row left to carry an error: a successful delete takes the
 * whole header with it.
 *
 * Nothing here reloads anything. Two existing DSH mechanisms do the visible
 * work:
 *
 * - the host archives the session and removes its directory, then publishes
 *   `api-session/removed` on the harness event bus. The browser's session
 *   store drops the sidebar row, the selection masks to "none", and the
 *   conversation shell falls to its new-session view — one incremental
 *   re-render, no page navigation;
 * - the control then starts a fresh session in the workspace the deleted one
 *   lived in, so the user is left ready to type instead of being asked to pick
 *   a workspace again.
 */

import { createLoaderIcon } from './icons/LoaderIcon'
import { createTrashIcon } from './icons/TrashIcon'
import { createConfirmDialog } from './ui/ConfirmDialog'
import { useAsyncAction } from './ui/useAsyncAction'
import type {
  ApiResult,
  ClientContext,
  ClientDeps,
  SessionListSelector,
  SessionPreview,
  SessionStoreFootprint,
  Translator,
  WorkspaceSelector,
} from '../runtime/types'

/** Props the slot framework supplies to a session-scope header entry. */
export interface SessionDeleteProps {
  /** Current session identity (the `sessionId` standard prop). */
  sessionId: string
  /** Translator bound to the `mcp` namespace (the registration declares `locale`). */
  t: Translator
  /**
   * Session-list selector hook (the `useSessions` global standard prop). Read
   * before the delete because the answer is what the replacement session is
   * built from: after a successful delete the row — and its `cwd` — are gone.
   */
  useSessions: SessionListSelector
  /**
   * Workspace selector hook (the `useWorkspaces` global standard prop). The
   * workspace id is the better half of the target: creating a session *in* a
   * workspace accounts it there, so the sidebar keeps the same group.
   */
  useWorkspaces: WorkspaceSelector
}

/**
 * Localized message per stable host refusal, so a refusal the user can act on
 * ("stop the session first") reads as an instruction instead of the host's
 * English diagnostic. An unknown code falls back to that diagnostic.
 */
const REFUSAL_KEYS: Record<string, string | undefined> = {
  'session/not-found': 'deleteSessionNotFound',
  'session/running': 'deleteSessionRunning',
  'session/attached': 'deleteSessionAttached',
  'session/subagent': 'deleteSessionSubagent',
  'session/unavailable': 'deleteSessionUnavailable',
}

/** What the dialog knows about the session when it opens. */
interface PreviewState {
  /** The host's dry run, absent when the read failed or was refused. */
  preview?: SessionPreview
  /** Message to show instead of the facts. */
  message?: string
  /**
   * Whether that message is a refusal the delete would hit too. Only then is
   * the confirm action locked: a read that merely failed must not block a
   * delete the host might well accept.
   */
  blocked: boolean
}

/** One rendered row of the dialog's fact block. */
interface InfoRow {
  label: string
  value: string
  /** Full text for the `title` bubble when `value` is elided or partial. */
  hint?: string
}

export function createSessionDeleteButton(
  deps: ClientDeps,
  ctx: ClientContext,
): (props: SessionDeleteProps) => JSX.Element {
  const { h, react, api, createPortal, Tooltip } = deps
  const ConfirmDialog = createConfirmDialog(deps)
  const TrashIcon = createTrashIcon(deps)
  const LoaderIcon = createLoaderIcon(deps)

  return function SessionDeleteButton({
    sessionId,
    t,
    useSessions,
    useWorkspaces,
  }: SessionDeleteProps): JSX.Element {
    const [asking, setAsking] = react.useState(false)
    // Undefined until the dry run answers: the dialog is not rendered before
    // that, so its first frame is also its final layout.
    const [facts, setFacts] = react.useState<PreviewState | undefined>(undefined)
    const { busy, error, run } = useAsyncAction(react)
    // All three hooks run on every render (never conditionally): they are
    // ordinary store subscriptions whose order must stay stable across renders.
    const cwd = useSessions(state => state.byId[sessionId]?.cwd)
    const title = useSessions(state => state.byId[sessionId]?.title)
    const workspaceId = useWorkspaces(state =>
      state.items.find(item => item.sessionIds.includes(sessionId))?.workspaceId)

    /** The host's message for one refused or failed call, localized when the code is known. */
    const messageFor = (result: ApiResult, fallbackKey: string): string => {
      const localized = typeof result.body.code === 'string' ? REFUSAL_KEYS[result.body.code] : undefined
      if (localized !== undefined) return t(localized)
      return typeof result.body.error === 'string' && result.body.error !== ''
        ? result.body.error
        : t(fallbackKey, { status: result.status })
    }

    /** Ask the host what this delete would remove, and whether it would be allowed at all. */
    const readPreview = async (): Promise<PreviewState> => {
      let result: ApiResult
      try {
        result = await api(`/sessions/preview?sessionId=${encodeURIComponent(sessionId)}`)
      } catch {
        // The dry run is advisory: without it the delete still re-validates.
        return { message: t('sessionInfoFailed'), blocked: false }
      }
      if (result.ok) return { preview: result.body as SessionPreview, blocked: false }
      return {
        message: messageFor(result, 'sessionInfoFailed'),
        blocked: typeof result.body.code === 'string' && result.body.code in REFUSAL_KEYS,
      }
    }

    const openDialog = (): void => {
      void run(async () => {
        setFacts(await readPreview())
        setAsking(true)
      })
    }

    /**
     * Start the next session the way DSH's own New Session does: in the
     * workspace the user was already working in. `ui-workspace`'s
     * `startSession` derives that workspace from the current session, but the
     * deleted session is no longer current by the time this runs, so its
     * identity is captured above and named explicitly.
     */
    const startInDeletedWorkspace = async (): Promise<void> => {
      const sessions = ctx.sessions
      if (sessions === undefined) return
      try {
        if (workspaceId === undefined && cwd === undefined) {
          // Nothing to reuse (an ungrouped session without a directory): the
          // no-session state is the honest destination, and its workspace
          // picker is the same first step a fresh harness starts from.
          sessions.clear()
        } else {
          const created = await sessions.create(
            workspaceId !== undefined ? { workspaceId } : { cwd },
          )
          sessions.open(created)
        }
      } catch {
        // The workspace vanished, or the Host refused the create: never leave
        // the deleted session selected — fall back to the empty state.
        sessions.clear()
      }
      void sessions.refresh().catch(() => {})
    }

    const confirm = (): void => {
      void run(async () => {
        const result = await api('/sessions/delete', {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        })
        if (!result.ok) return messageFor(result, 'deleteSessionFailed')
        setAsking(false)
        await startInDeletedWorkspace()
      })
    }

    /** The stores the delete would remove, as one label/value row each. */
    const footprintRow = (label: string, footprint: SessionStoreFootprint, withPath: boolean): InfoRow => {
      const size = formatBytes(footprint.bytes)
      const files = t('sessionInfoFiles', { count: footprint.files })
      return withPath
        ? { label, value: `${footprint.path} · ${size} · ${files}`, hint: footprint.path }
        : { label, value: `${size} · ${files}`, hint: footprint.path }
    }

    const infoRows = (preview: SessionPreview): InfoRow[] => {
      const rows: InfoRow[] = []
      // Identity first: the id is what every other surface (and the logs) uses.
      rows.push({ label: t('sessionInfoId'), value: sessionId })
      if (typeof title === 'string' && title !== '') rows.push({ label: t('sessionInfoTitle'), value: title })
      if (typeof preview.cwd === 'string') {
        rows.push({ label: t('sessionInfoCwd'), value: preview.cwd, hint: preview.cwd })
      }
      if (typeof preview.createdAt === 'number') {
        rows.push({ label: t('sessionInfoCreated'), value: new Date(preview.createdAt).toLocaleString() })
      }
      if (preview.log !== undefined) rows.push(footprintRow(t('sessionInfoLog'), preview.log, true))
      if (preview.cache !== undefined) rows.push(footprintRow(t('sessionInfoCache'), preview.cache, false))
      if (preview.spill !== undefined) rows.push(footprintRow(t('sessionInfoSpill'), preview.spill, false))
      rows.push({ label: t('sessionInfoTotal'), value: formatBytes(preview.totalBytes) })
      return rows
    }

    // The facts block, or nothing when the dry run had no numbers to give: the
    // host's refusal text then travels in the dialog's own error slot, which is
    // where every other delete dialog of this plugin reports "cannot do that".
    const measured = facts === undefined ? undefined : facts.preview
    const details = measured === undefined
      ? undefined
      : (
        // A flat label/value stream laid out as a two-column grid: the rows need
        // no wrapper, and the value column takes the remaining width.
        <div className="mm_sessionInfo">
          {infoRows(measured).flatMap(row => [
            <span className="mm_sessionInfoLabel" key={`${row.label}-label`}>{row.label}</span>,
            <span className="mm_sessionInfoValue" key={`${row.label}-value`} title={row.hint}>{row.value}</span>,
          ])}
        </div>
      )
    const refusal = facts === undefined ? undefined : facts.message
    const failure = refusal ?? (error === '' ? undefined : error)

    const dialog = asking
      ? (
        <ConfirmDialog
          t={t}
          title={t('deleteSession')}
          body={t('confirmSessionDelete')}
          busy={busy}
          details={details}
          confirmDisabled={facts?.blocked === true}
          {...(failure === undefined ? {} : { error: failure })}
          onCancel={() => { if (!busy) setAsking(false) }}
          onConfirm={confirm}
        />
      )
      : null

    // The dialog is portaled to the body: the header is a shallow strip inside
    // the app frame's own stacking and clipping layers, and a fixed overlay
    // rendered from there would ride those ancestors. Without react-dom the
    // dialog still renders inline — cramped, never broken.
    const overlay = dialog === null
      ? null
      : createPortal && typeof document !== 'undefined'
        ? createPortal(dialog, document.body)
        : dialog

    const anchor = (
      <button
        className="mm_sessionDelete"
        type="button"
        // The shell's bubble replaces the browser's: keeping `title` as well
        // would stack a native tooltip underneath the styled one.
        title={Tooltip === undefined ? t('deleteSession') : undefined}
        aria-label={t('deleteSession')}
        disabled={busy}
        onClick={openDialog}
      >
        {/* Busy covers both waits: reading the dry run (the dialog has not
         * opened yet, so this arc is the only feedback) and the delete itself
         * once the dialog is up. */}
        {busy
          ? <LoaderIcon className="mm_statusSpin" size={15} />
          : <TrashIcon size={15} />}
      </button>
    )

    return (
      <span className="mm_sessionDeleteHost">
        {/* The bubble clones this one anchor and adds a fixed-position sibling
         * of its own, so the button stays exactly the control it is. `bottom`
         * plus the shell's 500ms hover delay is what DSH's own header buttons
         * use; the edge handling rides along with the component. */}
        {Tooltip === undefined
          ? anchor
          : (
            <Tooltip label={t('deleteSession')} side="bottom" delayMs={500}>
              {anchor}
            </Tooltip>
          )}
        {overlay}
      </span>
    )
  }
}

/**
 * Format a byte count for a dialog row: whole bytes below 1 KiB, then one
 * decimal up to 10 units and whole units above, so a row of figures stays
 * scannable. Not localized on purpose — the units (`KB`/`MB`/`GB`) read the
 * same in both dictionaries, and `t` carries the surrounding copy.
 * @param bytes - the measured size.
 * @returns the display string.
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
