/**
 * Reading one skill root off the filesystem.
 *
 * Why this page scans the roots instead of asking the harness's skill registry
 * (`ctx.skills`): in the web profile the base `skill-filesystem` row is disabled
 * and every agent preset mounts its own copy
 * (`@deepseek-ai/dsh-web-app`'s patch layer says so), so the provider that
 * discovers these roots lives in a *preset's scope* — a scope-less read, which
 * is the only read a settings page can make, sees an empty catalog however full
 * the roots are. The registry's summaries also carry no file path, and this page
 * needs exactly that: the file behind each name, and for an installed-through-a-
 * link skill the directory it really lives in.
 *
 * What is walked is one root at a time (the layout is mirrored in `roots.ts`),
 * which is also the unit the page shows: a view is a root, a row is one entry
 * in it. Three things the harness's own provider does not do are done here:
 *
 * - **nesting**: a skill may sit in a group directory
 *   (`<root>/<group>/<name>/SKILL.md`), so the walk descends into directories
 *   that hold no `SKILL.md` of their own and records the group path as `rel`.
 *   Flat `<name>.md` files are read at the root only, matching the provider;
 * - **disabled skills**: a header renamed to `SKILL.md.disabled` (or
 *   `<name>.md.disabled`) is still read, listed and reported as `enabled: false`
 *   — the harness ignores it, the page keeps managing it;
 * - **links**: a directory or file may be a symlink or a Windows junction; both
 *   are followed for reading, reported with the path they resolve to, and never
 *   deleted *through* (see `catalog.deleteEntry`).
 */

import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { LOG_PREFIX } from '../../platform/constants.js'
import { isRecord, toErrorMessage } from '../../platform/util/text.js'
import { DISABLED_SUFFIX, MAX_SKILL_DEPTH, SKILL_FILE_NAME, SKIP_DIR_NAMES } from './constants.js'
import { readSkillFrontmatter } from './frontmatter.js'
import type { SkillFrontmatter } from './frontmatter.js'
import type { LoggerLike } from '../../platform/types.js'

/** One skill found in one root. */
export interface ScannedSkill extends SkillFrontmatter {
  /** The root it was found under (`user-dsh`, `project-agents`, …). */
  source: string
  /** The group directory under the root; `''` for a top-level skill. */
  rel: string
  /** False when the header carries the `.disabled` suffix. */
  enabled: boolean
  /** How the skill is laid out: a directory with a header, or one flat file. */
  kind: 'bundle' | 'flat'
  /** The header file as it is named now (`…/SKILL.md` or `…/SKILL.md.disabled`). */
  path: string
  /** Where that file really lives; equal to `path` unless the entry is a link. */
  realPath: string
  /** Whether the file or its directory is a link. */
  linked: boolean
  /** What a removal deletes: the bundle's own directory, or the flat file. */
  target: string
}

/** One root's scan. */
export interface SkillScan {
  skills: ScannedSkill[]
  /** Entries whose header was unusable: not listed, only counted. */
  skipped: number
  /** False when the root (or a directory in it) could not be read in full. */
  complete: boolean
}

/**
 * One file's header, remembered between polls. The page re-reads the roots
 * every three seconds; a skill file that has not changed (same size, same
 * modification time) is served from here instead of being read and parsed
 * again. Bounded because a long-running host could otherwise accumulate an
 * entry per path it ever saw — dropping the whole map is the cheapest correct
 * eviction, and a rebuild costs one pass over the roots.
 */
const headerCache = new Map<string, { mtimeMs: number; size: number; header: SkillFrontmatter | null }>()
const HEADER_CACHE_LIMIT = 512

/** A file bigger than this is not a skill header; it is left alone and counted. */
const MAX_SKILL_FILE_BYTES = 512 * 1024

/**
 * Walk one root and read every skill in it.
 *
 * @param root - the absolute root directory (from `roots.rootOf`).
 * @param source - the root's own key, copied onto every entry.
 * @param logger - the host logger, for the entries and directories that are skipped.
 */
export async function scanRoot(
  root: string,
  source: string,
  logger: LoggerLike,
): Promise<SkillScan> {
  const skills: ScannedSkill[] = []
  const state = { skipped: 0, complete: true }
  await walk(root, source, '', 0, skills, state, logger)
  return { skills, skipped: state.skipped, complete: state.complete }
}

/** One directory of the walk: its skills, and what could not be read. */
async function walk(
  dir: string,
  source: string,
  rel: string,
  depth: number,
  skills: ScannedSkill[],
  state: { skipped: number; complete: boolean },
  logger: LoggerLike,
): Promise<void> {
  if (depth > MAX_SKILL_DEPTH) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    // An absent directory is the normal state of a machine with no skills there.
    if (isAbsent(error)) return
    logger.warn(`${LOG_PREFIX}: cannot read skill directory ${dir}: ${toErrorMessage(error)}`)
    state.complete = false
    return
  }
  // Stable order: a poll must not reorder the page.
  const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of sorted) {
    // Hidden entries carry no skills, and the skip list holds the two places a
    // skill tree is certain not to be.
    if (entry.name.startsWith('.') || SKIP_DIR_NAMES.has(entry.name)) continue
    const entryPath = join(dir, entry.name)
    const kind = await entryKind(entryPath)
    if (kind === 'directory') {
      const held = await readBundle(entryPath, source, rel, logger)
      if (held !== null) {
        if (typeof held === 'string') state.skipped += 1
        else skills.push(held)
        // A directory that holds a header *is* the skill: its `references/`,
        // `scripts/` and the like belong to it, not to nested skills.
        continue
      }
      await walk(entryPath, source, rel === '' ? entry.name : `${rel}/${entry.name}`, depth + 1, skills, state, logger)
      continue
    }
    // Flat skills live at the root only, which is what the provider reads.
    if (kind === 'file' && rel === '') {
      const flat = await readFlat(entryPath, source, logger)
      if (flat !== null) {
        if (typeof flat === 'string') state.skipped += 1
        else skills.push(flat)
      }
    }
  }
}

