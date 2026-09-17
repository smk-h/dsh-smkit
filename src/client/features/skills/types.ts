/**
 * Types the skills feature owns.
 *
 * The props DSH hands its settings section, plus the wire shapes shared with the
 * host half (re-exported here so a component has one import site for both
 * infrastructure and business types).
 */

import type { Translator } from '../../platform/types'

export type {
  SkillAddress,
  SkillRootView,
  SkillScope,
  SkillView,
  SkillsView,
  SkillWorkspaceView,
  SkillWorkspacesView,
} from '../../../shared/skills/contract'

/** Props every settings section component receives from the slot system. */
export interface SectionProps {
  t: Translator
}
