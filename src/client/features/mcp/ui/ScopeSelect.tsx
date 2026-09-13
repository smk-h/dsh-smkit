/**
 * The scope picker above the MCP lists: one pill-shaped trigger that opens a
 * menu of the global scope plus every workspace.
 *
 * A thin mapping over the shared `ui/IconSelect`: this file owns which options
 * exist (global first, then every workspace under a group header) and their
 * glyphs — monitor for global, folder for a workspace — while IconSelect owns
 * the open/close behavior and rendering. That is the same icon pair the server
 * form's scope picker shows, so both surfaces read identically.
 */

import { createFolderIcon } from '../icons/FolderIcon'
import { createMonitorIcon } from '../icons/MonitorIcon'
import { createIconSelect } from './IconSelect'
import type { ClientDeps, Translator } from '../../../platform/types'

/** One workspace as the menu needs it: the path is the value, the name the label. */
export interface ScopeWorkspace {
  path: string
  name: string
}

export interface ScopeSelectProps {
  t: Translator
  /** `''` is the global scope; a workspace path selects that workspace. */
  value: string
  workspaces: ScopeWorkspace[]
  onChange(value: string): void
}

export function createScopeSelect(deps: ClientDeps): (props: ScopeSelectProps) => JSX.Element {
  const { h } = deps
  const MonitorIcon = createMonitorIcon(deps)
  const FolderIcon = createFolderIcon(deps)
  const IconSelect = createIconSelect(deps)

  return function ScopeSelect({ t, value, workspaces, onChange }: ScopeSelectProps): JSX.Element {
    return (
      <IconSelect
        variant="scope"
        ariaLabel={t('scope')}
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: t('global'), icon: <MonitorIcon /> },
          ...workspaces.map((workspace) => ({
            value: workspace.path,
            label: workspace.name,
            title: workspace.path,
            group: t('workspace'),
            icon: <FolderIcon />,
          })),
        ]}
      />
    )
  }
}
