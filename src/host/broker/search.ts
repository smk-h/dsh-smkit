/**
 * BM25 ranking over the MCP tool catalog — pure, no `ctx`, no I/O, no clock.
 *
 * The catalog is small enough to index on every call (microseconds), so nothing
 * has to be invalidated when a server emits `notifications/tools/list_changed`.
 * Ranking = per-field BM25 with field weights, alias-expanded query terms at a
 * lower weight, a bounded edit-distance fallback for typos, plus bonuses for an
 * exact name/token hit. No embedding model, no vector store, no network.
 */

import { expandSearchTerms } from './aliases.js'
import { normalizeSearchText, tokenizeSearchText } from './tokenize.js'
import type { ToolCatalogEntry, ToolSearchMatch, ToolSearchResult } from '../types.js'

export const SEARCH_LIMIT_DEFAULT = 10
export const SEARCH_LIMIT_MIN = 1
export const SEARCH_LIMIT_MAX = 50

const BM25_K1 = 1.2
const BM25_B = 0.75
const SEARCH_FIELD_ORDER = ['tool', 'server', 'description'] as const
const SEARCH_FIELD_WEIGHTS: Record<(typeof SEARCH_FIELD_ORDER)[number], number> = {
  tool: 3,
  server: 2,
  description: 1,
}
const FUZZY_TERM_WEIGHT = 0.6
const EXACT_NAME_BONUS = 3
const EXACT_TOKEN_BONUS = 2
const MIN_FUZZY_TOKEN_LENGTH = 5
const MAX_FUZZY_CANDIDATES_PER_TERM = 5

type SearchField = (typeof SEARCH_FIELD_ORDER)[number]

interface IndexedField {
  tf: Map<string, number>
  length: number
  tokens: Set<string>
}

interface FieldStats {
  df: Map<string, number>
  avgLength: number
}

interface IndexedDocument {
  entry: ToolCatalogEntry
  fields: Record<SearchField, IndexedField>
}

interface SearchIndex {
  documents: IndexedDocument[]
  stats: Record<SearchField, FieldStats>
  vocabulary: Set<string>
}

function searchTermFrequency(tokens: string[]): Map<string, number> {
  const frequency = new Map<string, number>()
  for (const token of tokens) frequency.set(token, (frequency.get(token) ?? 0) + 1)
  return frequency
}

function compareSearchText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function clampSearchLimit(value: unknown): number {
  const requested = Number.isInteger(value) ? (value as number) : SEARCH_LIMIT_DEFAULT
  return Math.max(SEARCH_LIMIT_MIN, Math.min(SEARCH_LIMIT_MAX, requested))
}

function buildSearchIndex(entries: ToolCatalogEntry[]): SearchIndex {
  const documents: IndexedDocument[] = entries.map((entry) => {
    const fields = {} as Record<SearchField, IndexedField>
    for (const field of SEARCH_FIELD_ORDER) {
      const tokens = tokenizeSearchText(entry[field] ?? '')
      fields[field] = { tf: searchTermFrequency(tokens), length: tokens.length, tokens: new Set(tokens) }
    }
    return { entry, fields }
  })
  const stats = {} as Record<SearchField, FieldStats>
  const vocabulary = new Set<string>()
  for (const field of SEARCH_FIELD_ORDER) {
    const df = new Map<string, number>()
    let totalLength = 0
    for (const document of documents) {
      totalLength += document.fields[field].length
      for (const token of document.fields[field].tf.keys()) {
        df.set(token, (df.get(token) ?? 0) + 1)
        vocabulary.add(token)
      }
    }
    stats[field] = { df, avgLength: documents.length > 0 ? totalLength / documents.length : 0 }
  }
  return { documents, stats, vocabulary }
}

function bm25TermScore(field: IndexedField, term: string, stats: FieldStats, documentCount: number): number {
  const documentFrequency = stats.df.get(term) ?? 0
  if (documentFrequency === 0) return 0
  const termFrequency = field.tf.get(term) ?? 0
  if (termFrequency === 0) return 0
  const idf = Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5))
  const lengthRatio = stats.avgLength > 0 ? field.length / stats.avgLength : 1
  const denominator = termFrequency + BM25_K1 * (1 - BM25_B + BM25_B * lengthRatio)
  return (idf * termFrequency * (BM25_K1 + 1)) / denominator
}

