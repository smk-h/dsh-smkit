/**
 * The wire contract of the OpenSpec feature.
 *
 * The host inspects one workspace's project root and serves these shapes over
 * `/mcp-manager/api/openspec*`; the browser half renders exactly these shapes.
 * They live outside both `src/host` and `src/client` for the same reason the
 * MCP and skills contracts do: each half would otherwise declare its own copy
 * of such a shape, and nothing would catch the two drifting apart.
 *
 * Type-only by design: the browser bundle is a single CommonJS script with no
 * module resolver, and `import type` is erased before bundling, so nothing here
 * reaches any emitted code.
 *
 * Paths travel in two spellings on purpose:
 *
 * - `path` is absolute, and is what a delete addresses — the host re-derives it
 *   from its own tool table rather than trusting the client's copy;
 * - `rel` is relative to the project root with forward slashes, and is what the
 *   panel renders. A workspace path printed in full would be the whole panel.
 */

/** Whether one entry is a directory or a plain file. */
export type OpenSpecEntryKind = 'dir' | 'file'

/** One node of the `openspec/` tree the panel draws. */
export interface OpenSpecTreeNode {
  /** Base name, as the directory listing spells it. */
  name: string
  /** Project-relative path with forward slashes (`openspec/specs/auth`). */
  rel: string
  kind: OpenSpecEntryKind
  /**
   * Bytes below this node: the file's own size, or the sum of a directory's
   * children. A directory the scan stopped at reports what it measured, and the
   * view's `truncated` says the number is a floor rather than a total.
   */
  bytes: number
  /** Direct children, for a directory. Absent on a file. */
  children?: OpenSpecTreeNode[]
}

/**
 * One part of the store's fixed layout (`specs/`, `changes/`, `config.yaml`, …).
 *
 * The parts answer a question the tree cannot: a tree shows what is there, and
 * "the layout expects `specs/` and it is not there" is about what is *not*.
 * `required` is what separates the two readings — a store is described by what
 * is on disk, but it is only judged incomplete against what the CLI was
 * supposed to have written.
 *
 * The part's own contents are deliberately absent: anything under it is in
 * `OpenSpecStore.tree`, and a payload that describes the same files twice is
 * two answers that can disagree.
 */
export interface OpenSpecPart {
  /** The name inside `openspec/` this part is known by. */
  name: string
  /** Project-relative path (`openspec/changes`). */
  rel: string
  kind: OpenSpecEntryKind
  /** Whether it is on disk right now. */
  exists: boolean
  /** Whether the layout is incomplete without it. */
  required: boolean
}

/** The `openspec/` directory itself: what a delete removes in one piece. */
export interface OpenSpecStore {
  /** Absolute path of `<projectRoot>/openspec`. */
  path: string
  /** Project-relative path, which is `openspec` by construction. */
  rel: string
  /** Measured bytes below the store. */
  bytes: number
  /** Regular files below the store. */
  files: number
  /** Directories below the store, the store itself excluded. */
  dirs: number
  /** The layout parts, whether or not each exists. */
  parts: OpenSpecPart[]
  /** The tree below the store, directories first, depth- and size-bounded. */
  tree: OpenSpecTreeNode[]
}

/** One entry an OpenSpec tool integration left in the workspace. */
export interface OpenSpecArtifactEntry {
  /** Base name: `openspec-propose`, `opsx-propose.md`, `opsx`, … */
  name: string
  /** Absolute path, and therefore the thing a delete addresses. */
  path: string
  /** Project-relative path with forward slashes. */
  rel: string
  kind: OpenSpecEntryKind
  /** Measured bytes: a file's size, or a bounded sum below a directory. */
  bytes: number
  /**
   * Whether this is the CLI's own ownership marker (`.openspec-target`) rather
   * than a generated skill or command.
   *
   * It is OpenSpec's to remove — left behind, it is what makes the next
   * `openspec update` restore what was just deleted — but it is neither of the
   * two things the list is headed by, so the fact travels with the entry
   * instead of a dotfile being filed silently among the skills.
   */
  marker: boolean
}

/**
 * One directory's worth of OpenSpec artifacts, grouped by what wrote them.
 *
 * A group is a directory, not a tool: several tool ids share one directory
 * (`codex`, `zed` and `agents` all target `.agents/skills`), and listing that
 * directory once with both names is the honest picture of what is on disk.
 *
 * A group is also never the unit of deletion. `.agents/skills` is where a
 * machine keeps *all* its skills, and the same is true of a tool's command
 * directory, so only `entries` is ever removed — `kept` is the rest of the
 * directory, reported so the panel can say out loud what a delete leaves alone.
 */
