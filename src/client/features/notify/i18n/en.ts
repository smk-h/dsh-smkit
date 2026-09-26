/**
 * English dictionary for the `notify` locale namespace — the notify tab's
 * copy, mirroring the zh dictionary key for key.
 */

import type { LocaleDict } from '../../../platform/types'

export const NOTIFY_LOCALE_EN: LocaleDict = {
  intro:
    'When a dsh task finishes, fails, or needs your confirmation or an answer, a notification pops with a sound; a focused page is never interrupted.',
  enabledTitle: 'Desktop notifications',
  enabledHelp: 'When off, no toast pops and no sound plays.',
  soundTitle: 'Notification sound',
  soundHelp: 'Plays a chime with each toast — the same sound ZCode uses; off keeps toasts silent.',
  durationTitle: 'Display duration',
  durationHelp:
    'How long the toast stays in the bottom-right corner before it moves into the notification center; "persistent" keeps it on screen until you dismiss it. Only the Windows system toast honors it; the browser controls its own timing.',
  durationShort: 'Standard (about 5 s)',
  durationLong: 'Long (about 25 s)',
  durationReminder: 'Persistent, until dismissed',
  webNotifTitle: 'Browser notifications',
  webNotifHelp:
    'Keep this page open and grant permission: the browser shows the notification and a click focuses this tab instead of opening a new one. With dsh on a remote host this is the only delivery path — a closed page receives nothing.',
  webNotifEnable: 'Grant permission',
  webNotifGranted: 'Granted',
  webNotifDenied: 'Denied — re-allow notifications in the browser site settings',
  webNotifUnsupported: 'Not available here; open dsh via localhost or https',
  webNotifFailed: 'Permission request failed.',
  on: 'On',
  off: 'Off',
  testButton: 'Send a test notification',
  testDone: 'Sent — check the bottom-right corner of your screen.',
  testFailed: 'Test notification failed ({status}).',
  saveFailed: 'Save failed ({status}).',
  note:
    'On Windows, when no page is open the dsh process raises a system toast as a fallback, and clicking it opens a new dsh tab; Focus Assist or Do Not Disturb can swallow system toasts.',
}
