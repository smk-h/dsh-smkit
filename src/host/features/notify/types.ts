/**
 * Types of the notify feature, shared between its host modules and its routes.
 */

import type { NotifyDuration } from '../../../shared/notify/contract.js'

export type { NotifyDuration }

/** What a notification announces. The four kinds are ZCode's own set. */
export type NotifyKind = 'completed' | 'failed' | 'permission' | 'elicitation'

/**
 * One ready-to-show notification, produced by the orchestrator after its edge
 * and dedupe rules have passed. `body` is optional: a completion with no
 * workspace name behind it shows the title alone rather than padding itself.
 */
export interface NotifyDecision {
  kind: NotifyKind
  /** Toast title, already in presentation copy. */
  title: string
  /** Toast body, already in presentation copy; omitted when there is none. */
  body?: string
  /**
   * The dedupe key the decision would notify under — `${kind}:${target}`,
   * where the target is the session id for completions and failures and the
   * interaction identity for approvals and questions. The dispatcher runs the
   * window check against it before showing anything.
   */
  dedupeKey: string
}

/**
 * The feature's settings, as the settings file and the routes carry them.
 * `duration` picks how long the toast stays on screen (see the shared
 * contract for the three values and their Windows-side meaning).
 */
export interface NotifySettings {
  /** Master switch: false stops toasts and sound both, like ZCode's. */
  enabled: boolean
  /** Sound sub-switch: effective only while `enabled` is also true. */
  soundEnabled: boolean
  /** Toast display duration: `short` (default), `long`, or `reminder`. */
  duration: NotifyDuration
}

/**
 * The heartbeat state the web page reports: `focused` while `document.
 * hasFocus()` is true (renewed on a timer), `blurred` the moment focus
 * leaves. Suppression mirrors ZCode's one check — an app window is focused —
 * which for dsh is "the web page has focus".
 */
export type HeartbeatState = 'focused' | 'blurred'
