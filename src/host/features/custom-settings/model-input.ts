/**
 * The model-input administration behind the 模型输入 tab of Settings →
 * 自定义设置: which request modalities each model of each provider route
 * accepts, and how one model's choice is written back.
 *
 * Like the retry administration next to it, nothing here reads or writes
 * `settings.yaml`. The model set and the modalities in force are the llm
 * registry's (`listModels` reports what the owning adapter resolved, catalog
 * inheritance included), and the write target is the settings seam's — the
 * configurable-provider directory names each route's `settingsNs`/`settingsPath`
 * and `mutate` applies the edit. That is also why a change lands live: the
 * owning adapter re-registers the route when its own namespace changes.
 *
 * Two facts about the pi-ai adapter shape everything below:
 *
 * - A modality list is declared per model, under two possible keys: an entry of
 *   the route's `models` list, or — for a route the installed catalog describes
 *   and configuration lists no models for — `modelOverrides.<id>`. Which of them
 *   a route uses is a stored fact, not a preference: an override beside a models
 *   list is refused by the adapter, so the list has to be edited in place.
 * - `models` is an array, and a path-addressed settings edit descends objects
 *   only. Naming an element's index would replace the whole array with an
 *   object keyed `0`, so a list is always read, patched and written back whole.
 */

import { LOG_PREFIX } from '../../platform/constants.js'
import { serviceOf } from '../../platform/util/services.js'
import { toErrorMessage } from '../../platform/util/text.js'
import { readAtPath } from './policy.js'
import type {
  InputModality,
  ModelInputRefusal,
  ModelInputsResponse,
  ProviderInputView,
  ProviderInputRefusal,
} from '../../../shared/custom-settings/model-input.js'
import type {
  ConfigurableProviderLike,
  LlmModelInfoLike,
  LlmProviderInfoLike,
  LlmServiceLike,
  AdminDeps,
  SettingsDescriptorLike,
  SettingsPathOp,
  SettingsServiceLike,
} from './types.js'

/** The only adapter whose model schema this page writes; others are listed read-only. */
const PI_AI_NS = 'llm-pi-ai'

/** Profile keys of the pi-ai adapter that carry per-model configuration. */
const MODELS_KEY = 'models'
const OVERRIDES_KEY = 'modelOverrides'
const INPUT_KEY = 'input'

/**
 * What the page may declare. pi-ai's own vocabulary is wider than this on
 * paper, and the request guard only ever asks these two questions; the
 * discovery path in particular surfaces `video`/`audio` from a gateway listing,
 * which the adapter's modality gate refuses.
 */
const ALLOWED_MODALITIES: readonly string[] = ['text', 'image']

/** Untrusted input of one model write, as the API route hands it over. */
export interface ModelInputSaveInput {
  provider: string
  model: string
  /** `null` removes the stored declaration so the model inherits again; anything but a list is refused. */
  modalities: unknown
  /** The revision the caller rendered, when it held one. */
  revision?: number
}

/** One refused write: the HTTP status, the stable code, and what to tell the user. */
export interface ModelInputSaveFailure {
  ok: false
  status: number
  code: ModelInputRefusal
  message: string
}

/** One accepted write, answered with the route as it now stands. */
export type ModelInputSaveOutcome = { ok: true; provider: ProviderInputView } | ModelInputSaveFailure

/** What the two API routes call. */
export interface ModelInputAdmin {
  listProviders(): Promise<ModelInputsResponse>
  save(input: ModelInputSaveInput): Promise<ModelInputSaveOutcome>
}

/**
 * Where one route's per-model declarations actually live, and what is stored
 * there right now. `models` carries the stored list so a write can send it back
 * patched; `overrides` carries the stored map for the same reason.
 */
type WriteTarget =
  | { kind: 'models'; path: readonly string[]; list: ReadonlyArray<Record<string, unknown>> }
  | { kind: 'overrides'; path: readonly string[]; map: Readonly<Record<string, Record<string, unknown>>> }

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

/** Whether a value can be descended into by a path-addressed settings edit. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One untrusted list narrowed to what this page can express, in canonical order. */
function filterModalities(value: readonly string[]): InputModality[] {
  const seen = new Set(value)
  return ALLOWED_MODALITIES.filter((modality) => seen.has(modality)) as InputModality[]
}

