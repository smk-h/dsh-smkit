/**
 * Reading one workspace's OpenSpec footprint off the disk.
 *
 * Three questions, answered in one walk of the project root:
 *
 * 1. **Is it initialised?** `<projectRoot>/openspec` existing is the whole
 *    answer — the CLI creates that directory first and nothing else stands in
 *    for it.
 * 2. **What is in there?** The store's layout parts (`specs/`, `changes/`,
 *    `config.yaml`, …) with the entries under each, plus a depth- and
 *    size-bounded tree for the panel to draw. Both are reads of the same
 *    directory, so a store that changes under the panel is at worst a scan
 *    behind, never internally inconsistent.
 * 3. **What did the tool integrations leave?** `openspec init --tools …` writes
 *    skill directories under `<tool>/skills/` and command entries under the
 *    tool's command directory. Both are found by prefix inside the directories
 *    the tool table names, so no path a client could send is ever read from.
 *
 * The project root is derived the way DSH derives it for skills: the nearest
 * ancestor carrying `.git`, falling back to the workspace directory itself. A
 * workspace directory may sit below the repository root (`packages/app`), and
 * `openspec init` writes at the root, so deriving it here rather than in the
 * browser is what makes the panel show the store that actually exists.
 *
 * Nothing here deletes anything; `remove.ts` re-runs this inspection and acts
 * on its own result, so a delete can never address a path that was not derived
 * from the disk a moment earlier.
 */

import { existsSync } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  type OpenSpecStorePart,
  COMMAND_PREFIX,
  MARKER_FILE_NAME,
  MAX_ARTIFACT_ENTRIES,
  MAX_MEASURE_DEPTH,
  MAX_TREE_DEPTH,
  MAX_TREE_NODES,
  OPENSPEC_TOOLS,
  SKILL_PREFIX,
  STORE_DIR,
  STORE_PARTS,
} from './constants.js'
import type {
  OpenSpecArtifactEntry,
  OpenSpecArtifacts,
  OpenSpecPart,
  OpenSpecStore,
  OpenSpecTreeNode,
  OpenSpecView,
} from '../../../shared/openspec/contract.js'

/** Mutable bookkeeping one inspection carries through its walks. */
interface ScanState {
  /** Nodes drawn so far, against `MAX_TREE_NODES`. */
  nodes: number
  /** Whether any bound was hit, i.e. whether the numbers are a floor. */
  truncated: boolean
}

/**
 * The nearest ancestor of `cwd` carrying a `.git` entry — the project root the
 * CLI writes into — falling back to `cwd` itself when the walk reaches the
 * filesystem root.
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
 * Whether `target` is `root` itself or a descendant of it, decided on resolved
 * paths in whole segments: a sibling whose name merely starts with the root's
 * (`/a/openspec-old` next to `/a/openspec`) is not inside it.
 *
 * The check is what makes the delete's own input safe: every path it removes is
 * re-derived here, and this is the assertion that the derivation stayed inside
 * the project it started from.
 */
export function isInsideRoot(root: string, target: string): boolean {
  const child = relative(resolve(root), resolve(target))
  if (child === '') return true
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

/** Whether a path is a directory, following links; `false` for anything absent. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** A path's size when it is a file, `0` when it is not readable. */
async function fileSize(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : 0
  } catch {
    return 0
  }
}

/**
 * Measured bytes below `path`, `depth` levels deep: a file's own size, or the
 * sum of its children.
 *
 * Bounded rather than exhaustive on purpose. A store is markdown and a skill is
 * one file in a directory (two facts that make the numbers useful), and an
 * unbounded walk of whatever a hand-rolled directory contains would turn a
 * hover into a filesystem scan.
 */
async function measure(path: string, depth: number): Promise<number> {
  let info: Stats
  try {
    info = await stat(path)
  } catch {
    return 0
  }
  if (info.isFile()) return info.size
  if (depth <= 0) return 0
  let entries: Dirent[]
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) total += await measure(join(path, entry.name), depth - 1)
  return total
}

/** Directories first, then files, each alphabetically — a stable, scannable order. */
function listingOrder(a: { name: string; isDirectory(): boolean }, b: { name: string; isDirectory(): boolean }): number {
  const rank = (entry: { isDirectory(): boolean }): number => (entry.isDirectory() ? 0 : 1)
  return rank(a) - rank(b) || a.name.localeCompare(b.name)
}

/**
 * Whether a subtree is out of bounds.
 *
 * The two bounds mean different things, and only one of them is a truncation:
 * the depth limit is a drawing rule (the tree stops nesting, and a store below
 * the limit is still fully counted by `countStore`), while the node cap means
 * something was genuinely left unmeasured, which is what `truncated` reports.
 */
function atBound(state: ScanState, depth: number): boolean {
  if (depth > MAX_TREE_DEPTH) return true
  if (state.nodes >= MAX_TREE_NODES) {
    state.truncated = true
    return true
  }
  return false
}

