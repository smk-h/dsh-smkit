/**
 * The little of a `SKILL.md` header this page needs.
 *
 * The harness parses a skill's frontmatter with a real YAML reader
 * (`@deepseek-ai/dsh-skill-filesystem`); this plugin deliberately takes no YAML
 * dependency for a management page. What is read here instead is the flat
 * `key: value` shape these headers are actually written in, plus the two block
 * scalar indicators (`|` and `>`), which is the whole of the grammar the
 * harness's own skills use. Anything richer — nested mappings, anchors, flow
 * collections — is outside what a skill header declares: `metadata` is the one
 * nested key the harness permits, and this page never shows it.
 *
 * Validation mirrors the harness's, because a file it would ignore must not
 * look installable here: a skill needs a non-empty `name` in the public
 * kebab-case shape and a non-empty `description`, and its invocation flags must
 * parse as booleans. `readSkillFrontmatter` returns `null` for anything else,
 * and the page reports those entries only as a skipped count.
 */

/** The parsed header of one skill file. */
export interface SkillFrontmatter {
  name: string
  description: string
  /** The skill's own hint for when to reach for it; `''` when absent. */
  whenToUse: string
  modelInvocable: boolean
  userInvocable: boolean
}

/** The public skill-name grammar (`@deepseek-ai/dsh-skill`). */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A block scalar's indicator: `|`, `>`, `|-`, `>+`, `|2-`, … */
const BLOCK_SCALAR_RE = /^([|>])(\d*)([+-]?)$/

/** A top-level `key: value` line (indented lines belong to the key above). */
const FIELD_RE = /^([A-Za-z0-9_.-]+):(.*)$/

/**
 * Read one file's header.
 * @param raw - the whole file, as text.
 * @returns the header, or `null` when the file is not a usable skill.
 */
export function readSkillFrontmatter(raw: string): SkillFrontmatter | null {
  const block = frontmatterBlock(raw)
  if (block === null) return null
  const fields = readFields(block)
  const name = fields.get('name') ?? ''
  const description = fields.get('description') ?? ''
  if (!SKILL_NAME_RE.test(name) || description === '') return null
  return {
    name,
    description,
    whenToUse: fields.get('whenToUse') ?? '',
    // The harness's own defaults: a skill is invocable both ways unless the
    // header says otherwise, and only an explicit `true`/`false` narrows it.
    modelInvocable: booleanValue(fields.get('disable-model-invocation')) !== true,
    userInvocable: booleanValue(fields.get('user-invocable')) !== false,
  }
}

/** The text between the leading `---` line and the closing one, or `null`. */
function frontmatterBlock(raw: string): string | null {
  const lines = raw.split('\n')
  if (stripCr(lines[0]) !== '---') return null
  for (let index = 1; index < lines.length; index += 1) {
    if (stripCr(lines[index]) === '---') return lines.slice(1, index).join('\n')
  }
  return null
}

/**
 * The flat fields of one header block. A block scalar consumes the indented
 * lines under it — folded into one line for `>`, kept as lines for `|` — so a
 * description written either way arrives whole rather than as its indicator.
 */
function readFields(block: string): Map<string, string> {
  const lines = block.split('\n')
  const fields = new Map<string, string>()
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripCr(lines[index])
    // Indented lines belong to the field above; comments and blanks carry nothing.
    if (line.trim() === '' || line.startsWith('#') || /^\s/.test(line)) continue
    const match = FIELD_RE.exec(line)
    if (match === null) continue
    const key = match[1]
    const raw = match[2].trim()
    const scalar = BLOCK_SCALAR_RE.exec(raw)
    if (scalar === null) {
      fields.set(key, unquote(raw))
      continue
    }
    const folded = scalar[1] === '>'
    const body: string[] = []
    while (index + 1 < lines.length) {
      const next = stripCr(lines[index + 1])
      if (next.trim() !== '' && !/^\s/.test(next)) break
      body.push(next)
      index += 1
    }
    const text = body
      .map((entry) => entry.replace(/^\s+/, ''))
      .join(folded ? ' ' : '\n')
      .trim()
    fields.set(key, text)
  }
  return fields
}

/** Drop a `\r`, so a CRLF file reads the same as an LF one. */
function stripCr(line: string | undefined): string {
  return (line ?? '').replace(/\r$/, '')
}

/** One scalar: its quotes removed, and any trailing comment dropped. */
function unquote(raw: string): string {
  const double = /^"(.*)"$/.exec(raw)
  if (double !== null) return double[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  const single = /^'(.*)'$/.exec(raw)
  if (single !== null) return single[1].replace(/''/g, "'")
  const comment = raw.search(/\s#/)
  return (comment === -1 ? raw : raw.slice(0, comment)).trim()
}

/** The boolean spellings the harness accepts, or `undefined` for anything else. */
function booleanValue(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined
  switch (raw.toLowerCase()) {
    case 'true':
    case 'yes':
    case 'on':
    case '1':
      return true
    case 'false':
    case 'no':
    case 'off':
    case '0':
      return false
    default:
      return undefined
  }
}
