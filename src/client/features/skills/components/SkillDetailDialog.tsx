/**
 * The skill detail dialog: what one skill is, where it lives, and what the
 * harness does with it.
 *
 * Read-only, reached by clicking a row, and rendered straight from the row's
 * own data — the page's list already carries the file path, because the host
 * reads each skill's header off the filesystem to build the row in the first
 * place. Nothing is fetched here, so the dialog opens whole.
 *
 * The card wears the platform's dialog frame (`.mm_dialog`, injected before
 * this feature's own rules), so this overlay and the confirmation dialog read
 * as one dialog family; only the width, the close control and the field layout
 * are this feature's own.
 */

import { createClearIcon } from '../../../platform/icons/ClearIcon'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { SkillView } from '../types'

export interface SkillDetailDialogProps {
  t: Translator
  skill: SkillView
  /** The absolute root directory the skill was found in. */
  root: string
  onClose(): void
}

export function createSkillDetailDialog(
  deps: ClientDeps,
): (props: SkillDetailDialogProps) => JSX.Element {
  const { h } = deps
  const ClearIcon = createClearIcon(deps)

  /** One labelled field of the dialog. */
  const field = (label: string, value: string, className?: string): JSX.Element => (
    <div className="sk_detailField">
      <div className="sk_detailLabel">{label}</div>
      <div className={className === undefined ? 'sk_detailValue' : `sk_detailValue ${className}`}>
        {value}
      </div>
    </div>
  )

  return function SkillDetailDialog({
    t,
    skill,
    root,
    onClose,
  }: SkillDetailDialogProps): JSX.Element {
    return (
      <div className="mm_overlay" onClick={onClose}>
        <div
          className="mm_dialog sk_detail"
          role="dialog"
          aria-modal="true"
          aria-label={skill.name}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sk_detailHead">
            <div className="sk_detailTitle">{skill.name}</div>
            {skill.rel ? <span className="sk_chip">{skill.rel}</span> : null}
            {skill.linked ? <span className="sk_chip">{t('linked')}</span> : null}
            <button
              className="mm_iconBtn sk_detailClose"
              type="button"
              aria-label={t('close')}
              onClick={onClose}
            >
              <ClearIcon size={14} />
            </button>
          </div>
          {field(t('detailDescription'), skill.description)}
          {skill.whenToUse ? field(t('detailWhenToUse'), skill.whenToUse) : null}
          <div className="sk_detailPair">
            {field(t('detailStatus'), skill.enabled ? t('statusEnabled') : t('statusDisabled'))}
            {field(
              t('detailInvocation'),
              skill.modelInvocable ? t('invocationBoth') : t('invocationUser'),
            )}
          </div>
          {skill.rel ? field(t('group'), skill.rel) : null}
          {field(t('detailRoot'), root, 'sk_detailPath')}
          {field(t('detailPath'), skill.path, 'sk_detailPath')}
          {/* A skill installed through a link shows both ends: the path its root
              holds it by, and the directory it really lives in — the latter is
              what a person needs to find the skill they actually edited. */}
          {skill.linked ? field(t('detailRealPath'), skill.realPath, 'sk_detailPath') : null}
        </div>
      </div>
    )
  }
}
