/**
 * The notification decision logic, kept free of I/O so the tests can drive it
 * with a fake clock: what the host bus says, mapped onto what should toast.
 *
 * The rules are ZCode's, deliberately:
 *
 * - **Edges only.** A session's first sighting is a baseline, not an event —
 *   a plugin that mounts mid-run must not toast for history. A completion is
 *   the edge `running: true → false`; a start is never announced.
 * - **A failure speaks for its run.** After `api-session/error`, the
 *   `status → false` that follows is quiet for a short window — the failure
 *   toast already fired, and "任务已完成" behind it would be a lie.
 * - **Dedupe window.** One notification per `kind:target` key inside 3
 *   seconds, pruning expired keys as decisions arrive. Approvals and
 *   questions dedupe on their interaction identity (tool, or the caller's
 *   stable question id), so a burst of *different* prompts still gets its
 *   toast each — the property ZCode's requestId keying buys.
 * - **No aggregation.** Five sessions finishing together toast five times,
 *   once each. There is no counter toast to wait for.
 * - **Focus suppression** is the only quiet condition: the web page's
 *   heartbeat says "focused" and the heartbeat is fresh. There is no other
 *   notion of "user is away" — a browser that is open-but-blurred, minimised
 *   or closed entirely all count as away, which is the point.
 *
 * Subagent sessions are tracked and skipped for completions and failures:
 * they are machinery of a parent run, not a task the user is waiting on.
 * Approvals and questions always announce — they block the run until the
 * user answers, wherever the agent sits.
 */

import {
  ERROR_COMPLETED_GAP_MS,
  FOCUSED_HEARTBEAT_FRESH_MS,
  MAX_TRACKED_SESSIONS,
  NOTIFY_DEDUPE_WINDOW_MS,
  TOAST_BODY_MAX_CHARS,
} from './constants.js'
import type { HeartbeatState, NotifyDecision } from './types.js'

/** The slice of `SessionSummary` (from `api-session/added`) this reads.
 * Everything is optional: the harness projects the summary, and the
 * orchestrator validates what it got rather than trusting the shape. */
export interface SessionAddedSummaryLike {
  sessionId?: string
  cwd?: string
  origin?: 'subagent'
}

/** The slice of the approval waterfall's payload this reads. */
export interface ApprovalRequestLike {
  agent?: { id?: string }
  toolName?: string
  reason?: string
}

/** The slice of the user-questions waterfall's payload this reads. */
export interface UserQuestionsRequestLike {
  agent?: { id?: string }
  questions?: Array<{ id?: string; question?: string; intent?: { kind?: string } }>
}

/** How the orchestrator is constructed; every input is optional. */
export interface NotifyOrchestratorOptions {
  /** Clock, overridable in tests. Defaults to `Date.now`. */
  now?: () => number
}

/** What a session's tracking row carries. */
interface SessionMeta {
  lastRunning?: boolean
  erroredAt?: number
  cwd?: string
  subagent?: boolean
}

/** The pure decision surface the host half drives. */
export interface NotifyOrchestrator {
  observeSessionAdded(summary: SessionAddedSummaryLike): void
  observeSessionRemoved(sessionId: string): void
  observeStatus(sessionId: string, running: boolean): NotifyDecision | null
  observeError(sessionId: string, message: string): NotifyDecision | null
  observeApproval(request: ApprovalRequestLike): NotifyDecision | null
  observeQuestion(request: UserQuestionsRequestLike): NotifyDecision | null
  touchHeartbeat(state: HeartbeatState): void
  isSuppressed(): boolean
}

/**
 * Longest prefix of a path that still reads as a workspace name in a toast:
 * the basename, nothing more. (A plain split — the name is presentation, not
 * identity, and the host does not stat the path.)
 */
function workspaceNameOf(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}

/** Clamp a body line to what a toast can carry whole. */
function clamp(text: string): string {
  const trimmed = text.trim()
  return trimmed.length <= TOAST_BODY_MAX_CHARS ? trimmed : `${trimmed.slice(0, TOAST_BODY_MAX_CHARS)}…`
}

/** Presentation copy. ZCode's zh-CN wording, kept verbatim where it exists. */
const TITLES = {
  completed: '任务已完成',
  failed: '任务出错',
  permission: '需要你的确认',
  elicitation: '需要你的回复',
} as const
const PLAN_REVIEW_TITLE = '计划等待确认'
const PLAN_REVIEW_BODY = '请确认计划后继续执行'

