/**
 * The merged settings section: the shell around the plugin's four pages.
 *
 * One nav row instead of five, and a strip of four tabs above the panel —
 * each tab is one of the pages this plugin used to seat on its own, so the
 * panels are the very components those seats rendered (`features/mcp`,
 * `features/skills`, `features/custom-settings`, `features/local-cache`),
 * untouched below their intro line. Adding a page is a directory plus one
 * entry in `TABS`; the shell itself does not change.
 *
 * A fifth tab used to sit here for `features/theme`, and it is the one page
 * that did not survive as a tab: it described a second theme system (the three
 * ported skins, applied by a `data-dsh-<id>` attribute of their own) beside the
 * theme center's, and the two could not share a card or a selection. The skins
 * are entries in the center now and the card that page drew is the card the
 * center draws, so there is nothing left for a tab to show — theme is
 * appearance, and the center already sits with the shell's appearance rows on
 * Settings → General.
 *
 * Two things the shell owns:
 *
 * - **the identity block** — the page's name, the intro line and the plugin pill
 *   each page used to carry, stacked in that order above the strip. Rendered
 *   once here, they cannot say the plugin's version three times over; all three
 *   name the merged page, not one panel, so they stay put while the tabs move.
 * - **which panel exists** — only the active tab's panel is rendered. Each page
 *   polls its own data every three seconds, so mounting all three at once would
 *   triple that traffic for two pages nobody is looking at, and the shell's own
 *   nav did the same thing: DSH keeps only the active section mounted, so
 *   switching tabs back costs a fresh read here too.
 *
 * Each panel is handed the copy bound to *its* namespace rather than the one
 * the slot registration binds: the seat is this shell's (`smkit`), the words
 * inside a panel still belong to the feature that wrote them.
 */

import { createTabs } from '../../platform/ui/Tabs'
import { createVersionBadge } from '../../platform/ui/VersionBadge'
import { createCableIcon } from '../../features/mcp/icons/CableIcon'
import { createWandSparklesIcon } from '../../features/skills/icons/WandSparklesIcon'
import { createSettings2Icon } from '../../platform/icons/Settings2Icon'
import { createNotebookTextIcon } from '../../features/local-cache/icons/NotebookTextIcon'
import { createMcpContent } from '../../features/mcp/components/McpContent'
import { createSkillsContent } from '../../features/skills/components/SkillsContent'
import { createCustomSettingsContent } from '../../features/custom-settings/components/CustomSettingsContent'
import { createLocalCachePanel } from '../../features/local-cache/components/LocalCachePanel'
import type { ClientDeps, Translator } from '../../platform/types'

/** The copy the merged page reads: the shell's own namespace, then the four
 * it seats panels from. */
export interface PanelDictionaries {
  section: Translator
  mcp: Translator
  skills: Translator
  customSettings: Translator
  localCache: Translator
}

/** One page: its tab's glyph, its key in the strip, and its panel. */
interface SettingsTab {
  /** Stable id: the strip button's key and the selection value. */
  id: string
  /** Dictionary key of the tab label, in this section's own namespace. */
  label: string
  /** The glyph before the label, already built (an icon is a component; the
   * strip takes the element it should draw). */
  icon: JSX.Element
  /** The panel rendered while the tab is active, with its own dictionary. */
  Panel: (props: { t: Translator }) => JSX.Element
}

export function createSettingsSection(
  deps: ClientDeps,
  panelDictionaries: PanelDictionaries,
): () => JSX.Element {
  const { h, react } = deps
  // `t` is this section's own copy; a tab's panel is handed its namespace's.
  const t = panelDictionaries.section
  const Tabs = createTabs(deps)
  const VersionBadge = createVersionBadge(deps)
  const CableIcon = createCableIcon(deps)
  const WandSparklesIcon = createWandSparklesIcon(deps)
  const Settings2Icon = createSettings2Icon(deps)
  const NotebookTextIcon = createNotebookTextIcon(deps)
  const McpContent = createMcpContent(deps)
  const SkillsContent = createSkillsContent(deps)
  const CustomSettingsContent = createCustomSettingsContent(deps)
  const LocalCachePanel = createLocalCachePanel(deps)

  /** The pages, in strip order — the order the settings nav listed them in
   * before they were merged. */
  const TABS: SettingsTab[] = [
    {
      id: 'mcp',
      label: 'tabMcp',
      icon: <CableIcon size={14} />,
      Panel: (props) => <McpContent {...props} />,
    },
    {
      id: 'skills',
      label: 'tabSkills',
      icon: <WandSparklesIcon size={14} />,
      Panel: (props) => <SkillsContent {...props} />,
    },
    {
      id: 'custom',
      label: 'tabCustom',
      icon: <Settings2Icon size={14} />,
      Panel: (props) => <CustomSettingsContent {...props} />,
    },
    {
      id: 'local-cache',
      label: 'tabLocalCache',
      icon: <NotebookTextIcon size={14} />,
      Panel: (props) => <LocalCachePanel {...props} />,
    },
  ]

  // The keys are the TABS ids, verbatim — the panel lookup below indexes by
  // `active.id`. `local-cache` is the one id no bare key can spell: `-` reads
  // as subtraction outside quotes.
  const PANEL_T: Record<string, Translator> = {
    mcp: panelDictionaries.mcp,
    skills: panelDictionaries.skills,
    custom: panelDictionaries.customSettings,
    'local-cache': panelDictionaries.localCache,
  }

  // No props: the slot system hands a section the seat's copy, but this shell
  // reads only the dictionaries it was built with — its own for the frame, each
  // panel's for the page below the strip.
  return function SettingsSection(): JSX.Element {
    const [selected, setSelected] = react.useState(TABS[0].id)
    const active = TABS.find((tab) => tab.id === selected) ?? TABS[0]
    return (
      <div className="st_section">
        {/* The identity block, top down: the page's name, the line that says what
            the page is, the plugin pill. All three name the merged page rather
            than the open panel, so they stay put while the tabs move. */}
        <h3 className="st_heading">{t('sectionLabel')}</h3>
        <p className="st_intro">{t('sectionIntro')}</p>
        <VersionBadge />
        <Tabs
          ariaLabel={t('sectionLabel')}
          active={active.id}
          onChange={setSelected}
          tabs={TABS.map((tab) => ({ id: tab.id, label: t(tab.label), icon: tab.icon }))}
        />
        <div className="st_panel" role="tabpanel">
          <active.Panel t={PANEL_T[active.id]} />
        </div>
      </div>
    )
  }
}
