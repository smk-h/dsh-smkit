/**
 * The skills API: `GET /skills`, `GET /skills/workspaces`,
 * `POST /skills/enabled` and `DELETE /skills/<name>`.
 *
 * Four routes, all inside the plugin's API prefix. A view is one *root*, named
 * by the `source` query parameter (`user-dsh`, `project-agents`, …) and, for a
 * project root, the `cwd` it belongs to — so the two user roots are read
 * separately, and nothing is merged behind the page's back.
 *
 * Every route resolves its root through `roots.rootOf`, which only knows the
 * four roots this plugin manages. That is what makes the source parameter safe
 * by construction: an unknown source has no root, so it is refused before any
 * code runs, and the one route that writes (`DELETE`) additionally re-derives
 * and checks its target inside that root (`catalog.planRemoval`).
 */

import { isAbsolute } from 'node:path'
import { readBody, sendJson } from '../../platform/util/http.js'
import { listProject, listRoot, removeSkill, setSkillEnabled } from './catalog.js'
import {
  SKILL_CWD_ERROR,
  SKILL_ENABLED_ERROR,
  SKILL_NAME_ERROR,
  SKILL_NAME_RE,
  SKILL_SOURCE_ERROR,
  USER_SOURCES,
} from './constants.js'
import { rootOf } from './roots.js'
import { listSkillScopes } from './workspaces.js'
import type { RequestFacts } from '../../platform/routes.js'
import type { SkillsHandler } from './types.js'

/** The view a read falls back to when it names no root: the harness home's. */
const DEFAULT_SOURCE = USER_SOURCES[0]

/** One request's scope: the root it addresses, and the project that root means. */
interface Scope {
  source: string
  cwd: string
  root: string
}

/**
 * Resolve the `source` (and, for a project root, the absolute `cwd`) a request
 * addresses.
 *
 * Reading is allowed to name no source at all, which means the default view —
 * the first user root. A settings page opens before it knows which roots exist
 * (that is what it is fetching), so a default read saves it a round trip, and
 * the answer names the root it chose so the page can select it. Writing is not:
 * both write routes require a source, so nothing can be deleted or switched by
 * accident.
 *
 * @returns the scope, or the error text to answer with.
 */
function scopeOf(facts: RequestFacts, fallback: boolean): Scope | string {
  const source = (facts.url.searchParams.get('source') ?? '').trim() || (fallback ? DEFAULT_SOURCE : '')
  const cwd = (facts.url.searchParams.get('cwd') ?? '').trim()
  if (source === '') return SKILL_SOURCE_ERROR
  const project = source.startsWith('project-')
  if (project && !isAbsolute(cwd)) return SKILL_CWD_ERROR
  const root = rootOf(source, project ? cwd : '')
  if (root === null) return SKILL_SOURCE_ERROR
  return { source, cwd: project ? cwd : '', root }
}

export const handleSkills: SkillsHandler = async (req, res, facts, deps) => {
  const { rest } = facts

  if (req.method === 'GET' && rest === '/skills/workspaces') {
    sendJson(res, 200, await listSkillScopes(deps.services))
    return true
  }

  if (req.method === 'GET' && rest === '/skills') {
    // A project is asked for as a project, not as two roots: the host resolves
    // and merges them, so the page makes one request and shows one list.
    const project = (facts.url.searchParams.get('project') ?? '').trim()
    if (project !== '') {
      if (!isAbsolute(project)) {
        sendJson(res, 400, { error: SKILL_CWD_ERROR })
        return true
      }
      sendJson(res, 200, await listProject(project, deps.logger))
      return true
    }
    const scope = scopeOf(facts, true)
    if (typeof scope === 'string') {
      sendJson(res, 400, { error: scope })
      return true
    }
    sendJson(res, 200, await listRoot(scope.root, scope.source, deps.logger))
    return true
  }

  // Enabling and disabling is a POST with a body: it names the skill the same
  // way the delete does, plus the state to move to.
  if (req.method === 'POST' && rest === '/skills/enabled') {
    const body = await readBody(req)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const rel = typeof body.rel === 'string' ? body.rel.trim() : ''
    if (!SKILL_NAME_RE.test(name)) {
      sendJson(res, 400, { error: SKILL_NAME_ERROR })
      return true
    }
    if (typeof body.enabled !== 'boolean') {
      sendJson(res, 400, { error: SKILL_ENABLED_ERROR })
      return true
    }
    const scope = scopeFrom(body.source, body.cwd)
    if (typeof scope === 'string') {
      sendJson(res, 400, { error: scope })
      return true
    }
    const outcome = await setSkillEnabled(
      { name, source: scope.source, cwd: scope.cwd, rel },
      body.enabled,
      deps.logger,
    )
    sendJson(res, outcome.status, outcome.body)
    return true
  }

  if (req.method === 'DELETE' && rest.startsWith('/skills/')) {
    const name = rest.slice('/skills/'.length)
    if (!SKILL_NAME_RE.test(name)) {
      sendJson(res, 400, { error: SKILL_NAME_ERROR })
      return true
    }
    const scope = scopeOf(facts, false)
    if (typeof scope === 'string') {
      sendJson(res, 400, { error: scope })
      return true
    }
    const rel = (facts.url.searchParams.get('rel') ?? '').trim()
    const outcome = await removeSkill(
      { name, source: scope.source, cwd: scope.cwd, rel },
      deps.logger,
    )
    sendJson(res, outcome.status, outcome.body)
    return true
  }

  return false
}

/** The same resolution as `scopeOf`, for a body that carries its scope as fields. */
function scopeFrom(source: unknown, cwd: unknown): Scope | string {
  const key = typeof source === 'string' ? source.trim() : ''
  const project = key.startsWith('project-')
  const path = typeof cwd === 'string' ? cwd.trim() : ''
  if (key === '') return SKILL_SOURCE_ERROR
  if (project && !isAbsolute(path)) return SKILL_CWD_ERROR
  const root = rootOf(key, project ? path : '')
  if (root === null) return SKILL_SOURCE_ERROR
  return { source: key, cwd: project ? path : '', root }
}