export interface OpenSpecArtifacts {
  /** Every tool id whose configuration named this directory. */
  tools: string[]
  /**
   * `skills` for `openspec-*` skill directories, `commands` for `opsx*`
   * command files or namespaces, `extra` for a single generated file.
   */
  kind: 'skills' | 'commands' | 'extra'
  /** Absolute path of the directory the entries sit in. */
  path: string
  /** Project-relative path of that directory. */
  rel: string
  /** The entries a delete would remove, in listing order. */
  entries: OpenSpecArtifactEntry[]
  /**
   * How many entries in the same directory are not OpenSpec's — the skills
   * beside `openspec-propose`, the commands beside `opsx`. They are never
   * removed; the count is here so the confirmation can say how much of a shared
   * directory it leaves standing, without listing a machine's other skills back
   * at it.
   */
  keptCount: number
}

/** `GET /openspec`: one workspace's OpenSpec footprint. */
export interface OpenSpecView {
  /** The workspace directory that was asked about, resolved. */
  cwd: string
  /** The project root derived from it: its nearest ancestor carrying `.git`. */
  root: string
  /** Whether `<root>/openspec` exists at all, i.e. whether `openspec init` ran here. */
  initialized: boolean
  /** The store, when it exists. */
  store?: OpenSpecStore
  /** Every tool integration found, whether or not the store exists. */
  artifacts: OpenSpecArtifacts[]
  /**
   * True when the scan had to stop counting — a store or a directory with more
   * entries than the inspection measures — so `bytes` is a floor rather than a
   * total. The panel says so instead of presenting a guess as a fact.
   */
  truncated: boolean
  /** Measured bytes across the store and every artifact entry. */
  totalBytes: number
  /**
   * How many things a delete would remove: the store counts as one (it goes in
   * one piece), plus one per artifact entry.
   */
  totalEntries: number
}

/** One target a delete could not remove. */
export interface OpenSpecRemoveFailure {
  /** Project-relative path of the target. */
  rel: string
  error: string
}

/** `POST /openspec/delete` body. */
export interface OpenSpecRemoveRequest {
  /** The workspace the panel is showing; the host derives everything else. */
  cwd: string
}

/** One `.gitignore` a delete or an un-ignore tidied while it worked. */
export interface OpenSpecIgnoreCleanup {
  /** Project-relative path of the ignore file, the spelling the panel lists. */
  rel: string
  /** How many lines naming a removed entry came out of it. */
  lines: number
  /**
   * Whether the file went with its lines, because nothing else was ever in it —
   * which is how a `.gitignore` this pair of actions created is un-made. The
   * store's own file is not one of these: it is below the store, so the
   * directory's removal takes it along without a word.
   */
  deleted: boolean
}

/** `POST /openspec/delete` answering with what it removed. */
export interface OpenSpecRemoveResponse {
  /** Project-relative paths removed, in the order they were removed. */
  removed: string[]
  /** Targets that survived, with why. */
  failed: OpenSpecRemoveFailure[]
  /** Measured bytes the removed targets held. */
  bytes: number
  /**
   * The shared directories whose `.gitignore` named entries this delete removed,
   * with what came out of each. Absent when there was nothing of ours to take
   * back, which is the usual case in a repository that never used the ignore
   * action.
   */
  ignoreFiles?: OpenSpecIgnoreCleanup[]
}

/* --------------------------------------------------- the .gitignore action */

/**
 * What one footprint entry looked like to git, and what this action did about
 * it. The four flags are the user's questions in order, each answered once:
 *
 * - `ignored` — `git check-ignore` already weighs it ignored (by `.gitignore`,
 *   `info/exclude` or the global file; a *tracked* path is not reported as
 *   ignored, because ignore rules do not apply to tracked files, which is why
 *   `untracked` exists); nothing was changed for it.
 * - `untracked` — files under it sat in the index and were removed from it
 *   (`git rm -r --cached`, working tree untouched); ignoring is meaningless
 *   until this happens.
 * - `listed` — its lines were written into `ignoreFile` now.
 * - `alreadyListed` — that file already said the same thing, so none was
 *   written again; a tracked entry can carry both this and `untracked`.
 *
 * The lines live in the ignore file *next to what they hide* rather than in the
 * repository's own — which is why `ignoreFile` and `patterns` travel per entry.
 * The store hides its contents with a `*` and keeps the hiding file visible with
 * the `!.gitignore` beside it, so the rule can be committed; a shared skill or
 * command directory carries one line per generated entry it holds.
 */
export interface OpenSpecIgnoreResult {
  /** Project-relative path of the entry, the spelling the panel lists. */
  rel: string
  /** Repo-relative path of the `.gitignore` that carries (or would carry) it. */
  ignoreFile: string
  /**
   * The lines inside that file: the entry's own name (a directory with its
   * trailing slash), or `*` and `!.gitignore` for the store.
   */
  patterns: string[]
  ignored: boolean
  untracked: boolean
  listed: boolean
  alreadyListed: boolean
  /** The git command's own words, when answering for this entry failed. */
  error?: string
}

/** `POST /openspec/gitignore` body. */
export interface OpenSpecIgnoreRequest {
  /** The workspace the panel is showing; the host derives the repo and targets. */
  cwd: string
}

