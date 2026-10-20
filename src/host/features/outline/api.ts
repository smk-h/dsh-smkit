/**
 * `GET /outline?path=<absolute file>` — the only route of the outline feature.
 *
 * Thin transport: it validates the request, refuses anything no profile claims,
 * decodes the bytes, and hands the text to the scanner. Decoding gets one
 * deliberate fallback — see {@link decode}.
 *
 * The route reads a path the browser names, like the explorer's own routes do:
 * there is no session cwd to project on this side, so a workspace-containment
 * check would be a guess dressed as a guard. What it does enforce is a bound on
 * *what* it will read: an absolute path, a suffix some profile reads, a regular
 * file, and a size cap.
 */

import { readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { sendJson } from '../../platform/util/http.js'
import type { ApiHandler } from '../../platform/routes.js'
import type { OutlineRefusal } from '../../../shared/outline/contract.js'
import { profileFor } from './profiles/index.js'
import { scanSource } from './scan.js'

/** Path suffix this feature answers, relative to the API prefix. */
const ROUTE = '/outline'

/** Files larger than this are refused rather than scanned. */
const MAX_BYTES = 4 * 1024 * 1024

/** HTTP status per stable refusal code. */
const REFUSAL_STATUS: Record<OutlineRefusal, number> = {
  'outline/not-absolute': 400,
  'outline/unsupported': 415,
  'outline/missing': 404,
  'outline/not-file': 400,
  'outline/too-large': 413,
  'outline/unreadable': 500,
}

/**
 * Decode source bytes.
 *
 * UTF-8 when it decodes cleanly. Windows editors still save C files in the local
 * ANSI code page, and a GBK comment is not valid UTF-8 — decoding it as such
 * would replace bytes with U+FFFD and, worse, could turn a stray 0x22 or 0x2A
 * inside a multi-byte character into a quote or a comment marker that ends the
 * literal early. GB18030 is a superset of GBK, so the second attempt reads those
 * files as their author meant them; if the runtime has no such decoder, the UTF-8
 * result stands and the scanner still sees every ASCII identifier.
 *
 * @param bytes - the file's bytes.
 * @returns the decoded text.
 */
function decode(bytes: Buffer): string {
  const utf8 = bytes.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gb18030').decode(bytes)
  } catch {
    return utf8
  }
}

/**
 * The feature's handler list, in matching order.
 * @returns the handler the composition root mounts.
 */
export function createOutlineHandlers(): ApiHandler[] {
  return [
    async (req, res, facts) => {
      if (facts.rest !== ROUTE || req.method !== 'GET') return false

      const path = facts.url.searchParams.get('path') ?? ''
      const refuse = (code: OutlineRefusal, error: string): true => {
        sendJson(res, REFUSAL_STATUS[code], { error, code })
        return true
      }

      if (!isAbsolute(path)) {
        return refuse('outline/not-absolute', 'the request must carry an absolute path')
      }

      const match = profileFor(path)
      if (match === undefined) {
        return refuse('outline/unsupported', `no outline is available for ${path}`)
      }

      let size: number
      try {
        const info = await stat(path)
        if (!info.isFile()) return refuse('outline/not-file', `${path} is not a regular file`)
        size = info.size
      } catch (error) {
        const code = (error as { code?: string }).code
        return refuse(
          code === 'ENOENT' ? 'outline/missing' : 'outline/unreadable',
          code === 'ENOENT' ? `${path} does not exist` : `cannot read ${path}`,
        )
      }
      if (size > MAX_BYTES) {
        return refuse('outline/too-large', `${path} is larger than ${MAX_BYTES} bytes`)
      }

      let text: string
      try {
        text = decode(await readFile(path))
      } catch {
        return refuse('outline/unreadable', `cannot read ${path}`)
      }

      sendJson(res, 200, {
        symbols: scanSource(text, match.profile, {
          prototypes: match.profile.prototypes?.(match.suffix) === true,
        }),
      })
      return true
    },
  ]
}
