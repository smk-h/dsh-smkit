/**
 * The OpenSpec API: `GET /openspec`, `POST /openspec/delete` and
 * `POST /openspec/init`.
 *
 * Three routes, all inside the plugin's API prefix. The read answers with the
 * whole footprint (`OpenSpecView`); the two writes are the panel's two
 * actions — remove everything, or create it — and each answers with what it
 * did.
 *
 * All three take exactly one input — the workspace directory, as `cwd` in the
 * query or in the body — and derive everything else themselves. That is the
 * point of the split: the browser half renders paths it was handed and can
 * never name one, so a stale panel, a hand-typed URL or a replayed request all
 * end at the same resolution the inspection made. `cwd` is required to be
 * absolute, which is the only thing worth validating here: whether it exists,
 * whether a `.git` sits above it and what is inside are questions the
 * filesystem answers — and where the initialise runs is the same project root
 * the read resolved.
 */

import { isAbsolute } from 'node:path'
import { readBody, sendJson } from '../../platform/util/http.js'
import { OPENSPEC_CWD_ERROR } from './constants.js'
import { initOpenSpec, runOpenSpec } from './init.js'
import { inspectOpenSpec } from './inspect.js'
import { removeOpenSpec } from './remove.js'
import type { OpenSpecHandler } from './types.js'

/** Read the one field either route carries, trimmed, or `''` when unusable. */
function cwdOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const handleOpenSpec: OpenSpecHandler = async (req, res, facts, deps) => {
  const { rest } = facts

  if (req.method === 'GET' && rest === '/openspec') {
    const cwd = cwdOf(facts.url.searchParams.get('cwd'))
    if (!isAbsolute(cwd)) {
      sendJson(res, 400, { error: OPENSPEC_CWD_ERROR })
      return true
    }
    sendJson(res, 200, await inspectOpenSpec(cwd))
    return true
  }

  if (req.method === 'POST' && rest === '/openspec/delete') {
    const body = await readBody(req)
    const cwd = cwdOf(body.cwd)
    if (!isAbsolute(cwd)) {
      sendJson(res, 400, { error: OPENSPEC_CWD_ERROR })
      return true
    }
    // A target that could not be removed is reported inside a 200: the request
    // itself was understood and acted on, and the caller needs the list of what
    // survived rather than a status code that says only "not all of it".
    sendJson(res, 200, await removeOpenSpec(cwd, deps.logger))
    return true
  }

  if (req.method === 'POST' && rest === '/openspec/init') {
    const body = await readBody(req)
    const cwd = cwdOf(body.cwd)
    if (!isAbsolute(cwd)) {
      sendJson(res, 400, { error: OPENSPEC_CWD_ERROR })
      return true
    }
    // The runner is a dependency so a test can assert the command line without
    // spawning one; a composition that passes none gets the real `execFile`.
    const outcome = await initOpenSpec(cwd, { logger: deps.logger, run: deps.run ?? runOpenSpec })
    sendJson(res, outcome.status, outcome.body)
    return true
  }

  return false
}
