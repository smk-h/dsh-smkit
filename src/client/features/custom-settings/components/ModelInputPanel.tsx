/**
 * The model-input tab of the Custom settings page.
 *
 * One expandable card per provider route — the same disclosure the Settings →
 * MCP rows draw — and inside it one row per model, where the inputs a model
 * takes are asked with the platform's check chips: text, which every declaration
 * this page writes contains and so carries its lock, and image, the only one
 * worth asking about.
 *
 * There is no draft and no Save button, because ticking a box is the write, and
 * the row paints what the host reports, which the 3-second poll keeps true after
 * an edit made by hand in `settings.yaml` or in another window.
 *
 * The boxes show what a request is accepted for today: a model this page has not
 * touched takes whatever answer dsh resolves for it, and the tick still reports
 * that. Which of the two a row is shows as the shared state dot — blue once this
 * page has written its list, grey while it has not — and every editable row
 * carries the same way back beside it, reset to default, which deletes the
 * stored declaration. A row that never had one answers that reset by staying
 * exactly as it is, so the control needs no state to be predictable. Un-ticking
 * image is not the reset: it states "text only", while deleting the declaration
 * asks dsh again, and dsh may well answer image.
 */

import { createCheckChip } from '../../../platform/ui/CheckChip'
import { createChevronDownIcon } from '../../../platform/icons/ChevronDownIcon'
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

/** The modalities one row's boxes stand for. */
function modalitiesOf(image: boolean): InputModality[] {
  return image ? ['text', 'image'] : ['text']
}

export function createModelInputPanel(deps: ClientDeps): (props: ModelInputPanelProps) => JSX.Element {
  const { h, react, api } = deps
  const ChevronDownIcon = createChevronDownIcon(deps)
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

    const write = (provider: ProviderInputView, model: ModelInputView, modalities: InputModality[] | null) =>
      run(async () => {
        const result = await api('/model-input/modalities', {
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
        if (result.ok) {
          refresh()
          return
        }
        return saveRefusalText(t, result.body.code, result.body.error, result.status)
      }, `${provider.provider}/${model.id}`)

    const toggleCard = (provider: string) => {
      setOpen(open.includes(provider) ? open.filter(kept => kept !== provider) : [...open, provider])
    }

    const seamNotice = unavailableText(t, unavailable)
    const modelCount = providers.reduce((total, provider) => total + provider.models.length, 0)
    return (
      <div className="mi_panel">
        <div className="mi_catalogHeading">
          <h3>{t('heading')}</h3>
          <span>{t('countModels', { count: modelCount })}</span>
        </div>
        <p className="mi_intro">{t('modelInputIntro')}</p>
        {seamNotice ? <div className="mm_err">{seamNotice}</div> : null}
        {loadError ? <div className="mm_err">{loadError}</div> : null}
        {error ? <div className="mm_err">{error}</div> : null}
        {/* An absent seam already explains an empty list; saying "no routes"
            underneath it would read as a second, contradictory fact. */}
        {loaded && providers.length === 0 && !seamNotice ? <div className="mi_meta">{t('modelEmpty')}</div> : null}
        <div className="mi_cards">
          {providers.map((provider) => {
            const expanded = open.includes(provider.provider)
            const declared = provider.models.filter(model => model.overridden).length
            const visual = provider.models.filter(model => model.effective.includes('image')).length
            return (
              <div className="mm_row" key={provider.provider} data-open={expanded ? 'true' : undefined}>
                <button className="mm_cardContent" type="button" aria-expanded={expanded} onClick={() => toggleCard(provider.provider)}>
                  <span className="mm_name">{provider.displayName}</span>
                  <span className="mi_route">{provider.provider}</span>
                  <span className="mm_cardTrailing">
                    {declared > 0 ? <span className="mi_badge">{t('badgeDeclared')}</span> : null}
                    <span className="mm_chevron" data-open={expanded ? 'true' : undefined}>
                      <ChevronDownIcon size={12} />
                    </span>
                  </span>
                </button>
                <div className="mi_summary">
                  {t('countModels', { count: provider.models.length })}
                  {' · '}
                  {t('summaryVisual', { count: visual })}
                </div>
                {expanded ? (
                  <div className="mm_details">
                    {provider.editable ? null : <div className="mi_meta">{refusalText(t, provider)}</div>}
                    {provider.editable && provider.models.length === 0 ? (
                      <div className="mi_meta">{t('noModels')}</div>
                    ) : null}
                    {provider.error ? <div className="mm_err">{provider.error}</div> : null}
                    {provider.models.map((model) => {
                      const busy = pending === `${provider.provider}/${model.id}`
                      return (
                        <div className="mi_row" key={model.id}>
                          <div className="mi_model">
                            <span className="mi_modelName">{model.name}</span>
                            <span className="mi_modelId">{model.id}</span>
                          </div>
                          <div className="mi_controls">
                            <div className="mm_chipRow">
                              <CheckChip of={model.id} label={t('modalityText')} checked locked disabled />
                              <CheckChip
                                of={model.id}
                                label={t('modalityImage')}
                                checked={model.effective.includes('image')}
                                disabled={busy}
                                inert={!provider.editable}
                                onChange={(next) => { void write(provider, model, modalitiesOf(next)) }}
                              />
                              {(model.other ?? []).map(name => (
                                <CheckChip key={name} of={model.id} label={name} checked locked disabled />
                              ))}
                            </div>
                            <span className="mi_tail">
                              {provider.editable ? (
                                <button
                                  className="mm_btn mi_reset"
                                  aria-label={`${model.id} · ${t('choiceInherit')}`}
                                  onClick={() => { void write(provider, model, null) }}
                                  disabled={busy}
                                >
                                  {t('choiceInherit')}
                                </button>
                              ) : null}
                              <StateDot
                                state={model.overridden ? 'active' : 'idle'}
                                label={`${model.id} · ${t(model.overridden ? 'modelStatusCustom' : 'modelStatusDefault')}`}
                              />
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        <p className="mi_note">{t('modelInputNote')}</p>
      </div>
    )
  }
}
