/**
 * The Other settings tab of the Custom settings page: what this page is lined
 * up to take next.
 *
 * Read-only on purpose — it is a plan, not a form. Every entry names a value
 * dsh already exposes through one of its settings namespaces, so taking one on
 * means a panel and its label rather than a new mechanism; showing the address
 * lets a reader go straight to `settings.yaml` in the meantime. When an entry
 * becomes a real tab, it leaves this list.
 *
 * The addresses are code, not copy: they are dsh's own namespace and path
 * spellings, which no locale translates.
 */

import type { ClientDeps, Translator } from '../../../platform/types'

/** Props every tab panel receives from the page shell. */
export interface OtherSettingsPanelProps {
  t: Translator
}

/** One setting a later tab is expected to take. */
interface PlannedSetting {
  /** Stable key for the list. */
  id: string
  /** Dictionary key of the entry's name. */
  title: string
  /** Dictionary key of the one-line explanation. */
  help: string
  /** Where the value lives in dsh's settings document. */
  where: string
}

/**
 * The list, in the order the entries were chosen: the first four are values a
 * deployment usually wants to tune per machine, the last two are per-feature
 * switches.
 */
const PLANNED: PlannedSetting[] = [
  {
    id: 'tool-calls',
    title: 'plannedToolCalls',
    help: 'plannedToolCallsHelp',
    where: 'agent-loop · maxParallelToolCalls',
  },
  {
    id: 'shell-limits',
    title: 'plannedShellLimits',
    help: 'plannedShellLimitsHelp',
    where: 'shell · timeoutMs · maxOutputBytes',
  },
  {
    id: 'stream-idle',
    title: 'plannedStreamIdle',
    help: 'plannedStreamIdleHelp',
    where: 'llm-deepseek · streamIdleTimeoutMs',
  },
  {
    id: 'request-budget',
    title: 'plannedRequestBudget',
    help: 'plannedRequestBudgetHelp',
    where: 'llm-deepseek · maxImagesPerRequest · maxRequestFilesBytes',
  },
  {
    id: 'search-uses',
    title: 'plannedSearchUses',
    help: 'plannedSearchUsesHelp',
    where: 'web-search-deepseek · maxUses',
  },
  {
    id: 'subagent-models',
    title: 'plannedSubagentModels',
    help: 'plannedSubagentModelsHelp',
    where: 'subagent-model-selection · allowedModels',
  },
]

export function createOtherSettingsPanel(
  deps: ClientDeps,
): (props: OtherSettingsPanelProps) => JSX.Element {
  const { h } = deps

  return function OtherSettingsPanel({ t }: OtherSettingsPanelProps): JSX.Element {
    return (
      <div className="ot_panel">
        <p className="ot_intro">{t('otherIntro')}</p>
        <div className="ot_list">
          {PLANNED.map((setting) => (
            <div className="ot_item" key={setting.id}>
              <div className="ot_head">
                <span className="ot_title">{t(setting.title)}</span>
                <span className="ot_badge">{t('otherPlanned')}</span>
              </div>
              <div className="ot_help">{t(setting.help)}</div>
              <div className="ot_addr">{setting.where}</div>
            </div>
          ))}
        </div>
        <p className="ot_note">{t('otherNote')}</p>
      </div>
    )
  }
}
