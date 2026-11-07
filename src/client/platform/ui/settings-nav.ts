/**
 * Adapting a settings-nav row to a section's own glyph.
 *
 * Hosts before 0.2.2 project only `id`, `order` and `label` out of a
 * `settings.section` registration, then pick each row's glyph inside the
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
 * 0.2.2 and every later release turn that glyph into a first-class seat —
 * `settings.section.icon`, addressed by the section's id — so a section on
 * such a host registers there and needs no marker at all. The marker therefore
 * splits into two questions the caller can answer separately:
 *
 * - *Locating* the row (`SETTINGS_NAV_ATTRIBUTE`): the shell-restore fallback
 *   clicks this row, and it keeps working on every host.
 * - *Painting* the glyph (`SETTINGS_NAV_GLYPH_ATTRIBUTE`): only the hosts
 *   without the icon seat need it. {@link SettingsNavMarker.standDown} drops
 *   the paint while leaving the row locatable, and the release that added the
 *   seat also moved the fallback gear from the row itself into a wrapper span
 *   of the shell's own, which is why the stylesheet hides both shapes.
 *
 * Every section that wants its own glyph does this, which is why the
 * adaptation lives here rather than in a caller: a feature may not import
 * another feature, and a second copy of this observer is exactly the copy the
 * architecture guard exists to catch. Nothing below knows a section — the
 * caller passes the row's label and the name that stands for it.
 */

/** Attribute a marked row carries; its value is the owning section's name.
 * Locates the row (the shell-restore DOM fallback clicks it) and nothing more. */
export const SETTINGS_NAV_ATTRIBUTE = 'data-smkit-nav'

/** Attribute that asks `style/settings-nav.css` to paint the section's glyph
 * over the shell's fallback. Dropped as soon as the host owns the icon. */
export const SETTINGS_NAV_GLYPH_ATTRIBUTE = 'data-smkit-nav-glyph'

/** The handle a marking session keeps on the rows it adapted. */
export interface SettingsNavMarker {
  /** Stop observing and clear every row this marker touched. */
  dispose(): void
  /**
   * Hand the glyph back to the shell — the host has a seat of its own now. The
   * row stays marked for locating; only the paint stops.
   * @returns The undo, which resumes painting (the host lost the seat).
   */
  standDown(): () => void
}

/** A handle that touches nothing: hosts without a DOM to adapt. */
const NO_MARKER: SettingsNavMarker = { dispose: () => {}, standDown: () => () => {} }

/**
 * Keep the marker on the settings-nav row whose visible text is `label()`.
 * @param owner - the section's own name, written as the marker's value.
 * @param label - Locale-aware label resolver, the same one the section
 * registration hands to the shell.
 * @returns The marking session, whose `dispose` clears the rows it marked.
 */
export function markSettingsNavRow(owner: string, label: () => string): SettingsNavMarker {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return NO_MARKER

  let disposed = false
  let painting = true

  const sync = (): void => {
    if (disposed) return
    const current = label().trim()
    for (const row of document.querySelectorAll('[role="dialog"] nav button')) {
      if (current.length > 0 && row.textContent?.trim() === current) {
        row.setAttribute(SETTINGS_NAV_ATTRIBUTE, owner)
        if (painting) row.setAttribute(SETTINGS_NAV_GLYPH_ATTRIBUTE, owner)
        else row.removeAttribute(SETTINGS_NAV_GLYPH_ATTRIBUTE)
        continue
      }
      // Only the rows this section marked: another section's row carries the
      // same attributes with its own value and is none of this observer's
      // business, which is what lets one attribute serve every section.
      if (row.getAttribute(SETTINGS_NAV_ATTRIBUTE) === owner) row.removeAttribute(SETTINGS_NAV_ATTRIBUTE)
      if (row.getAttribute(SETTINGS_NAV_GLYPH_ATTRIBUTE) === owner) {
        row.removeAttribute(SETTINGS_NAV_GLYPH_ATTRIBUTE)
      }
    }
  }

  sync()
  // `characterData` too: a locale change rewrites the label text in place.
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  return {
    dispose(): void {
      disposed = true
      observer.disconnect()
      for (const marked of document.querySelectorAll(
        `[${SETTINGS_NAV_ATTRIBUTE}="${owner}"],[${SETTINGS_NAV_GLYPH_ATTRIBUTE}="${owner}"]`,
      )) {
        marked.removeAttribute(SETTINGS_NAV_ATTRIBUTE)
        marked.removeAttribute(SETTINGS_NAV_GLYPH_ATTRIBUTE)
      }
    },
    standDown(): () => void {
      if (!painting) return () => {}
      painting = false
      sync()
      return () => {
        if (disposed) return
        painting = true
        sync()
      }
    },
  }
}
