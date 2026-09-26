/**
 * English dictionary for the `local-cache` locale namespace.
 *
 * Covers the intro pair, the preview table's column heads and per-key
 * descriptions, and the button's three answers.
 *
 * Key set must stay identical to `zh.ts` (the language test enforces it).
 */

import type { LocaleDict } from '../../../platform/types'

export const LOCAL_CACHE_LOCALE_EN: LocaleDict = {
  intro:
    "dsh records this browser's share of the interface state: how the sidebar's workspaces expand and order, each page's view preferences, and input drafts that were never sent. After dsh changes version, what the old version recorded can disagree with the new one — at worst a whole region of the interface (the workspace and session list on the left, for instance) renders blank.",
  scope:
    'The cards tagged "Will clear" above are the whole of what clearing removes — only keys starting with dsh. This plugin\'s own settings (smkit: — theme, palette colors, language) and every other entry on the site stay put. The page reloads when clearing finishes.',
  catSessionState: 'dsh session state',
  catSessionStateDesc: 'Per-conversation drafts and view records; clearing loses the drafts.',
  catCurrentSession: 'dsh current session',
  catCurrentSessionDesc: 'Which conversation is open; clearing falls back to the default.',
  catWorkspaceView: 'dsh sidebar view preferences',
  catWorkspaceViewDesc: 'Sidebar grouping, ordering and expansion; clearing resets the layout.',
  catDshOther: 'other dsh entries',
  catDshOtherDesc: 'Other entries dsh recorded; cleared all the same.',
  catSmkit: 'This plugin\'s settings',
  catSmkitDesc: 'Theme, palette colors, language — clearing never touches these.',
  catOther: 'Other data',
  catOtherDesc: 'Everything else on this address; clearing never touches it.',
  itemCount: '{count} items',
  tagClean: 'Will clear',
  tagKeep: 'Kept',
  colKey: 'Key / value',
  colDesc: 'What it stores',
  descCurrentSession:
    'The session currently open. After clearing, the sidebar falls back to its default pick.',
  descSessionState:
    'One per conversation: the unsent input draft, the view you left it on, and any pending view request.',
  descWorkspaceView:
    "Sidebar view preferences: grouping, ordering, expansion. The key is versioned (v5 today); a new dsh may fail to read an old shape — the main thing this page exists to clear.",
  descOther: 'Other local state dsh recorded.',
  descSmkitTheme: "The theme id the theme center currently has applied.",
  descSmkitMode: "The theme center's display-mode choice (auto / light / dark).",
  descSmkitColors: 'The color overrides saved from the palette.',
  descSmkitOther: "Other settings this plugin recorded.",
  descSiteOther: 'Data that is neither dsh\'s nor this plugin\'s; clearing never touches it.',
  tableEmpty: 'Nothing recorded at all right now.',
  tableDenied:
    'The browser refused the page access to local storage (private mode?); the list cannot be read.',
  action: 'Clear and reload',
  resultCleared: 'Cleared {count} items — reloading…',
  resultEmpty: 'Nothing to clear.',
  resultDenied:
    'The browser refused the page access to local storage (private mode?); nothing was cleared.',
}