function boundedEditDistance(left: string, right: string, maxDistance: number): number {
  if (left === right) return 0
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1
  let previous = new Array<number>(right.length + 1)
  let current = new Array<number>(right.length + 1)
  for (let index = 0; index <= right.length; index += 1) previous[index] = index
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row
    let rowMinimum = row
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + cost,
      )
      if (current[column] < rowMinimum) rowMinimum = current[column]
    }
    if (rowMinimum > maxDistance) return maxDistance + 1
    const swap = previous
    previous = current
    current = swap
  }
  return previous[right.length]
}

function fuzzySearchTerms(term: string, vocabulary: Set<string>): string[] {
  if (term.length < MIN_FUZZY_TOKEN_LENGTH) return []
  const maxDistance = term.length >= 8 ? 2 : 1
  const candidates: string[] = []
  for (const candidate of vocabulary) {
    if (candidate === term) continue
    if (Math.abs(candidate.length - term.length) > maxDistance) continue
    if (boundedEditDistance(term, candidate, maxDistance) <= maxDistance) candidates.push(candidate)
  }
  candidates.sort()
  return candidates.slice(0, MAX_FUZZY_CANDIDATES_PER_TERM)
}

function toSearchMatch(entry: ToolCatalogEntry, score: number): ToolSearchMatch {
  return {
    name: String(entry.name ?? ''),
    server: String(entry.server ?? ''),
    tool: String(entry.tool ?? ''),
    description: String(entry.description ?? '').slice(0, 300),
    score,
  }
}

/**
 * Rank one catalog snapshot against a lexical query. Returns
 * `{ query, total, matches }` where `total` is the number of results before
 * `limit` truncation. Omitting the query browses the catalog instead.
 */
export function searchToolEntries(
  entries: ToolCatalogEntry[],
  options: { query?: unknown; server?: unknown; limit?: unknown } = {},
): ToolSearchResult {
  const catalog = Array.isArray(entries) ? entries : []
  const query = typeof options.query === 'string' ? options.query.trim() : ''
  const serverFilter = typeof options.server === 'string' ? options.server.trim().toLowerCase() : ''
  const limit = clampSearchLimit(options.limit)
  const filtered =
    serverFilter === ''
      ? catalog.slice()
      : catalog.filter((entry) => String(entry.server ?? '').toLowerCase() === serverFilter)

  if (query === '') {
    const browse = filtered
      .map((entry) => ({ entry, server: String(entry.server ?? ''), name: String(entry.name ?? '') }))
      .sort(
        (left, right) => compareSearchText(left.server, right.server) || compareSearchText(left.name, right.name),
      )
      .slice(0, limit)
      .map((item) => toSearchMatch(item.entry, 0))
    return { query: '', total: filtered.length, matches: browse }
  }

  const tokens = tokenizeSearchText(query)
  if (tokens.length === 0) return { query, total: 0, matches: [] }

  const index = buildSearchIndex(filtered)
  const terms = expandSearchTerms(tokens)
  for (const term of [...terms]) {
    if (index.vocabulary.has(term.term)) continue
    for (const candidate of fuzzySearchTerms(term.term, index.vocabulary)) {
      terms.push({ term: candidate, weight: term.weight * FUZZY_TERM_WEIGHT })
    }
  }

  const exactQuery = normalizeSearchText(query)
  const queryTokens = new Set(tokens)
  const scored: { entry: ToolCatalogEntry; score: number }[] = []
  for (const document of index.documents) {
    let score = 0
    for (const term of terms) {
      for (const field of SEARCH_FIELD_ORDER) {
        const fieldScore = bm25TermScore(document.fields[field], term.term, index.stats[field], filtered.length)
        if (fieldScore > 0) score += fieldScore * SEARCH_FIELD_WEIGHTS[field] * term.weight
      }
    }
    const toolName = String(document.entry.tool ?? '').toLowerCase()
    const publicName = `${String(document.entry.server ?? '').toLowerCase()}__${toolName}`
    if (exactQuery !== '' && (toolName.includes(exactQuery) || publicName.includes(exactQuery))) {
      score += EXACT_NAME_BONUS
    }
    for (const token of queryTokens) {
      if (document.fields.tool.tokens.has(token)) {
        score += EXACT_TOKEN_BONUS
        break
      }
    }
    if (score <= 0) continue
    scored.push({ entry: document.entry, score: Math.round(score * 100) })
  }
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      compareSearchText(String(left.entry.server ?? ''), String(right.entry.server ?? '')) ||
      compareSearchText(String(left.entry.name ?? ''), String(right.entry.name ?? '')),
  )
  return {
    query,
    total: scored.length,
    matches: scored.slice(0, limit).map((item) => toSearchMatch(item.entry, item.score)),
  }
}
