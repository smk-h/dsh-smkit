/**
 * The page's model of a root's catalog: one scan projected into rows, one entry
 * switched between enabled and disabled, and one entry removed from disk.
 *
 * The scan (`scan.ts`) is the only source. A row is one directory or one flat
 * file found in one root, and both writes address it the same way: by name, in
 * one root, at one group path — never by a path the client supplied. The name is
 * resolved against a *fresh* scan, so a stale page cannot address a file that
 * moved, and a directory renamed by hand cannot be deleted by its old name.
 *
 * Both writes are deliberately the reversible pair the page needs: `enabled`
 * renames the header (the harness ignores a `.disabled` one, so the skill stops
 * being loadable without leaving the disk), and only `deleteEntry` removes
 * anything — as an entry, so a symlink or a Windows junction loses the link and
 * never the tree behind it.
 */

import { lstat, rename, rmdir, rm, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { LOG_PREFIX } from '../../platform/constants.js'
import { isRecord } from '../../platform/util/text.js'
import { entryIsLink, isDirectory, isFile, scanRoot } from './scan.js'
import { dshHome, isInsideRoot, rootOf } from './roots.js'
import {
  DISABLED_SUFFIX,
  PROJECT_SOURCES_LIST,
  PROJECT_SCOPE,
  USER_SOURCES,
  USER_SCOPE,
  SKILL_BOTH_HEADERS_ERROR,
  SKILL_FILE_NAME,
  SKILL_NOT_FOUND_ERROR,
  SKILL_NOT_REMOVABLE_ERROR,
  SKILL_REL_ERROR,
  SKILL_SOURCE_ERROR,
  scopeOfSource,
} from './constants.js'
import type { SkillAddress, SkillView, SkillsView } from '../../../shared/skills/contract.js'
import type { LoggerLike } from '../../platform/types.js'
import type { ScannedSkill } from './scan.js'

/** What one removal deletes, and how the skill is laid out. */
export interface RemovalPlan {
  /** Absolute path: a bundle's own directory, or a flat skill's `.md` file. */
  target: string
  kind: 'bundle' | 'flat'
}

/** One write's outcome, ready to be answered with as-is. */
export interface Outcome {
  status: number
  body: Record<string, unknown>
}

/** Project one scanned entry into the row the page renders. */
function toView(skill: ScannedSkill): SkillView {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse === '' ? {} : { whenToUse: skill.whenToUse }),
    source: skill.source,
    scope: scopeOfSource(skill.source),
    rel: skill.rel,
    enabled: skill.enabled,
    modelInvocable: skill.modelInvocable,
    userInvocable: skill.userInvocable,
    path: skill.path,
    realPath: skill.realPath,
    linked: skill.linked,
  }
}

/**
 * Read one root's catalog: the user roots are each their own view.
 *
 * @param root - the absolute root directory (from `roots.rootOf`).
 * @param source - the root's key, copied onto every row.
 * @param logger - the host logger, for directories and entries that are skipped.
 */
export async function listRoot(
  root: string,
  source: string,
  logger: LoggerLike,
): Promise<SkillsView> {
  const scan = await scanRoot(root, source, logger)
  return {
    source,
    root,
    roots: [root],
    absentRoots: (await isDirectory(root)) ? [] : [root],
    skills: scan.skills.map(toView),
    skipped: scan.skipped,
    complete: scan.complete,
  }
}

/**
 * Read the user side's catalog: both homes are the view, its roots are not.
 *
 * The user side reads like the project side — one picker entry, two tabs — so
 * one request reads both homes in rank order (`~/.dsh` before `~/.agents`,
 * which is also the order the harness resolves a duplicate name in), and each
 * row still names the root writes address it by. Both roots are always named:
 * a home whose skills directory has not been created yet keeps its tab, and
 * the page's empty state is what says so.
 *
 * @param logger - the host logger, for directories and entries that are skipped.
 */
export async function listUser(logger: LoggerLike): Promise<SkillsView> {
  const roots: Array<{ source: string; dir: string; exists: boolean }> = []
  for (const source of USER_SOURCES) {
    const dir = rootOf(source, '')
    if (dir !== null) roots.push({ source, dir, exists: await isDirectory(dir) })
  }
  return mergeViews(USER_SCOPE, dshHome(), roots, logger)
}

