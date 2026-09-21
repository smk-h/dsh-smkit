/**
 * Handing a workspace's OpenSpec footprint to git's ignore list.
 *
 * The panel's delete is the loud answer — remove it all. This is the quiet one,
 * for a team that keeps OpenSpec local: the footprint stays on disk, and git
 * stops asking about it. Three facts decide what happens to each target, and
 * they are asked in the user's order:
 *
 * 1. **Is it already ignored?** `git check-ignore` answers for real — it weighs
 *    every ignore file in scope, `info/exclude` and the global file together,
 *    and it does not report a tracked path as ignored even when a pattern
 *    matches it, because ignore rules do not apply to tracked files. A hit here
 *    means there is nothing to do and the panel only says so.
 * 2. **Is it tracked?** `git ls-files` on the path; any output at all means
 *    files under it sit in the index. Ignoring a tracked file changes nothing
 *    tomorrow, so it is removed from the index first (`git rm -r --cached`,
 *    which leaves the working tree alone) and only then listed.
 * 3. **Is the line already there?** A pattern is appended only when no existing
 *    line in *that file* says the same thing, so pressing the button twice
 *    writes once.
 *
 * **The lines go next to what they hide, not into the repository's own
 * `.gitignore`.** A project's top-level ignore file is a statement about the
 * project; OpenSpec's footprint is a statement about this tool, and writing
 * twelve `.agents/skills/openspec-*` lines into it would turn someone else's
 * file into this plugin's scratch pad. git reads an ignore file in every
 * directory it walks, so:
 *
 * - the store gets an `openspec/.gitignore` holding `*` and `!.gitignore` —
 *   everything below the store is OpenSpec's by definition, and the negation is
 *   what keeps the hiding file itself outside the hiding, so a rule the team can
 *   see and commit is a rule that survives;
 * - every generated entry gets a line naming just itself in the ignore file of
 *   the directory that holds it (`.agents/skills/.gitignore` carrying
 *   `openspec-propose/`, `opsx/`, the ownership marker, …) — a shared directory
 *   says nothing about entries it does not hold, and that file stays visible to
 *   git on purpose, because committing it is what tells the rest of the team
 *   the same thing.
 *
 * The repo is checked before any of this: outside a git working tree every
 * question above is meaningless, so the action answers "not a repo" and touches
 * nothing — and a missing `git` binary is reported as its own reason, because
 * "install git" and "this folder is not a repo" need different sentences.
 *
 * The targets are the inspection's own list re-derived on the host — the store
 * plus every generated entry — never paths the browser could name, the same
 * rule the delete runs by.
 *
 * `untrackOpenSpec` at the bottom of this file is the way back, and it is
 * deliberately less than the mirror: it only edits the ignore files. The lines
 * this action wrote are taken out (the store's own file goes whole — it exists
 * because of that button, so nothing in it can belong to anyone else; a shared
 * directory's file is pruned exactly the way the delete prunes it, and only
 * leaves if nothing else was in it), and git is asked nothing at all. What the
 * index does with an entry that stopped being hidden is git's and the user's
 * business — this button never stages, never commits, never shells out.
 */

import { execFile } from 'node:child_process'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { LOG_PREFIX } from '../../platform/constants.js'
import { toErrorMessage } from '../../platform/util/text.js'
import { IGNORE_FILE_NAME, OPENSPEC_IGNORE_HEADER } from './constants.js'
import { inspectOpenSpec, isInsideRoot } from './inspect.js'
import { isOpenspecRule } from './remove.js'
import type {
  OpenSpecIgnoreCleanup,
  OpenSpecIgnoreResponse,
  OpenSpecIgnoreResult,
  OpenSpecUntrackResponse,
  OpenSpecUntrackResult,
} from '../../../shared/openspec/contract.js'
import type { GitRunner, OpenSpecIgnoreDeps } from './types.js'

