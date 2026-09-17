/**
 * The filesystem roots this page reads and removes from.
 *
 * The layout is the harness's own (`@deepseek-ai/dsh-skill-filesystem` walks
 * exactly these four roots for a workspace, in this rank order):
 *
 *   project: <projectRoot>/.dsh/skills      (source `project-dsh`)
 *            <projectRoot>/.agents/skills   (source `project-agents`)
 *   user:    $DSH_HOME/skills               (source `user-dsh`)
 *            $DSH_AGENTS_HOME/skills        (source `user-agents`)
 *
 * It is mirrored rather than imported for two reasons: the harness publishes no
 * helper for it (this plugin's single peer dependency is `@deepseek-ai/cordis`),
 * and a mirrored layout is what makes the check meaningful — a removal is
 * refused unless its target sits under a root this module derived itself, so no
 * entry can address a path outside them. The same derivation fills the page's
 * rows, which is why a skill's `source` is simply the key it was found under.
 * `test/skills-removal.test.mjs` pins each root against a scratch home, so a
 * layout change upstream surfaces as a failure there.
 *
 * Custom skill directories (the provider's own `customSkillDirs`, which a preset
 * may add) are deliberately absent: their locations are not knowable from here,
 * so a page about the standard roots says nothing about them rather than
 * offering a delete it cannot check.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** The harness home: `$DSH_HOME` when set and non-blank, `~/.dsh` otherwise. */
export function dshHome(): string {
  const configured = process.env.DSH_HOME?.trim()
  return resolve(configured && configured.length > 0 ? configured : join(homedir(), '.dsh'))
}

/** The shared agents home: `$DSH_AGENTS_HOME` when set, `~/.agents` otherwise. */
export function agentsHome(): string {
  const configured = process.env.DSH_AGENTS_HOME?.trim()
  return resolve(configured && configured.length > 0 ? configured : join(homedir(), '.agents'))
}

/**
 * The nearest ancestor of `cwd` carrying a `.git` entry — the project root the
 * provider derives from the workspace directory — falling back to `cwd` itself
 * when the walk reaches the filesystem root.
 */
export function projectRootOf(cwd: string): string {
  const start = resolve(cwd)
  let current = start
  while (true) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

/**
 * The directory each removable source maps to, for one request's scope.
 * @param cwd - the selected project, or `''` for the global scope: only a
 *   project request has project roots to resolve.
 * @returns source name to absolute root directory.
 */
export function skillRoots(cwd: string): Record<string, string> {
  const roots: Record<string, string> = {
    'user-dsh': join(dshHome(), 'skills'),
    'user-agents': join(agentsHome(), 'skills'),
  }
  if (cwd !== '') {
    const projectRoot = projectRootOf(cwd)
    roots['project-dsh'] = join(projectRoot, '.dsh', 'skills')
    roots['project-agents'] = join(projectRoot, '.agents', 'skills')
  }
  return roots
}

/**
 * The absolute directory of one source for one request's scope, or `null` when
 * that source has no root there (a project root without a project).
 *
 * @param source - the root key a request named.
 * @param cwd - the selected project, or `''` for a user root.
 */
export function rootOf(source: string, cwd: string): string | null {
  return skillRoots(cwd)[source] ?? null
}

/** The project root a workspace directory belongs to, for the picker's labels. */
export function projectRootFor(cwd: string): string {
  return projectRootOf(cwd)
}

/**
 * Whether `target` is `root` itself or a descendant of it, decided on resolved
 * paths in whole segments: a sibling whose name merely starts with the root's
 * (`/a/skills-old` next to `/a/skills`) is not inside it.
 */
export function isInsideRoot(root: string, target: string): boolean {
  const child = relative(resolve(root), resolve(target))
  if (child === '') return true
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}