/**
 * The tree below one directory, as the panel draws it.
 *
 * A directory is walked, a file is measured, and both are pushed in listing
 * order; a directory the bounds stop at keeps its place in the tree but no
 * children, because dropping it would make the panel claim the entry is not
 * there at all.
 */
async function readTree(
  abs: string,
  rel: string,
  depth: number,
  state: ScanState,
): Promise<OpenSpecTreeNode[]> {
  if (atBound(state, depth)) return []
  let entries: Dirent[]
  try {
    entries = await readdir(abs, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: OpenSpecTreeNode[] = []
  for (const entry of entries.sort(listingOrder)) {
    if (state.nodes >= MAX_TREE_NODES) {
      state.truncated = true
      break
    }
    state.nodes += 1
    const childAbs = join(abs, entry.name)
    const childRel = `${rel}/${entry.name}`
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(childAbs)))
    if (!isDir) {
      nodes.push({ name: entry.name, rel: childRel, kind: 'file', bytes: await fileSize(childAbs) })
      continue
    }
    const children = await readTree(childAbs, childRel, depth + 1, state)
    nodes.push({
      name: entry.name,
      rel: childRel,
      kind: 'dir',
      bytes: children.reduce((sum, child) => sum + child.bytes, 0),
      children,
    })
  }
  return nodes
}

/**
 * Count what the tree holds, since the tree itself is bounded: `files` and
 * `dirs` come from a plain listing of the store rather than from the drawn
 * nodes, so a truncated tree still reports how much is really there.
 */
async function countStore(abs: string, state: ScanState): Promise<{ files: number; dirs: number }> {
  const queue: string[] = [abs]
  let files = 0
  let dirs = 0
  let visited = 0
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (visited >= MAX_TREE_NODES * 4) {
      state.truncated = true
      break
    }
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      visited += 1
      const child = join(current, entry.name)
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(child)))
      if (isDir) {
        dirs += 1
        queue.push(child)
      } else {
        files += 1
      }
    }
  }
  return { files, dirs }
}

/**
 * One store part: whether the layout's entry is on disk.
 *
 * One `stat` and nothing else. What is *under* the part is not this function's
 * business — the tree draws it, and reading it here as well would be the second
 * answer to the same question (and a directory listing the panel would then
 * have to reconcile with the tree's).
 */
async function readPart(abs: string, rel: string, part: OpenSpecStorePart): Promise<OpenSpecPart> {
  const base = { name: part.name, rel, kind: part.kind, required: part.required }
  return { ...base, exists: (await stat(abs).catch(() => null)) !== null }
}

/** The store itself: its layout parts, its tree, and what it measures. */
async function readStore(
  root: string,
  storePath: string,
  state: ScanState,
): Promise<OpenSpecStore> {
  const rel = relative(root, storePath).split(sep).join('/')
  const parts = await Promise.all(
    STORE_PARTS.map((part) => readPart(join(storePath, part.name), `${rel}/${part.name}`, part)),
  )
  const tree = await readTree(storePath, rel, 1, state)
  const { files, dirs } = await countStore(storePath, state)
  return {
    path: storePath,
    rel,
    bytes: tree.reduce((sum, node) => sum + node.bytes, 0),
    files,
    dirs,
    parts,
    tree,
  }
}

/** One directory to scan, and the tools whose configuration named it. */
interface GroupSeed {
  kind: 'skills' | 'commands' | 'extra'
  /** Project-relative path: a directory for the first two, a file for `extra`. */
  rel: string
  /** The entry-name prefix this group is looking for. */
  prefix: string
  tools: string[]
}

/**
 * Fold the tool table into the directories actually worth listing: one seed per
 * directory, carrying every tool id that pointed at it. `.agents/skills` is the
 * reason this exists — Codex, Zed and the vendor-neutral `agents` target all
 * write there, and listing it three times would triple-count the same folder.
 */
function groupSeeds(): GroupSeed[] {
  const seeds = new Map<string, GroupSeed>()
  const add = (kind: GroupSeed['kind'], rel: string, prefix: string, toolId: string): void => {
    const key = `${kind}:${rel}`
    const existing = seeds.get(key)
    if (existing === undefined) {
      seeds.set(key, { kind, rel, prefix, tools: [toolId] })
      return
    }
    if (!existing.tools.includes(toolId)) existing.tools.push(toolId)
  }
  for (const tool of OPENSPEC_TOOLS) {
    for (const rel of tool.skills) add('skills', rel, SKILL_PREFIX, tool.id)
    for (const rel of tool.commands) add('commands', rel, COMMAND_PREFIX, tool.id)
    for (const rel of tool.extra) add('extra', rel, '', tool.id)
  }
  return [...seeds.values()]
}

