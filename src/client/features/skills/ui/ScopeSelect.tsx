/**
 * The skill-directory picker above the list.
 *
 * A thin mapping over the shared `platform/ui/IconSelect` — the very component
 * the MCP page's scope picker maps onto — so the trigger, the caret, the open
 * menu and the hover bubble cannot drift between the two pages.
 *
 * What this file owns is only the shape of an option and the glyph that goes
 * with it: a user root gets the monitor, a project root the folder, matching how
 * the MCP picker tells the two sides apart. The options themselves — which roots
 * exist, what each is called, and which project it belongs to — are built by the
 * section from the host's answer, because only the host knows where the homes
 * are and what the workspaces are titled.
 *
 * A value is `source|cwd`: the root key and, for a project root, the workspace
 * it belongs to. That pair is exactly what the section sends back on every
 * request, so selecting a row in this menu and addressing a skill in it are the
 * same fact.
 */

import { createFolderIcon } from '../../../platform/icons/FolderIcon'
import { createMonitorIcon } from '../../../platform/icons/MonitorIcon'
import { createIconSelect } from '../../../platform/ui/IconSelect'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { SkillScope } from '../types'

/** One selectable skill directory. */
export interface ScopeOption {
  /** `source|cwd`; the workspace part is empty for a user root. */
  value: string
  /** The root key, so a view the host answered with can be selected by name. */
  source: string
  /** Short display label, e.g. `~/.dsh/skills` or `.agents/skills`. */
  label: string
  /** The root's absolute path, shown in the hover bubble. */
  title: string
  /** Menu group header: the user side, or one project. */
  group: string
  scope: SkillScope
}

export interface ScopeSelectProps {
  t: Translator
  value: string
  options: ScopeOption[]
  onChange(value: string): void
}

export function createScopeSelect(deps: ClientDeps): (props: ScopeSelectProps) => JSX.Element {
  const { h } = deps
  const MonitorIcon = createMonitorIcon(deps)
  const FolderIcon = createFolderIcon(deps)
  const IconSelect = createIconSelect(deps)

  return function ScopeSelect({ t, value, options, onChange }: ScopeSelectProps): JSX.Element {
    return (
      <IconSelect
        ariaLabel={t('scope')}
        value={value}
        onChange={onChange}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          title: option.title,
          group: option.group,
          icon: option.scope === 'project' ? <FolderIcon /> : <MonitorIcon />,
        }))}
      />
    )
  }
}
