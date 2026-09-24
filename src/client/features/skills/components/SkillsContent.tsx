/**
 * The Skills panel of the merged settings section.
 *
 * One page over one scope at a time. The picker above the list names that scope,
 * and there are two kinds of them, which now read the same way:
 *
 * - **the user side**, one entry for both homes — `~/.dsh/skills` and
 *   `~/.agents/skills` arrive in one answer and show as two tabs;
 * - **a project**, one entry per registered workspace, named the way the session
 *   list names it — its `.dsh/skills` and `.agents/skills` arrive in one answer
 *   and show as two tabs too.
 *
 * Either way a view is one directory deep: the strip names the directory, the
 * path line under it gives its absolute location, and the rows below are that
 * directory's alone. The host reads the roots of the selected scope together in
 * rank order — one request per poll — and each row still carries the root key
 * its writes are addressed by.
 *
 * Inside a view: a search box, one row per skill, and exactly two actions,
 * enable/disable and remove. Like the MCP section the page re-polls every three
 * seconds, since skills are files: something added, edited, enabled or deleted
 * outside the page (or by hand in a shell) shows up without a reload. The
 * toolbar's refresh button is the same read on demand, for the times a user does
 * not want to wait out the tick. Either way the scan the host runs is what makes
 * the page agree with the disk rather than with a provider's cache.
 *
 * Scope is part of the request rather than a client-side sift, and it is a
 * per-scope query map, so each scope keeps its own text. A removal is optimistic
 * in one direction only: the row leaves the list the moment the host confirms
 * the delete, and stays hidden while a poll may still carry it — see `removed`.
 */

import { createXIcon } from '../../../platform/icons/XIcon'
import { createSearchIcon } from '../../../platform/icons/SearchIcon'
import { createRefreshButton } from '../../../platform/ui/RefreshButton'
import { createTabs } from '../../../platform/ui/Tabs'
import { createScopeSelect } from '../ui/ScopeSelect'
import { createSkillRow } from './SkillRow'
import { watchTipBoundaries } from '../../../platform/ui/tip'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { ScopeOption } from '../ui/ScopeSelect'
import type { SectionProps, SkillView, SkillsView, SkillWorkspacesView } from '../types'

const REFRESH_INTERVAL_MS = 3000

/**
 * The pseudo-source the user side's merged view is answered with — and the
 * picker value it is selected by: `user` with no workspace part. It is also
 * the default read: an empty query asks for this view, so a page that opens
 * before it knows the menu still lands on the tabs in one round trip.
 */
const USER_SCOPE = 'user'

/**
 * The pseudo-source a project view is asked for by: `project|<workspace>`. A
 * project is one entry in the picker, so it is one request too — the host
 * resolves its roots and answers for them all. Mirrors `PROJECT_SCOPE`
 * host-side, which is what an answer for it carries back.
 */
const PROJECT_SCOPE = 'project'

/** The catalog before the first answer: nothing known, nothing reported. */
const EMPTY_CATALOG: SkillsView = {
  source: '',
  root: '',
  roots: [],
  absentRoots: [],
  skills: [],
  skipped: 0,
  complete: true,
}

/**
 * Split a picker value back into the pair a row's writes are addressed by. The
 * separator is a character no root key contains, and the second half is a
 * workspace path for a project (empty for a user root).
 */
function parseScope(value: string): { source: string; cwd: string } {
  const at = value.indexOf('|')
  if (at === -1) return { source: value, cwd: '' }
  return { source: value.slice(0, at), cwd: value.slice(at + 1) }
}

/**
 * Which of a view's directories one skill was read from.
 *
 * Decided by containment rather than by mapping its source back to a path: a
 * merged view reads two directories, and the header file the row carries is
 * inside exactly one of them — so the answer cannot disagree with the row it is
 * shown next to. Windows paths are compared with both separators folded, because
 * the host hands out native ones.
 */
function rootOfPath(roots: string[], path: string, fallback: string): string {
  const target = path.replaceAll('\\', '/')
  return (
    roots.find((root) => target.startsWith(`${root.replaceAll('\\', '/').replace(/\/+$/, '')}/`)) ??
    roots[0] ??
    fallback
  )
}

/**
 * The short name a directory wears on a tab when no host label is known for it:
 * the directory that holds the skills (`.dsh`, `.agents`), read from the path
 * the answer echoed back.
 */
function rootLabel(root: string): string {
  const parts = root.replaceAll('\\', '/').split('/').filter((part) => part !== '')
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[parts.length - 1] ?? root)
}