/**
 * Read one project's catalog: the project is the view, its roots are not.
 *
 * A workspace's project root is the nearest ancestor carrying `.git` — which a
 * workspace directory may not be itself, so both roots are resolved here rather
 * than in the browser. Both are always named, in rank order (`.dsh` before
 * `.agents`), whether or not they exist yet; only the ones that exist are read,
 * and the rest surface on the page as a "not installed yet" empty tab.
 *
 * @param cwd - the selected workspace directory.
 * @param logger - the host logger, for directories and entries that are skipped.
 */
export async function listProject(cwd: string, logger: LoggerLike): Promise<SkillsView> {
  const roots: Array<{ source: string; dir: string; exists: boolean }> = []
  for (const source of PROJECT_SOURCES_LIST) {
    const dir = rootOf(source, cwd)
    if (dir !== null) roots.push({ source, dir, exists: await isDirectory(dir) })
  }
  return mergeViews(PROJECT_SCOPE, resolve(cwd), roots, logger)
}

/**
 * Scan the roots that exist, in rank order, into one merged view; the absent
 * ones keep their place in `roots` and are reported in `absentRoots`, which is
 * what a tab's "not installed yet" empty state is keyed by.
 */
function mergeViews(
  scope: string,
  root: string,
  roots: Array<{ source: string; dir: string; exists: boolean }>,
  logger: LoggerLike,
): Promise<SkillsView> {
  const scanned = Promise.all(
    roots
      .filter((entry) => entry.exists)
      .map(async (entry) => ({
        source: entry.source,
        scan: await scanRoot(entry.dir, entry.source, logger),
      })),
  )
  return scanned.then((views) => {
    const skills: SkillView[] = []
    let skipped = 0
    let complete = true
    for (const { scan } of views) {
      for (const skill of scan.skills) skills.push(toView(skill))
      skipped += scan.skipped
      if (!scan.complete) complete = false
    }
    return {
      source: scope,
      root,
      roots: roots.map((entry) => entry.dir),
      absentRoots: roots.filter((entry) => !entry.exists).map((entry) => entry.dir),
      skills,
      skipped,
      complete,
    }
  })
}

/**
 * Turn a scanned entry into the one path a removal may delete, or `null` when it
 * must not be deleted from here.
 *
 * The plan is derived from the entry rather than trusted: the target must sit
 * inside the root that was walked, as a single path segment below it. A scan can
 * therefore never hand the delete a path outside the root, even if the root
 * itself is a link (the comparison is on the root's own spelling, which is what
 * the entries were joined onto).
 *
 * @param skill - one entry from `scanRoot`.
 * @param root - the absolute root directory it was found under.
 */
export function planRemoval(skill: ScannedSkill, root: string): RemovalPlan | null {
  const target = skill.target
  if (target === root || !isInsideRoot(root, target)) return null
  const name = basename(target)
  if (name === '' || name === '.' || name === '..' || name.includes(sep)) return null
  return { target, kind: skill.kind }
}

/**
 * The two spellings of one skill's header: the file that is live, and the file
 * its `enabled` flag renames it to.
 */
export function togglePaths(skill: ScannedSkill): { enabled: string; disabled: string } {
  if (skill.kind === 'bundle') {
    const enabled = join(dirname(skill.path), SKILL_FILE_NAME)
    return { enabled, disabled: `${enabled}${DISABLED_SUFFIX}` }
  }
  const enabled = skill.path.endsWith(DISABLED_SUFFIX)
    ? skill.path.slice(0, -DISABLED_SUFFIX.length)
    : skill.path
  return { enabled, disabled: `${enabled}${DISABLED_SUFFIX}` }
}

/**
 * Delete one entry: a bundle's own tree, a flat file, or — for a symlink or a
 * Windows junction — just the link.
 *
 * The link check runs here, at delete time, rather than trusting the scan: a
 * directory can be replaced by a link between the poll that rendered the row and
 * the click that removes it, and a recursive delete would then walk *through*
 * the link and destroy whatever it points at (`fs.rm`'s own symlink handling
 * does not cover junctions, which `lstat` reports as ordinary directories).
 *
 * @param target - the absolute entry path from `planRemoval`.
 * @returns what was removed, for the log line.
 */
