/**
 * The retry administration behind the model-retry tab of Settings → 自定义设置:
 * what every registered provider route's policy currently is, and how one is
 * written back.
 *
 * Both facts come from the seams rather than from a file of this plugin's own:
 * the route set and the policy in force are the llm registry's (an adapter
 * captures the policy when it registers the route, defaults included), and the
 * write target is the settings seam's — the configurable-provider directory
 * names each route's `settingsNs`/`settingsPath`, and `mutate` applies a
 * path-addressed edit to that section. Nothing here reads or writes
 * `settings.yaml` directly, so the seam keeps owning validation, the
 * comment-preserving write, and stale-write detection.
 *
 * That is also why a retry change lands live: the owning adapter subscribes to
 * its own settings namespace and re-registers the route in place when the
 * captured policy changes, so the next request already uses the new values.
 */

import { LOG_PREFIX } from '../../platform/constants.js'
import { serviceOf } from '../../platform/util/services.js'
import { toErrorMessage } from '../../platform/util/text.js'
import { normalizePolicy, parsePolicyFields, readAtPath, storedRetryableCodes } from './policy.js'
import type {
  RetryRefusal,
  RetryRouteView,
  RetryRoutesResponse,
} from '../../../shared/custom-settings/retry.js'
import type {
  ConfigurableProviderLike,
  LlmProviderInfoLike,
  LlmServiceLike,
  ResolvedRetryPolicyLike,
  RetryAdminDeps,
  SettingsDescriptorLike,
  SettingsPathOp,
  SettingsServiceLike,
} from './types.js'

/** The profile key every adapter stores its policy under. */
const RETRY_POLICY_KEY = 'retryPolicy'

/** Untrusted input of one policy write, as the API route hands it over. */
export interface RetrySaveInput {
  provider: string
  /** `null` removes the stored policy; anything else is parsed as a policy. */
  policy: unknown
  /** The revision the caller rendered, when it held one. */
  revision?: number
}

/** One refused write: the HTTP status, the stable code, and what to tell the user. */
export interface RetrySaveFailure {
  ok: false
  status: number
  code: RetryRefusal
  message: string
}

/** One accepted write, answered with the route as it now stands. */
export type RetrySaveOutcome = { ok: true; route: RetryRouteView } | RetrySaveFailure

/** What the two API routes call. */
export interface RetryAdmin {
  listRoutes(): RetryRoutesResponse
  savePolicy(input: RetrySaveInput): Promise<RetrySaveOutcome>
}

/** Whether a context carries the llm service, structurally. */
function isLlmService(value: unknown): value is LlmServiceLike {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate['listProviders'] === 'function'
    && typeof candidate['providerRetryPolicy'] === 'function'
}

/** Whether a context carries the settings service, structurally. */
function isSettingsService(value: unknown): value is SettingsServiceLike {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate['describe'] === 'function'
    && typeof candidate['mutate'] === 'function'
}

/**
 * Build the retry administration over the optional llm and settings seams.
 * @param deps - the optional-service accessor and the plugin logger.
 * @returns the two operations the API routes expose.
 */
