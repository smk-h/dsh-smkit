/**
 * Is the upstream MCP manager loaded by the profile this copy runs in?
 *
 * `dsh-mcp-manager` is the project this plugin started from, and the two cannot
 * run side by side: both claim the `mcp` locale namespace, and dsh 0.2.2's
 * locale runtime throws on a duplicate namespace + language, which takes the
 * whole client entry — and with it the shell — down. Both would also connect
 * the same servers and register the same `mcp__*` tools.
 *
 * So when the same profile loads the upstream plugin, this plugin's MCP half
 * stands down and leaves MCP entirely to it. The rest of the plugin (session
 * delete, skills, outline, theme, notify, …) keeps working.
 *
 * The check reads the **profile manifest this copy actually lives in**, not a
 * machine-wide list: `dsh.profile.bundles` is what the loader mounts, so a
 * plugin that is merely present in `node_modules` — or installed in another
 * profile — does not disarm this one. A copy running from a source checkout has
 * no profile around it and never stands down.
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package name of the upstream project, as npm and the loader spell it. */
export const UPSTREAM_MCP_PLUGIN = 'dsh-mcp-manager'

/** The `node_modules` directory this copy was loaded from, when there is one. */
function nodeModulesDirOfSelf(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 8; depth += 1) {
    if (basename(dir) === 'node_modules') return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * Whether `profileRoot` loads the upstream MCP manager.
 *
 * @param profileRoot - directory holding the profile's `package.json` and
 *   `node_modules`; defaults to the profile this copy was loaded from.
 * @returns `true` when the profile's `dsh.profile.bundles` names the upstream
 *   plugin. Without a readable manifest the answer falls back to "the package
 *   is installed here", so a hand-assembled profile still stands down.
 */
export function upstreamMcpManagerInstalled(profileRoot?: string): boolean {
  const root = profileRoot ?? (nodeModulesDirOfSelf() === null ? null : dirname(nodeModulesDirOfSelf() as string))
  if (root === null) return false
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = manifest.dsh?.profile?.bundles
    if (Array.isArray(bundles)) return bundles.includes(UPSTREAM_MCP_PLUGIN)
  } catch {
    // No manifest (a hand-assembled profile): fall through to the package check.
  }
  return existsSync(join(root, 'node_modules', UPSTREAM_MCP_PLUGIN))
}
