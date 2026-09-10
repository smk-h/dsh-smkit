/**
 * Bilingual / abbreviation synonym groups for `mcp_search_tools`.
 *
 * Only query terms are expanded — the document side keeps its own vocabulary,
 * which is the standard cheap choice for a lexical retriever. This is what lets
 * a Chinese query (`查日志`) hit a tool whose description is English
 * (`Query thor logs by service and time range.`).
 */

import { stemSearchToken } from './tokenize.js'
import type { SearchTerm } from '../types.js'

export const ALIAS_TERM_WEIGHT = 0.5

export const MCP_SEARCH_ALIASES: string[][] = [
  ['log', 'logs', 'logging', '日志'],
  ['search', 'query', 'find', '查询', '搜索', '检索'],
  ['deploy', 'deployment', 'release', 'publish', '部署', '发布', '上线'],
  ['config', 'configuration', 'settings', '配置', '设置'],
  ['database', 'db', '数据库'],
  ['table', '表格', '表'],
  ['user', 'account', '用户', '账号'],
  ['file', 'files', '文件'],
  ['document', 'doc', 'docs', 'documentation', '文档'],
  ['test', 'tests', 'testing', '测试'],
  ['error', 'errors', 'exception', '错误', '异常'],
  ['image', 'images', 'picture', '图片', '图像'],
  ['message', 'messages', 'msg', '消息'],
  ['task', 'tasks', 'job', '任务'],
  ['workflow', 'pipeline', '流程', '工作流'],
  ['monitor', 'monitoring', '监控'],
  ['metric', 'metrics', '指标'],
  ['cluster', '集群'],
  ['namespace', 'ns', '命名空间'],
  ['container', 'pod', '容器'],
  ['repo', 'repository', '仓库'],
  ['branch', '分支'],
  ['commit', '提交'],
  ['build', 'compile', '构建', '编译'],
  ['permission', 'permissions', 'auth', 'authorization', '权限', '认证', '鉴权'],
  ['domain', 'dns', '域名', '解析'],
  ['key', 'token', 'secret', '密钥', '令牌'],
  ['mail', 'email', '邮件'],
  ['calendar', 'schedule', '日历', '日程'],
  ['meeting', '会议'],
  ['create', 'add', 'new', '创建', '新增'],
  ['update', 'edit', 'modify', '更新', '修改'],
  ['delete', 'remove', '删除'],
  ['list', '列表'],
  ['get', 'fetch', 'read', '获取', '读取'],
  ['status', '状态'],
  ['name', '名称'],
  ['time', 'datetime', '时间'],
]

export function buildAliasIndex(aliasGroups: string[][]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  const link = (from: string, members: string[]): void => {
    const aliases = index.get(from) ?? new Set<string>()
    for (const member of members) if (member !== from) aliases.add(member)
    index.set(from, aliases)
  }
  for (const group of aliasGroups) {
    const members = [...new Set(group.map((member) => String(member).toLowerCase()))]
    for (const member of members) {
      link(member, members)
      const stem = stemSearchToken(member)
      if (stem !== member && stem !== '') link(stem, members)
    }
  }
  return index
}

export const SEARCH_ALIAS_INDEX: Map<string, Set<string>> = buildAliasIndex(MCP_SEARCH_ALIASES)

/** Expand query tokens with alias groups; the original term always wins. */
export function expandSearchTerms(tokens: string[]): SearchTerm[] {
  const weights = new Map<string, number>()
  const add = (term: string, weight: number): void => {
    if (!term) return
    const previous = weights.get(term)
    if (previous === undefined || weight > previous) weights.set(term, weight)
  }
  const list = Array.isArray(tokens) ? tokens : []
  for (const token of list) add(token, 1)
  for (const token of list) {
    const aliases = SEARCH_ALIAS_INDEX.get(token) ?? SEARCH_ALIAS_INDEX.get(stemSearchToken(token))
    if (!aliases) continue
    for (const alias of aliases) {
      add(alias, ALIAS_TERM_WEIGHT)
      const stem = stemSearchToken(alias)
      if (stem !== alias) add(stem, ALIAS_TERM_WEIGHT)
    }
  }
  return [...weights.entries()].map(([term, weight]) => ({ term, weight }))
}