/**
 * One untrusted list narrowed to the modalities this page can express.
 * @returns the accepted list in canonical order, or `undefined` when the value
 * is not a list of names, repeats itself, or leaves out `text` — a model that
 * takes no text at all could serve no request this page knows of.
 */
function toModalities(value: unknown): InputModality[] | undefined {
  if (!Array.isArray(value)) return undefined
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !ALLOWED_MODALITIES.includes(entry) || seen.has(entry)) return undefined
    seen.add(entry)
  }
  if (!seen.has('text')) return undefined
  return filterModalities([...seen])
}

/**
 * Build the model-input administration over the optional llm and settings seams.
 * @param deps - the optional-service accessor and the plugin logger.
 * @returns the two operations the API routes expose.
 */
export function createModelInputAdmin(deps: AdminDeps): ModelInputAdmin {
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

  /**
   * The models one route serves, with the modalities in force.
   * @returns the list, or `undefined` when the registry cannot answer — a
   * registry without `listModels`, or one that throws for this route.
   */
  const modelsOf = async (registry: LlmServiceLike, provider: string): Promise<LlmModelInfoLike[] | undefined> => {
    if (registry.listModels === undefined) return undefined
    try {
      return [...await registry.listModels(provider)]
    } catch (error) {
      logger.warn(`${LOG_PREFIX}: could not read the models of route "${provider}": ${toErrorMessage(error)}`)
      return undefined
    }
  }

  /**
   * Where a route's per-model declarations are written, or `undefined` when
   * neither key is available.
   *
   * A stored models list wins: it replaces the served catalog, so an override
   * written beside it would be refused. Otherwise only a route the shipped
   * catalog describes may take overrides — `declared` is the adapter's own
   * answer to that, and an adapter that draws no distinction is not guessed at.
   */
  function targetOf(entry: ConfigurableProviderLike, descriptor: SettingsDescriptorLike): WriteTarget | undefined {
    const modelsPath = [...entry.settingsPath, MODELS_KEY]
    const stored = readAtPath(descriptor.user, modelsPath)
    if (Array.isArray(stored)) {
      const list: Array<Record<string, unknown>> = []
      for (const item of stored) {
        if (!isPlainObject(item) || typeof item['id'] !== 'string' || item['id'].length === 0) return undefined
        list.push(item)
      }
      // An empty list is no declaration at all: the adapter reads it as "serve
      // the installed catalog", so writing through it would miss the catalog.
      if (list.length > 0) return { kind: 'models', path: modelsPath, list }
    }
    if (entry.declared === false) {
      const overridesPath = [...entry.settingsPath, OVERRIDES_KEY]
      const map = readAtPath(descriptor.user, overridesPath)
      if (map === undefined) return { kind: 'overrides', path: overridesPath, map: {} }
      if (!isPlainObject(map)) return undefined
      const kept: Record<string, Record<string, unknown>> = {}
      for (const [id, entryOfModel] of Object.entries(map)) {
        if (!isPlainObject(entryOfModel)) return undefined
        kept[id] = entryOfModel
      }
      return { kind: 'overrides', path: overridesPath, map: kept }
    }
    return undefined
  }

  /** The modality list one stored per-model entry declares, `undefined` when it inherits. */
  function storedModalities(target: WriteTarget | undefined, model: string): string[] | undefined {
    if (target === undefined) return undefined
    const entryOfModel = target.kind === 'models'
      ? target.list.find(candidate => candidate['id'] === model)
      : target.map[model]
    if (entryOfModel === undefined) return undefined
    const declared = entryOfModel[INPUT_KEY]
    if (!Array.isArray(declared)) return undefined
    const list = declared.filter((modality): modality is string => typeof modality === 'string')
    // An empty list states nothing to the adapter, so it is shown as inherited.
    return list.length === 0 || list.length !== declared.length ? undefined : list
  }

  /**
   * Whether this route's model declarations can be written here, and why not.
   * Ordered from the least to the most specific refusal, so the page names the
   * first thing that stops it.
   */
  function refusalOf(
    entry: ConfigurableProviderLike | undefined,
    descriptor: SettingsDescriptorLike | undefined,
  ): ProviderInputRefusal | undefined {
    if (entry === undefined) return 'no-address'
    if (entry.settingsNs !== PI_AI_NS) return 'other-adapter'
    if (descriptor === undefined) return 'no-namespace'
    return undefined
  }

  /**
   * One route as the page reads it.
   * @param models - what the registry reports, or `undefined` when it cannot.
   */
  function viewOf(
    info: LlmProviderInfoLike,
    entry: ConfigurableProviderLike | undefined,
    descriptor: SettingsDescriptorLike | undefined,
    models: LlmModelInfoLike[] | undefined,
  ): ProviderInputView {
    const refusal = refusalOf(entry, descriptor)
    // A route that is not pi-ai's, or has no address, has nowhere to write and
    // no stored declaration to look for; its models still show what is in force.
    const target = refusal === undefined && descriptor !== undefined && entry !== undefined
      ? targetOf(entry, descriptor)
      : undefined
    // A registry that reports no model list leaves nothing to edit, and a route
    // that stores its models where this page may not write leaves nothing to
    // write; saying either beats a card with no rows and no reason.
    const unusable = refusal
      ?? (models === undefined ? 'no-model-list' as const : undefined)
      ?? (target === undefined ? 'no-store' as const : undefined)
    return {
      provider: info.id,
      displayName: entry?.displayName ?? info.name,
      ...entry === undefined ? {} : { settingsNs: entry.settingsNs, settingsPath: [...entry.settingsPath] },
      editable: unusable === undefined,
      ...unusable === undefined ? {} : { refusal: unusable },
      models: (models ?? []).map(model => {
        const others = (model.inputModalities ?? []).filter(name => !ALLOWED_MODALITIES.includes(name))
        return {
          id: model.id,
          name: model.name,
          effective: filterModalities(model.inputModalities ?? []),
          overridden: storedModalities(target, model.id) !== undefined,
          ...others.length === 0 ? {} : { other: others },
        }
      }),
      ...descriptor === undefined ? {} : { revision: descriptor.revision },
      ...entry?.error === undefined ? {} : { error: entry.error },
    }
  }

  /**
   * Every registered route with its models and the modalities each accepts.
   *
   * A missing seam is reported instead of thrown, and one route that cannot
   * answer for its models is listed without them rather than dropped: a page
   * that quietly loses a provider is worse than one that says it cannot read it.
   */
  async function listProviders(): Promise<ModelInputsResponse> {
    const registry = llm()
    if (registry === undefined) return { providers: [], unavailable: 'llm' }
    const section = settings()
    const directory = directoryOf(registry)
    const descriptors = section === undefined ? new Map<string, SettingsDescriptorLike>() : descriptorsOf(section)
    const providers: ProviderInputView[] = []
    for (const info of registeredRoutes(registry)) {
      const entry = directory.get(info.id)
      const descriptor = entry === undefined ? undefined : descriptors.get(entry.settingsNs)
      const models = await modelsOf(registry, info.id)
      providers.push(viewOf(info, entry, descriptor, models))
    }
    return { providers, ...section === undefined ? { unavailable: 'settings' as const } : {} }
  }

  /** One refused write, in the shape both the API and the page read. */
  function failure(status: number, code: ModelInputRefusal, message: string): ModelInputSaveFailure {
    return { ok: false, status, code, message }
  }

  /** Map a settings-write failure: a moved section is the caller's to fix by reloading. */
  function failureFrom(error: unknown): ModelInputSaveFailure {
    const code = isPlainObject(error) ? error['code'] : undefined
    if (code === 'SETTINGS_CONFLICT') {
      return failure(409, 'input/conflict', 'the settings section changed since this page read it; reload and try again')
    }
    return failure(400, 'input/invalid-modalities', toErrorMessage(error))
  }

  /**
   * The edit that puts one model's modalities where the adapter reads them.
   * @returns the op, or why the write cannot be made at all.
   */
  function opFor(
    target: WriteTarget,
    model: string,
    modalities: InputModality[] | undefined,
  ): { op: SettingsPathOp } | { failure: ModelInputSaveFailure } {
    // Names the vocabulary here does not cover — a hand-written `video`, or one
    // a later dsh adds — ride through the write untouched: this page toggles
    // `image`, it does not rewrite a modality it cannot name. The adapter's own
    // modality map is declared merge-extensible, so such a name is not an error.
    const preserved = (storedModalities(target, model) ?? []).filter(name => !ALLOWED_MODALITIES.includes(name))
    if (target.kind === 'models') {
      const index = target.list.findIndex(entry => entry['id'] === model)
      if (index < 0) {
        return { failure: failure(404, 'input/unknown-model', `route does not list model "${model}" in its configuration`) }
      }
      // The whole list goes back: the path editor cannot address an element, and
      // every other entry's capacities must survive this write untouched.
      const next = [...target.list.map(entry => ({ ...entry }))]
      if (modalities === undefined) delete next[index][INPUT_KEY]
      else next[index][INPUT_KEY] = [...modalities, ...preserved]
      return { op: { op: 'set', path: target.path, value: next } }
    }
    if (modalities === undefined) {
      // The whole entry goes, so an override that declared nothing but
      // modalities does not linger as an empty object.
      return { op: { op: 'unset', path: [...target.path, model] } }
    }
    return { op: { op: 'set', path: [...target.path, model, INPUT_KEY], value: [...modalities, ...preserved] } }
  }

  /**
   * Write one model's modalities, or remove the declaration so it inherits.
   *
   * The choice is checked here for a readable message; the owning adapter's
   * schema still judges the write through the seam, so an accepted write is one
   * the route can actually serve.
   * @param input - route key, model id, the next list (or `null`), and the revision read.
   * @returns the route as it now stands, or why the write was refused.
   */
  async function save(input: ModelInputSaveInput): Promise<ModelInputSaveOutcome> {
    const registry = llm()
    if (registry === undefined) return failure(503, 'input/unavailable', 'this deployment mounts no llm service')
    const section = settings()
    if (section === undefined) return failure(503, 'input/unavailable', 'this deployment mounts no settings service')

    const provider = input.provider
    if (provider.length === 0) return failure(400, 'input/unknown-provider', 'provider must name a registered route key')
    const info = registeredRoutes(registry).find(candidate => candidate.id === provider)
    if (info === undefined) {
      return failure(404, 'input/unknown-provider', `no adapter is registered for provider "${provider}"`)
    }
    if (input.model.length === 0) return failure(400, 'input/unknown-model', 'model must name a model id of that route')

    const entry = directoryOf(registry).get(provider)
    const descriptor = entry === undefined ? undefined : descriptorsOf(section).get(entry.settingsNs)
    const refusal = refusalOf(entry, descriptor)
    if (refusal === 'no-address' || entry === undefined) {
      return failure(400, 'input/not-editable', `provider "${provider}" declares no settings address, so its models cannot be written here`)
    }
    if (refusal === 'other-adapter') {
      return failure(400, 'input/not-editable', `provider "${provider}" is configured by the "${entry.settingsNs}" adapter, whose model schema this page does not write`)
    }
    if (refusal === 'no-namespace' || descriptor === undefined) {
      return failure(400, 'input/not-editable', `settings namespace "${entry.settingsNs}" is not registered, so provider "${provider}" cannot be written here`)
    }

    const listed = await modelsOf(registry, provider)
    if (listed === undefined) {
      return failure(400, 'input/not-editable', `this deployment reports no model list for provider "${provider}"`)
    }
    if (!listed.some(model => model.id === input.model)) {
      return failure(404, 'input/unknown-model', `provider "${provider}" does not serve model "${input.model}"`)
    }

    const target = targetOf(entry, descriptor)
    if (target === undefined) {
      return failure(
        400,
        'input/not-editable',
        `provider "${provider}" stores its models nowhere this page may write: a route the configuration declares lists its models itself, and overrides need a catalog route without a models list`,
      )
    }

    let modalities: InputModality[] | undefined
    if (input.modalities !== null) {
      const parsed = Array.isArray(input.modalities) ? toModalities(input.modalities) : undefined
      if (parsed === undefined) {
        return failure(
          400,
          'input/invalid-modalities',
          'modalities must be null to inherit, or a list of "text" and "image" that includes "text"',
        )
      }
      modalities = parsed
    }

    const built = opFor(target, input.model, modalities)
    if ('failure' in built) return built.failure
    try {
      await section.mutate(entry.settingsNs, [built.op], input.revision)
    } catch (error) {
      return failureFrom(error)
    }

    const written = viewOf(
      info,
      entry,
      descriptorsOf(section).get(entry.settingsNs),
      await modelsOf(registry, provider),
    )
    return { ok: true, provider: written }
  }

  return { listProviders, save }
}
