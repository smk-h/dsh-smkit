/**
 * The wire contract of the model-input tab (Settings → 自定义设置).
 *
 * The host projects every registered provider route and the request modalities
 * of each of its models into these shapes over
 * `/smkit/api/model-input/*`; the browser half renders exactly these
 * shapes and posts one model's next choice back.
 *
 * Type-only by design, like the retry contract next to it: the browser bundle
 * is a single CommonJS script with no module resolver, and `import type` is
 * erased before bundling.
 */

/** One accepted request modality, matching the pi-ai adapter's vocabulary. */
export type InputModality = 'text' | 'image'

/**
 * What one model's modality list is set to, from the page's point of view.
 *
 * Three states, not a checkbox: an absent declaration is *not* the same fact as
 * a declaration of `['text']`. The adapter resolves a model through
 * configuration → the installed catalog → the route's default, so clearing a
 * stored list hands the answer back to the catalog, which may well say `image`.
 * A two-state control would therefore render "off" for a model the adapter
 * still accepts images on — and, worse, write `[]` to mean off, which the
 * adapter reads as no answer at all.
 */
export type ModalityChoice = 'inherit' | InputModality[]

/** One model the page shows: what it accepts, and whether that is stored. */
export interface ModelInputView {
  /** Model id passed to `GenerateOptions.model`. */
  id: string
  /** Display name the adapter reports. */
  name: string
  /**
   * The modalities actually in force, resolved by the owning adapter — catalog
   * inheritance included. Empty means the adapter declared none, which the
   * request guard treats as text-only.
   */
  effective: InputModality[]
  /**
   * Whether the stored configuration declares this model's modalities itself.
   * False leaves {@link effective} coming from the installed catalog or the
   * route's default, and the page marks the row as inherited.
   */
  overridden: boolean
  /**
   * Modality names the model declares that this page has no control for — a
   * hand-written `video`, or one a later dsh adds. Absent means there are none.
   * The page shows them as locked chips and a write leaves them in the stored
   * list, so toggling `image` here cannot drop a name it does not know.
   */
  other?: string[]
}

/**
 * One provider route: its models, and whether this page can write them.
 *
 * Only the pi-ai adapter's routes are editable here. Each other adapter names
 * its modality field and shape differently, and writing a field the owning
 * schema does not declare is a refusal at best and a silent no-op at worst, so
 * those routes are listed with a reason instead of guessed at.
 */
export interface ProviderInputView {
  /** Provider route key (`GenerateOptions.provider`). */
  provider: string
  /** Human-readable route name from the owning adapter. */
  displayName: string
  /** Settings namespace that owns this route's profile, when it has one. */
  settingsNs?: string
  /** Path from that section's root to the route's profile. */
  settingsPath?: string[]
  /** Whether this route's models can be written from here. */
  editable: boolean
  /** Why the route is not editable, when it is not. */
  refusal?: ProviderInputRefusal
  /** Revision of the user section this view was read at; send it back on save. */
  revision?: number
  models: ModelInputView[]
  /** The owning adapter's diagnostic for the route, when it has one. */
  error?: string
}

/** Why a route is listed but not editable. */
export type ProviderInputRefusal =
  /** The route is configured by an adapter other than pi-ai. */
  | 'other-adapter'
  /** The route declares no settings address, so there is nowhere to write. */
  | 'no-address'
  /** Its settings namespace is not registered in this deployment. */
  | 'no-namespace'
  /** The llm registry reports no model list for this route, so there is nothing to edit. */
  | 'no-model-list'
  /** The route stores its models where this page may not write, so the declaration has no target. */
  | 'no-store'

/** Body of `GET /model-input/providers`. */
export interface ModelInputsResponse {
  providers: ProviderInputView[]
  /** The seam this deployment does not mount, when one is missing. */
  unavailable?: 'llm' | 'settings'
}

/** Body of `POST /model-input/modalities`: one model's next choice. */
export interface ModelInputSaveRequest {
  provider: string
  model: string
  /** `null` removes the stored declaration so the model inherits again. */
  modalities: InputModality[] | null
  /** The {@link ProviderInputView.revision} the caller rendered. */
  revision?: number
}

/** Answer of `POST /model-input/modalities`: the route as it now stands. */
export interface ModelInputSaveResponse {
  provider: ProviderInputView
}

/** Body of `POST /model-input/discover`: which route and model to interrogate. */
export interface ModelDiscoveryRequest {
  provider: string
  model: string
}

/**
 * Answer of `POST /model-input/discover`: the modalities the route's own
 * endpoint reports for that model. The probe runs host-side against the
 * route's configured endpoint with the route's own key; the browser half only
 * ever sees this list, and applies it through a normal save.
 */
export interface ModelDiscoveryResponse {
  modalities: InputModality[]
}

/**
 * Stable refusal codes of the model-input API. The browser half shows the
 * host's own message and uses the code only to decide what the user can do
 * about it: a conflict means the page was stale, everything else means the
 * choice was refused.
 */
export type ModelInputRefusal =
  | 'input/unknown-provider'
  | 'input/unknown-model'
  | 'input/not-editable'
  | 'input/invalid-modalities'
  | 'input/conflict'
  | 'input/unavailable'

/**
 * Stable refusal codes of `POST /model-input/discover`. The codes carried over
 * from {@link ModelInputRefusal} mean the same thing here; the two new ones
 * separate what the endpoint itself answered (`discover-failed`, or
 * `discover-no-model` when it listed the model without capacities) from what
 * the route's configuration makes impossible without asking it (`discover-
 * unsupported` — no endpoint to ask, or a protocol with no readable listing).
 */
export type ModelDiscoverRefusal =
  | 'input/unavailable'
  | 'input/unknown-provider'
  | 'input/unknown-model'
  | 'input/not-editable'
  | 'input/discover-unsupported'
  | 'input/discover-failed'
  | 'input/discover-no-model'
