/**
 * Constants of the skills feature: the on-disk conventions and the refusals.
 *
 * A skill's `source` is DSH's own name for the root it was found in
 * (`@deepseek-ai/dsh-skill-filesystem` assigns one per root). Two decisions are
 * keyed by it — which page view a row belongs to, and which directory a removal
 * stays inside — so both readings live here, next to each other, instead of
 * being re-derived at each call site.
 */

import type { SkillScope } from '../../../shared/skills/contract.js'

/** The bundle layout's file name: a directory skill is `<root>/<dir>/SKILL.md`. */
export const SKILL_FILE_NAME = 'SKILL.md'

/**
 * The suffix a header is renamed to when the skill is disabled.
 *
 * Disabling is this plugin's own convention, not the harness's: the provider
 * looks for exactly `SKILL.md` (and, for flat skills, exactly `*.md`), so a
 * `SKILL.md.disabled` is simply not a skill to it — the entry stops being
 * loadable while staying on disk, listed here, and switchable back on. That is
 * the point: a skill is rarely something to delete outright, and this is the
 * reversible half of the page's two actions.
 */
export const DISABLED_SUFFIX = '.disabled'

/** Entries the walk never descends into: VCS metadata and installed packages. */
export const SKIP_DIR_NAMES: ReadonlySet<string> = new Set(['node_modules', '.git', '.hg', '.svn'])

/**
 * How far below a root a nested skill may sit. Deep enough for a collection's
 * `group/subgroup/skill` layout, shallow enough that a symlink cycle cannot walk
 * forever (the walk follows links, and nothing else bounds it).
 */
export const MAX_SKILL_DEPTH = 8

/** Roots that belong to the selected project rather than to the user. */
const PROJECT_SOURCES: ReadonlySet<string> = new Set(['project-dsh', 'project-agents'])

/**
 * The page filter one source belongs to: a project root is only in view while
 * that project is selected, everything else is the user's.
 */
export function scopeOfSource(source: string): SkillScope {
  return PROJECT_SOURCES.has(source) ? 'project' : 'global'
}

/** The sources this page knows, both sides, in the provider's rank order. */
export const USER_SOURCES: readonly string[] = ['user-dsh', 'user-agents']
export const PROJECT_SOURCES_LIST: readonly string[] = ['project-dsh', 'project-agents']

/**
 * The pseudo-source the user side's merged view answers with.
 *
 * The user side reads like the project side now: one picker entry, two tabs.
 * The answer still names each row's own root (`user-dsh`, `user-agents`),
 * which is what writes are addressed by — this name only says "the view was
 * the user side", never a root that could be written to. It is deliberately
 * not a key of `skillRoots`, so a request that names it as a source is
 * refused.
 */
export const USER_SCOPE = 'user'

/**
 * The pseudo-source a project's merged view answers with.
 *
 * A project is one entry in the picker, so its two roots are read together; the
 * answer still names each row's own root (`project-dsh`, `project-agents`),
 * which is what writes are addressed by — this name only says "the view was a
 * project", never a root that could be written to. It is deliberately not a key
 * of `skillRoots`, so a request that names it as a source is refused.
 */
export const PROJECT_SCOPE = 'project'

/** A skill name addressed by a route must be its kebab-case id. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const SKILL_NAME_ERROR = 'skill name must be a kebab-case segment'
export const SKILL_CWD_ERROR = 'cwd must be an absolute path for a project root'
export const SKILL_SOURCE_ERROR = 'source must name one of the skill roots this plugin manages'
export const SKILL_REL_ERROR = 'rel must be a relative group path without traversal'
export const SKILL_ENABLED_ERROR = 'enabled must be a boolean'
export const SKILL_NOT_FOUND_ERROR = 'no skill of that name in that root; refresh the list'
export const SKILL_NOT_REMOVABLE_ERROR =
  'this entry does not sit inside the root it was listed under; refusing to remove it'
export const SKILL_BOTH_HEADERS_ERROR =
  'this skill has both an enabled and a disabled header; resolve it by hand'
