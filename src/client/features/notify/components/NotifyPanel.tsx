/**
 * The notify panel: the two toggles, the duration picker, and the test fire.
 *
 * Toggles save the moment they flip — ZCode's notification preferences are
 * immediate and this panel keeps that: no save button to forget, and the
 * host's answer (the effective settings) becomes the next state, so a
 * rejected write cannot leave the switch claiming a state the host does not
 * run. The panel reads once on mount instead of polling: two toggles and a
 * dropdown are not worth traffic every three seconds, and the shell re-mounts
 * the tab on every visit, which is a fresh read anyway.
 *
 * The test button bypasses nothing on the host except suppression and the
 * master toggle — it is an explicit gesture — but the sound still follows the
 * sound toggle, so the user can hear exactly what their current settings buy.
 */

import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import { NOTIFY_DURATIONS } from '../../../../shared/notify/contract'
import { createSwitch } from '../ui/Switch'
import type { ApiResult, ClientDeps, Translator } from '../../../platform/types'
import type { NotifyDuration } from '../../../../shared/notify/contract'

export interface NotifyPanelProps {
  t: Translator
}

/** The settings as the host reports them. */
export interface NotifySettingsBody {
  enabled?: boolean
  soundEnabled?: boolean
  duration?: string
  /** Where the host runs: `win32` delivers natively; anything else asks the
   * page to show the notification itself. */
  platform?: string
}

/** The browser's Notification permission, plus a stand-in for "no API here". */
type WebPermission = 'default' | 'granted' | 'denied' | 'unsupported'

