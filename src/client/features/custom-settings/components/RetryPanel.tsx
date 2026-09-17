/**
 * The model-retry tab of the Custom settings page.
 *
 * One component drives two views: the route list and one route's form. The list
 * is re-polled every 3 seconds like the MCP section, because the settings
 * document is shared — an edit made by hand in `settings.yaml` or in another
 * window has to appear here without a page reload. The poll only owns the list;
 * an open form is seeded once from the route it was opened on, so a poll landing
 * mid-edit cannot overwrite what the user is typing (only its `revision`, which
 * is what keeps the eventual save from clobbering that other edit).
 *
 * Everything the panel shows is decided by the host: which routes exist, what
 * policy applies to each, whether it is writable here, and whether a write was
 * refused. This component renders those facts and posts one draft back.
 */

import { createRetryForm } from './RetryForm'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { RetryPolicyFields, RetryRouteView } from '../../../../shared/custom-settings/retry'

const REFRESH_INTERVAL_MS = 3000

/** Props every tab panel receives from the page shell. */
export interface RetryPanelProps {
  t: Translator
}

/** One route's policy in a line: mode, budget, and the interval it waits after a failure. */
function summaryOf(policy: RetryPolicyFields, t: Translator): string {
  const parts = [
    policy.mode === 'normal' ? t('modeNormal') : t('modeAlways'),
    policy.mode === 'normal'
      ? t('summaryRetries', { count: policy.maxRetries ?? 0 })
      : t('summaryUnlimited'),
    policy.initialDelayMs === policy.maxDelayMs
      ? t('summaryFixedDelay', { delay: policy.initialDelayMs })
      : t('summaryBackoffDelay', { initial: policy.initialDelayMs, maximum: policy.maxDelayMs }),
  ]
  if (policy.jitterRatio > 0) parts.push(t('summaryJitter', { ratio: policy.jitterRatio }))
  return parts.join(' · ')
}

/** The message for the seam this deployment does not mount. */
function unavailableText(t: Translator, seam: string): string | undefined {
  if (seam === 'llm') return t('unavailableLlm')
  if (seam === 'settings') return t('unavailableSettings')
  return undefined
}

export function createRetryPanel(deps: ClientDeps): (props: RetryPanelProps) => JSX.Element {
  const { h, react, api } = deps
  const RetryForm = createRetryForm(deps)

  return function RetryPanel({ t }: RetryPanelProps): JSX.Element {
    const [routes, setRoutes] = react.useState<RetryRouteView[]>([])
    const [unavailable, setUnavailable] = react.useState('')
    const [loadError, setLoadError] = react.useState('')
    // The empty-state line waits for the first answer: "no routes" before the
    // host has spoken would be a claim this component cannot make.
    const [loaded, setLoaded] = react.useState(false)
    const [editing, setEditing] = react.useState('')

    const refresh = react.useCallback(() => {
      api('/llm-retry/routes')
        .then((result) => {
          if (!result.ok) {
            setLoadError(t('loadFailed', { status: result.status }))
            return
          }
          setLoadError('')
          setRoutes(Array.isArray(result.body.routes) ? result.body.routes : [])
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

    // Leaving the form drops the selection: a route removed from the
    // configuration would otherwise keep a form open over a route the list no
    // longer has.
    const edited = editing === '' ? undefined : routes.find((route) => route.provider === editing)
    if (edited !== undefined) {
      return (
        <div className="lr_panel">
          <div className="lr_catalogHeading">
            <h3>{t('editTitle')}</h3>
            <span>{edited.displayName}</span>
          </div>
          <div className="lr_meta">{t('provider')} · {edited.provider}</div>
          <RetryForm
            t={t}
            route={edited}
            onDone={() => {
              setEditing('')
              refresh()
            }}
            onCancel={() => setEditing('')}
          />
        </div>
      )
    }

    const seamNotice = unavailableText(t, unavailable)
    return (
      <div className="lr_panel">
        <div className="lr_catalogHeading">
          <h3>{t('heading')}</h3>
          <span>{t('countRoutes', { count: routes.length })}</span>
        </div>
        <p className="lr_intro">{t('retryIntro')}</p>
        {seamNotice ? <div className="mm_err">{seamNotice}</div> : null}
        {loadError ? <div className="mm_err">{loadError}</div> : null}
        {/* An absent seam already explains an empty list; saying "no routes"
            underneath it would read as a second, contradictory fact. */}
        {loaded && routes.length === 0 && !seamNotice ? <div className="lr_meta">{t('empty')}</div> : null}
        <div className="lr_cards">
          {routes.map((route) => (
            <div className="lr_card" key={route.provider}>
              <div className="lr_cardHead">
                <span className="lr_name">{route.displayName}</span>
                <span className="lr_route">{route.provider}</span>
                <span className={route.overridden ? 'lr_badge custom' : 'lr_badge'}>
                  {route.overridden ? t('policyCustom') : t('policyDefault')}
                </span>
              </div>
              <div className="lr_summary">{summaryOf(route.policy, t)}</div>
              {route.editable ? null : <div className="lr_meta">{t('readOnly')}</div>}
              {route.error ? <div className="mm_err">{route.error}</div> : null}
              <div className="lr_actions">
                <button
                  className="mm_btn"
                  onClick={() => setEditing(route.provider)}
                  disabled={!route.editable}
                >
                  {t('edit')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }
}
