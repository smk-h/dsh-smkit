/**
 * The update check: ask npm for this package's `latest`, compare it with the
 * running version, and say whether anything is newer.
 *
 * Deliberately dependency-free — one `fetch`, one comparison — because the
 * plugin ships no runtime dependencies at all and a version check is not worth
 * being the first. The registry answer is read as the small JSON `/latest`
 * returns (`{ version }`), not as the whole document.
 *
 * Failure is an answer too: a check that cannot reach the registry returns
 * `latest: null` plus `error`, and the caller renders "check failed" instead of
 * pretending the plugin is current. A network that is merely slow must not
 * hang the settings button, hence the timeout.
 */

import { PLUGIN_ID, PLUGIN_VERSION } from '../../platform/constants.js'
import { errorText } from '../../platform/util/text.js'
import type { UpdateCheckView } from '../../../shared/update/contract.js'
import type { LoggerLike } from '../../platform/types.js'

/** The public registry, unless a caller points the check elsewhere. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/** How long one registry read may take before the check gives up. */
const DEFAULT_TIMEOUT_MS = 8_000

/**
 * The `/latest` endpoint of one package on one registry.
 *
 * Only the scope separator is escaped: `@scope/name` has to travel as
 * `@scope%2Fname`, and encoding the `@` as well is accepted by the registry but
 * makes the URL harder to read beside a package name the user typed.
 */
export function registryLatestUrl(name: string, registry: string = DEFAULT_REGISTRY): string {
  return `${registry.replace(/\/+$/, '')}/${name.replace('/', '%2F')}/latest`
}

/** One parsed version: three numbers plus the prerelease tail, if any. */
interface ParsedVersion {
  core: [number, number, number]
  pre: string
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Split one version string, or null when it is not `x.y.z[-pre]`. */
function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_RE.exec(version.trim())
  if (match === null) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? '',
  }
}

/**
 * Compare two versions, semver-style: `1` when `a` is newer, `-1` when it is
 * older, `0` when they are equal or either side does not parse.
 *
 * Only as much of semver as the decision needs: the three numbers, then "a
 * prerelease sorts before its release". Two prereleases compare as strings,
 * which orders `rc.10` after `rc.9` wrongly — acceptable for a check whose
 * registry answer is a plain release, and documented here so nobody mistakes it
 * for a full implementation.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return 0
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] > right.core[i] ? 1 : -1
  }
  if (left.pre === right.pre) return 0
  if (left.pre === '') return 1
  if (right.pre === '') return -1
  return left.pre > right.pre ? 1 : -1
}

/** Options one check accepts; every field has a production default. */
export interface CheckOptions {
  /** The running version. Defaults to this build's `PLUGIN_VERSION`. */
  current?: string
  /** The package to ask about. Defaults to this package's name. */
  packageName?: string
  /** Registry base; defaults to npm's public one. */
  registry?: string
  timeoutMs?: number
  /** Where a failed check is reported. A check never throws at the route. */
  logger?: LoggerLike
}

/** Read `<registry>/<name>/latest` and return its `version`, or null. */
export async function fetchLatestVersion(
  name: string,
  options: { registry?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(registryLatestUrl(name, options.registry), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!resp.ok) throw new Error(`registry answered ${resp.status}`)
    const body: unknown = await resp.json()
    const version = (body as { version?: unknown } | null)?.version
    return typeof version === 'string' && version !== '' ? version : null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Compare the running version with the registry's latest.
 *
 * Never throws: everything that can go wrong is folded into `error`, because
 * the caller is a settings button whose entire job is to report one line.
 */
export async function checkForUpdate(options: CheckOptions = {}): Promise<UpdateCheckView> {
  const current = options.current ?? PLUGIN_VERSION
  try {
    const latest = await fetchLatestVersion(options.packageName ?? PLUGIN_ID, options)
    if (latest === null) {
      return { current, latest: null, hasUpdate: false, error: 'registry answer carries no version' }
    }
    return { current, latest, hasUpdate: compareVersions(latest, current) > 0 }
  } catch (error) {
    const detail = errorText(error)
    options.logger?.warn?.(`smkit update: check failed: ${detail}`)
    return { current, latest: null, hasUpdate: false, error: detail }
  }
}
