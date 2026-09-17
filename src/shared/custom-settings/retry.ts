/**
 * The wire contract of the model-retry tab (Settings → 自定义设置).
 *
 * The host projects every registered provider route and the retry policy that
 * currently applies to it into these shapes over
 * `/mcp-manager/api/llm-retry/*`; the browser half renders exactly these shapes
 * and posts one back.
 *
 * Type-only by design: the browser bundle is a single CommonJS script with no
 * module resolver, and `import type` is erased before bundling, so nothing here
 * reaches any emitted code. The MCP and session-delete features keep their own
 * contracts (`shared/mcp/contract.ts`, `shared/session-delete/contract.ts`), and
 * a later tab of this page adds a sibling file next to this one.
 */

/** Retry mode, mirroring the adapters' `retryPolicy` union discriminant. */
export type RetryMode = 'normal' | 'always'

/**
 * One route's retry policy as the browser sends and receives it: the adapter
 * vocabulary flattened, with the `backoff` object unpacked into the three
 * fields the page edits.
 */
export interface RetryPolicyFields {
  mode: RetryMode
  /**
   * Retries after the first request, in `normal` mode. Never carried for
   * `always`, whose policy has no count: it stops only on success, cancellation,
   * or plugin disposal.
   */
  maxRetries?: number
  /**
   * Failure codes eligible for retry in `normal` mode, as they apply — the
   * adapter's default set materialized when the route does not store its own.
   * The page never edits this list and never sends it back: the host preserves
   * whatever the route stores, so writing it here could only pin a route that
   * inherits the defaults to an explicit copy of them.
   */
  retryableCodes?: string[]
  /** Initial backoff delay in milliseconds. */
  initialDelayMs: number
  /** Upper bound on any single scheduled delay in milliseconds. */
  maxDelayMs: number
  /** Symmetric jitter ratio around each delay, 0 to 1. */
  jitterRatio: number
}

/**
 * One route the page shows: its identity, where its profile lives, and the
 * policy that applies to it right now, with the adapter's defaults
 * materialized — so the form opens on the values actually in force rather than
 * on an empty inheritance.
 */
export interface RetryRouteView {
  /** Provider route key (`GenerateOptions.provider`). */
  provider: string
  /** Human-readable route name from the owning adapter. */
  displayName: string
  /**
   * Settings namespace and path that own this route's profile. Present only
   * when the owning adapter declared a settings address for the route; without
   * one the policy is visible but there is nowhere to write it.
   */
  settingsNs?: string
  settingsPath?: string[]
  /**
   * Whether this route's policy can be written from here: its adapter declared
   * a settings address *and* that namespace is registered in this deployment.
   * False leaves the policy readable and the form unavailable.
   */
  editable: boolean
  /** Whether the stored section carries its own policy instead of inheriting defaults. */
  overridden: boolean
  /** The policy in force, defaults materialized. */
  policy: RetryPolicyFields
  /**
   * Revision of the user section this view was read at. Send it back on save:
   * a section that moved past it refuses the write instead of overwriting a
   * change made in another window or by hand.
   */
  revision?: number
  /** The owning adapter's diagnostic for the route, when it has one. */
  error?: string
}

/** Body of `GET /llm-retry/routes`. */
export interface RetryRoutesResponse {
  routes: RetryRouteView[]
  /**
   * The seam this deployment does not mount, when one is missing: `llm` leaves
   * nothing to list, `settings` leaves the list readable but unsavable.
   */
  unavailable?: 'llm' | 'settings'
}

/** Body of `POST /llm-retry/policy`: one route's next policy, or `null` to reset it. */
export interface RetrySaveRequest {
  provider: string
  /** `null` removes the stored policy, so the route inherits the adapter's defaults again. */
  policy: RetryPolicyFields | null
  /** The {@link RetryRouteView.revision} the caller rendered. */
  revision?: number
}

/** Answer of `POST /llm-retry/policy`: the route as it now stands. */
export interface RetrySaveResponse {
  route: RetryRouteView
}

/**
 * Stable refusal codes of the retry API. The browser half shows the host's own
 * message and uses the code only to decide what the user can do about it: a
 * conflict means the page was stale, everything else means the input was
 * refused.
 */
export type RetryRefusal =
  /** No adapter is registered for that route key. */
  | 'retry/unknown-provider'
  /** The route's adapter declared no settings address, so nothing is writable. */
  | 'retry/not-editable'
  /** The policy failed the adapter's own validation. */
  | 'retry/invalid-policy'
  /** The settings section moved since the page read it. */
  | 'retry/conflict'
  /** This deployment mounts no `llm` or `settings` seam. */
  | 'retry/unavailable'
