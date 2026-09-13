/**
 * Tokenisation for the zero-dependency lexical tool search.
 *
 * NFKC normalization, camelCase boundaries, CJK unigrams + bigrams, and a
 * conservative English stemmer. Stopwords are dropped **only when something
 * else remains**, so a stopword-only query still searches instead of silently
 * degrading to a catalog browse.
 */

const SEARCH_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'for', 'and', 'or', 'is', 'are', 'be',
  'in', 'on', 'with', 'by', 'at', 'from', 'as', 'it', 'this', 'that',
])

const CJK_TOKEN_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u

/** NFKC + lowercase, used for the exact-name bonus and by callers. */
export function normalizeSearchText(text: unknown): string {
  return String(text ?? '').normalize('NFKC').toLowerCase()
}

/** Conservative English stemmer; long words only, so short words stay intact. */
export function stemSearchToken(token: unknown): string {
  const value = String(token ?? '').toLowerCase()
  if (!/^[a-z][a-z0-9]*$/.test(value)) return value
  if (value.length >= 5 && value.endsWith('ies')) return value.slice(0, -3) + 'y'
  if (value.length >= 5 && value.endsWith('ing')) {
    const base = value.slice(0, -3)
    return base.length >= 3 ? base : value
  }
  if (value.length >= 5 && value.endsWith('ed')) {
    const base = value.slice(0, -2)
    return base.length >= 3 ? base : value
  }
  if (value.length >= 4 && value.endsWith('s') && !value.endsWith('ss') && !value.endsWith('us')) {
    return value.slice(0, -1)
  }
  return value
}

function pushCjkTokens(tokens: string[], part: string): void {
  const chars = [...part]
  if (chars.length === 1) {
    tokens.push(chars[0])
    return
  }
  for (const char of chars) tokens.push(char)
  for (let index = 0; index + 1 < chars.length; index += 1) {
    tokens.push(chars[index] + chars[index + 1])
  }
}

/**
 * Split text into search tokens: camelCase boundaries, punctuation separators,
 * CJK unigrams + bigrams, and surface + stem forms of Latin words.
 */
export function tokenizeSearchText(text: unknown): string[] {
  const raw = String(text ?? '').normalize('NFKC').trim()
  if (raw === '') return []
  const camelSplit = raw.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
  const parts = camelSplit.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const tokens: string[] = []
  for (const part of parts) {
    if (CJK_TOKEN_RE.test(part)) {
      pushCjkTokens(tokens, part)
      continue
    }
    tokens.push(part)
    const stem = stemSearchToken(part)
    if (stem !== part && stem !== '') tokens.push(stem)
  }
  if (tokens.length === 0) return []
  const filtered = tokens.filter((token) => !SEARCH_STOPWORDS.has(token))
  return filtered.length > 0 ? filtered : tokens
}
