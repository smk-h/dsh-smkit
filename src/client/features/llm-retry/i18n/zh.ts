/**
 * Simplified Chinese dictionary for the `llm-retry` locale namespace.
 *
 * The page's own copy: the route list, the policy form, the summary line each
 * row carries, and the refusals the host can answer with. The two button labels
 * every dialog shares (`cancel`, `delete`) live in the platform namespace, so
 * they are declared once for the whole plugin; `save` is this page's own
 * because nothing else in the plugin writes a settings section.
 */

import type { LocaleDict } from '../../../platform/types'

export const RETRY_LOCALE_ZH: LocaleDict = {
  "sectionLabel": "模型重试",
  "sectionIntro": "为每个已注册的提供方路由配置模型请求失败后的自动重试：模式、次数与退避间隔。保存后立即生效——下一次失败就按新值退避，不需要重启 dsh。",
  "heading": "提供方路由",
  "countRoutes": "{count} 个路由",
  "empty": "没有已注册的提供方路由。先在「模型」页配置一个提供方，这里就会列出它的重试策略。",
  "unavailableLlm": "当前部署没有挂载 llm 服务，读不到已注册的提供方路由。",
  "unavailableSettings": "当前部署没有挂载 settings 服务：策略只能查看，不能保存。",
  "loadFailed": "读取重试策略失败 (HTTP {status})",
  "policyCustom": "自定义",
  "policyDefault": "默认",
  "edit": "配置",
  "readOnly": "该提供方未声明可编辑的配置地址，只能查看当前策略。",
  "editTitle": "配置重试策略",
  "provider": "路由",
  "mode": "模式",
  "modeNormal": "normal（有界重试）",
  "modeAlways": "always（无限重试）",
  "maxRetries": "最多重试次数",
  "maxRetriesHelp": "首次请求之外的重试上限，0 表示不重试。",
  "unlimitedHelp": "always 模式没有次数上限，直到成功、取消或插件释放。",
  "initialDelayMs": "初始间隔（毫秒）",
  "maxDelayMs": "最大间隔（毫秒）",
  "jitterRatio": "抖动比例（0 到 1）",
  "backoffHelp": "每次等待取「初始 × 2^(第 n 次-1)」与最大值的较小者，再乘以 1-r+2r×随机；初始等于最大且抖动为 0 时即为固定间隔。",
  "resetHint": "「恢复默认」会删除配置文件中这条路由的 retryPolicy，恢复适配器默认值。",
  "summaryRetries": "最多 {count} 次",
  "summaryUnlimited": "无次数上限",
  "summaryFixedDelay": "固定 {delay} 毫秒",
  "summaryBackoffDelay": "{initial} → {maximum} 毫秒",
  "summaryJitter": "抖动 {ratio}",
  "save": "保存",
  "reset": "恢复默认",
  "cancel": "取消",
  "saveFailed": "保存失败 (HTTP {status})",
  "conflict": "配置已被其他窗口或手工编辑改动，已刷新，请重试。",
  "codeUnknownProvider": "该提供方已不再注册。",
  "codeNotEditable": "该提供方不允许在这里配置。",
  "codeUnavailable": "当前部署缺少所需的 DSH 服务。",
  "invalidMaxRetries": "最多重试次数必须是不小于 0 的整数。",
  "invalidInitialDelay": "初始间隔必须是大于 0 且不超过 2147483647 的毫秒整数。",
  "invalidMaxDelay": "最大间隔必须是大于 0 且不超过 2147483647 的毫秒整数。",
  "invalidOrder": "初始间隔不能大于最大间隔。",
  "invalidJitter": "抖动比例必须在 0 到 1 之间。",
}
