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
 *
 * The duration picker only renders on a Windows host: the setting reaches the
 * native toast alone, so everywhere else it would be a control that cannot do
 * anything. The row's help text carries the other half of that caveat — even
 * on Windows it is inert while a page is open, because delivery then prefers
 * the browser. `platform` arrives with the settings read; before it lands the
 * row is absent rather than briefly wrong.
 *
 * The browser-permission row owns the one dead end this panel can reach: a
 * site the browser has already denied. The page may not ask again, and it may
 * not open a privileged scheme either, so the row hands the address over —
 * named by the host from the request's user agent — with a copy button and the
 * address itself, selected whole by one click.
 */

import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import { NOTIFY_DURATIONS } from '../../../../shared/notify/contract'
import { NOTIFY_PERMISSION_EVENT } from '../client'
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
  /** Where the host runs. Decides whether the duration row renders at all:
   * only a Windows host can raise the native toast that setting drives. */
  platform?: string
  /**
   * The address of this browser's own notification settings, or `null` when
   * the host could not name one. The host derives it from the user agent of
   * the request this panel made, so it always describes the browser the page
   * is in — the client half carries no user-agent reading of its own.
   */
  webSettingsUrl?: string | null
}

/** The browser's Notification permission, plus a stand-in for "no API here". */
type WebPermission = 'default' | 'granted' | 'denied' | 'unsupported'

/** Read one toggle out of a host answer, keeping the fallback on garbage. */
function readToggle(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Put the settings address on the clipboard, from the click that asked for it.
 *
 * Only the modern Clipboard API, with no `document.execCommand('copy')`
 * fallback: a refused copy is not a dead end, because the address stays on
 * screen as a `user-select: all` chip — one click selects it whole — and the
 * panel says the copy failed instead of pretending it worked.
 */
async function copyAddress(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
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
    const [copyState, setCopyState] = react.useState<'idle' | 'done' | 'failed'>('idle')
    const { busy, pending, error, run } = useAsyncAction(react)

    react.useEffect(() => {
      let cancelled = false
      void api('/notify/settings').then((r: ApiResult) => {
        if (cancelled || !r.ok) return
        setSettings(r.body as NotifySettingsBody)
        // An open page delivers the notification itself on every platform —
        // on Windows it is the preferred path, elsewhere the only one — so
        // the permission row always shows.
        setWebPerm(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
      }).catch(() => {})
      return () => {
        cancelled = true
      }
    }, [api])

    const enabled = readToggle(settings?.enabled, true)
    const soundEnabled = readToggle(settings?.soundEnabled, true)
    const duration = (settings?.duration as NotifyDuration | undefined) ?? 'short'
    // The address only matters for the denied case: that is the one where the
    // page may not ask again, so the user has to go and allow the site
    // themselves — and a page cannot navigate to a privileged scheme on its
    // own. The host names it per browser, and `null` means it could not.
    const settingsUrl =
      webPerm === 'denied' && typeof settings?.webSettingsUrl === 'string' ? settings.webSettingsUrl : null

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
     * this only ever runs from the button. A grant also reaches the feature's
     * stream subscriber, which mounted before the answer existed. */
    const authorize = (): Promise<void> =>
      run(async () => {
        try {
          const next = await Notification.requestPermission()
          setWebPerm(next)
          if (next === 'granted' && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new Event(NOTIFY_PERMISSION_EVENT))
          }
        } catch {
          return t('webNotifFailed')
        }
      }, 'webperm')

    /** Hand the settings address over for pasting: the page cannot open it. */
    const copySettingsUrl = async (): Promise<void> => {
      if (settingsUrl === null) return
      setCopyState((await copyAddress(settingsUrl)) ? 'done' : 'failed')
    }

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
          {settings?.platform === 'win32' ? (
            <div className="smkit-notify-page-row smkit-notify-page-row-stacked">
              <div className="smkit-notify-page-row-head">
                <div className="smkit-notify-page-row-title">{t('durationTitle')}</div>
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
              <div className="smkit-notify-page-row-help">
                {t('durationHelp')}
                {webPerm === 'granted' ? ` ${t('durationHelpToastOnly')}` : ''}
              </div>
            </div>
          ) : null}
          {webPerm !== null ? (
            <div className="smkit-notify-page-row smkit-notify-page-row-stacked">
              <div className="smkit-notify-page-row-head">
                <div className="smkit-notify-page-row-title">{t('webNotifTitle')}</div>
                <div className="smkit-notify-page-row-controls">
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
                    <span className="smkit-notify-page-badge" data-smkit-state={webPerm}>
                      {webPerm === 'granted'
                        ? t('webNotifGranted')
                        : webPerm === 'denied'
                          ? t('webNotifDenied')
                          : t('webNotifUnsupported')}
                    </span>
                  )}
                  {settingsUrl === null ? null : (
                    <button className="smkit-ui-button" onClick={() => void copySettingsUrl()}>
                      {t('webNotifSettingsCopy')}
                    </button>
                  )}
                </div>
              </div>
              <div className="smkit-notify-page-row-help">
                {t('webNotifHelp')}
                {webPerm === 'denied'
                  ? ` ${t('webNotifDeniedHint')}`
                  : webPerm === 'unsupported'
                    ? ` ${t('webNotifUnsupportedHint')}`
                    : ''}
              </div>
              {settingsUrl !== null ? (
                <div className="smkit-notify-page-settings">
                  <div className="smkit-notify-page-row-help">{t('webNotifSettingsHint')}</div>
                  <div className="smkit-notify-page-settings-line">
                    <span className="smkit-notify-page-settings-address">{settingsUrl}</span>
                    {copyState === 'idle' ? null : (
                      <span className="smkit-notify-page-row-help">
                        {copyState === 'done' ? t('webNotifSettingsCopied') : t('webNotifSettingsCopyFailed')}
                      </span>
                    )}
                  </div>
                </div>
              ) : null}
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
