/**
 * The scope picker's menu: the two user roots, and every registered workspace.
 *
 * The projects come from DSH's workspace registry — the same source the MCP
 * page's picker uses — but are read here rather than borrowed from that feature:
 * features do not import each other, and a hidden dependency on another
 * feature's route would be worse than a second read of the same registry. The
 * registry is a soft dependency: a profile without it (a headless or TUI
 * composition) offers no project scope and the page keeps working on the user
 * roots.
 *
 * A project is one entry, named by the workspace: the roots under it are the
 * provider's layout detail and are read together when the project is selected
 * (`catalog.listProject`), so this module only has to name the projects.
 *
 * Display names come from DSH's own workspace storage
 * (`$DSH_HOME/storages/workspace.json`), because a workspace's title is the only
 * place a rename lives — the directory keeps whatever name it was created with,
 * so the folder would show a stale name forever. The stored title is also what
 * the session list shows, so the two agree.
 *
 * Labels are composed here rather than in the browser: only the host knows where
 * a home is, and a label is a path the user recognises (`~/.dsh/skills`), not a
 * string to translate.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { serviceOf } from '../../platform/util/services.js'
import { isRecord } from '../../platform/util/text.js'
import { USER_SOURCES, scopeOfSource } from './constants.js'
import { dshHome, rootOf } from './roots.js'
import type {
  SkillRootView,
  SkillWorkspaceView,
  SkillWorkspacesView,
} from '../../../shared/skills/contract.js'
import type { ServiceAccessor } from '../../platform/types.js'

/** Every scope the page can show, in the picker's own order. */
export async function listSkillScopes(
  services: ServiceAccessor | null | undefined,
): Promise<SkillWorkspacesView> {
  const titles = await workspaceTitles()
  const userRoots: SkillRootView[] = []
  for (const source of USER_SOURCES) {
    const path = rootOf(source, '')
    if (path !== null) userRoots.push(rootView(source, path, homeLabel(path)))
  }
  const workspaces: SkillWorkspaceView[] = []
  for (const path of registryPaths(services)) {
    workspaces.push({ path, title: titles.get(pathKey(path)) ?? basename(path) })
  }
  return { userRoots, workspaces }
}

/** One root view: its key, its side, its absolute path and its short label. */
function rootView(source: string, path: string, label: string): SkillRootView {
  return { source, scope: scopeOfSource(source), path, label }
}

/**
 * Fold the user's home to `~`, so a label reads like the path a user would type.
 * A label is display text, so its separators read `/` whatever the platform
 * spells; the `path` beside it stays the native one.
 */
function homeLabel(path: string): string {
  const home = homedir()
  const shown = path.replaceAll(sep, '/')
  const homeShown = home.replaceAll(sep, '/')
  if (shown === homeShown) return '~'
  if (shown.startsWith(`${homeShown}/`)) return `~${shown.slice(homeShown.length)}`
  return shown
}

/** Every registered workspace path, in registry order, deduplicated. */
function registryPaths(services: ServiceAccessor | null | undefined): string[] {
  const registry = serviceOf(services, 'workspaceRegistry')
  if (!isRecord(registry) || typeof registry.list !== 'function') return []
  let listed: unknown
  try {
    listed = (registry.list as () => unknown)()
  } catch {
    return []
  }
  if (!Array.isArray(listed)) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const entry of listed) {
    const path = isRecord(entry) ? entry.path : undefined
    if (typeof path !== 'string' || path.length === 0) continue
    const key = pathKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(path)
  }
  return paths
}

/**
 * The title DSH stores for each workspace path, from its own storage file.
 * Absent, unreadable or malformed storage simply yields no titles: the folder
 * name stands in, and nothing about the page fails.
 */
async function workspaceTitles(): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  let raw: string
  try {
    raw = await readFile(join(dshHome(), 'storages', 'workspace.json'), 'utf8')
  } catch {
    return titles
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return titles
  }
  const tables = isRecord(parsed) ? parsed.tables : undefined
  const rows = isRecord(tables) ? tables.workspaces : undefined
  if (!isRecord(rows)) return titles
  for (const value of Object.values(rows)) {
    if (!isRecord(value)) continue
    const { path, title } = value
    if (typeof path !== 'string' || typeof title !== 'string' || title.trim() === '') continue
    titles.set(pathKey(path), title)
  }
  return titles
}

/** The comparison key for a workspace path: resolved, and case-folded on Windows. */
function pathKey(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
