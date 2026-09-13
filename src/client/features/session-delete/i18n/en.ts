/**
 * English dictionary for the `session-delete` locale namespace.
 *
 * Key set must stay identical to `zh.ts`.
 */

import type { LocaleDict } from '../../../platform/types'

export const SESSION_DELETE_LOCALE_EN: LocaleDict = {
  "deleteSession": "Delete session",
  "confirmSessionDelete": "This permanently deletes the session's history and all of its stored data, including its log file. It cannot be undone.",
  "sessionInfoId": "Session ID",
  "sessionInfoTitle": "Title",
  "sessionInfoCwd": "Working directory",
  "sessionInfoCreated": "Created",
  "sessionInfoLog": "Stored at",
  "sessionInfoCache": "Projection cache",
  "sessionInfoSpill": "Spilled files",
  "sessionInfoTotal": "Total",
  "sessionInfoFiles": "{count} files",
  "sessionInfoFailed": "Reading session details failed (HTTP {status})",
  "deleteSessionFailed": "Delete session failed (HTTP {status})",
  "deleteSessionNotFound": "The session no longer exists",
  "deleteSessionRunning": "The session is running; stop it before deleting",
  "deleteSessionAttached": "The session is still attached to the harness and this deployment mounts no archive set to hide it; restart dsh and delete it again",
  "deleteSessionSubagent": "A subagent session cannot be deleted on its own; delete the session that owns it",
  "deleteSessionUnavailable": "This deployment mounts no session store, so session data cannot be deleted",
}
