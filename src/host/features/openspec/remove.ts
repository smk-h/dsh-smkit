/**
 * Removing a workspace's OpenSpec footprint: the store, and every skill or
 * command entry the tool integrations left behind.
 *
 * The panel's delete is one action over several targets, so the interesting
 * design questions are what a target is and what makes one safe to remove.
 *
 * **A target is re-derived, never received.** The client sends a workspace
 * directory and nothing else; the list of targets is the result of inspecting
 * the disk here, in this process, from the same tool table the panel listed.
 * Nothing a browser could send names a path that gets deleted.
 *
 * **Only OpenSpec's own entries are targets.** The directories this feature
 * looks in are shared — `.agents/skills` holds every skill a machine has, and a
 * tool's command directory holds every command its owner wrote — so the unit of
 * deletion is one generated entry (`openspec-*`, `opsx*`), never the directory,
 * and the rule is re-checked per target at the moment of the write.
 *
 * **Every target is checked against the root it came from.** The store must be
 * `<root>/openspec` exactly, and an artifact entry must be a direct child of
 * the directory its group was derived from, which must itself sit inside the
 * project root. A tool table entry that ever grew a `..` would therefore fail
 * the check instead of deleting something outside the workspace.
 *
 * **The entry, not its target.** A link is unlinked rather than followed, on
 * both platforms: `lstat` catches a symlink, and on Windows a junction — which
 * `lstat` reports as an ordinary directory — is caught by `readlink` and
 * removed with `rmdir`, which takes the reparse point and leaves the tree it
 * points at alone. `openspec init` never creates either, but a hand-organised
 * skill collection routinely does, and a recursive delete would then destroy
 * whatever the link pointed at.
 *
 * A target that cannot be removed does not abort the rest: each one is
 * attempted, failures are collected with a reason, and the panel shows what
 * survived. A half-removed OpenSpec is a state a user can act on; a delete that
 * stopped at the first surprise is not.
 *
 * **What hid an entry is tidied after it.** The ignore action writes one line
 * per generated entry into the directory holding it, so a delete that removed
 * the entries and left the lines would be reporting names that no longer mean
 * anything — and hiding whatever lands in that directory next. Each affected
 * directory's `.gitignore` is therefore re-read and pruned, and a file holding
 * nothing but what this feature wrote into it is removed whole rather than left
 * as an empty shell (see `pruneIgnoreFile`).
 */

