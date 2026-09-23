/**
 * Adapting a settings-nav row to a section's own glyph.
 *
 * DSH 0.1.x projects only `id`, `order` and `label` out of a
 * `settings.section` registration, then picks each row's glyph inside the
 * settings shell from a closed list of built-in ids: `models`, `plugins` and
 * `agent-presets` have their own, everything else — this plugin's sections
 * included — gets the fallback gear, and the registration carries no icon
 * field to set.
 *
 * So a section that draws its own glyph marks its row once the dialog has
 * mounted and lets a stylesheet paint over the shell's (`style/settings-nav.css`
 * hides the fallback, the section's own sheet supplies the mask). The marker
 * owns no shell structure and is dropped again on disposal, which keeps the
 * adaptation HMR-safe.
 *
 * Every section that wants its own glyph does this, which is why the
 * adaptation lives here rather than in a caller: a feature may not import
 * another feature, and a second copy of this observer is exactly the copy the
 * architecture guard exists to catch. Nothing below knows a section — the
 * caller passes the row's label and the name that stands for it.
 */

/** Attribute a marked row carries; its value is the owning section's name. */
export const SETTINGS_NAV_ATTRIBUTE = 'data-dsh-smkit-nav'

/**
 * Keep the marker on the settings-nav row whose visible text is `label()`.
 * @param owner - the section's own name, written as the marker's value.
 * @param label - Locale-aware label resolver, the same one the section
 * registration hands to the shell.
 * @returns Disposer that stops observing and clears the rows it marked.
 */
export function markSettingsNavRow(owner: string, label: () => string): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}

  let disposed = false

  const sync = (): void => {
    if (disposed) return
    const current = label().trim()
    for (const row of document.querySelectorAll('[role="dialog"] nav button')) {
      if (current.length > 0 && row.textContent?.trim() === current) {
        row.setAttribute(SETTINGS_NAV_ATTRIBUTE, owner)
      } else if (row.getAttribute(SETTINGS_NAV_ATTRIBUTE) === owner) {
        // Only the rows this section marked: another section's row carries the
        // same attribute with its own value and is none of this observer's
        // business, which is what lets one attribute serve every section.
        row.removeAttribute(SETTINGS_NAV_ATTRIBUTE)
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
    for (const marked of document.querySelectorAll(`[${SETTINGS_NAV_ATTRIBUTE}="${owner}"]`)) {
      marked.removeAttribute(SETTINGS_NAV_ATTRIBUTE)
    }
  }
}
