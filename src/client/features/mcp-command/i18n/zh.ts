/**
 * Simplified Chinese dictionary for the `mcp-command` locale namespace.
 *
 * `en.ts` must carry the exact same key set: the picker's copy resolves through
 * this namespace, and a key missing on one side is a blank row in that language.
 * Tool names and the servers' own descriptions deliberately stay as the servers
 * wrote them.
 */

import type { LocaleDict } from '../../../platform/types'

export const MCP_COMMAND_LOCALE_ZH: LocaleDict = {
  'searchPlaceholder': '搜索 MCP 工具',
  'empty': '这个项目还没有可用的 MCP 工具',
  'noResults': '没有匹配的工具',
  'loadFailed': '读取 MCP 工具清单失败，请稍后重试',
  'groupCommands': '命令',
  'rowList': '列出服务器与工具',
  'rowListDetail': '/mcp list — 按服务器列出工具数量与名称',
  'badgeCall': '补参数',
}
