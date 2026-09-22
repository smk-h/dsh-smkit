/**
 * The GitHub mark: a filled disc with the cat cut out of it.
 *
 * Glyph ported verbatim from GitHub's own Octicons (`mark-github`, 16px grid) —
 * MIT, © GitHub, Inc. — https://primer.style/octicons/icon/mark-github-16/ —
 * inlined here the same way as the glyphs beside it, without taking a runtime
 * dependency on the package.
 *
 * The disc is already in this one contour: the mark's outer boundary is the
 * circle, and the cat is traced inward from it, so the glyph paints as a solid
 * disc with the animal as the hole without a second shape being added. Adding
 * one is what made the disc vanish — a circle laid over this path cancels its
 * own interior under `evenodd`, leaving only the cat's own body painted.
 *
 * It paints in `currentColor`, so the disc takes the badge's text colour and the
 * cat takes the pill behind it: a dark disc on the light theme, a light disc on
 * the dark one, with no second colour and no theme selector in the glyph.
 *
 * It is drawn by one thing: the identity badge (`platform/ui/VersionBadge`), at
 * the tail of the pill that links to this plugin's repository. The badge is
 * mounted by every settings page, so the glyph it carries is platform material
 * like the `<svg>` shell it is drawn with.
 */

import { createIcon, type IconFactory, type IconSpec } from './Icon'
import type { ClientDeps } from '../types'

/** Octicons' 16px grid. One contour, filled: no stroke, no second shape. */
const MARK =
  'M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656'

export const GITHUB_SPEC: IconSpec = {
  size: 16,
  viewBox: '0 0 16 16',
  nodes: [
    {
      tag: 'path',
      attrs: {
        d: MARK,
        fill: 'currentColor',
      },
    },
  ],
}

export function createGithubIcon(deps: ClientDeps): IconFactory {
  return createIcon(deps, GITHUB_SPEC)
}
