/**
 * Which profile reads which file.
 *
 * The suffix list is shared with the browser half (`shared/outline/languages`),
 * which decides whether to draw a toggle at all; this file turns the id it names
 * into behaviour. A language that is added to the shared list without a profile
 * here is simply not offered — the two cannot silently disagree about a file the
 * toggle says is readable.
 */

import { outlineLanguageOf, outlineSuffixOf } from '../../../../shared/outline/languages.js'
import { C_FAMILY } from './c.js'
import { JS_FAMILY } from './js.js'
import { SHELL_FAMILY } from './shell.js'
import type { SourceProfile } from '../scan.js'

/** Every profile, by the id the shared language list uses. */
const PROFILES: Readonly<Record<string, SourceProfile>> = {
  'c-family': C_FAMILY,
  'js-family': JS_FAMILY,
  'shell-family': SHELL_FAMILY,
}

/** The profile for a file, and the suffix that selected it. */
export interface ProfileMatch {
  readonly profile: SourceProfile
  readonly suffix: string
}

/**
 * Pick the profile for one path.
 *
 * @param path - a path or a bare file name.
 * @returns the profile and its suffix, or undefined when no language claims it.
 */
export function profileFor(path: string): ProfileMatch | undefined {
  const language = outlineLanguageOf(path)
  if (language === undefined) return undefined
  const profile = PROFILES[language.id]
  return profile === undefined ? undefined : { profile, suffix: outlineSuffixOf(path) ?? '' }
}
