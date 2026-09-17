/**
 * The Settings → Skills section.
 *
 * One page over one scope at a time. The picker above the list names that scope,
 * and there are two kinds of them:
 *
 * - **a user root**, one per home — `~/.dsh/skills` and `~/.agents/skills` are
 *   separate entries, never merged into one "global";
 * - **a project**, one entry per registered workspace, named the way the session
 *   list names it. Its two skill directories (`.dsh/skills`, `.agents/skills`) are
 *   read together, because a user thinks in projects, and each row still says
 *   which of the two it came from.
 *
 * Inside a view: a search box, one row per skill, and exactly two actions,
 * enable/disable and remove. Like the MCP section the page re-polls every three
 * seconds, because skills are files: something added, edited, enabled or deleted
 * outside the page (or by hand in a shell) shows up without a reload. The scan
 * the host runs is what makes the page agree with the disk rather than with a
 * provider's cache.
 *
 * Scope is part of the request rather than a client-side sift, and it is a
 * per-scope query map, so each scope keeps its own text. A removal is optimistic
 * in one direction only: the row leaves the list the moment the host confirms
 * the delete, and stays hidden while a poll may still carry it — see `removed`.
 */

import { createClearIcon } from '../../../platform/icons/ClearIcon'
import { createSearchIcon } from '../../../platform/icons/SearchIcon'
import { createScopeSelect } from '../ui/ScopeSelect'
import { createSkillRow } from './SkillRow'
import { watchTipBoundaries } from '../../../platform/ui/tip'
import type { ClientDeps, Translator } from '../../../platform/types'
import type { ScopeOption } from '../ui/ScopeSelect'
import type { SectionProps, SkillView, SkillsView, SkillWorkspacesView } from '../types'

const REFRESH_INTERVAL_MS = 3000

/**
 * The pseudo-source a project view is asked for by: `project|<workspace>`. A
 * project is one entry in the picker, so it is one request too — the host
 * resolves its roots and merges them. Mirrors `PROJECT_SCOPE` host-side, which
 * is what an answer for it carries back.
 */
const PROJECT_SCOPE = 'project'

