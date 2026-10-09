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
 * Auto-detect wears the shell's hover bubble, because its own two words cannot
 * carry the fact that the answer belongs to the endpoint: providers publish
 * this differently, so the check may come back empty or incomplete, and the
 * reader has to know the boxes above are theirs to set by hand — from the
 * provider's own documentation when the check has nothing to report.
 *
 * A rule closes the body, and under it the second subject: the reasoning levels
 * the model may be asked for. Its check is a line of its own rather than one
 * more chip in the row above because it answers a different question — what a
 * request may carry is not whether the model can be asked to think — and
 * because the two are stored under separate keys, each with its own reset.
 * Ticking it writes the level set the owning adapter accepts; un-ticking it, or
 * the named reset beside it, removes the declaration and hands the question
 * back to the route's installed catalog. Neither greys the other while it is
 * writing: they answer two separate clicks, and a control that dims its
 * neighbour is read as one control whose second half moved on its own.
 *
 * The check wears the same chip the boxes above wear, because it is the same
 * kind of answer: a yes or a no about this model, moved by the click itself.
 * Only the field under it differs, which is what the tooltip is for — a reader
 * who has not opened `settings.yaml` cannot tell from two words what a tick
 * writes or what the reset beside it deletes.
 *
 * There is no draft and no Save button, because ticking a box is the write, and
 * the card paints what the host reports, which the 3-second poll keeps true
 * after an edit made by hand in `settings.yaml` or in another window.
 *
 * The boxes show what a request is accepted for today: a model this page has not
 * touched takes whatever answer dsh resolves for it, and the tick still reports
 * that. The dot says which of the two a card is — orange once this page has
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
    case 'input/invalid-reasoning': return t('codeInvalidReasoning')
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
  const { h, react, api, Tooltip } = deps
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

    const write = (provider: ProviderInputView, model: ModelInputView, modalities: InputModality[] | null, tag = '') => {
      // A box ticked by hand replaces the last check's answer for that row:
      // from here on the row states the user's own choice.
      if (detectNote !== null && detectNote.key === `${provider.provider}/${model.id}`) setDetectNote(null)
      // `tag` names the control that started this write, and belongs to that
      // control alone: a tick and a reset write the same row, and each has to
      // dim only itself (see the tags at the buttons).
      return run(async () => {
        const result = await save(provider, model, modalities)
        if (result.ok) {
          refresh()
          return
        }
        return saveRefusalText(t, result.body.code, result.body.error, result.status)
      }, `${provider.provider}/${model.id}${tag}`)
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

    // The reasoning declaration's write: the same round trip as a box, one
    // field over. It names an endpoint of its own rather than riding on the
    // modality save, because the two fields are separate facts — a model that
    // takes images without reasoning is the ordinary case, not an odd one — and
    // either one being cleared has to leave the other where it stands.
    const writeReasoning = (provider: ProviderInputView, model: ModelInputView, declared: boolean, tag = '') =>
      run(async () => {
        const result = await api('/model-input/reasoning-efforts', {
          method: 'POST',
          body: JSON.stringify({
            provider: provider.provider,
            model: model.id,
            declared,
            // The same revision discipline as the modality write: a section
            // that moved under the card refuses rather than clobbers.
            ...(provider.revision === undefined ? {} : { revision: provider.revision }),
          }),
        })
        if (result.ok) {
          refresh()
          return
        }
        return saveRefusalText(t, result.body.code, result.body.error, result.status)
      }, `${provider.provider}/${model.id}${tag}`)

    const toggleCard = (provider: string) => {
      setOpen(open.includes(provider) ? open.filter(kept => kept !== provider) : [...open, provider])
    }

    const toggleModelCard = (key: string) => {
      setOpenModels(openModels.includes(key) ? openModels.filter(kept => kept !== key) : [...openModels, key])
    }

    // The shell's own hover bubble for a control whose two words cannot carry
    // the caveat behind it. A host that hands no bubble over loses nothing but
    // the styling: the anchor then wears the browser's `title`, which is the
    // same sentence in a plainer box. Each such anchor sets `title` exactly
    // when `Tooltip` is missing, so a host with the bubble never floats two at
    // once.
    const bubble = (label: string, anchor: JSX.Element): JSX.Element =>
      Tooltip === undefined ? anchor : <Tooltip label={label} side="bottom" delayMs={300} maxWidth={280}>{anchor}</Tooltip>

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
            // A model counts as this page's once either field is stored: the two
            // are written by separate controls, and either one alone is enough
            // to make the row this page's rather than the catalog's.
            const declared = provider.models.filter(model => model.overridden || model.reasoningDeclared).length
            const visual = provider.models.filter(model => model.effective.includes('image')).length
            return (
              <div className="smkit-ui-disclosure-card" key={provider.provider} data-smkit-open={expanded ? 'true' : undefined}>
                <div className="smkit-cs-model-input-card-head">
                  <button className="smkit-ui-disclosure-card-content" type="button" aria-expanded={expanded} onClick={() => toggleCard(provider.provider)}>
                    <span className="smkit-ui-disclosure-card-name">{provider.displayName}</span>
                    <span className="smkit-cs-model-input-route">{provider.provider}</span>
                    <StateDot
                      state={declared > 0 ? 'custom' : 'idle'}
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
                      // Every control carries the tag of the action it starts,
                      // so a write dims the control that started it and never
                      // its neighbour — two controls that can physically never
                      // be pressed together should not light up together
                      // either. The box's own tag is what keeps the tick from
                      // dimming the way back: writing a tick under the row's
                      // key greyed the reset beside it for the whole round trip
                      // (~1.2s measured), and a row whose edits disable its own
                      // undo is the one thing this card must not be. The boxes
                      // are the exception the other way round: they wait for
                      // any of the three, because a save landing mid-tick would
                      // overwrite the tick after it. A click that races a write
                      // is answered by the row's revision check, the same way
                      // the check has always answered one.
                      const tickKey = `${key}#tick`
                      const detectKey = `${key}#detect`
                      const reasoningKey = `${key}#reasoning`
                      const reasoningResetKey = `${key}#reasoning-reset`
                      const rowBusy = pending === key || pending === tickKey || pending === detectKey
                      // Each of the two reasoning controls answers its own
                      // click and no other. They do write one field, so either
                      // request changes what the other one is showing — but the
                      // check is a tick and the button beside it is a way back,
                      // and a tick that greys the way back (or a reset that
                      // greys the tick) reads as a single control moved twice
                      // rather than two answers given separately. The line
                      // above holds the same rule for its button. A click that
                      // races a write is answered by the row's revision check,
                      // the same way every race on this page is.
                      const reasoningTickBusy = pending === reasoningKey
                      const reasoningResetBusy = pending === reasoningResetKey
                      // Whether this row carries a declaration of this page's
                      // making. Either field counts on its own — they are
                      // written and cleared by separate controls.
                      const mine = model.overridden || model.reasoningDeclared
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
                                state={mine ? 'custom' : 'idle'}
                                label={`${model.id} · ${t(mine ? 'modelStatusCustom' : 'modelStatusDefault')}`}
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
                                  onChange={(next) => { void write(provider, model, modalitiesOf(next), '#tick') }}
                                />
                                {(model.other ?? []).map(name => (
                                  <CheckChip key={name} of={model.id} label={name} checked locked disabled />
                                ))}
                              </div>
                              {provider.editable ? (
                                <span className="smkit-cs-model-input-body-tail">
                                  {bubble(t('autoFetchHint'), (
                                    <button
                                      className="smkit-ui-button smkit-cs-model-input-body-btn"
                                      aria-label={`${model.id} · ${t('autoFetch')}`}
                                      title={Tooltip === undefined ? t('autoFetchHint') : undefined}
                                      onClick={() => { void detect(provider, model) }}
                                      disabled={pending === detectKey}
                                    >
                                      {pending === detectKey ? t('detecting') : t('autoFetch')}
                                    </button>
                                  ))}
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
                              {/* The rule states that the line beneath it answers
                                * a different question: the boxes above say what a
                                * request may carry, the check below says whether
                                * this model can be asked to think. The two live on
                                * the same model entry but under keys that are
                                * written and cleared separately, so the reset on
                                * this line touches its own field alone — and the
                                * check's own off state is that same removal, since
                                * an absent field and a field cleared to nothing are
                                * not both storable answers. */}
                              {provider.editable ? (
                                <div className="smkit-cs-model-input-reasoning">
                                  <div className="smkit-cs-model-input-reasoning-seam" />
                                  <div className="smkit-cs-model-input-reasoning-row">
                                    <CheckChip
                                      of={model.id}
                                      label={t('reasoningLevel')}
                                      checked={model.reasoningDeclared}
                                      disabled={reasoningTickBusy}
                                      hint={t('reasoningHint')}
                                      onChange={(next) => { void writeReasoning(provider, model, next, '#reasoning') }}
                                    />
                                    <span className="smkit-cs-model-input-body-tail">
                                      <button
                                        className="smkit-ui-button smkit-cs-model-input-body-btn"
                                        aria-label={`${model.id} · ${t('reasoningReset')}`}
                                        onClick={() => { void writeReasoning(provider, model, false, '#reasoning-reset') }}
                                        disabled={reasoningResetBusy}
                                      >
                                        {t('reasoningReset')}
                                      </button>
                                    </span>
                                  </div>
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