/** One footprint entry, in every spelling the three questions and the write need. */
interface Target {
  /** Absolute, for the containment check. */
  abs: string
  /** Repo-relative with forward slashes — the pathspec git is addressed by. */
  rel: string
  /** Absolute path of the ignore file this entry belongs to. */
  file: string
  /**
   * The lines this entry needs in that file, in the order they are written.
   *
   * One for a skill or a command — its own name — and two for the store: the
   * `*` that hides its contents and the `!.gitignore` that keeps the hiding
   * file itself out of what is hidden.
   */
  patterns: string[]
  /** Whether this is the store, whose own file goes whole on the way back. */
  store: boolean
}

/**
 * The footprint as ignore targets: the store (when it exists), then every
 * generated entry, each paired with the ignore file it belongs in. Entries that
 * do not sit inside the repository root are dropped rather than refused — the
 * inspection already scoped them to its own project root, so one that escaped
 * here is a disagreement between two roots, and the safe reading is "not ours".
 */
function targetsOf(root: string, view: Awaited<ReturnType<typeof inspectOpenSpec>>): Target[] {
  const of = (abs: string, file: string, patterns: string[], store = false): Target => ({
    abs,
    rel: relative(root, abs).split('\\').join('/'),
    file,
    patterns,
    store,
  })
  const targets: Target[] = []
  if (view.store !== undefined) {
    // The store's own file, hiding everything below it — and naming itself on
    // the way out, because an ignore file that hides itself cannot be committed,
    // and a private rule of this tool would then have to be re-derived on every
    // other machine instead of travelling with the repository.
    targets.push(of(view.store.path, join(view.store.path, IGNORE_FILE_NAME), ['*', '!.gitignore'], true))
  }
  for (const group of view.artifacts) {
    for (const entry of group.entries) {
      // One line naming one entry, in the ignore file of the directory holding
      // it — the directory is shared with material that is not OpenSpec's, so
      // the line may not be wider than the entry it speaks for.
      targets.push(
        of(entry.path, join(group.path, IGNORE_FILE_NAME), [entry.kind === 'dir' ? `${entry.name}/` : entry.name]),
      )
    }
  }
  return targets.filter((target) => isInsideRoot(root, target.abs))
}

/** Whether the file already carries this pattern, in either spelling of a directory. */
function alreadyListed(lines: readonly string[], pattern: string): boolean {
  const wanted = pattern.replace(/\/$/, '')
  return lines.some((line) => line.replace(/\/$/, '') === wanted)
}

/**
 * Ask git where the working tree starts, or collect the two reasons it cannot.
 *
 * The gate the ignore run asks its questions behind: outside a git working
 * tree every question that action asks is meaningless, so the answer is
 * "not a repo" and nothing is touched — and a missing `git` binary is its own
 * reason, because "install git" and "this folder is not a repo" need different
 * sentences.
 */
async function repoGate(
  probeCwd: string,
  deps: OpenSpecIgnoreDeps,
): Promise<{ root: string } | { refused: { repo: false; reason: 'no-git' | 'not-a-repo'; results: never[] } }> {
  try {
    const probe = await deps.runGit(['rev-parse', '--show-toplevel'], { cwd: probeCwd })
    if (probe.code !== 0) return { refused: { repo: false, reason: 'not-a-repo', results: [] } }
    return { root: probe.stdout.trim() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { refused: { repo: false, reason: 'no-git', results: [] } }
    }
    throw error
  }
}

/**
 * Ignore the footprint of one workspace, or say why it cannot.
 *
 * @param cwd - the workspace directory the panel is showing.
 * @param deps - the logger, and the git runner seam.
 */
