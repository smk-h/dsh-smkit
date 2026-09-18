/**
 * The identity badge the settings pages share: the package name — a link to the
 * repository when the package declares one — beside a `v`-tagged version, the
 * pill that says which plugin is speaking and at which version at the top of
 * every section (MCP, Skills, Custom settings alike).
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

import type { ClientDeps } from '../types'

export function createVersionBadge(deps: ClientDeps): () => JSX.Element {
  const { h } = deps

  return function VersionBadge(): JSX.Element {
    const name =
      __PLUGIN_REPO_URL__ === '' ? (
        <span className="mm_versionBadgeName">{__PLUGIN_NAME__}</span>
      ) : (
        <a
          className="mm_versionBadgeName"
          href={__PLUGIN_REPO_URL__}
          target="_blank"
          rel="noreferrer"
        >
          {__PLUGIN_NAME__}
        </a>
      )
    return (
      <div className="mm_versionBadge">
        {name}
        <span className="mm_versionBadgeTag">v{__PLUGIN_VERSION__}</span>
      </div>
    )
  }
}
