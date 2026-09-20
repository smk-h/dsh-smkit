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

/** `POST /openspec/delete` answering with what it removed. */
export interface OpenSpecRemoveResponse {
  /** Project-relative paths removed, in the order they were removed. */
  removed: string[]
  /** Targets that survived, with why. */
  failed: OpenSpecRemoveFailure[]
  /** Measured bytes the removed targets held. */
  bytes: number
}
