/**
 * The Custom settings panel of the merged settings section: the shell around
 * its tabs.
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
import { createModelInputPanel } from './ModelInputPanel'
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
  const ModelInputPanel = createModelInputPanel(deps)
  const OtherSettingsPanel = createOtherSettingsPanel(deps)

  /** The page's areas, in strip order. */
  const TABS: SettingsTab[] = [
    { id: 'retry', label: 'tabRetry', Panel: RetryPanel },
    { id: 'model-input', label: 'tabModelInput', Panel: ModelInputPanel },
    { id: 'other', label: 'tabOther', Panel: OtherSettingsPanel },
  ]

  return function CustomSettingsContent({ t }: CustomSettingsProps): JSX.Element {
    const [selected, setSelected] = react.useState(TABS[0].id)
    const active = TABS.find((tab) => tab.id === selected) ?? TABS[0]
    return (
      <div className="cs_section">
        {/* The page's areas, in strip order. The identity block — the intro
            line, the plugin pill and the page title — is the merged settings
            section's, not this panel's: the tab that opened this strip already
            names the page. */}
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