import { lstat, readFile, readlink, rmdir, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { LOG_PREFIX } from '../../platform/constants.js'
import { isRecord, toErrorMessage } from '../../platform/util/text.js'
import {
  COMMAND_PREFIX,
  IGNORE_FILE_NAME,
  MARKER_FILE_NAME,
  OPENSPEC_IGNORE_HEADER,
  OPENSPEC_MISSING_ERROR,
  OPENSPEC_NOT_OPENSPEC_ERROR,
  OPENSPEC_OUTSIDE_ERROR,
  SKILL_PREFIX,
  STORE_DIR,
} from './constants.js'
import { inspectOpenSpec, isInsideRoot } from './inspect.js'
import type {
  OpenSpecIgnoreCleanup,
  OpenSpecRemoveFailure,
  OpenSpecRemoveResponse,
} from '../../../shared/openspec/contract.js'
import type { LoggerLike } from '../../platform/types.js'

/**
 * One thing a delete will address, with how much it held when it was read.
 *
 * Exported with `removalRefusal` so the scoping rule can be asserted directly
 * rather than inferred from a fixture: the check is what stands between a
 * shared directory and the material in it that is not OpenSpec's, and it is
 * worth exercising at its edges.
 */
export interface OpenSpecRemovalTarget {
  /** Absolute path. */
  path: string
  /** Project-relative path, for the answer and the log. */
  rel: string
  /** Measured bytes, taken from the inspection: the read is what measured it. */
  bytes: number
  /** The directory the target was derived from, or `null` for the store. */
  parent: string | null
  /** What the inspection claimed the entry is, which decides how it is re-checked. */
  kind: 'store' | 'skills' | 'commands' | 'extra'
}

/**
 * Why this target must not be removed, or `null` when it is safe.
 *
 * The inspection already refused to list anything outside the project root, so
 * these are not the checks that keep a browser from naming a path — the browser
 * cannot name one at all. They are the checks that keep *this feature* honest
 * about its own scope, re-run at the moment of the write rather than trusted
 * from the read, in three layers:
 *
 * 1. the target sits inside the project root;
 * 2. the two spellings of it agree, so a path that moved between the two is a
 *    mismatch rather than a surprise;
 * 3. it is still a direct child of the directory its group came from, and still
 *    carries the name OpenSpec gives its own entries.
 *
 * The third is the one the scoping rule lives in. `.agents/skills` is where a
 * machine keeps every skill it has, and a tool's command directory is every
 * command its owner wrote; a delete that took the directory, or took an entry
 * because it happened to be listed, would take material that is not OpenSpec's.
 * So an entry is removed only when it is named `openspec-…` (a skill) or
 * `opsx…` (a command) *right now*, whatever the listing said a moment ago.
 *
 * @param root - the project root the inspection started from.
 * @param target - the derived target.
 */
export function removalRefusal(root: string, target: OpenSpecRemovalTarget): string | null {
  if (!isInsideRoot(root, target.path)) return OPENSPEC_OUTSIDE_ERROR
  if (relative(root, target.path).split(sep).join('/') !== target.rel) return OPENSPEC_OUTSIDE_ERROR
  if (target.kind === 'store') {
    // The store is one directory with a fixed name at the root; anything else
    // wearing the label would be a derivation bug, not a store.
    return basename(target.path) === STORE_DIR ? null : OPENSPEC_OUTSIDE_ERROR
  }
  if (target.parent === null) return OPENSPEC_OUTSIDE_ERROR
  if (!isInsideRoot(root, target.parent)) return OPENSPEC_OUTSIDE_ERROR
  // A direct child, not a descendant: the entry must be the thing the group
  // directory listed, and nothing a stray path segment could redirect.
  if (dirname(target.path) !== target.parent) return OPENSPEC_OUTSIDE_ERROR
  const name = basename(target.path)
  if (target.kind === 'skills' || target.kind === 'commands') {
    const prefix = target.kind === 'skills' ? SKILL_PREFIX : COMMAND_PREFIX
    // The ownership marker is OpenSpec's own even though it carries neither
    // prefix: it is the file a later `openspec update` would use to bring the
    // generated entries back, so leaving it would undo the removal.
    if (name.startsWith(prefix) || name === MARKER_FILE_NAME) return null
    return OPENSPEC_NOT_OPENSPEC_ERROR
  }
  // An `extra` is one exact file the tool table names; the derivation check
  // above is what covers it, since there is no prefix to match on.
  return null
}

/** Whether a directory is a Windows junction rather than a real directory. */
async function isJunction(path: string): Promise<boolean> {
  if (process.platform !== 'win32') return false
  try {
    await readlink(path)
    return true
  } catch {
    return false
  }
}

/**
 * Delete one entry: a directory tree, a file, or just the link.
 * @param path - an absolute path a `Target` was built for.
 * @returns what was removed, for the log line.
 */
async function removeEntry(path: string): Promise<'link' | 'file' | 'directory'> {
  const info = await lstat(path)
  if (info.isSymbolicLink()) {
    await unlink(path)
    return 'link'
  }
  if (info.isFile()) {
    await unlink(path)
    return 'file'
  }
  if (await isJunction(path)) {
    await rmdir(path)
    return 'link'
  }
  await rm(path, { recursive: true, force: false })
  return 'directory'
}

/** Whether one ignore line speaks for an OpenSpec-generated entry. */
function isOpenspecRule(rule: string): boolean {
  const name = rule.replace(/\/$/, '')
  return name.startsWith(SKILL_PREFIX) || name.startsWith(COMMAND_PREFIX) || name === MARKER_FILE_NAME
}

/**
 * Take the lines of removed entries out of the ignore file of the directory that
 * held them — and take the file with them when nothing else was in it.
 *
 * A `.gitignore` written beside the footprint says who owns what: the panel's
 * ignore action puts one line per generated entry into the shared directory's
 * own file, and a delete that left those lines behind would describe entries
 * that no longer exist and, worse, hide whatever name comes next. So each
 * directory whose entries were removed is re-read here, and the lines that named
 * them come out — in either spelling, since git reads `openspec-propose` and
 * `openspec-propose/` as the same entry.
 *
 * Two things then follow from what is left:
 *
 * - no OpenSpec-shaped line remains, so the `# Added by dsh-smkit: OpenSpec`
 *   heading has no block left to head and is taken back too;
 * - no line with content remains at all, which means the file held nothing but
 *   what this pair of actions wrote into it, so the file itself goes rather than
 *   surviving as a comment and some blank lines.
 *
 * Anything else anyone wrote — their rules, their comments — keeps the file, and
 * keeps its words intact: the lines that stay are written back as they were
 * read, in the file's own end-of-line style.
 *
 * @param root - the project root, for the path the answer reports.
 * @param dir - the absolute path of the directory whose file is being tidied.
 * @param names - the base names of the entries actually removed from it.
 * @returns what came out, or `null` when there was nothing of ours here.
 */
async function pruneIgnoreFile(root: string, dir: string, names: readonly string[]): Promise<OpenSpecIgnoreCleanup | null> {
  const file = join(dir, IGNORE_FILE_NAME)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    // No file at all: the entries were git's to ask about, never this
    // directory's to describe, so there is nothing to take back.
    return null
  }
  const gone = new Set(names)
  const lines = text.split(/\r?\n/)
  const kept = lines.filter((line) => !gone.has(line.trim().replace(/\/$/, '')))
  const dropped = lines.length - kept.length
  const heading = (line: string): boolean => line.trim() === OPENSPEC_IGNORE_HEADER
  // The heading heads our block; once the block is gone it is a signature over
  // nothing, which is ours to remove and nothing else's to lose.
  const left = kept.some((line) => isOpenspecRule(line.trim())) ? kept : kept.filter((line) => !heading(line))
  if (dropped === 0 && left.length === kept.length) return null
  const rel = relative(root, file).split(sep).join('/')
  if (left.every((line) => line.trim() === '')) {
    await unlink(file)
    return { rel, lines: dropped, deleted: true }
  }
  while (left.length > 0 && left[left.length - 1].trim() === '') left.pop()
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const out = `${left.join(eol)}${eol}`
  if (out === text) return null
  await writeFile(file, out, 'utf8')
  return { rel, lines: dropped, deleted: false }
}