/**
 * The short name one of a view's directories wears on its tab. A project's
 * directories take the name of the directory that holds the skills (`.dsh`,
 * `.agents`); a user's take the home the way a user types it (`~/.dsh`,
 * `~/.agents`), which is what the host's own label for that root says minus its
 * `/skills` tail. Both are the provider's own directory names, not copy.
 */
function tabLabel(root: string, scopes: SkillWorkspacesView | null): string {
  const known = scopes?.userRoots.find((candidate) => candidate.path === root)
  if (known !== undefined) return known.label.replace(/\/skills$/i, '')
  return rootLabel(root)
}

/**
 * The query string one view is read with. The user side *is* the default view:
 * an empty query asks for it, which is also what the first poll needs before
 * the menu is known.
 */
function scopeQuery(value: string): string {
  if (value === '') return ''
  const { source, cwd } = parseScope(value)
  if (source === USER_SCOPE) return ''
  if (source === PROJECT_SCOPE) return `?project=${encodeURIComponent(cwd)}`
  const parts = [`source=${encodeURIComponent(source)}`]
  if (cwd !== '') parts.push(`cwd=${encodeURIComponent(cwd)}`)
  return `?${parts.join('&')}`
}

/**
 * The picker's options, built from the host's answer: one entry for the user
 * side, then one per project. Labels and paths both come from the host — only it
 * knows where the homes are, and a workspace's name is the title DSH stored for
 * it, not the folder it happens to live in.
 */
function buildOptions(scopes: SkillWorkspacesView | null, t: Translator): ScopeOption[] {
  if (scopes === null) return []
  const options: ScopeOption[] = []
  if (scopes.userRoots.length > 0) {
    // The entry reads as the scope's own name, plain and short — the tabs
    // inside carry the directory marks, and the hover bubble keeps both
    // absolute paths.
    options.push({
      value: `${USER_SCOPE}|`,
      source: USER_SCOPE,
      label: t('scopeUser'),
      title: scopes.userRoots.map((root) => root.path).join(' · '),
      group: '',
      scope: 'global',
    })
  }
  for (const workspace of scopes.workspaces) {
    options.push({
      value: `${PROJECT_SCOPE}|${workspace.path}`,
      source: PROJECT_SCOPE,
      label: workspace.title,
      title: workspace.path,
      group: t('scopeProject'),
      scope: 'project',
    })
  }
  return options
}

/**
 * The key one removal is remembered under. It carries the group path and the
 * root key as well as the name, because two directories of one view may each
 * hold a skill of the same name — and hiding one must not hide the other.
 */
function removalKey(scope: string, skill: SkillView): string {
  return `${scope}\u0000${skill.source}\u0000${skill.rel}\u0000${skill.name}`
}