/**
 * The skill a directory holds, `null` when it holds none.
 * @returns the entry, the string `'skipped'` when it holds an unusable header,
 *   or `null` when the directory is a group to descend into.
 */
async function readBundle(
  dir: string,
  source: string,
  rel: string,
  logger: LoggerLike,
): Promise<ScannedSkill | 'skipped' | null> {
  const enabledPath = join(dir, SKILL_FILE_NAME)
  const disabledPath = `${enabledPath}${DISABLED_SUFFIX}`
  const enabled = await isFile(enabledPath)
  const headerPath = enabled ? enabledPath : disabledPath
  if (!enabled && !(await isFile(disabledPath))) return null
  const header = await readHeader(headerPath, logger)
  if (header === null) return 'skipped'
  return describe(header, {
    source,
    rel,
    enabled,
    kind: 'bundle',
    path: headerPath,
    target: dir,
    watch: [dir, headerPath],
  })
}

/**
 * The flat skill one file holds, `null` when the file is not a candidate.
 * @returns the entry, the string `'skipped'` when it holds an unusable header,
 *   or `null` for a file that is not a skill at all.
 */
async function readFlat(
  file: string,
  source: string,
  logger: LoggerLike,
): Promise<ScannedSkill | 'skipped' | null> {
  const disabled = file.endsWith(`.md${DISABLED_SUFFIX}`)
  if (!disabled && !file.endsWith('.md')) return null
  const header = await readHeader(file, logger)
  if (header === null) return 'skipped'
  return describe(header, {
    source,
    rel: '',
    enabled: !disabled,
    kind: 'flat',
    path: file,
    target: file,
    watch: [file],
  })
}

/** Fill in the entry's paths and link facts. */
async function describe(
  header: SkillFrontmatter,
  fields: {
    source: string
    rel: string
    enabled: boolean
    kind: 'bundle' | 'flat'
    path: string
    target: string
    /** Paths whose being a link makes the skill linked: the entry, and its header. */
    watch: string[]
  },
): Promise<ScannedSkill> {
  let linked = false
  for (const path of fields.watch) {
    if (await entryIsLink(path)) {
      linked = true
      break
    }
  }
  return {
    ...header,
    source: fields.source,
    rel: fields.rel,
    enabled: fields.enabled,
    kind: fields.kind,
    path: fields.path,
    realPath: await resolved(fields.path),
    linked,
    target: fields.target,
  }
}

/**
 * What one entry is, following links: a directory, a plain file, or something
 * this page does not list (a socket, a broken link). `stat` follows symlinks and
 * Windows junctions alike, which is what makes both readable.
 */
async function entryKind(path: string): Promise<'directory' | 'file' | 'other'> {
  try {
    const info = await stat(path)
    if (info.isDirectory()) return 'directory'
    return info.isFile() ? 'file' : 'other'
  } catch {
    // Absent, or a link whose target is gone: nothing to list.
    return 'other'
  }
}

/**
 * Whether one entry is a link.
 *
 * A symlink answers for itself (`lstat` does not follow it). A Windows junction
 * is a reparse point that `lstat` reports as a plain directory, so the entry is
 * also compared with the path it resolves to: a junction's target is somewhere
 * else by construction, while a real directory resolves to exactly
 * `<realpath(parent)>/<name>`. Resolving both sides absorbs a path the platform
 * spells differently (macOS's `/tmp` under `/private`).
 */
export async function entryIsLink(path: string): Promise<boolean> {
  if (await isSymlink(path)) return true
  const real = await resolved(path)
  return real !== join(await resolved(dirname(path)), basename(path))
}

/** `lstat` reduced to the one bit the link checks need. */
async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink()
  } catch {
    return false
  }
}

/** Whether one path is a regular file (following links). */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Whether one path is a directory (following links). */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** `realpath` with a fallback: an unresolvable path is reported as itself. */
async function resolved(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/**
 * One file's header, from the cache when the file has not changed.
 * @returns the header, or `null` when the file is absent or unusable.
 */
async function readHeader(path: string, logger: LoggerLike): Promise<SkillFrontmatter | null> {
  let fingerprint: { mtimeMs: number; size: number }
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    fingerprint = { mtimeMs: info.mtimeMs, size: info.size }
  } catch {
    return null
  }
  const cached = headerCache.get(path)
  if (cached && cached.mtimeMs === fingerprint.mtimeMs && cached.size === fingerprint.size) {
    return cached.header
  }
  let header: SkillFrontmatter | null = null
  if (fingerprint.size > MAX_SKILL_FILE_BYTES) {
    logger.warn(`${LOG_PREFIX}: skill file ${path} ignored: larger than a skill header ought to be`)
  } else {
    try {
      header = readSkillFrontmatter(await readFile(path, 'utf8'))
    } catch (error) {
      logger.warn(`${LOG_PREFIX}: cannot read skill file ${path}: ${toErrorMessage(error)}`)
    }
    if (header === null) logger.warn(`${LOG_PREFIX}: skill file ${path} ignored: unusable frontmatter`)
  }
  if (headerCache.size >= HEADER_CACHE_LIMIT) headerCache.clear()
  headerCache.set(path, { ...fingerprint, header })
  return header
}

/** Whether an error means "nothing there", which is not a failure to report. */
function isAbsent(error: unknown): boolean {
  if (!isRecord(error)) return false
  return error.code === 'ENOENT' || error.code === 'ENOTDIR'
}