/**
 * Remove everything OpenSpec owns in one workspace — and only that.
 *
 * Every target is re-derived from the disk in this call and re-checked against
 * the root and the name prefix it claims (see `removalRefusal`), which is what makes
 * this scoped rather than sweeping: `.agents/skills` loses its `openspec-*`
 * entries and keeps every other skill it holds, a command directory loses its
 * `opsx*` entries and keeps every other command, and the directories themselves
 * are never targets at all. `OpenSpecArtifacts.kept` is the inspection's own
 * report of what this leaves behind; the panel shows it before and after.
 *
 * @param cwd - the workspace directory the panel was showing.
 * @param logger - the host logger; every removal is announced here.
 */
export async function removeOpenSpec(
  cwd: string,
  logger: LoggerLike,
): Promise<OpenSpecRemoveResponse> {
  const view = await inspectOpenSpec(cwd)
  const root = view.root
  const targets: OpenSpecRemovalTarget[] = []
  if (view.store !== undefined) {
    targets.push({
      path: view.store.path,
      rel: view.store.rel,
      bytes: view.store.bytes,
      parent: null,
      kind: 'store',
    })
  }
  for (const group of view.artifacts) {
    for (const entry of group.entries) {
      // The group's own directory is never a target: only the entries in it
      // that carry OpenSpec's name are, and `refusalOf` checks that again.
      targets.push({
        path: entry.path,
        rel: entry.rel,
        bytes: entry.bytes,
        parent: group.path,
        kind: group.kind,
      })
    }
  }

  const removed: string[] = []
  const failed: OpenSpecRemoveFailure[] = []
  /** The base names actually removed, per directory that held them: what its ignore file must stop naming. */
  const goneByDir = new Map<string, string[]>()
  let bytes = 0
  for (const target of targets) {
    const refusal = removalRefusal(root, target)
    if (refusal !== null) {
      failed.push({ rel: target.rel, error: refusal })
      continue
    }
    try {
      const what = await removeEntry(target.path)
      removed.push(target.rel)
      bytes += target.bytes
      if (target.parent !== null) {
        const gone = goneByDir.get(target.parent)
        const name = basename(target.path)
        if (gone === undefined) goneByDir.set(target.parent, [name])
        else gone.push(name)
      }
      logger.info(`${LOG_PREFIX}: removed OpenSpec ${what} at ${target.path}`)
    } catch (error) {
      // Gone between the inspection and the delete (another window, a hand-run
      // `rm -rf`): the same miss as an entry that was never there, not a fault.
      failed.push({
        rel: target.rel,
        error: isRecord(error) && error.code === 'ENOENT' ? OPENSPEC_MISSING_ERROR : toErrorMessage(error),
      })
    }
  }

  // The tidy-up, after the removals rather than among them: an entry that
  // survived is still named by the line that hides it, and an entry that is gone
  // must stop being named.
  const ignoreFiles: OpenSpecIgnoreCleanup[] = []
  for (const [dir, names] of goneByDir) {
    try {
      const cleaned = await pruneIgnoreFile(root, dir, names)
      if (cleaned === null) continue
      ignoreFiles.push(cleaned)
      logger.info(
        `${LOG_PREFIX}: ${cleaned.deleted ? 'removed' : `pruned ${cleaned.lines} OpenSpec line(s) from`} ${cleaned.rel}`,
      )
    } catch (error) {
      // The entries are gone; the file that used to name them is still there
      // with its stale lines, which is exactly the kind of survivor the panel
      // lists rather than hides in a log.
      failed.push({ rel: relative(root, join(dir, IGNORE_FILE_NAME)).split(sep).join('/'), error: toErrorMessage(error) })
    }
  }
  return { removed, failed, bytes, ...(ignoreFiles.length > 0 ? { ignoreFiles } : {}) }
}