export function createSkillsContent(deps: ClientDeps): (props: SectionProps) => JSX.Element {
  const { h, react, api } = deps
  const SkillRow = createSkillRow(deps)
  const ScopeSelect = createScopeSelect(deps)
  const Tabs = createTabs(deps)
  const SearchIcon = createSearchIcon(deps)
  const XIcon = createXIcon(deps)
  // The platform layer's own refresh control: same glyph, bubble and pending
  // turn as any page that later reads something re-readable.
  const RefreshButton = createRefreshButton(deps)

  return function SkillsContent({ t }: SectionProps): JSX.Element {
    const [catalog, setCatalog] = react.useState<SkillsView>(EMPTY_CATALOG)
    const [scopes, setScopes] = react.useState<SkillWorkspacesView | null>(null)
    // The picker's value: `source|cwd`, the same pair every request carries.
    const [selected, setSelected] = react.useState('')
    // One query per directory: the text belongs to the view it was typed in.
    const [queries, setQueries] = react.useState<Record<string, string>>({})
    // The active project tab, named by the root path it stands for. A value the
    // current answer does not list — another project's, or a directory that
    // vanished — falls back to the first, which is also where a fresh project
    // lands.
    const [activeRoot, setActiveRoot] = react.useState('')
    // Removals this page has already performed, keyed by view and skill. The
    // host's answer can still carry the row for a moment (another poll may run
    // against a scan taken before the delete), so these keys hide it until an
    // answer no longer reports it.
    const [removed, setRemoved] = react.useState<string[]>([])
    // Whether a read the user asked for by hand is still in flight; the timer's
    // own polls never set it, so the button only turns for a click.
    const [refreshing, setRefreshing] = react.useState(false)

    // The view is an argument, not a closure over state: the poll below restarts
    // on every selection change (which is also what refetches immediately), so
    // the callback itself can stay identity-stable. It answers with the read it
    // started, which is what the manual refresh below waits on.
    const refresh = react.useCallback((value: string) => {
      // An empty value is the default view: the host answers with the first user
      // root and names it, which is how a page that opens before it knows the
      // menu still gets a list in the same round trip.
      return Promise.all([api(`/skills${scopeQuery(value)}`), api('/skills/workspaces')])
        .then(([catalogResult, scopesResult]) => {
          const answered =
            catalogResult.ok && typeof catalogResult.body.source === 'string'
              ? catalogResult.body.source
              : ''
          if (catalogResult.ok) {
            const body = catalogResult.body
            setCatalog({
              source: answered,
              root: typeof body.root === 'string' ? body.root : '',
              roots: Array.isArray(body.roots)
                ? (body.roots as unknown[]).filter((path): path is string => typeof path === 'string')
                : [],
              absentRoots: Array.isArray(body.absentRoots)
                ? (body.absentRoots as unknown[]).filter(
                    (path): path is string => typeof path === 'string',
                  )
                : [],
              skills: Array.isArray(body.skills) ? (body.skills as SkillView[]) : [],
              skipped: typeof body.skipped === 'number' ? body.skipped : 0,
              complete: body.complete !== false,
            })
          }
          if (scopesResult.ok) {
            const body = scopesResult.body
            const menu: SkillWorkspacesView = {
              userRoots: Array.isArray(body.userRoots) ? (body.userRoots as SkillWorkspacesView['userRoots']) : [],
              workspaces: Array.isArray(body.workspaces)
                ? (body.workspaces as SkillWorkspacesView['workspaces'])
                : [],
            }
            setScopes(menu)
            // The default poll is answered with the merged user view, so the
            // picker lands on the user entry — which is also what the list
            // already is. Only when the poll asked for the default view,
            // though: a value here means the user has chosen a directory, and
            // their choice outranks the answer's.
            if (value === '' && menu.userRoots.length > 0) {
              setSelected(`${USER_SCOPE}|`)
            }
          }
        })
        .catch(() => {
          // Transient: the next poll resyncs.
        })
    }, [])

    react.useEffect(() => {
      refresh(selected)
      const timer = setInterval(() => refresh(selected), REFRESH_INTERVAL_MS)
      return () => clearInterval(timer)
    }, [refresh, selected])

    // The manual read: the same call the poll makes, on demand. The turn lasts
    // exactly as long as that read, and `refresh` settles even when the request
    // fails, so the pending state cannot stick. The timer is deliberately left
    // running rather than restarted, so the wait after a click is never longer
    // than the period.
    const manualRefresh = react.useCallback(() => {
      setRefreshing(true)
      refresh(selected).finally(() => setRefreshing(false))
    }, [refresh, selected])

    const options = buildOptions(scopes, t)

    // Fall back to the first directory if the selected one disappeared from the
    // registry (a workspace removed elsewhere).
    react.useEffect(() => {
      if (options.length === 0) return
      if (selected !== '' && options.some((option) => option.value === selected)) return
      setSelected(options[0].value)
    }, [options, selected])

    // The picker's bubble slides clear of clip edges; one document-level watch
    // serves every `.smkit-ui-tip` on the page (see `platform/ui/tip`).
    react.useEffect(() => watchTipBoundaries(), [])

    // A hidden removal stays hidden only while the host still reports that
    // skill: once an answer no longer mentions it, the row is gone by itself and
    // the key has done its job.
    react.useEffect(() => {
      if (removed.length === 0) return
      const present = new Set(catalog.skills.map((skill) => removalKey(selected, skill)))
      const next = removed.filter((key) => present.has(key))
      if (next.length !== removed.length) setRemoved(next)
    }, [catalog, selected, removed])

    const current = parseScope(selected)
    const query = queries[selected] ?? ''
    const setQuery = (next: string): void => {
      setQueries({ ...queries, [selected]: next })
    }
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const searching = normalizedQuery !== ''
    const hidden = new Set(removed)
    const listed = catalog.skills.filter((skill) => !hidden.has(removalKey(selected, skill)))
    // Both sides of the picker read as two tabs — always both, even when one
    // directory does not exist yet: the layout is the harness's, and a missing
    // half shows its tab with a "not installed" empty state instead of hiding.
    const tabbed = current.source === USER_SCOPE || current.source === PROJECT_SCOPE
    const shownRoot = tabbed
      ? catalog.roots.includes(activeRoot)
        ? activeRoot
        : catalog.roots[0]
      : ''
    // The tab's side of the answer, narrowed by the same containment test the
    // row's own root is decided by — so the strip, the path line and the rows
    // can never disagree about what is on the page.
    const inView = (skill: SkillView): boolean =>
      shownRoot === '' || rootOfPath(catalog.roots, skill.path, catalog.root) === shownRoot
    const view = listed.filter(inView)
    // A trimmed, case-insensitive substring test across the fields a skill is
    // found by — its name, its description, the hint its author wrote for when
    // to reach for it, and the group it sits in.
    const matchesQuery = (skill: SkillView): boolean =>
      !searching ||
      [skill.name, skill.description, skill.whenToUse ?? '', skill.rel].some((field) =>
        field.toLocaleLowerCase().includes(normalizedQuery),
      )
    const rows = view.filter(matchesQuery)
    // A project whose roots do not exist yet has nothing to name but the project
    // itself, so it says where a skill would go instead of listing a directory
    // that is not there.
    // The active tab's directory may not exist yet — a home or a project side
    // that has never had a skill installed. Its tab stays up either way; the
    // empty state is what tells the two cases apart.
    const activeAbsent = shownRoot !== '' && catalog.absentRoots.includes(shownRoot)
    const emptyLabel = searching
      ? t('searchEmpty')
      : activeAbsent
        ? t('emptyAbsent', { path: shownRoot })
        : t('emptyRoot', { path: shownRoot !== '' ? shownRoot : catalog.roots.join(' · ') })

    return (
      <div className="smkit-skill-page-section">
        {/* The heading over the toolbar: the page's own title and the count of
            rows below. The identity block (intro line, plugin pill) is the
            merged settings section's, not this panel's. */}
        <div className="smkit-skill-page-catalog-heading">
          <h3>{t('sectionLabel')}</h3>
          <span>{t('count', { count: view.length })}</span>
        </div>
        <div className="smkit-skill-page-toolbar">
          {options.length > 0 ? (
            <ScopeSelect t={t} value={selected} options={options} onChange={setSelected} />
          ) : null}
          <span className="smkit-skill-page-toolbar-spacer" aria-hidden="true" />
          {/* The search box and the refresh button travel as one cluster — the
              shape the MCP toolbar's search and add button already have — so a
              narrow row moves both to the next line instead of leaving a lone
              28px button behind. */}
          <div className="smkit-skill-page-toolbar-actions">
            <label className="smkit-skill-page-search">
              <SearchIcon size={14} />
              <input
                type="search"
                value={query}
                placeholder={t('search')}
                aria-label={t('search')}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query ? (
                <button
                  className="smkit-skill-page-search-clear"
                  type="button"
                  aria-label={t('clearSearch')}
                  title={t('clearSearch')}
                  onClick={() => setQuery('')}
                >
                  <XIcon size={12} />
                </button>
              ) : null}
            </label>
            <RefreshButton busy={refreshing} onClick={manualRefresh} />
          </div>
        </div>
        {tabbed ? (
          <Tabs
            ariaLabel={t('rootTabs')}
            active={shownRoot}
            onChange={setActiveRoot}
            tabs={catalog.roots.map((root) => ({ id: root, label: tabLabel(root, scopes) }))}
          />
        ) : null}
        {/* The directory the rows below were read from — the active tab's,
            whether or not it exists yet; the empty state below is what says
            when it doesn't. */}
        {catalog.roots.length > 0 ? (
          <div className="smkit-skill-page-path-hint">{shownRoot !== '' ? shownRoot : catalog.roots.join(' · ')}</div>
        ) : null}
        {catalog.complete ? null : <div className="smkit-skill-page-meta">{t('incomplete')}</div>}
        {catalog.skipped > 0 ? (
          <div className="smkit-skill-page-meta">{t('skipped', { count: catalog.skipped })}</div>
        ) : null}
        {rows.length > 0 ? (
          <div className="smkit-skill-row-list">
            {rows.map((skill) => (
              <SkillRow
                t={t}
                skill={skill}
                source={skill.source}
                cwd={current.cwd}
                root={rootOfPath(catalog.roots, skill.path, catalog.root)}
                onRemoved={(skill) => setRemoved([...removed, removalKey(selected, skill)])}
                onChanged={() => refresh(selected)}
                key={`${skill.rel}/${skill.name}`}
              />
            ))}
          </div>
        ) : null}
        {rows.length === 0 && catalog.root !== '' ? (
          <div className="smkit-skill-page-meta">{emptyLabel}</div>
        ) : null}
      </div>
    )
  }
}