export function createRetryAdmin(deps: RetryAdminDeps): RetryAdmin {
  const { logger, services } = deps

  const llm = (): LlmServiceLike | undefined => {
    const service = serviceOf(services, 'llm')
    return isLlmService(service) ? service : undefined
  }
  const settings = (): SettingsServiceLike | undefined => {
    const service = serviceOf(services, 'settings')
    return isSettingsService(service) ? service : undefined
  }

  /** The routes the registry has an adapter for, or none when the read fails. */
  const registeredRoutes = (registry: LlmServiceLike): LlmProviderInfoLike[] => {
    try {
      return registry.listProviders()
    } catch (error) {
      logger.warn(`${LOG_PREFIX}: could not read the registered provider routes: ${toErrorMessage(error)}`)
      return []
    }
  }

  /** Every route's settings address, keyed by provider. */
  const directoryOf = (registry: LlmServiceLike): Map<string, ConfigurableProviderLike> => {
    const entries = new Map<string, ConfigurableProviderLike>()
    // A host without the directory serves retry policies but publishes no
    // address: every route reads as not-editable rather than as a missing
    // service, which is what it actually is.
    if (registry.listConfigurableProviders === undefined) return entries
    try {
      for (const entry of registry.listConfigurableProviders()) entries.set(entry.provider, entry)
    } catch (error) {
      logger.warn(`${LOG_PREFIX}: could not read the configurable-provider directory: ${toErrorMessage(error)}`)
    }
    return entries
  }

  /** Every registered settings namespace, keyed by namespace. */
  const descriptorsOf = (section: SettingsServiceLike): Map<string, SettingsDescriptorLike> => {
    const descriptors = new Map<string, SettingsDescriptorLike>()
    try {
      for (const descriptor of section.describe()) descriptors.set(descriptor.ns, descriptor)
    } catch (error) {
      logger.warn(`${LOG_PREFIX}: could not describe the settings namespaces: ${toErrorMessage(error)}`)
    }
    return descriptors
  }

  /** The policy the adapter captured for one route, or none when it cannot answer. */
  const policyOf = (registry: LlmServiceLike, provider: string): ResolvedRetryPolicyLike | undefined => {
    try {
      return registry.providerRetryPolicy(provider)
    } catch (error) {
      logger.warn(`${LOG_PREFIX}: could not read the retry policy of route "${provider}": ${toErrorMessage(error)}`)
      return undefined
    }
  }

  /** One route as the page reads it; `undefined` when its policy cannot be read at all. */
  function viewOf(
    info: LlmProviderInfoLike,
    entry: ConfigurableProviderLike | undefined,
    descriptor: SettingsDescriptorLike | undefined,
    registry: LlmServiceLike,
  ): RetryRouteView | undefined {
    const policy = policyOf(registry, info.id)
    if (policy === undefined) return undefined
    const stored = entry === undefined || descriptor === undefined
      ? undefined
      : readAtPath(descriptor.user, [...entry.settingsPath, RETRY_POLICY_KEY])
    return {
      provider: info.id,
      // The directory names the route for configuration surfaces; the registry's
      // own metadata is the fallback for an adapter that declares no directory.
      displayName: entry?.displayName ?? info.name,
      ...entry === undefined ? {} : { settingsNs: entry.settingsNs, settingsPath: [...entry.settingsPath] },
      editable: entry !== undefined && descriptor !== undefined,
      overridden: stored !== undefined,
      policy: normalizePolicy(policy),
      ...descriptor === undefined ? {} : { revision: descriptor.revision },
      ...entry?.error === undefined ? {} : { error: entry.error },
    }
  }

  /**
   * Every registered route with the policy that applies to it.
   *
   * A missing seam is reported instead of thrown: the page still lists what it
   * can read, and says which half of the write is unavailable.
   */
  function listRoutes(): RetryRoutesResponse {
    const registry = llm()
    if (registry === undefined) return { routes: [], unavailable: 'llm' }
    const section = settings()
    const directory = directoryOf(registry)
    const descriptors = section === undefined ? new Map<string, SettingsDescriptorLike>() : descriptorsOf(section)
    const routes: RetryRouteView[] = []
    for (const info of registeredRoutes(registry)) {
      const entry = directory.get(info.id)
      const descriptor = entry === undefined ? undefined : descriptors.get(entry.settingsNs)
      const view = viewOf(info, entry, descriptor, registry)
      if (view !== undefined) routes.push(view)
    }
    return { routes, ...section === undefined ? { unavailable: 'settings' as const } : {} }
  }

  /** One refused write, in the shape both the API and the page read. */
  function failure(status: number, code: RetryRefusal, message: string): RetrySaveFailure {
    return { ok: false, status, code, message }
  }

  /** Map a settings-write failure: a moved section is the caller's to fix by reloading. */
  function failureFrom(error: unknown): RetrySaveFailure {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
    if (code === 'SETTINGS_CONFLICT') {
      return failure(409, 'retry/conflict', 'the settings section changed since this page read it; reload and try again')
    }
    return failure(400, 'retry/invalid-policy', toErrorMessage(error))
  }

  /**
   * Write one route's policy, or remove it so the adapter's defaults apply again.
   *
   * The submitted fields are checked here for a readable message, and the
   * adapter's own schema still judges the write: the seam validates the
   * resolved section before anything is persisted, so an accepted write is one
   * the route can actually serve.
   * @param input - route key, the next policy (or `null`), and the revision read.
   * @returns the route as it now stands, or why the write was refused.
   */
  async function savePolicy(input: RetrySaveInput): Promise<RetrySaveOutcome> {
    const registry = llm()
    if (registry === undefined) return failure(503, 'retry/unavailable', 'this deployment mounts no llm service')
    const section = settings()
    if (section === undefined) return failure(503, 'retry/unavailable', 'this deployment mounts no settings service')

    const provider = input.provider
    if (provider.length === 0) return failure(400, 'retry/unknown-provider', 'provider must name a registered route key')
    const info = registeredRoutes(registry).find(candidate => candidate.id === provider)
    if (info === undefined) {
      return failure(404, 'retry/unknown-provider', `no adapter is registered for provider "${provider}"`)
    }
    const entry = directoryOf(registry).get(provider)
    if (entry === undefined) {
      return failure(
        400,
        'retry/not-editable',
        `provider "${provider}" declares no settings address, so its retry policy cannot be written here`,
      )
    }
    const descriptor = descriptorsOf(section).get(entry.settingsNs)
    if (descriptor === undefined) {
      return failure(
        400,
        'retry/not-editable',
        `settings namespace "${entry.settingsNs}" is not registered, so provider "${provider}" cannot be written here`,
      )
    }

    const policyPath = [...entry.settingsPath, RETRY_POLICY_KEY]
    let op: SettingsPathOp
    if (input.policy === null || input.policy === undefined) {
      op = { op: 'unset', path: policyPath }
    } else {
      const parsed = parsePolicyFields(input.policy)
      if (!parsed.ok) return failure(400, 'retry/invalid-policy', parsed.error)
      // The stored shape is the adapter's own (`backoff` nested); the flat form
      // fields are gathered back by `parsePolicyFields` before they get here.
      const codes = storedRetryableCodes(readAtPath(descriptor.user, policyPath))
      op = {
        op: 'set',
        path: policyPath,
        value: { ...parsed.value, ...codes === undefined ? {} : { retryableCodes: codes } },
      }
    }

    try {
      await section.mutate(entry.settingsNs, [op], input.revision)
    } catch (error) {
      return failureFrom(error)
    }

    const written = viewOf(info, entry, descriptorsOf(section).get(entry.settingsNs), registry)
    if (written === undefined) {
      return failure(500, 'retry/invalid-policy', `provider "${provider}" lost its retry policy right after the write`)
    }
    return { ok: true, route: written }
  }

  return { listRoutes, savePolicy }
}
