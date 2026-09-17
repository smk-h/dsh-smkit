/**
 * Simplified Chinese dictionary for the `skills` locale namespace.
 *
 * `en.ts` must always carry the exact same key set — DSH owns language
 * selection (Settings → General → Language) and the component tree resolves
 * every user-visible string through `t` from this namespace. Skill names,
 * descriptions and `whenToUse` hints are the skill authors' own text and
 * deliberately stay in their original language, as do directory paths.
 */

import type { LocaleDict } from '../../../platform/types'

export const SKILLS_LOCALE_ZH: LocaleDict = {
  "sectionLabel": "Skills",
  "sectionIntro": "查看、启停与移除 Agent Skills。用户的两个技能目录（~/.dsh/skills 与 ~/.agents/skills）各自一档，每个项目一档——选中项目后显示该项目下技能目录里的全部技能。",
  "scope": "技能目录",
  "scopeUser": "用户",
  "scopeProject": "项目",
  "count": "{count} 个技能",
  "search": "搜索技能…",
  "clearSearch": "清空搜索",
  "searchEmpty": "没有匹配的技能",
  "emptyRoot": "这个技能目录还是空的：{path}",
  "emptyProjectRoots": "这个项目下还没有技能目录（{path} 下的 .dsh/skills 与 .agents/skills 都不存在）。",
  "skipped": "有 {count} 个技能目录没有可用的 SKILL.md 头部，已跳过。",
  "incomplete": "这个技能目录未能完整读取，下面的列表可能不全。",
  "group": "分组",
  "linked": "链接",
  "disabled": "已停用",
  "enable": "启用",
  "disable": "停用",
  "toggleFailed": "切换失败 (HTTP {status})",
  "detailDescription": "描述",
  "detailWhenToUse": "适用场景",
  "detailStatus": "状态",
  "detailInvocation": "调用方式",
  "statusEnabled": "已启用",
  "statusDisabled": "已停用",
  "invocationBoth": "模型与用户",
  "invocationUser": "仅用户手动",
  "detailRoot": "根目录",
  "detailPath": "文件路径",
  "detailRealPath": "实际路径",
  "close": "关闭",
  "remove": "移除",
  "removeSkill": "移除技能",
  "confirmRemove": "确定要移除「{name}」吗？该操作会把下面这个文件（或目录）从磁盘上删除，且不可恢复。",
  "removeFailed": "移除失败 (HTTP {status})",
}
