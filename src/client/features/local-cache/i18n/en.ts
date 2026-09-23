/**
 * English dictionary for the `local-cache` locale namespace.
 *
 * Key set must stay identical to `zh.ts` (the language test enforces it).
 */

import type { LocaleDict } from '../../../platform/types'

export const LOCAL_CACHE_LOCALE_EN: LocaleDict = {
  intro:
    "dsh records this browser's share of the interface state: how the sidebar's workspaces expand and order, each page's view preferences, and input drafts that were never sent. After dsh changes version, what the old version recorded can disagree with the new one — at worst a whole region of the interface (the workspace and session list on the left, for instance) renders blank.",
  scope:
    "Clearing removes every entry dsh recorded for this address and reloads the page. This plugin's own settings (skins, language) stay put.",
  action: 'Clear and reload',
  resultCleared: 'Cleared {count} items — reloading…',
  resultEmpty: 'Nothing to clear.',
  resultDenied:
    'The browser refused the page access to local storage (private mode?); nothing was cleared.',
}
