/**
 * The Session-header control that deletes the current session for good.
 *
 * Mounted into DSH's `conversation.session.header.utilities` slot, so it sits
 * with the header's own right-aligned utilities on the current session only —
 * there is no "delete some other row" state to keep consistent.
 *
 * The control asks before acting (a session's transcript is not something to
 * remove on a misclick) and reports a refusal *inside* the dialog, because by
 * the time the answer arrives there is no row left to carry an error: a
 * successful delete takes the whole header with it.
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
 *   a workspace again (see {@link SessionDeleteProps.workspaceId} below).
 */

import { createTrashIcon } from './icons/TrashIcon'
import { createConfirmDialog } from './ui/ConfirmDialog'
import { useAsyncAction } from './ui/useAsyncAction'
import type {
  ClientContext,
  ClientDeps,
  SessionListSelector,
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

export function createSessionDeleteButton(
  deps: ClientDeps,
  ctx: ClientContext,
): (props: SessionDeleteProps) => JSX.Element {
  const { h, react, api, createPortal } = deps
  const ConfirmDialog = createConfirmDialog(deps)
  const TrashIcon = createTrashIcon(deps)

  return function SessionDeleteButton({
    sessionId,
    t,
    useSessions,
    useWorkspaces,
  }: SessionDeleteProps): JSX.Element {
    const [asking, setAsking] = react.useState(false)
    const { busy, error, setError, run } = useAsyncAction(react)
    // Both hooks run on every render (never conditionally): they are ordinary
    // store subscriptions whose order must stay stable across renders.
    const cwd = useSessions(state => state.byId[sessionId]?.cwd)
    const workspaceId = useWorkspaces(state =>
      state.items.find(item => item.sessionIds.includes(sessionId))?.workspaceId)

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
        if (!result.ok) {
          const localized = typeof result.body.code === 'string'
            ? REFUSAL_KEYS[result.body.code]
            : undefined
          if (localized !== undefined) return t(localized)
          return typeof result.body.error === 'string' && result.body.error !== ''
            ? result.body.error
            : t('deleteSessionFailed', { status: result.status })
        }
        setAsking(false)
        await startInDeletedWorkspace()
      })
    }

    const dialog = asking
      ? (
        <ConfirmDialog
          t={t}
          title={t('deleteSession')}
          body={t('confirmSessionDelete')}
          busy={busy}
          {...(error === '' ? {} : { error })}
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

    return (
      <span className="mm_sessionDeleteHost">
        <button
          className="mm_sessionDelete"
          type="button"
          title={t('deleteSession')}
          aria-label={t('deleteSession')}
          disabled={busy}
          onClick={() => { setError(''); setAsking(true) }}
        >
          <TrashIcon size={15} />
        </button>
        {overlay}
      </span>
    )
  }
}
