/**
 * One skill row.
 *
 * The row states what the skill is — a glyph, its name, one line of description
 * — and carries the page's two actions on its right: the switch that enables or
 * disables it, and the button that removes it. Clicking anywhere in the row body
 * opens the detail dialog (`SkillDetailDialog`), which shows the file path and,
 * for a skill installed through a link, the directory it resolves to. The
 * markers after the text say what is not the default: which directory the row
 * came from when the view reads several (a project), the group of a nested
 * skill, a link, a disabled state.
 *
 * Both actions are addressed by the same four facts the row was rendered from —
 * name, root, project and group — and the host resolves them against a fresh
 * scan of that one root, so a name that moved between roots (or between groups)
 * since the poll is a miss rather than a write to its namesake. The confirmation
 * names the exact file it is about to delete.
 *
 * The switch is optimistic in one direction: it shows the state the click asked
 * for immediately, and falls back if the host refuses, because a switch that
 * waits for a round trip feels broken — the poll that follows settles the truth
 * within a few seconds either way.
 */

import { createTrashIcon } from '../../../platform/icons/TrashIcon'
import { createWandSparklesIcon } from '../icons/WandSparklesIcon'
import { createConfirmDialog } from '../../../platform/ui/ConfirmDialog'
import { createSkillDetailDialog } from './SkillDetailDialog'
import { useAsyncAction } from '../../../platform/ui/useAsyncAction'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { SkillView } from '../types'

/** Which overlay the row has open, if any. */
type RowDialog = 'none' | 'detail' | 'remove'

/**
 * How each root is shortened on a row that has to say which one it came from.
 * A user root needs no marker (a user view *is* that root), so these are only
 * read in a merged project view; the paths are the provider's own directory
 * names, not strings to translate.
 */
const SOURCE_MARKS: Record<string, string> = {
  'user-dsh': '~/.dsh',
  'user-agents': '~/.agents',
  'project-dsh': '.dsh',
  'project-agents': '.agents',
}

export interface SkillRowProps {
  t: Translator
  skill: SkillView
  /** The root key this row lives in (`user-dsh`, …). */
  source: string
  /** The project that root means, or `''` for a user root. */
  cwd: string
  /** The root's absolute path, shown in the dialog and the confirmation. */
  root: string
  /** Whether the view reads more than one directory, so a row must name its own. */
  merged: boolean
  /** Called after a successful removal, so the row can leave the list at once. */
  onRemoved(skill: SkillView): void
  /** Re-poll the view after a write. */
  onChanged(): void
}

export function createSkillRow(deps: ClientDeps): (props: SkillRowProps) => JSX.Element {
  const { h, react, api } = deps
  const ConfirmDialog = createConfirmDialog(deps)
  const SkillDetailDialog = createSkillDetailDialog(deps)
  const WandSparklesIcon = createWandSparklesIcon(deps)
  const TrashIcon = createTrashIcon(deps)

  return function SkillRow({
    t,
    skill,
    source,
    cwd,
    root,
    merged,
    onRemoved,
    onChanged,
  }: SkillRowProps): JSX.Element {
    const { busy, error, run } = useAsyncAction(react)
    const [dialog, setDialog] = react.useState<RowDialog>('none')
    const [wanted, setWanted] = react.useState<boolean | null>(null)
    const enabled = wanted ?? skill.enabled

    // Once the poll reports the state the click asked for, the row follows the
    // disk again — including a change made outside this page.
    react.useEffect(() => {
      if (wanted !== null && wanted === skill.enabled) setWanted(null)
    }, [skill.enabled, wanted])

    /** The four facts that address this skill, as a query string. */
    const address = (): string => {
      const parts = [
        `source=${encodeURIComponent(source)}`,
        `rel=${encodeURIComponent(skill.rel)}`,
      ]
      if (cwd !== '') parts.unshift(`cwd=${encodeURIComponent(cwd)}`)
      return `?${parts.join('&')}`
    }

    const toggle = (): void => {
      const next = !enabled
      setWanted(next)
      void run(async () => {
        const r = await api('/skills/enabled', {
          method: 'POST',
          body: JSON.stringify({
            name: skill.name,
            source,
            cwd,
            rel: skill.rel,
            enabled: next,
          }),
        })
        if (r.ok) {
          onChanged()
          return
        }
        setWanted(null)
        return r.body.error || t('toggleFailed', { status: r.status })
      })
    }

    const remove = (): Promise<void> => {
      setDialog('none')
      return run(async () => {
        const r = await api(`/skills/${encodeURIComponent(skill.name)}${address()}`, {
          method: 'DELETE',
        })
        if (r.ok) {
          onRemoved(skill)
          onChanged()
          return
        }
        return r.body.error || t('removeFailed', { status: r.status })
      })
    }

    /** The facts the confirmation shows: the root, and exactly what goes. */
    const facts = (
      <div className="sk_facts">
        <div className="sk_fact">
          <span className="sk_factLabel">{t('detailRoot')}</span>
          <span className="sk_factValue">{root}</span>
        </div>
        <div className="sk_fact">
          <span className="sk_factLabel">{t('detailPath')}</span>
          <span className="sk_factValue">{skill.path}</span>
        </div>
        {skill.linked ? (
          <div className="sk_fact">
            <span className="sk_factLabel">{t('detailRealPath')}</span>
            <span className="sk_factValue">{skill.realPath}</span>
          </div>
        ) : null}
      </div>
    )

    return (
      <div className="sk_row" data-disabled={enabled ? undefined : 'true'}>
        <button className="sk_open" type="button" onClick={() => setDialog('detail')} disabled={busy}>
          <span className="sk_glyph">
            <WandSparklesIcon size={14} />
          </span>
          <span className="sk_text">
            <span className="sk_name" title={skill.name}>
              {skill.name}
            </span>
            {skill.description ? <span className="sk_desc">{skill.description}</span> : null}
          </span>
        </button>
        {merged ? <span className="sk_chip">{SOURCE_MARKS[skill.source] ?? skill.source}</span> : null}
        {skill.rel ? <span className="sk_chip">{skill.rel}</span> : null}
        {skill.linked ? <span className="sk_chip">{t('linked')}</span> : null}
        {enabled ? null : <span className="sk_chip sk_chipOff">{t('disabled')}</span>}
        <button
          className="sk_switch"
          type="button"
          role="switch"
          aria-checked={enabled}
          data-on={enabled ? 'true' : 'false'}
          aria-label={enabled ? t('disable') : t('enable')}
          onClick={toggle}
          disabled={busy}
        >
          <span className="sk_switchThumb" />
        </button>
        <button
          className="mm_iconBtn sk_trash"
          type="button"
          aria-label={t('remove')}
          onClick={() => setDialog('remove')}
          disabled={busy}
        >
          <TrashIcon size={15} />
        </button>
        {dialog === 'detail' ? (
          <SkillDetailDialog t={t} skill={skill} root={root} onClose={() => setDialog('none')} />
        ) : null}
        {dialog === 'remove' ? (
          <ConfirmDialog
            title={t('removeSkill')}
            body={t('confirmRemove', { name: skill.name, source: root })}
            details={facts}
            busy={busy}
            error={error}
            onCancel={() => setDialog('none')}
            onConfirm={remove}
          />
        ) : null}
        {dialog === 'none' && error ? <div className="mm_err">{error}</div> : null}
      </div>
    )
  }
}
