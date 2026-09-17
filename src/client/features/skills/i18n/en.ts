/**
 * English dictionary for the `skills` locale namespace.
 *
 * Key set must stay identical to `zh.ts`. This is also the fallback DSH
 * uses when the resolved language has no `skills` dictionary.
 */

import type { LocaleDict } from '../../../platform/types'

export const SKILLS_LOCALE_EN: LocaleDict = {
  "sectionLabel": "Skills",
  "sectionIntro": "Inspect, enable or remove Agent Skills. The user's two skill directories (~/.dsh/skills and ~/.agents/skills) are separate entries, and each project is one entry — selecting a project lists every skill in that project's skill directories.",
  "scope": "Skill directory",
  "scopeUser": "User",
  "scopeProject": "Projects",
  "count": "{count} skills",
  "search": "Search skills…",
  "clearSearch": "Clear search",
  "searchEmpty": "No matching skills",
  "emptyRoot": "This skill directory is still empty: {path}",
  "emptyProjectRoots": "This project has no skill directory yet (neither .dsh/skills nor .agents/skills exists under {path}).",
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
