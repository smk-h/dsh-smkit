/**
 * The model-input tab of the Custom settings page.
 *
 * One expandable card per provider route — the same disclosure the Settings →
 * MCP rows draw — and inside it one mini-card per model, shaped like the host's
 * own `ModelListEditor` rows: a bordered frame whose head puts the model's id
 * and name in two framed fields, with the caret that opens it and, at the right
 * edge, the shared state dot.
 *
 * The head opens onto the inputs a model takes, asked with the platform's check
 * chips at the left — text, which every declaration this page writes contains
 * and so carries its lock, and image, the only one worth asking about — and at
 * the right edge the two answers to that question: auto-detect, which asks the
 * route's own endpoint what it takes for this model and writes the reply, and
 * reset to default, which deletes the stored declaration. Under them the last
 * check states its answer, so a reply of text-only is seen as the result it
 * is rather than mistook for a check that never finished.
 *
 * There is no draft and no Save button, because ticking a box is the write, and
 * the card paints what the host reports, which the 3-second poll keeps true
 * after an edit made by hand in `settings.yaml` or in another window.
 *
 * The boxes show what a request is accepted for today: a model this page has not
 * touched takes whatever answer dsh resolves for it, and the tick still reports
 * that. The dot says which of the two a card is — blue once this page has
 * written its list, grey while it has not. A card that never had a declaration
 * answers the reset by staying exactly as it is, so the control needs no state
 * to be predictable. Un-ticking image is not the reset: it states "text only",
 * while deleting the declaration asks dsh again, and dsh may well answer image.
 */

import { createCheckChip } from '../../../platform/ui/CheckChip'
import { createChevronRightIcon } from '../../../platform/icons/ChevronRightIcon'
import { createStateDot } from '../../../platform/ui/StateDot'
import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { InputModality, ModelInputView, ProviderInputView } from '../../../../shared/custom-settings/model-input'

const REFRESH_INTERVAL_MS = 3000

/** Props every tab panel receives from the page shell. */
export interface ModelInputPanelProps {
  t: Translator
}

/** The message for the seam this deployment does not mount. */
function unavailableText(t: Translator, seam: string): string | undefined {
  if (seam === 'llm') return t('unavailableLlm')
  if (seam === 'settings') return t('modelUnavailableSettings')
  return undefined
}

/** Why a route is listed but cannot be edited here, in the reader's words. */
function refusalText(t: Translator, provider: ProviderInputView): string {
  switch (provider.refusal) {
    case 'other-adapter':
      return t('refusalOtherAdapter', { ns: provider.settingsNs ?? '' })
    case 'no-namespace':
      return t('refusalNoNamespace', { ns: provider.settingsNs ?? '' })
    case 'no-model-list':
      return t('refusalNoModelList')
    case 'no-store':
      return t('refusalNoStore')
    default:
      return t('refusalNoAddress')
  }
}

/** What a refused write tells the user: its stable code localized, else the host's own words. */
function saveRefusalText(t: Translator, code: unknown, message: string | undefined, status: number): string {
  switch (code) {
    case 'input/conflict': return t('conflict')
    case 'input/unknown-provider': return t('codeUnknownProvider')
    case 'input/unknown-model': return t('codeUnknownModel')
    case 'input/not-editable': return t('codeNotEditable')
    case 'input/unavailable': return t('codeUnavailable')
    case 'input/invalid-modalities': return t('codeInvalidModalities')
    default: return message || t('saveFailed', { status })
  }
}

/** What a refused capability check tells the user: the ask failed, so the boxes stay theirs. */
function discoverRefusalText(t: Translator, code: unknown): string {
  switch (code) {
    case 'input/discover-unsupported': return t('discoverUnsupported')
    case 'input/discover-no-model': return t('discoverNoModel')
    case 'input/unknown-provider': return t('codeUnknownProvider')
    case 'input/unknown-model': return t('codeUnknownModel')
    case 'input/not-editable': return t('codeNotEditable')
    case 'input/unavailable': return t('codeUnavailable')
    default: return t('discoverFailed')
  }
}

