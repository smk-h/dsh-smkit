/**
 * Structural slices of the two DSH services this feature reads and writes.
 *
 * The plugin touches `ctx.llm` and `ctx.settings` structurally — never by
 * importing `@deepseek-ai/*` — so it keeps its single peer dependency and stays
 * testable against the stub contexts in `test/`. Only the members actually
 * called are declared, which is also what keeps a missing seam detectable:
 * {@link isLlmService} and {@link isSettingsService} answer whether a context
 * carries one at all.
 */

import type { LoggerLike, ServiceAccessor } from '../../platform/types.js'

/** Display metadata of one registered provider route (`LlmProviderInfo`). */
export interface LlmProviderInfoLike {
  id: string
  name: string
}

/**
 * One provider route an adapter can activate through configuration
 * (`LlmConfigurableProvider`): the settings address a configuration surface
 * writes when it edits that route.
 */
export interface ConfigurableProviderLike {
  provider: string
  displayName: string
  /** User-settings namespace whose section configures this provider. */
  settingsNs: string
  /** Path from that section's root to the provider's profile; empty when the whole section is it. */
  settingsPath: readonly string[]
  /** Whether the owning adapter knows the route only because configuration declared it. */
  declared?: boolean
  /** Configuration diagnostic for repair. */
  error?: string
}

/**
 * The retry policy an adapter captured for one route (`ResolvedRetryPolicy`),
 * with every default already resolved. `normal` carries the count and the
 * eligible codes; `always` carries neither.
 */
export interface ResolvedRetryPolicyLike {
  mode: 'normal' | 'always'
  maxRetries?: number
  retryableCodes?: readonly string[]
  initialDelayMs: number
  maxDelayMs: number
  jitterRatio: number
}

/** The slice of `ctx.llm` this feature uses. */
export interface LlmServiceLike {
  listProviders(): LlmProviderInfoLike[]
  providerRetryPolicy(provider: string): ResolvedRetryPolicyLike
  /**
   * The configuration directory every route's settings address comes from.
   * Optional on purpose: a harness older than the directory still serves
   * `retryPolicy`, and this page then shows the policies as read-only instead
   * of claiming no llm service is mounted.
   */
  listConfigurableProviders?(): ConfigurableProviderLike[]
}

/** One path-addressed settings edit (`SettingsPathOp`). */
export type SettingsPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }

/** One registered settings namespace as a configuration surface reads it (`SettingsDescriptor`). */
export interface SettingsDescriptorLike {
  ns: string
  /** Resolved value: schema defaults, then the composition base, then the user layer. */
  value: unknown
  /** Raw user section, when one is stored — a field's presence here marks it user-overridden. */
  user?: unknown
  /** Monotonic revision of the raw user section, for stale-write detection. */
  revision: number
}

/** The slice of `ctx.settings` this feature uses. */
export interface SettingsServiceLike {
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptorLike[]
  mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
}

/** What the retry administration needs from its mount. */
export interface RetryAdminDeps {
  /** Optional-service accessor: both seams are resolved per call, never injected. */
  services: ServiceAccessor
  logger: LoggerLike
}