/**
 * Read one seed: the entries in its directory that carry its prefix, measured,
 * and the rest of that directory named back.
 *
 * An `extra` seed names a single file, so its entry is that file and nothing is
 * listed; the other two read the directory and split it in two — the entries
 * OpenSpec generated (`openspec-` skills, `opsx` commands) and everything else
 * the directory holds, which is reported but never addressed. Sharing a
 * directory with the user's own material is the normal case here: `.agents/
 * skills` is every skill on the machine, and a tool's command directory is
 * every command its owner wrote.
 *
 * Everything expires quietly — a directory that is absent, a file that cannot
 * be read and an entry that vanished mid-scan are all "nothing to report",
 * which is exactly what the panel should show.
 */
async function readGroup(root: string, seed: GroupSeed, state: ScanState): Promise<OpenSpecArtifacts | null> {
  const abs = join(root, seed.rel)
  const toRel = (target: string): string => relative(root, target).split(sep).join('/')

  if (seed.kind === 'extra') {
    if (!existsSync(abs)) return null
    const entry: OpenSpecArtifactEntry = {
      name: abs.split(sep).pop() ?? seed.rel,
      path: abs,
      rel: seed.rel,
      kind: 'file',
      bytes: await measure(abs, 1),
      marker: false,
    }
    return {
      tools: seed.tools,
      kind: 'extra',
      path: dirname(abs),
      rel: dirname(seed.rel).split(sep).join('/'),
      entries: [entry],
      keptCount: 0,
    }
  }

  let entries: Dirent[]
  try {
    entries = await readdir(abs, { withFileTypes: true })
  } catch {
    return null
  }
  /**
   * Whether one entry in this directory is OpenSpec's to remove: the generated
   * name prefix, or the CLI's own ownership marker — which carries neither
   * prefix and is still OpenSpec's, because it is the file that would bring the
   * generated entries back on the next `openspec update`.
   */
  const owns = (name: string): boolean =>
    name.startsWith(seed.prefix) || name === MARKER_FILE_NAME

  const matched = entries.filter((entry) => owns(entry.name)).sort((a, b) => a.name.localeCompare(b.name))
  if (matched.length === 0) return null
  if (matched.length > MAX_ARTIFACT_ENTRIES) state.truncated = true

  const keptCount = entries.filter((entry) => !owns(entry.name)).length

  const found: OpenSpecArtifactEntry[] = []
  for (const entry of matched.slice(0, MAX_ARTIFACT_ENTRIES)) {
    const entryAbs = join(abs, entry.name)
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(entryAbs)))
    found.push({
      name: entry.name,
      path: entryAbs,
      rel: toRel(entryAbs),
      kind: isDir ? 'dir' : 'file',
      bytes: await measure(entryAbs, MAX_MEASURE_DEPTH),
      marker: entry.name === MARKER_FILE_NAME,
    })
  }
  return { tools: seed.tools, kind: seed.kind, path: abs, rel: seed.rel, entries: found, keptCount }
}

/**
 * Inspect one workspace.
 *
 * Nothing here fails loudly: a store that is absent, a directory that cannot be
 * read and an entry that vanished mid-scan are all "nothing to report", which
 * is exactly what the panel should show. The one thing that is *not* swallowed
 * is a programming error inside the scan — those propagate to the route's own
 * error handler rather than being reported as "not initialised".
 *
 * @param cwd - the workspace directory the panel was opened in.
 */
export async function inspectOpenSpec(cwd: string): Promise<OpenSpecView> {
  const root = projectRootOf(cwd)
  const state: ScanState = { nodes: 0, truncated: false }
  const storePath = join(root, STORE_DIR)
  const store = (await isDirectory(storePath)) ? await readStore(root, storePath, state) : undefined
  const groups = await Promise.all(groupSeeds().map((seed) => readGroup(root, seed, state)))
  const artifacts = groups.filter((group): group is OpenSpecArtifacts => group !== null)
  // One stable order for the panel's list, whatever order the tool table
  // happened to declare its directories in: by kind alphabetically (commands,
  // then extras, then skills), each kind by path, each path by its first tool.
  artifacts.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.rel.localeCompare(b.rel) || a.tools[0].localeCompare(b.tools[0]),
  )

  const artifactBytes = artifacts.reduce(
    (sum, group) => sum + group.entries.reduce((groupSum, entry) => groupSum + entry.bytes, 0),
    0,
  )
  const artifactEntries = artifacts.reduce((sum, group) => sum + group.entries.length, 0)
  return {
    cwd: resolve(cwd),
    root,
    initialized: store !== undefined,
    ...(store === undefined ? {} : { store }),
    artifacts,
    truncated: state.truncated,
    totalBytes: (store?.bytes ?? 0) + artifactBytes,
    totalEntries: (store === undefined ? 0 : 1) + artifactEntries,
  }
}
