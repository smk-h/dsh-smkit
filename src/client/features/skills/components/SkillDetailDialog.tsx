/**
 * The skill detail dialog: what one skill is, where it lives, and what the
 * harness does with it.
 *
 * Read-only, reached by clicking a row, and rendered straight from the row's
 * own data — the page's list already carries the file path, because the host
 * reads each skill's header off the filesystem to build the row in the first
 * place. Nothing is fetched here, so the dialog opens whole.
 *
 * The card wears the platform's dialog frame (`.smkit-ui-dialog`, injected before
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
    <div className="smkit-skill-detail-field">
      <div className="smkit-skill-detail-label">{label}</div>
      <div className={className === undefined ? 'smkit-skill-detail-value' : `smkit-skill-detail-value ${className}`}>
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
      <div className="smkit-ui-dialog-overlay" onClick={onClose}>
        <div
          className="smkit-ui-dialog smkit-skill-detail"
          role="dialog"
          aria-modal="true"
          aria-label={skill.name}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="smkit-skill-detail-head">
            <div className="smkit-skill-detail-title">{skill.name}</div>
            {skill.rel ? <span className="smkit-skill-row-chip">{skill.rel}</span> : null}
            {skill.linked ? <span className="smkit-skill-row-chip">{t('linked')}</span> : null}
            <button
              className="smkit-ui-icon-button smkit-skill-detail-close"
              type="button"
              aria-label={t('close')}
              onClick={onClose}
            >
              <ClearIcon size={14} />
            </button>
          </div>
          {field(t('detailDescription'), skill.description)}
          {skill.whenToUse ? field(t('detailWhenToUse'), skill.whenToUse) : null}
          <div className="smkit-skill-detail-pair">
            {field(t('detailStatus'), skill.enabled ? t('statusEnabled') : t('statusDisabled'))}
            {/* Both invocation flags matter: a header may narrow either side, and
                "user only" is not what a `disable-model-invocation` alone means. */}
            {field(
              t('detailInvocation'),
              skill.modelInvocable && skill.userInvocable
                ? t('invocationBoth')
                : skill.modelInvocable
                  ? t('invocationModel')
                  : skill.userInvocable
                    ? t('invocationUser')
                    : t('invocationNone'),
            )}
          </div>
          {skill.rel ? field(t('group'), skill.rel) : null}
          {field(t('detailRoot'), root, 'smkit-skill-detail-path')}
          {field(t('detailPath'), skill.path, 'smkit-skill-detail-path')}
          {/* A skill installed through a link shows both ends: the path its root
              holds it by, and the directory it really lives in — the latter is
              what a person needs to find the skill they actually edited. */}
          {skill.linked ? field(t('detailRealPath'), skill.realPath, 'smkit-skill-detail-path') : null}
        </div>
      </div>
    )
  }
}