export async function ignoreOpenSpec(cwd: string, deps: OpenSpecIgnoreDeps): Promise<OpenSpecIgnoreResponse> {
  const view = await inspectOpenSpec(cwd)

  // The gate, and the ground truth for where anything belongs: git itself names
  // the working-tree root, so a store derived from a hand-walked `.git` that
  // disagrees with it yields to git's answer.
  const gate = await repoGate(resolve(cwd), deps)
  if ('refused' in gate) return gate.refused
  const root = gate.root

  const results: OpenSpecIgnoreResult[] = []
  /** The lines each ignore file is to receive, keyed by that file. */
  const pending = new Map<string, string[]>()
  for (const target of targetsOf(root, view)) {
    const rel = target.rel
    const ignoreFile = relative(root, target.file).split('\\').join('/')
    const record = (over: Partial<OpenSpecIgnoreResult>): void => {
      results.push({
        rel,
        ignoreFile,
        patterns: target.patterns,
        ignored: false,
        untracked: false,
        listed: false,
        alreadyListed: false,
        ...over,
      })
    }
    try {
      // 1. already ignored, by whatever rule git weighs — nothing to change.
      const ignoredHit = await deps.runGit(['check-ignore', '--', rel], { cwd: root })
      if (ignoredHit.code === 0) {
        record({ ignored: true })
        continue
      }
      // 2. anything listed in the index must leave it before an ignore would mean anything.
      const trackedFiles = await deps.runGit(['ls-files', '--', rel], { cwd: root })
      let untracked = false
      if (trackedFiles.stdout.trim() !== '') {
        const removed = await deps.runGit(['rm', '-r', '--cached', '--', rel], { cwd: root })
        if (removed.code !== 0) {
          const why = removed.stderr.trim() || removed.stdout.trim() || 'git rm --cached failed'
          record({ error: why })
          continue
        }
        untracked = true
      }
      // 3. the lines themselves, written only where they are not already said.
      const existing = await readFile(target.file, 'utf8').catch(() => '')
      const lines = existing.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'))
      const queued = pending.get(target.file) ?? []
      const missing = target.patterns.filter((pattern) => !alreadyListed(lines, pattern) && !queued.includes(pattern))
      if (missing.length === 0) {
        record({ untracked, alreadyListed: true })
        continue
      }
      pending.set(target.file, [...queued, ...missing])
      record({ untracked, listed: true })
    } catch (error) {
      record({ error: toErrorMessage(error) })
    }
  }

  const files: string[] = []
  for (const [file, patterns] of pending) {
    const existing = await readFile(file, 'utf8').catch(() => '')
    // The lines join whatever the file already said under one marker comment, so
    // the next dedup pass — and a human skimming the file — both find them.
    const block = [OPENSPEC_IGNORE_HEADER, ...patterns].join('\n')
    const tail = existing === '' || existing.endsWith('\n') ? '' : '\n'
    await writeFile(file, `${existing}${tail}${block}\n`, 'utf8')
    files.push(relative(root, file).split('\\').join('/'))
  }
  if (files.length > 0) {
    deps.logger.info(`${LOG_PREFIX}: updated ${files.length} gitignore file(s) for OpenSpec in ${root}`)
  }

  return { repo: true, ...(files.length > 0 ? { files } : {}), results }
}

/**
 * Take the footprint's lines back out of the ignore files — and nothing else.
 *
 * This action never asks git anything: it is a file edit, not an index
 * operation. Removing a line from an ignore file is the whole promise; whether
 * the entry then shows up in `git status`, and what the user does about it,
 * belong to git and to the user. That also means the walk needs no repo gate —
 * the inspection already found the footprint under a project root, and lines
 * this tool wrote can be taken back wherever that root lives.
 *
 * Two kinds of file, two kinds of take-back — the same distinction the delete
 * draws. The store's own `.gitignore` goes whole: the ignore button created it,
 * so nothing inside it can belong to anyone else. A shared directory's file is
 * pruned, not deleted: the lines naming this footprint's entries come out, the
 * heading follows once no OpenSpec-shaped line stands under it, and only a file
 * left with nothing but blank lines is unmade altogether — anything a human
 * wrote there survives word for word, in the file's own end-of-line style.
 *
 * @param cwd - the workspace directory the panel is showing.
 * @param deps - the logger.
 */