/** Read one toggle out of a host answer, keeping the fallback on garbage. */
function readToggle(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** The dictionary key per duration option, spelled out rather than templated
 * so the dictionaries stay greppable. */
const DURATION_KEYS: Record<NotifyDuration, string> = {
  short: 'durationShort',
  long: 'durationLong',
  reminder: 'durationReminder',
}

export function createNotifyPanel(deps: ClientDeps): (props: NotifyPanelProps) => JSX.Element {
  const { h, react, api } = deps
  const Switch = createSwitch(deps)

  return function NotifyPanel({ t }: NotifyPanelProps): JSX.Element {
    const [settings, setSettings] = react.useState<NotifySettingsBody | null>(null)
    const [testDone, setTestDone] = react.useState(false)
    const [webPerm, setWebPerm] = react.useState<WebPermission | null>(null)
    const { busy, pending, error, run } = useAsyncAction(react)

    react.useEffect(() => {
      let cancelled = false
      void api('/notify/settings').then((r: ApiResult) => {
        if (cancelled || !r.ok) return
        setSettings(r.body as NotifySettingsBody)
        if (typeof r.body.platform === 'string' && r.body.platform !== 'win32') {
          setWebPerm(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
        }
      }).catch(() => {})
      return () => {
        cancelled = true
      }
    }, [api])

    const enabled = readToggle(settings?.enabled, true)
    const soundEnabled = readToggle(settings?.soundEnabled, true)
    const duration = (settings?.duration as NotifyDuration | undefined) ?? 'short'

    /** Flip one toggle and take the host's answer as the truth. */
    const flip = (field: 'enabled' | 'soundEnabled', next: boolean): Promise<void> =>
      run(async () => {
        const r: ApiResult = await api('/notify/settings', {
          method: 'POST',
          body: JSON.stringify({ [field]: next }),
        })
        if (r.ok) {
          setSettings(r.body as NotifySettingsBody)
          return
        }
        return r.body.error || t('saveFailed', { status: r.status })
      }, field)

    /** Pick a duration; the host validates the word, so a stale option value
     * only costs one round trip back to what it runs. */
    const pickDuration = (next: string): Promise<void> =>
      run(async () => {
        const r: ApiResult = await api('/notify/settings', {
          method: 'POST',
          body: JSON.stringify({ duration: next }),
        })
        if (r.ok) {
          setSettings(r.body as NotifySettingsBody)
          return
        }
        return r.body.error || t('saveFailed', { status: r.status })
      }, 'duration')

    /** Ask the browser for notification permission; the answer lands in the
     * row's status. Browsers refuse to even ask without a user gesture, so
     * this only ever runs from the button. */
    const authorize = (): Promise<void> =>
      run(async () => {
        try {
          setWebPerm(await Notification.requestPermission())
        } catch {
          return t('webNotifFailed')
        }
      }, 'webperm')

    const fireTest = (): Promise<void> =>
      run(async () => {
        const r: ApiResult = await api('/notify/test', { method: 'POST', body: '{}' })
        if (r.ok) {
          setTestDone(true)
          return
        }
        return r.body.error || t('testFailed', { status: r.status })
      }, 'test')

    return (
      <div className="smkit-notify-page-panel">
        <p className="smkit-notify-page-intro">{t('intro')}</p>
        <div className="smkit-notify-page-toggles">
          <div className="smkit-notify-page-row">
            <div className="smkit-notify-page-row-copy">
              <div className="smkit-notify-page-row-title">{t('enabledTitle')}</div>
              <div className="smkit-notify-page-row-help">{t('enabledHelp')}</div>
            </div>
            <Switch
              on={enabled}
              text={enabled ? t('on') : t('off')}
              busy={pending === 'enabled'}
              onToggle={() => void flip('enabled', !enabled)}
              ariaLabel={t('enabledTitle')}
            />
          </div>
          <div className="smkit-notify-page-row">
            <div className="smkit-notify-page-row-copy">
              <div className="smkit-notify-page-row-title">{t('soundTitle')}</div>
              <div className="smkit-notify-page-row-help">{t('soundHelp')}</div>
            </div>
            <Switch
              on={soundEnabled}
              text={soundEnabled ? t('on') : t('off')}
              busy={pending === 'soundEnabled'}
              onToggle={() => void flip('soundEnabled', !soundEnabled)}
              ariaLabel={t('soundTitle')}
            />
          </div>
          <div className="smkit-notify-page-row">
            <div className="smkit-notify-page-row-copy">
              <div className="smkit-notify-page-row-title">{t('durationTitle')}</div>
              <div className="smkit-notify-page-row-help">{t('durationHelp')}</div>
            </div>
            <select
              className="smkit-notify-page-select"
              value={duration}
              disabled={pending === 'duration'}
              aria-label={t('durationTitle')}
              onChange={(e) => void pickDuration(e.target.value)}
            >
              {NOTIFY_DURATIONS.map((value) => (
                <option key={value} value={value}>
                  {t(DURATION_KEYS[value])}
                </option>
              ))}
            </select>
          </div>
          {webPerm !== null ? (
            <div className="smkit-notify-page-row">
              <div className="smkit-notify-page-row-copy">
                <div className="smkit-notify-page-row-title">{t('webNotifTitle')}</div>
                <div className="smkit-notify-page-row-help">{t('webNotifHelp')}</div>
              </div>
              {webPerm === 'default' ? (
                <button
                  className="smkit-ui-button"
                  onClick={() => void authorize()}
                  disabled={pending === 'webperm'}
                  data-smkit-pending={pending === 'webperm' ? 'true' : undefined}
                  aria-busy={pending === 'webperm'}
                >
                  {t('webNotifEnable')}
                </button>
              ) : (
                <span className="smkit-notify-page-status">
                  {webPerm === 'granted'
                    ? t('webNotifGranted')
                    : webPerm === 'denied'
                      ? t('webNotifDenied')
                      : t('webNotifUnsupported')}
                </span>
              )}
            </div>
          ) : null}
        </div>
        <div className="smkit-notify-page-actions">
          <button
            className="smkit-ui-button"
            onClick={() => void fireTest()}
            disabled={busy}
            data-smkit-pending={pending === 'test' ? 'true' : undefined}
            aria-busy={pending === 'test'}
          >
            {t('testButton')}
          </button>
          {testDone ? <span className="smkit-notify-page-test-done">{t('testDone')}</span> : null}
        </div>
        {error ? <div className="smkit-ui-field-error">{error}</div> : null}
        <p className="smkit-notify-page-note">{t('note')}</p>
      </div>
    )
  }
}
