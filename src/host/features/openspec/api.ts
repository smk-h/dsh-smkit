/**
 * The OpenSpec API: `GET /openspec`, `POST /openspec/delete`,
 * `POST /openspec/init`, `POST /openspec/gitignore`, `POST /openspec/untrack`
 * and `POST /openspec/update`.
 *
 * Six routes, all inside the plugin's API prefix. The read answers with the
 * whole footprint (`OpenSpecView`); the writes are the panel's actions — remove
 * everything, create it, hand it to git's ignore list, take its lines back out
 * of that list, or upgrade the tool — and each answers with what it did.
 * The upgrade is the one that streams: it answers with an event stream of
 * the install's own output rather than a single result, because it is the one
 * action long enough that a silent wait would read as a hang.
 *
 * All six take exactly one input — the workspace directory, as `cwd` in the
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
import { ignoreOpenSpec, runGit, untrackOpenSpec } from './gitignore.js'
import { initOpenSpec, runOpenSpec } from './init.js'
import { inspectOpenSpec } from './inspect.js'
import { removeOpenSpec } from './remove.js'
import { streamOpenSpecUpdate, updateOpenSpec } from './update.js'
import type { OpenSpecHandler } from './types.js'
import type { ResponseLike } from '../../platform/types.js'
import type { OpenSpecUpdateEvent } from '../../../shared/openspec/contract.js'

/** Read the one field every route carries, trimmed, or `''` when unusable. */
function cwdOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Open a response as an event stream.
 *
 * `text/event-stream` is the one content type DSH's webserver never gzips (its
 * compression filter skips it by name), which is what lets each frame reach the
 * browser as it is written rather than in one buffered block at the end — the
 * whole point of streaming an install that can take half a minute.
 */
function startEventStream(res: ResponseLike): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  })
}

/** Write one frame; the closing `done` frame also ends the response. */
function sendEvent(res: ResponseLike, event: OpenSpecUpdateEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
  if (event.type === 'done') res.end()
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

  if (req.method === 'POST' && rest === '/openspec/gitignore') {
    const body = await readBody(req)
    const cwd = cwdOf(body.cwd)
    if (!isAbsolute(cwd)) {
      sendJson(res, 400, { error: OPENSPEC_CWD_ERROR })
      return true
    }
    // Always a 200 that describes itself, like the delete: "not a repo" and
    // "git is not installed" are answers the panel has to say in its own words,
    // not request failures, and a target whose git command refused is reported
    // inside `results` rather than as a status code that hides the rest.
    sendJson(res, 200, await ignoreOpenSpec(cwd, { logger: deps.logger, runGit: deps.runGit ?? runGit }))
    return true
  }

  if (req.method === 'POST' && rest === '/openspec/untrack') {
    const body = await readBody(req)
    const cwd = cwdOf(body.cwd)
    if (!isAbsolute(cwd)) {
      sendJson(res, 400, { error: OPENSPEC_CWD_ERROR })
      return true
    }
    // A 200 that describes itself, like the route above — but this one asks
    // git nothing at all: "a line was not there" and "the file could not be
    // rewritten" are answers the panel phrases, not request failures.
    sendJson(res, 200, await untrackOpenSpec(cwd, { logger: deps.logger, runGit: deps.runGit ?? runGit }))
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

  if (req.method === 'POST' && rest === '/openspec/update') {
    const body = await readBody(req)
    const cwd = cwdOf(body.cwd)
    if (!isAbsolute(cwd)) {
      sendJson(res, 400, { error: OPENSPEC_CWD_ERROR })
      return true
    }
    // The upgrade is the feature's one long-running action, so it answers with
    // the commands' output as it happens rather than a result at the end. The
    // orchestrator spawns each command in turn and keeps writing to `res` from
    // its own callbacks, so this route claims the request and steps out of the
    // way; the closing `done` frame is what ends the response, and the catch is a
    // backstop so a throw can never leave the connection hanging.
    startEventStream(res)
    const send = (event: OpenSpecUpdateEvent): void => sendEvent(res, event)
    void updateOpenSpec(cwd, { logger: deps.logger, run: deps.runUpdate ?? streamOpenSpecUpdate }, send).catch(
      () => {
        try {
          res.end()
        } catch {
          // The stream was already closed by the frame that ended it.
        }
      },
    )
    return true
  }

  return false
}
