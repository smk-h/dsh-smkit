/**
 * English dictionary for the `skills` locale namespace.
 *
 * Key set must stay identical to `zh.ts`. This is also the fallback DSH
 * uses when the resolved language has no `skills` dictionary.
 */

import type { LocaleDict } from '../../../platform/types'

export const SKILLS_LOCALE_EN: LocaleDict = {
  "sectionLabel": "Skills",
  "sectionIntro": "Inspect, enable or remove Agent Skills. The picker offers one entry for the user's side and one per project; the two user skill directories (~/.dsh/skills and ~/.agents/skills) and a project's .dsh and .agents all show as tabs.",
  "scope": "Skill directory",
  "scopeUser": "User",
  "scopeProject": "Projects",
  "rootTabs": "Skill directory tabs",
  "count": "{count} skills",
  "search": "Search skills…",
  "clearSearch": "Clear search",
  "searchEmpty": "No matching skills",
  "emptyRoot": "This skill directory is still empty: {path}",
  "emptyAbsent": "No skills installed yet — this skill directory does not exist: {path}",
  "skipped": "{count} skill directories carry no usable SKILL.md header and are not listed.",
  "incomplete": "This skill directory could not be read in full; the list below may be short.",
  "group": "Group",
  "linked": "Link",
  "disabled": "Disabled",
  "enable": "Enable",
  "disable": "Disable",
  "toggleFailed": "Could not switch the skill (HTTP {status})",
  "detailDescription": "Description",
  "detailWhenToUse": "Use when",
  "detailStatus": "Status",
  "detailInvocation": "Invocation",
  "statusEnabled": "Enabled",
  "statusDisabled": "Disabled",
  "invocationBoth": "Model and user",
  "invocationModel": "Model only",
  "invocationUser": "User only",
  "invocationNone": "Neither",
  "detailRoot": "Root directory",
  "detailPath": "File path",
  "detailRealPath": "Real path",
  "close": "Close",
  "remove": "Remove",
  "removeSkill": "Remove skill",
  "confirmRemove": "Remove \"{name}\"? This deletes the file (or directory) below from disk. This cannot be undone.",
  "removeFailed": "Remove failed (HTTP {status})",
}