export async function untrackOpenSpec(cwd: string, deps: OpenSpecIgnoreDeps): Promise<OpenSpecUntrackResponse> {
  const view = await inspectOpenSpec(cwd)
  const root = view.root

  const targets = targetsOf(root, view)
  const records: OpenSpecUntrackResult[] = targets.map((target) => ({
    rel: target.rel,
    ignoreFile: relative(root, target.file).split('\\').join('/'),
    patterns: target.patterns,
    unlisted: false,
    alreadyUnlisted: false,
  }))

  // — the lines first, one file at a time —
  const files: OpenSpecIgnoreCleanup[] = []
  const byFile = new Map<string, number[]>()
  targets.forEach((target, index) => {
    const members = byFile.get(target.file) ?? []
    members.push(index)
    byFile.set(target.file, members)
  })
  for (const [file, members] of byFile) {
    const relFile = relative(root, file).split('\\').join('/')
    const storeIndex = members.find((index) => targets[index].store)
    if (storeIndex !== undefined) {
      // The store's file is this pair of buttons' own making: contents and all,
      // it says nothing about anyone but the store, so it is removed whole
      // rather than pruned line by line.
      try {
        const text = await readFile(file, 'utf8')
        const lines = text
          .split(/\r?\n/)
          .filter((line) => line.trim() !== '' && line.trim() !== OPENSPEC_IGNORE_HEADER).length
        await unlink(file)
        records[storeIndex].unlisted = true
        files.push({ rel: relFile, lines, deleted: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') records[storeIndex].alreadyUnlisted = true
        else records[storeIndex].error = toErrorMessage(error)
      }
      continue
    }
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      text = ''
    }
    const lines = text.split(/\r?\n/)
    const gone = new Set<number>()
    for (const index of members) {
      const wanted = targets[index].patterns.map((pattern) => pattern.replace(/\/$/, ''))
      let hit = false
      lines.forEach((line, at) => {
        if (!gone.has(at) && wanted.includes(line.trim().replace(/\/$/, ''))) {
          gone.add(at)
          hit = true
        }
      })
      if (hit) records[index].unlisted = true
      else records[index].alreadyUnlisted = true
    }
    if (gone.size === 0) continue
    try {
      const kept = lines.filter((_, at) => !gone.has(at))
      // The heading signs our block; with no OpenSpec-shaped line left under it,
      // it signs nothing and is ours to take back.
      const left = kept.some((line) => isOpenspecRule(line.trim()))
        ? kept
        : kept.filter((line) => line.trim() !== OPENSPEC_IGNORE_HEADER)
      if (left.every((line) => line.trim() === '')) {
        await unlink(file)
        files.push({ rel: relFile, lines: gone.size, deleted: true })
        continue
      }
      while (left.length > 0 && left[left.length - 1].trim() === '') left.pop()
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      await writeFile(file, `${left.join(eol)}${eol}`, 'utf8')
      files.push({ rel: relFile, lines: gone.size, deleted: false })
    } catch (error) {
      // The file could not be rewritten, so the lines that matched still stand
      // in it — the entries above must say they were not taken back after all.
      const why = toErrorMessage(error)
      for (const index of members) {
        if (records[index].unlisted) records[index].error = why
      }
    }
  }

  if (files.length > 0) {
    deps.logger.info(
      `${LOG_PREFIX}: took OpenSpec back out of the ignore files in ${root}`
        + ` (${files.length} file(s) tidied)`,
    )
  }

  return { ...(files.length > 0 ? { files } : {}), results: records }
}

/**
 * The real runner: `execFile('git', …)`, answering with the exit code rather
 * than throwing on non-zero.
 *
 * This feature's git questions are *answered* by non-zero exits — `check-ignore`
 * exits 1 for "not ignored" — so a runner that turned every non-zero into an
 * exception would turn every honest "no" into a failure. Only a missing `git`
 * itself (ENOENT) rejects, which the caller reads as the not-installed reason.
 * No shell: each path reaches git as its own argument, so a directory name with
 * shell metacharacters in it stays just a name.
 */
export const runGit: GitRunner = (args, options) =>
  new Promise((execResolve, execReject) => {
    execFile(
      'git',
      [...args],
      { cwd: options.cwd, windowsHide: true, maxBuffer: 1 << 20 },
      (error, stdout, stderr) => {
        if (error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          execReject(error)
          return
        }
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        execResolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' })
      },
    )
  })
