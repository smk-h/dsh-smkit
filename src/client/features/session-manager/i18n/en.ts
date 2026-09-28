/**
 * English dictionary for the `session-manager` locale namespace.
 *
 * Key set must stay identical to `zh.ts`.
 */

import type { LocaleDict } from '../../../platform/types'

export const SESSION_MANAGER_LOCALE_EN: LocaleDict = {
  intro: 'Browse dsh sessions by workspace and clean them up in batches. Deletes apply immediately and the sidebar follows; a session\'s history and local data (log, cache, spill files) are removed for good and cannot be recovered.',

  subtabsLabel: 'Session views',
  subtabActive: 'Active ({count})',
  subtabArchived: 'Archived ({count})',

  selectAll: 'Select all',
  selectedSummary: '{count} selected · about {size}',
  deleteSelected: 'Delete selected ({count})',
  refreshFailed: 'Reading the session list failed (HTTP {status})',

  ungrouped: 'Ungrouped',
  ungroupedHint: 'Sessions no workspace claims',
  sessionCount: '{count} sessions',
  groupSelectAll: 'Select all sessions in {name}',
  groupToggle: 'Expand or collapse {name}',

  untitledSession: 'Untitled session',
  badgeRunning: 'Running',

  emptyActive: 'No active sessions.',
  emptyArchived: 'No archived sessions.',
  loadFailed: 'The session list could not be read. Try again shortly.',

  confirmBatchTitle: 'Delete {count} sessions',
  confirmBatchBody: 'The selected sessions\' history and all local data (log, cache, spill files) will be removed for good. This cannot be undone. Sessions that are running or still attached are skipped and reported one by one.',

  batchDone: 'Deleted {deleted} sessions.',
  batchPartial: 'Deleted {deleted}, {failed} not deleted:',
  batchFailed: 'The batch delete failed (HTTP {status})',

  deleteSessionNotFound: 'The session does not exist (or is already gone)',
  deleteSessionRunning: 'The session is running; stop it before deleting',
  deleteSessionAttached: 'The session is attached to this harness and no archive set is mounted to hide it; restart dsh, then delete it',
  deleteSessionSubagent: 'A subagent session cannot be deleted on its own; delete its parent session',
  deleteSessionUnavailable: 'This deployment mounts no session storage, so there is no session data to delete',

  timeYesterday: 'Yesterday',
}