export function createNotifyOrchestrator(options: NotifyOrchestratorOptions = {}): NotifyOrchestrator {
  const now = options.now ?? Date.now
  const sessions = new Map<string, SessionMeta>()
  const lastNotified = new Map<string, number>()
  let focusState: HeartbeatState | null = null
  let focusAt = 0

  /** Evict the oldest session row past the cap: maps stay bounded, and an
   * evicted session re-baselines on its next event, like a first sighting. */
  function evictIfNeeded(): void {
    if (sessions.size <= MAX_TRACKED_SESSIONS) return
    const oldest = sessions.keys().next().value
    if (oldest !== undefined) sessions.delete(oldest)
  }

  function rowOf(sessionId: string): SessionMeta {
    let row = sessions.get(sessionId)
    if (row === undefined) {
      row = {}
      sessions.set(sessionId, row)
      evictIfNeeded()
    }
    return row
  }

  function dedupe(key: string): boolean {
    const at = now()
    for (const [k, t] of lastNotified) {
      if (at - t >= NOTIFY_DEDUPE_WINDOW_MS) lastNotified.delete(k)
    }
    const previous = lastNotified.get(key)
    lastNotified.set(key, at)
    return previous === undefined
  }

  function decisionOf(
    key: string,
    kind: keyof typeof TITLES,
    body?: string,
  ): NotifyDecision | null {
    if (!dedupe(key)) return null
    return body === undefined
      ? { kind, title: TITLES[kind], dedupeKey: key }
      : { kind, title: TITLES[kind], body, dedupeKey: key }
  }

  return {
    observeSessionAdded(summary: SessionAddedSummaryLike): void {
      if (typeof summary?.sessionId !== 'string' || summary.sessionId === '') return
      const row = rowOf(summary.sessionId)
      row.cwd = typeof summary.cwd === 'string' && summary.cwd !== '' ? summary.cwd : row.cwd
      row.subagent = summary.origin === 'subagent' ? true : row.subagent
    },

    observeSessionRemoved(sessionId: string): void {
      sessions.delete(sessionId)
    },

    observeStatus(sessionId: string, running: boolean): NotifyDecision | null {
      if (typeof sessionId !== 'string' || sessionId === '' || typeof running !== 'boolean') return null
      const row = rowOf(sessionId)
      const previous = row.lastRunning
      row.lastRunning = running
      // First sighting is a baseline; no edge, no toast.
      if (previous === undefined || previous === running) return null
      // Only the run→idle edge announces.
      if (running) return null
      // A run that just errored is already accounted for.
      const erroredAt = row.erroredAt
      row.erroredAt = undefined
      if (erroredAt !== undefined && now() - erroredAt < ERROR_COMPLETED_GAP_MS) return null
      if (row.subagent) return null
      const body = row.cwd === undefined ? undefined : `工作区：${workspaceNameOf(row.cwd)}`
      return decisionOf(`completed:${sessionId}`, 'completed', body)
    },

    observeError(sessionId: string, message: string): NotifyDecision | null {
      if (typeof sessionId !== 'string' || sessionId === '') return null
      const row = rowOf(sessionId)
      row.erroredAt = now()
      if (row.subagent) return null
      const body = typeof message === 'string' && message.trim() !== '' ? clamp(message) : undefined
      return decisionOf(`failed:${sessionId}`, 'failed', body)
    },

    observeApproval(request: ApprovalRequestLike): NotifyDecision | null {
      const agentId = typeof request?.agent?.id === 'string' ? request.agent.id : ''
      const toolName = typeof request?.toolName === 'string' ? request.toolName : ''
      const body = clamp(
        typeof request?.reason === 'string' && request.reason.trim() !== ''
          ? request.reason
          : toolName === '' ? '工具调用等待确认' : `工具：${toolName}`,
      )
      return decisionOf(`permission_request:${agentId}:${toolName}`, 'permission', body)
    },

    observeQuestion(request: UserQuestionsRequestLike): NotifyDecision | null {
      const agentId = typeof request?.agent?.id === 'string' ? request.agent.id : ''
      const questions = Array.isArray(request?.questions) ? request.questions : []
      const first = questions[0]
      if (first?.intent?.kind === 'plan-review') {
        const key = `elicitation_request:${agentId}:plan-review`
        if (!dedupe(key)) return null
        return { kind: 'elicitation', title: PLAN_REVIEW_TITLE, body: PLAN_REVIEW_BODY, dedupeKey: key }
      }
      const body = clamp(
        typeof first?.question === 'string' && first.question.trim() !== '' ? first.question : '有问题等待你的回答',
      )
      const target = typeof first?.id === 'string' && first.id !== '' ? first.id : 'unknown'
      return decisionOf(`elicitation_request:${agentId}:${target}`, 'elicitation', body)
    },

    touchHeartbeat(state: HeartbeatState): void {
      focusState = state === 'focused' ? 'focused' : 'blurred'
      focusAt = now()
    },

    isSuppressed(): boolean {
      // The page is focused and said so recently enough to believe.
      return focusState === 'focused' && now() - focusAt < FOCUSED_HEARTBEAT_FRESH_MS
    },
  }
}