/** `POST /openspec/gitignore` answering with what each entry became. */
export interface OpenSpecIgnoreResponse {
  /**
   * Whether `cwd` sits inside a git working tree at all. The whole action is
   * gated on this: false means nothing was checked, untracked or written, and
   * `results` is empty.
   */
  repo: boolean
  /**
   * Why there was no repo to work in, when `repo` is false: the `git` command
   * is missing from PATH, or the directory sits outside any work tree. They
   * need different sentences — one is an install step, the other is the answer.
   */
  reason?: 'no-git' | 'not-a-repo'
  /**
   * Repo-relative paths of the ignore files created or extended, in the order
   * they were written. Absent when every line already sat where it belongs, so
   * the panel can say "nothing was written" rather than list empty files; one
   * directory's file covers every entry it holds, which is why this is a list of
   * files and not one per entry (`results` carries that mapping as `ignoreFile`).
   */
  files?: string[]
  /** Every footprint entry the action was offered for, in footprint order. */
  results: OpenSpecIgnoreResult[]
}

/* --------------------------------------------------- the un-ignore action */

/**
 * What one footprint entry looked like to the un-ignore run, and what it did
 * about it — the mirror of {@link OpenSpecIgnoreResult}, asked in the mirror's
 * order:
 *
 * - `unlisted` — its lines were taken out of `ignoreFile` now. The store's own
 *   file is deleted whole rather than pruned: this feature created it, so
 *   nothing in it can belong to anyone else.
 * - `alreadyUnlisted` — no line in that file named it (or the file was gone),
 *   so nothing was taken out; hiding it never came from these files.
 * - `tracked` — files under it already sit in the index; nothing was staged for
 *   it, because staging is the user's business, not this action's.
 * - `retracked` — it was out of the index and `git add` put it back; the lines
 *   above had to come out first, or git would have refused.
 * - `stillIgnored` — after our lines were gone a rule we do not manage (the
 *   project's own `.gitignore`, `info/exclude`, the global file) still hides
 *   it, so nothing was added; touching that rule is not this button's call.
 *
 * Only an entry that is out of the index is ever offered to `git add`, so a
 * workspace whose OpenSpec was tracked all along is reported, not staged.
 */
export interface OpenSpecUntrackResult {
  /** Project-relative path of the entry, the spelling the panel lists. */
  rel: string
  /** Repo-relative path of the `.gitignore` that carried (or would carry) it. */
  ignoreFile: string
  /** The lines taken out (or looked for): see `OpenSpecIgnoreResult.patterns`. */
  patterns: string[]
  unlisted: boolean
  alreadyUnlisted: boolean
  tracked: boolean
  retracked: boolean
  stillIgnored: boolean
  /** The git command's own words, when answering for this entry failed. */
  error?: string
}

/** `POST /openspec/untrack` body. */
export interface OpenSpecUntrackRequest {
  /** The workspace the panel is showing; the host derives the repo and targets. */
  cwd: string
}

/** `POST /openspec/untrack` answering with what each entry became. */
export interface OpenSpecUntrackResponse {
  /** Whether `cwd` sits inside a git working tree; false means nothing ran. */
  repo: boolean
  /** Why there was no repo, when `repo` is false; see `OpenSpecIgnoreResponse`. */
  reason?: 'no-git' | 'not-a-repo'
  /**
   * The ignore files this run pruned or deleted, per file with how many lines
   * came out and whether the file went with them. Absent when no file carried
   * a line of ours.
   */
  files?: OpenSpecIgnoreCleanup[]
  /** Every footprint entry the action was offered for, in footprint order. */
  results: OpenSpecUntrackResult[]
}

/* ------------------------------------------------------- the tool upgrade */

/**
 * How an `npm install -g @fission-ai/openspec@latest` run ended.
 *
 * The four ways are the four things the panel can say back: it worked, the CLI
 * ran and npm refused, npm itself is not on PATH (so nothing can be upgraded),
 * and the run was killed for taking too long. They travel as a stable code
 * rather than a status number because the panel localises each into its own
 * instruction, and only `ok` needs no instruction.
 */
export type OpenSpecUpdateStatus = 'ok' | 'failed' | 'npm-missing' | 'timeout'

/** One line the upgrade command wrote, streamed as it was produced. */
export interface OpenSpecUpdateLine {
  type: 'line'
  /** Which stream the line came from; the two are kept apart so the panel can
   * mark npm's own warnings differently from its progress. */
  stream: 'out' | 'err'
  text: string
}

/** The upgrade's closing event: how it ended, and the exit code when it ran. */
export interface OpenSpecUpdateDone {
  type: 'done'
  status: OpenSpecUpdateStatus
  /** The command's exit code, or `null` when it never started or was killed. */
  exitCode: number | null
}

/**
 * One frame of `POST /openspec/update`'s event stream.
 *
 * The upgrade is the feature's only long-running action — a global npm install
 * can take tens of seconds — and a button that shows nothing while it works
 * reads as a hung plugin. So the route answers not with a result but with the
 * command's own output, line by line, and this is the shape of each line. The
 * `done` frame closes the stream and carries the verdict.
 */
export type OpenSpecUpdateEvent = OpenSpecUpdateLine | OpenSpecUpdateDone
