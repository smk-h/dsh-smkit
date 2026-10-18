/**
 * English dictionary for the `plugin-gallery` locale namespace.
 *
 * The intro line and one description per card. A card's name, its repository
 * and its install command are data (`catalog.ts`) — an identifier is not copy
 * — so the one sentence this page owns per plugin is what the plugin is for.
 *
 * Key set must stay identical to `zh.ts` (the language test enforces it), and
 * every key has to match an entry id in `catalog.ts`: the panel asks for
 * `<id>Desc` per card, so a card with no line here reads its own key.
 */

import type { LocaleDict } from '../../../platform/types'

export const PLUGIN_GALLERY_LOCALE_EN: LocaleDict = {
  intro:
    "A shortlist of dsh plugins, one card each: the plugin's name (the link opens its repository) and the single command its own README gives for installing it, with a button beside the command that copies it to the clipboard. Every command installs into the web profile — swap in your own profile name if you run another — and writes that profile's dependencies; restart the profile and hard-refresh the page afterwards. This page only remembers the list: nothing here installs anything for you.",
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  betterSidebarDesc:
    'The sidebar workbench: file preview and editing, a terminal, a side chat, Git and sub-agent pages are built in, and the sidebar itself is a base other plugins register pages onto.',
  sessionsManagerDesc:
    'Session management: one settings page for every active and archived session, with search, stars, tags, batch archive and cross-workspace moves; each sidebar row\'s ⋯ menu also gains mark-unread, move and delete, where delete goes to a trash bin you can restore from or empty after 7/30/90 days.',
}
