/**
 * The Custom settings page of the settings dialog: the shell around its tabs.
 *
 * A tab per configuration area this plugin exposes on this page; `TABS` below
 * is the list, and adding an area is appending a panel component and its label
 * key to it — the shell itself does not change. The strip is the platform
 * layer's `Tabs`, the same one the skills page renders for a project's skill
 * directories, so the pages read as one dialog family and the strip's roles
 * and active underline live in exactly one place.
 *
 * Nothing here reads or writes configuration: each tab owns its own reads, its
 * own drafts and its own refusals, which is what keeps one area's polling and
 * error lines out of another's.
 */

import { createTabs } from '../../../platform/ui/Tabs'
import { createVersionBadge } from '../../../platform/ui/VersionBadge'
import { createOtherSettingsPanel } from './OtherSettingsPanel'
import { createRetryPanel } from './RetryPanel'
import type { ClientDeps, Translator } from '../../../platform/types'

/** Props every settings section component receives from the slot system. */
export interface CustomSettingsProps {
  t: Translator
}

/** One configuration area: its key in the strip, its label, and its panel. */
interface SettingsTab {
  /** Stable id, used as the strip button's key and as the selection value. */
  id: string
  /** Dictionary key of the tab label. */
  label: string
  /** The panel rendered while the tab is active; takes the section's `t`. */
  Panel: (props: CustomSettingsProps) => JSX.Element
}

export function createCustomSettingsContent(
  deps: ClientDeps,
): (props: CustomSettingsProps) => JSX.Element {
  const { h, react } = deps
  const Tabs = createTabs(deps)
  const RetryPanel = createRetryPanel(deps)
  const OtherSettingsPanel = createOtherSettingsPanel(deps)
  const VersionBadge = createVersionBadge(deps)

  /** The page's areas, in strip order. */
  const TABS: SettingsTab[] = [
    { id: 'retry', label: 'tabRetry', Panel: RetryPanel },
    { id: 'other', label: 'tabOther', Panel: OtherSettingsPanel },
  ]

  return function CustomSettingsContent({ t }: CustomSettingsProps): JSX.Element {
    const [selected, setSelected] = react.useState(TABS[0].id)
    const active = TABS.find((tab) => tab.id === selected) ?? TABS[0]
    return (
      <div className="cs_section">
        {/* The page's areas, in strip order — the identity block reads the way
            the MCP and skills pages' does: intro line, plugin pill, then the
            section's own heading above the strip. The dialog's own header
            carries the section label too, and the two agree because both read
            it from the registration. */}
        <p className="cs_intro">{t('sectionIntro')}</p>
        <VersionBadge />
        <h3 className="cs_heading">{t('sectionLabel')}</h3>
        <Tabs
          ariaLabel={t('sectionLabel')}
          active={active.id}
          onChange={setSelected}
          tabs={TABS.map((tab) => ({ id: tab.id, label: t(tab.label) }))}
        />
        <div className="cs_panel" role="tabpanel">
          <active.Panel t={t} />
        </div>
      </div>
    )
  }
}