export async function deleteEntry(target: string): Promise<'link' | 'file' | 'directory'> {
  const info = await lstat(target)
  if (info.isSymbolicLink()) {
    await unlink(target)
    return 'link'
  }
  if (info.isFile()) {
    await unlink(target)
    return 'file'
  }
  if (await entryIsLink(target)) {
    // A junction: `rmdir` removes the reparse point itself and leaves the tree
    // it points at untouched.
    await rmdir(target)
    return 'link'
  }
  await rm(target, { recursive: true, force: false })
  return 'directory'
}

/** One removal's or toggle's outcome: the entry it applied to, or why not. */
interface Located {
  root: string
  skill: ScannedSkill
}

/**
 * Find the entry one address names, in a fresh scan of that one root.
 * @returns the entry, or the refusal to answer with.
 */
async function locate(
  address: SkillAddress,
  logger: LoggerLike,
): Promise<Located | Outcome> {
  const root = rootOf(address.source, address.cwd)
  if (root === null) return { status: 400, body: { error: SKILL_SOURCE_ERROR } }
  if (!isSafeRel(address.rel)) return { status: 400, body: { error: SKILL_REL_ERROR } }
  const scan = await scanRoot(root, address.source, logger)
  const skill = scan.skills.find(
    (entry) => entry.rel === address.rel && entry.name === address.name,
  )
  if (skill === undefined) return { status: 404, body: { error: SKILL_NOT_FOUND_ERROR } }
  return { root, skill }
}

/** Whether a group path is a plain relative path: no traversal, no separator games. */
function isSafeRel(rel: string): boolean {
  if (rel === '') return true
  if (isAbsolute(rel) || rel.includes('\0') || rel.includes('\\')) return false
  return rel.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

/**
 * Remove one skill from disk.
 *
 * @param address - the skill to remove: name, root, project and group.
 * @param logger - the host logger; a removal is announced here.
 */
export async function removeSkill(address: SkillAddress, logger: LoggerLike): Promise<Outcome> {
  const located = await locate(address, logger)
  if ('status' in located) return located
  const plan = planRemoval(located.skill, located.root)
  if (plan === null) return { status: 400, body: { error: SKILL_NOT_REMOVABLE_ERROR } }
  try {
    const removed = await deleteEntry(plan.target)
    logger.info(`${LOG_PREFIX}: removed ${removed} skill "${address.name}" at ${plan.target}`)
  } catch (error) {
    // The entry was there a moment ago; it can be gone by now (another window, a
    // hand-run delete). That is the same miss as an unknown name, not a fault.
    if (isRecord(error) && error.code === 'ENOENT') {
      return { status: 404, body: { error: SKILL_NOT_FOUND_ERROR } }
    }
    throw error
  }
  return { status: 200, body: { name: address.name } }
}

/**
 * Switch one skill between enabled and disabled by renaming its header.
 *
 * The rename stays inside the skill's own directory, so it is atomic and the
 * file's contents are never touched. Asking for the state that already holds is
 * a no-op success — the page's switch can be a step behind the disk after a
 * hand-made change, and that should not read as a failure.
 *
 * A skill installed through a link is switched at the directory the link points
 * at, because the header is one file: disabling it therefore disables the skill
 * for every root that refers to it, which is the honest behaviour of a shared
 * installation (removal, by contrast, only takes the link out of *this* root).
 * The page says which path it will touch in the row's detail and confirmation.
 *
 * @param address - the skill to switch: name, root, project and group.
 * @param enabled - the state to move to.
 * @param logger - the host logger.
 */
export async function setSkillEnabled(
  address: SkillAddress,
  enabled: boolean,
  logger: LoggerLike,
): Promise<Outcome> {
  const located = await locate(address, logger)
  if ('status' in located) return located
  if (located.skill.enabled === enabled) {
    return { status: 200, body: { name: address.name, enabled } }
  }
  const paths = togglePaths(located.skill)
  const to = enabled ? paths.enabled : paths.disabled
  // Both headers present is a state this page will not guess at: which one the
  // harness would load is a coin toss, so it is reported instead of resolved.
  if (await isFile(to)) return { status: 409, body: { error: SKILL_BOTH_HEADERS_ERROR } }
  try {
    await rename(located.skill.path, to)
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return { status: 404, body: { error: SKILL_NOT_FOUND_ERROR } }
    }
    throw error
  }
  logger.info(
    `${LOG_PREFIX}: ${enabled ? 'enabled' : 'disabled'} skill "${address.name}" at ${to}`,
  )
  return { status: 200, body: { name: address.name, enabled } }
}
