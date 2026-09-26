/**
 * English dictionary for the `notify` locale namespace — the notify tab's
 * copy, mirroring the zh dictionary key for key.
 */

import type { LocaleDict } from '../../../platform/types'

export const NOTIFY_LOCALE_EN: LocaleDict = {
  intro:
    'When a dsh task finishes, fails, or needs your confirmation or an answer, a Windows toast pops from the machine dsh runs on, with a sound. A focused page is never interrupted; a closed browser or page is not a gap — the toast comes from the dsh process itself, not from the web page.',
  enabledTitle: 'Desktop notifications',
  enabledHelp: 'When off, no toast pops and no sound plays.',
  soundTitle: 'Notification sound',
  soundHelp: 'Plays a chime with each toast — the same sound ZCode uses; off keeps toasts silent.',
  durationTitle: 'Display duration',
  durationHelp:
    'How long the toast stays in the bottom-right corner before it moves into the notification center; "persistent" keeps it on screen until you dismiss it.',
  durationShort: 'Standard (about 5 s)',
  durationLong: 'Long (about 25 s)',
  durationReminder: 'Persistent, until dismissed',
  on: 'On',
  off: 'Off',
  testButton: 'Send a test notification',
  testDone: 'Sent — check the bottom-right corner of your screen.',
  testFailed: 'Test notification failed ({status}).',
  saveFailed: 'Save failed ({status}).',
  note:
    'Windows only; clicking a toast opens the dsh page. Focus Assist or Do Not Disturb can swallow toasts at the system level.',
}