/** The catalog before the first answer: nothing known, nothing reported. */
const EMPTY_CATALOG: SkillsView = {
  source: '',
  root: '',
  roots: [],
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
 * project view reads two directories, and the header file the row carries is
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
 * The query string one view is read with. An empty value carries no query at
 * all: the host then answers with its default view, which is what the first poll
 * needs before the menu is known.
 */
function scopeQuery(value: string): string {
  if (value === '') return ''
  const { source, cwd } = parseScope(value)
  if (source === PROJECT_SCOPE) return `?project=${encodeURIComponent(cwd)}`
  const parts = [`source=${encodeURIComponent(source)}`]
  if (cwd !== '') parts.push(`cwd=${encodeURIComponent(cwd)}`)
  return `?${parts.join('&')}`
}

/**
 * The picker's options, built from the host's answer: the user roots first, then
 * one entry per project. Labels and paths both come from the host — only it
 * knows where the homes are, and a workspace's name is the title DSH stored for
 * it, not the folder it happens to live in.
 */
function buildOptions(scopes: SkillWorkspacesView | null, t: Translator): ScopeOption[] {
  if (scopes === null) return []
  const options: ScopeOption[] = []
  for (const root of scopes.userRoots) {
    options.push({
      value: `${root.source}|`,
      source: root.source,
      label: root.label,
      title: root.path,
      group: t('scopeUser'),
      scope: root.scope,
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
 * The key one removal is remembered under. It carries the group path as well as
 * the name, because two groups may each hold a skill of the same name.
 */
function removalKey(scope: string, skill: SkillView): string {
  return `${scope}\u0000${skill.rel}\u0000${skill.name}`
}

export function createSkillsContent(deps: ClientDeps): (props: SectionProps) => JSX.Element {
  const { h, react, api } = deps
  const SkillRow = createSkillRow(deps)
  const ScopeSelect = createScopeSelect(deps)
  const SearchIcon = createSearchIcon(deps)
  const ClearIcon = createClearIcon(deps)

  return function SkillsContent({ t }: SectionProps): JSX.Element {
    const [catalog, setCatalog] = react.useState<SkillsView>(EMPTY_CATALOG)
    const [scopes, setScopes] = react.useState<SkillWorkspacesView | null>(null)
    // The picker's value: `source|cwd`, the same pair every request carries.
    const [selected, setSelected] = react.useState('')
    // One query per directory: the text belongs to the view it was typed in.
    const [queries, setQueries] = react.useState<Record<string, string>>({})
    // Removals this page has already performed, keyed by view and skill. The
    // host's answer can still carry the row for a moment (another poll may run
    // against a scan taken before the delete), so these keys hide it until an
    // answer no longer reports it.
    const [removed, setRemoved] = react.useState<string[]>([])

    // The view is an argument, not a closure over state: the poll below restarts
    // on every selection change (which is also what refetches immediately), so
    // the callback itself can stay identity-stable.
    const refresh = react.useCallback((value: string) => {
      // An empty value is the default view: the host answers with the first user
      // root and names it, which is how a page that opens before it knows the
      // menu still gets a list in the same round trip.
      Promise.all([api(`/skills${scopeQuery(value)}`), api('/skills/workspaces')])
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
            // The answer named its own root, so the picker shows what the list
            // already is. Only when the poll asked for the default view, though:
            // a value here means the user has chosen a directory, and their
            // choice outranks the answer's.
            if (value === '') {
              const first = menu.userRoots[0]
              const chosen = menu.userRoots.some((root) => root.source === answered)
                ? answered
                : (first?.source ?? '')
              if (chosen !== '') setSelected(`${chosen}|`)
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

    const options = buildOptions(scopes, t)

    // Fall back to the first directory if the selected one disappeared from the
    // registry (a workspace removed elsewhere).
    react.useEffect(() => {
      if (options.length === 0) return
      if (selected !== '' && options.some((option) => option.value === selected)) return
      setSelected(options[0].value)
    }, [options, selected])

    // The picker's bubble slides clear of clip edges; one document-level watch
    // serves every `.mm_tip` on the page (see `platform/ui/tip`).
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
    // A trimmed, case-insensitive substring test across the fields a skill is
    // found by — its name, its description, the hint its author wrote for when
    // to reach for it, and the group it sits in.
    const matchesQuery = (skill: SkillView): boolean =>
      !searching ||
      [skill.name, skill.description, skill.whenToUse ?? '', skill.rel].some((field) =>
        field.toLocaleLowerCase().includes(normalizedQuery),
      )
    const rows = listed.filter(matchesQuery)
    // A project whose roots do not exist yet has nothing to name but the project
    // itself, so it says where a skill would go instead of listing a directory
    // that is not there.
    const emptyLabel = searching
      ? t('searchEmpty')
      : catalog.roots.length === 0
        ? t('emptyProjectRoots', { path: catalog.root })
        : t('emptyRoot', { path: catalog.roots.join(' · ') })

    return (
      <div className="sk_section">
        <div className="sk_catalogHeading">
          <h3>{t('sectionLabel')}</h3>
          <span>{t('count', { count: listed.length })}</span>
        </div>
        <p className="sk_intro">{t('sectionIntro')}</p>
        <div className="sk_toolbar">
          {options.length > 0 ? (
            <ScopeSelect t={t} value={selected} options={options} onChange={setSelected} />
          ) : null}
          <span className="sk_toolbarSpacer" aria-hidden="true" />
          <label className="sk_search">
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
                className="sk_searchClear"
                type="button"
                aria-label={t('clearSearch')}
                title={t('clearSearch')}
                onClick={() => setQuery('')}
              >
                <ClearIcon size={12} />
              </button>
            ) : null}
          </label>
        </div>
        {/* The directories actually read: one for a user root, and a project's as
            many as exist — so what the page is showing can always be checked
            against the disk without opening a row. */}
        {catalog.roots.length > 0 ? (
          <div className="sk_pathHint">{catalog.roots.join(' · ')}</div>
        ) : null}
        {catalog.complete ? null : <div className="sk_meta">{t('incomplete')}</div>}
        {catalog.skipped > 0 ? (
          <div className="sk_meta">{t('skipped', { count: catalog.skipped })}</div>
        ) : null}
        {rows.length > 0 ? (
          <div className="sk_list">
            {rows.map((skill) => (
              <SkillRow
                t={t}
                skill={skill}
                source={skill.source}
                cwd={current.cwd}
                root={rootOfPath(catalog.roots, skill.path, catalog.root)}
                merged={catalog.roots.length > 1}
                onRemoved={(skill) => setRemoved([...removed, removalKey(selected, skill)])}
                onChanged={() => refresh(selected)}
                key={`${skill.rel}/${skill.name}`}
              />
            ))}
          </div>
        ) : null}
        {rows.length === 0 && catalog.root !== '' ? (
          <div className="sk_meta">{emptyLabel}</div>
        ) : null}
      </div>
    )
  }
}