/** The modalities one row's boxes stand for. */
function modalitiesOf(image: boolean): InputModality[] {
  return image ? ['text', 'image'] : ['text']
}

export function createModelInputPanel(deps: ClientDeps): (props: ModelInputPanelProps) => JSX.Element {
  const { h, react, api } = deps
  const ChevronRightIcon = createChevronRightIcon(deps)
  const CheckChip = createCheckChip(deps)
  const StateDot = createStateDot(deps)

  return function ModelInputPanel({ t }: ModelInputPanelProps): JSX.Element {
    const [providers, setProviders] = react.useState<ProviderInputView[]>([])
    const [unavailable, setUnavailable] = react.useState('')
    const [loadError, setLoadError] = react.useState('')
    // The empty-state line waits for the first answer: "no routes" before the
    // host has spoken would be a claim this component cannot make.
    const [loaded, setLoaded] = react.useState(false)
    // Which cards show their models. A list of route keys, so a route that
    // disappears from the configuration takes its open card with it instead of
    // holding a slot over a route the list no longer has.
    const [open, setOpen] = react.useState<string[]>([])
    // Which model mini-cards show their boxes, keyed the same way and by the
    // same rule as the route cards above.
    const [openModels, setOpenModels] = react.useState<string[]>([])
    // What the last check of a row answered, shown on that row: a reply of
    // text-only is a result too, and a row that silently stays unticked reads
    // as a check that never finished.
    const [detectNote, setDetectNote] = react.useState<{ key: string; text: string; failed: boolean } | null>(null)
    const { pending, error, run } = useAsyncAction(react)

    const refresh = react.useCallback(() => {
      api('/model-input/providers')
        .then((result) => {
          if (!result.ok) {
            setLoadError(t('modelLoadFailed', { status: result.status }))
            return
          }
          setLoadError('')
          setProviders(Array.isArray(result.body.providers) ? result.body.providers : [])
          setUnavailable(typeof result.body.unavailable === 'string' ? result.body.unavailable : '')
          setLoaded(true)
        })
        .catch(() => {})
    }, [])

    react.useEffect(() => {
      refresh()
      const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
      return () => clearInterval(timer)
    }, [refresh])

    // The one save every write on this row goes through, so a detected answer
    // lands by the same CAS path as a ticked box.
    const save = (provider: ProviderInputView, model: ModelInputView, modalities: InputModality[] | null) =>
      api('/model-input/modalities', {
        method: 'POST',
        body: JSON.stringify({
          provider: provider.provider,
          model: model.id,
          modalities,
          // The revision this row was rendered from: a section that moved
          // since then refuses the write instead of clobbering that edit.
          ...(provider.revision === undefined ? {} : { revision: provider.revision }),
        }),
      })

    const write = (provider: ProviderInputView, model: ModelInputView, modalities: InputModality[] | null) => {
      // A box ticked by hand replaces the last check's answer for that row:
      // from here on the row states the user's own choice.
      if (detectNote !== null && detectNote.key === `${provider.provider}/${model.id}`) setDetectNote(null)
      return run(async () => {
        const result = await save(provider, model, modalities)
        if (result.ok) {
          refresh()
          return
        }
        return saveRefusalText(t, result.body.code, result.body.error, result.status)
      }, `${provider.provider}/${model.id}`)
    }

    const detect = (provider: ProviderInputView, model: ModelInputView) =>
      run(async () => {
        const key = `${provider.provider}/${model.id}`
        const found = await api('/model-input/discover', {
          method: 'POST',
          body: JSON.stringify({ provider: provider.provider, model: model.id }),
        })
        // Every answer the check gives — a refusal included — is reported on
        // the row it belongs to, not in the panel-wide banner: the user is
        // looking at this card, and a ticked or unticked box alone cannot
        // tell "the endpoint says text only" from "nothing happened".
        if (!found.ok) {
          setDetectNote({ key, text: discoverRefusalText(t, found.body.code), failed: true })
          return
        }
        if (!Array.isArray(found.body.modalities)) {
          setDetectNote({ key, text: t('discoverFailed'), failed: true })
          return
        }
        const modalities = found.body.modalities as InputModality[]
        const result = await save(provider, model, modalities)
        if (!result.ok) {
          setDetectNote({ key, text: saveRefusalText(t, result.body.code, result.body.error, result.status), failed: true })
          return
        }
        setDetectNote({
          key,
          text: modalities.includes('image') ? t('detectImage') : t('detectTextOnly'),
          failed: false,
        })
        refresh()
        // The row note already carries a failure's message; a banner on top of
        // it would state the same refusal twice.
      }, `${provider.provider}/${model.id}#detect`)

    const toggleCard = (provider: string) => {
      setOpen(open.includes(provider) ? open.filter(kept => kept !== provider) : [...open, provider])
    }

    const toggleModelCard = (key: string) => {
      setOpenModels(openModels.includes(key) ? openModels.filter(kept => kept !== key) : [...openModels, key])
    }

    const seamNotice = unavailableText(t, unavailable)
    const modelCount = providers.reduce((total, provider) => total + provider.models.length, 0)
    return (
      <div className="smkit-cs-model-input-panel">
        <div className="smkit-cs-model-input-catalog-heading">
          <h3>{t('heading')}</h3>
          <span>{t('countModels', { count: modelCount })}</span>
        </div>
        <p className="smkit-cs-model-input-intro">{t('modelInputIntro')}</p>
        {seamNotice ? <div className="smkit-ui-field-error">{seamNotice}</div> : null}
        {loadError ? <div className="smkit-ui-field-error">{loadError}</div> : null}
        {error ? <div className="smkit-ui-field-error">{error}</div> : null}
        {/* An absent seam already explains an empty list; saying "no routes"
            underneath it would read as a second, contradictory fact. */}
        {loaded && providers.length === 0 && !seamNotice ? <div className="smkit-cs-model-input-meta">{t('modelEmpty')}</div> : null}
        <div className="smkit-cs-model-input-cards">
          {providers.map((provider) => {
            const expanded = open.includes(provider.provider)
            const declared = provider.models.filter(model => model.overridden).length
            const visual = provider.models.filter(model => model.effective.includes('image')).length
            return (
              <div className="smkit-ui-disclosure-card" key={provider.provider} data-smkit-open={expanded ? 'true' : undefined}>
                <div className="smkit-cs-model-input-card-head">
                  <button className="smkit-ui-disclosure-card-content" type="button" aria-expanded={expanded} onClick={() => toggleCard(provider.provider)}>
                    <span className="smkit-ui-disclosure-card-name">{provider.displayName}</span>
                    <span className="smkit-cs-model-input-route">{provider.provider}</span>
                    <StateDot
                      state={declared > 0 ? 'active' : 'idle'}
                      label={`${provider.displayName} · ${t(declared > 0 ? 'modelStatusCustom' : 'modelStatusDefault')}`}
                    />
                  </button>
                  <button
                    className="smkit-cs-model-input-caret-btn"
                    type="button"
                    aria-expanded={expanded}
                    data-smkit-open={expanded ? 'true' : undefined}
                    aria-label={`${provider.displayName} · ${t('modelAdvanced')}`}
                    title={t('modelAdvanced')}
                    onClick={() => toggleCard(provider.provider)}
                  >
                    <ChevronRightIcon className="smkit-cs-model-input-caret" />
                  </button>
                </div>
                <div className="smkit-cs-model-input-summary">
                  {t('countModels', { count: provider.models.length })}
                  {' · '}
                  {t('summaryVisual', { count: visual })}
                </div>
                {expanded ? (
                  <div className="smkit-ui-disclosure-card-details">
                    {provider.editable ? null : <div className="smkit-cs-model-input-meta">{refusalText(t, provider)}</div>}
                    {provider.editable && provider.models.length === 0 ? (
                      <div className="smkit-cs-model-input-meta">{t('noModels')}</div>
                    ) : null}
                    {provider.error ? <div className="smkit-ui-field-error">{provider.error}</div> : null}
                    {provider.models.map((model) => {
                      const key = `${provider.provider}/${model.id}`
                      // One action, one busy flag: pressing a button dims that
                      // button alone, never its neighbour — two controls that
                      // can physically never be pressed together should not
                      // light up together either. The boxes still wait for
                      // whatever the row is doing, so a slow check cannot have
                      // its answer overwritten mid-flight by a tick.
                      const detectKey = `${key}#detect`
                      const rowBusy = pending === key || pending === detectKey
                      const modelExpanded = openModels.includes(key)
                      return (
                        <div className="smkit-cs-model-input-model-card" key={model.id}>
                          <div className="smkit-cs-model-input-model-head">
                            <span className="smkit-cs-model-input-model-id">{model.id}</span>
                            <span className="smkit-cs-model-input-model-name">{model.name}</span>
                            <span className="smkit-cs-model-input-head-tail">
                              <button
                                className="smkit-cs-model-input-caret-btn"
                                type="button"
                                aria-expanded={modelExpanded}
                                data-smkit-open={modelExpanded ? 'true' : undefined}
                                aria-label={`${model.name} · ${t('modelAdvanced')}`}
                                title={t('modelAdvanced')}
                                onClick={() => toggleModelCard(key)}
                              >
                                <ChevronRightIcon className="smkit-cs-model-input-caret" />
                              </button>
                              <StateDot
                                state={model.overridden ? 'active' : 'idle'}
                                label={`${model.id} · ${t(model.overridden ? 'modelStatusCustom' : 'modelStatusDefault')}`}
                              />
                            </span>
                          </div>
                          {modelExpanded ? (
                            <div className="smkit-cs-model-input-model-body">
                              <div className="smkit-ui-check-chip-chip-row">
                                <CheckChip of={model.id} label={t('modalityText')} checked locked disabled />
                                <CheckChip
                                  of={model.id}
                                  label={t('modalityImage')}
                                  checked={model.effective.includes('image')}
                                  disabled={rowBusy}
                                  inert={!provider.editable}
                                  onChange={(next) => { void write(provider, model, modalitiesOf(next)) }}
                                />
                                {(model.other ?? []).map(name => (
                                  <CheckChip key={name} of={model.id} label={name} checked locked disabled />
                                ))}
                              </div>
                              {provider.editable ? (
                                <span className="smkit-cs-model-input-body-tail">
                                  <button
                                    className="smkit-ui-button smkit-cs-model-input-body-btn"
                                    aria-label={`${model.id} · ${t('autoFetch')}`}
                                    onClick={() => { void detect(provider, model) }}
                                    disabled={pending === detectKey}
                                  >
                                    {pending === detectKey ? t('detecting') : t('autoFetch')}
                                  </button>
                                  <button
                                    className="smkit-ui-button smkit-cs-model-input-body-btn"
                                    aria-label={`${model.id} · ${t('choiceInherit')}`}
                                    onClick={() => { void write(provider, model, null) }}
                                    disabled={pending === key}
                                  >
                                    {t('choiceInherit')}
                                  </button>
                                </span>
                              ) : null}
                              {detectNote !== null && detectNote.key === key ? (
                                <div className="smkit-cs-model-input-detect-note" data-smkit-failed={detectNote.failed ? 'true' : undefined}>
                                  {detectNote.text}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        <p className="smkit-cs-model-input-note">{t('modelInputNote')}</p>
      </div>
    )
  }
}
