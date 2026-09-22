/**
 * The identity badge the settings pages share: the package name beside a
 * `v`-tagged version, the pill that says which plugin is speaking and at which
 * version at the top of every section (MCP, Skills, Custom settings alike).
 * When the package declares a repository the whole pill is a link to it, and
 * the mark of the host it lives on sits at the pill's tail.
 *
 * The name and version are build-time defines read from package.json
 * (`tsdown.config.ts`), so what the pill shows cannot drift from the package
 * that ships it. Prop-less on purpose: the identity belongs to the plugin as a
 * whole, and a page that wanted it different would be a page advertising a
 * different plugin.
 *
 * The paint is this layer's `style/version-badge.css` (`mm_versionBadge*`),
 * which every page inherits the way it inherits `mm_btn` and `mm_tabs`.
 */

import { createGithubIcon } from '../icons/GithubIcon'
import type { ClientDeps } from '../types'

export function createVersionBadge(deps: ClientDeps): () => JSX.Element {
  const { h } = deps
  const GithubIcon = createGithubIcon(deps)

  return function VersionBadge(): JSX.Element {
    const hasRepo = __PLUGIN_REPO_URL__ !== ''
    // A list rather than a fragment: the bundle compiles classic JSX without a
    // fragment factory, and these two are siblings of the mark, not a wrapper.
    const words = [
      <span className="mm_versionBadgeName" key="name">
        {__PLUGIN_NAME__}
      </span>,
      <span className="mm_versionBadgeTag" key="tag">
        v{__PLUGIN_VERSION__}
      </span>,
    ]
    // The mark names where the pill goes, so it rides along with the link: a
    // badge with no repository to go to has nothing to mark. It trails rather
    // than leads because a glyph between the name and its version would split
    // the one identity the two words spell.
    const mark = hasRepo ? <GithubIcon className="mm_versionBadgeMark" /> : null
    if (!hasRepo) return <div className="mm_versionBadge">{words}</div>
    // The whole pill is the target, not just the words: the mark at its tail
    // has to be on the link to be part of it.
    return (
      <a
        className="mm_versionBadge"
        href={__PLUGIN_REPO_URL__}
        target="_blank"
        rel="noreferrer"
      >
        {words}
        {mark}
      </a>
    )
  }
}
