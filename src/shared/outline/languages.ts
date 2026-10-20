/**
 * Which file kinds the outline claims, and which profile reads them.
 *
 * Kept in `shared/` because both halves need the same answer: the host picks a
 * profile by suffix, and the browser decides whether to draw a toggle at all.
 * Two independent lists would drift the moment one gained an extension — the
 * toggle would open on a file the host refuses, or stay hidden on one it could
 * read.
 *
 * Data only: a profile's behaviour lives in the host half (`features/outline/
 * profiles`), because a profile carries code and the browser bundle must not
 * pull a scanner into the page.
 */

/** One language the outline can read. */
export interface OutlineLanguage {
  /** Profile id in the host half; also what a refusal message names. */
  readonly id: string
  /** Lowercase suffixes, leading dot included. */
  readonly extensions: readonly string[]
  /**
   * Whole base names with no suffix of their own — the shell's rc files.
   *
   * `.zshrc` is not "a file with the extension `.zshrc`"; it is one of the few
   * files a reader edits and expects an outline for, and no suffix rule reaches
   * it.
   */
  readonly names?: readonly string[]
}

/** The languages read today, in the order their extensions are tried. */
export const OUTLINE_LANGUAGES: readonly OutlineLanguage[] = [
  {
    id: 'c-family',
    extensions: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hh', '.hpp', '.hxx', '.ino', '.m', '.mm'],
  },
  {
    id: 'js-family',
    extensions: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'],
  },
  {
    id: 'shell-family',
    extensions: ['.sh', '.bash', '.zsh', '.ksh'],
    names: ['.bashrc', '.bash_profile', '.bash_aliases', '.zshrc', '.zprofile', '.zshenv', '.profile'],
  },
]

/** Every suffix, flattened for callers that only need the set. */
export const OUTLINE_EXTENSIONS: readonly string[] = OUTLINE_LANGUAGES.flatMap(
  (language) => language.extensions,
)

/**
 * The suffix of a path the outline claims, or undefined.
 *
 * Deliberately not `node:path`: this runs in the browser too, and the only
 * question being asked is "does the lowered tail match a known suffix".
 *
 * @param path - a path or a bare file name.
 * @returns the matched suffix, lowercase, or undefined when none matches.
 */
export function outlineSuffixOf(path: string): string | undefined {
  const lower = path.toLowerCase()
  return OUTLINE_EXTENSIONS.find((extension) => lower.endsWith(extension))
}

/**
 * The language that claims a path, by base name first and suffix second.
 *
 * Base names win because a `.zshrc` is a shell script whose last dot is not a
 * suffix, and a suffix rule would either miss it or (worse) match `.zshrc` as
 * some other language's ending.
 *
 * @param path - a path or a bare file name; separators may be either kind.
 * @returns the language, or undefined when nothing claims the file.
 */
export function outlineLanguageOf(path: string): OutlineLanguage | undefined {
  const lower = path.toLowerCase()
  const base = lower.split(/[\\/]/).pop() ?? ''
  for (const language of OUTLINE_LANGUAGES) {
    if (language.names?.includes(base) === true) return language
  }
  const suffix = outlineSuffixOf(lower)
  return suffix === undefined
    ? undefined
    : OUTLINE_LANGUAGES.find((language) => language.extensions.includes(suffix))
}
