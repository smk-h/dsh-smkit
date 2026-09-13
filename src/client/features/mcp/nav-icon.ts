/**
 * The MCP row's glyph in DSH's settings nav.
 *
 * DSH 0.1.x projects only `id`, `order` and `label` out of a
 * `settings.section` registration, then picks each row's glyph inside the
 * settings shell from a closed list of built-in ids: `models`, `plugins` and
 * `agent-presets` have their own, everything else — this section included —
 * gets the fallback gear, and the registration carries no icon field to set.
 *
 * So the plugin marks its own localized row once the dialog has mounted and
 * lets the stylesheet paint the glyph over the shell's (see `MCP_NAV_ICON_CSS`
 * in `../style`). The marker owns no shell structure and is dropped again on
 * disposal, which keeps the adaptation HMR-safe.
 */

/** Marks the nav row this section owns; the stylesheet keys off it. */
export const SETTINGS_NAV_MARKER = 'data-mm-settings-nav'

/**
 * Keep the marker on the settings-nav row whose visible text is this section's
 * current localized label.
 * @param label - Locale-aware label resolver, the same one the section
 * registration hands to the shell.
 * @returns Disposer that stops observing and clears owned markers.
 */
export function markSettingsNavRow(label: () => string): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}

  let disposed = false

  const sync = (): void => {
    if (disposed) return
    const current = label().trim()
    for (const row of document.querySelectorAll('[role="dialog"] nav button')) {
      if (current.length > 0 && row.textContent?.trim() === current) {
        row.setAttribute(SETTINGS_NAV_MARKER, '')
      } else {
        row.removeAttribute(SETTINGS_NAV_MARKER)
      }
    }
  }

  sync()
  // `characterData` too: a locale change rewrites the label text in place.
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  return () => {
    disposed = true
    observer.disconnect()
    for (const marked of document.querySelectorAll(`[${SETTINGS_NAV_MARKER}]`)) {
      marked.removeAttribute(SETTINGS_NAV_MARKER)
    }
  }
}
