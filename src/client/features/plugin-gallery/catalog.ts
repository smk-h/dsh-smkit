/**
 * The plugins the gallery tab lists: a hand-kept shortlist, one card each.
 *
 * The list is data rather than markup for the same reason the local-cache
 * page's categories are: a card carries nothing a reader of this constant
 * cannot see — a package name, the repository it lives in, and the one line
 * that installs it — so adding a plugin is one entry here plus one description
 * in the feature's dictionaries, and the panel itself never changes.
 *
 * What each field is, and what it is not:
 *
 * - `name` is the package name: the very string the command installs, and the
 *   string a reader would search for. It is an identifier rather than copy, so
 *   it is not in the dictionaries and is never translated.
 * - `repo` is the browse URL the name links to. Cards only link out; this page
 *   installs nothing, because a settings page that could run a package manager
 *   is a page that can be talked into running one.
 * - `command` is verbatim from the plugin's own README — `npx` prefixes and
 *   `-w` flags included. Rewriting one into a house style would be a
 *   correction this page has no standing to make, and the day the upstream
 *   changes it, a rewritten copy would send the reader to an install that does
 *   not work.
 * - the one thing about a plugin that does have to follow the language — what
 *   the thing is for — stays in the dictionaries, keyed `<id>Desc`.
 */

/** One card: what to call the plugin, where it lives, how to install it. */
export interface CatalogEntry {
  /** Stable id: the card's `key`, and the stem of its description key
   * (`<id>Desc`) in this feature's dictionaries. */
  id: string
  /** The package name the command installs. */
  name: string
  /** The upstream repository, as the browse URL the name links to. */
  repo: string
  /** The install line, exactly as the plugin's own README writes it. */
  command: string
}

/**
 * The shortlist, in card order. The sidebar workbench first — the base most
 * other dsh pages hang off — then the session manager, and the list's shape is
 * the point of keeping it a list: the next plugin a reader should know about
 * costs one entry here and one line in each dictionary, and nothing in the
 * panel changes.
 */
export const PLUGIN_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'betterSidebar',
    name: 'dsh-better-sidebar',
    repo: 'https://github.com/omdsh-dev/DSH-better-sidebar',
    command: 'dsh plugin --profile web add dsh-better-sidebar@latest',
  },
  {
    id: 'sessionsManager',
    name: 'dsh-sessions-manager',
    repo: 'https://github.com/TOBYCAI/dsh-sessions-manager',
    command: 'dsh plugin --profile web add "github:TOBYCAI/dsh-sessions-manager"',
  },
]
