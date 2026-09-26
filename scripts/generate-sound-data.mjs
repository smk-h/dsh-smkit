/**
 * Regenerate `src/host/features/notify/sound-data.ts` from the asset beside it.
 *
 * The host half is plain `tsc` output — no bundler rides along to copy an
 * asset into `lib/`, and `package.json` ships `lib/` only, so the notification
 * sound's bytes have to travel inside a source file. This script is that
 * translation, run once per asset swap:
 *
 *     node scripts/generate-sound-data.mjs
 *
 * The source asset (`task-notification-pop.mp3`) is ZCode's own notification
 * sound (packages/ui/src/assets/notification-sounds/task-notification-pop.mp3,
 * Apache-2.0), carried verbatim so dsh's notifications sound exactly like
 * ZCode's. The generated module keeps the provenance in its header, where a
 * license audit will actually look.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const assetPath = resolve(here, '../src/host/features/notify/assets/task-notification-pop.mp3')
const outPath = resolve(here, '../src/host/features/notify/sound-data.ts')

const base64 = readFileSync(assetPath).toString('base64')
// Wrap the literal so no source line runs four figures wide; the decoder
// strips whitespace before parsing, so the wrapping is free.
const wrapped = base64.replace(/.{1,120}/g, '$&\n').trimEnd()

const header = `\
/**
 * The task-notification sound, as data.
 *
 * The bytes of \`assets/task-notification-pop.mp3\` beside this file — ZCode's
 * own notification sound (packages/ui/src/assets/notification-sounds/
 * task-notification-pop.mp3, Apache-2.0, © the ZCode authors), carried
 * verbatim so dsh's notifications sound exactly like ZCode's. It travels as
 * base64 because the host half is plain \`tsc\` output with no asset-copying
 * bundler, and \`package.json\` ships \`lib/\` only; see
 * \`scripts/generate-sound-data.mjs\`, the script that wrote this file and the
 * only supported way to regenerate it after an asset swap.
 *
 * Whitespace is tolerated (and present — the literal is wrapped): the decoder
 * strips everything that is not base64 before parsing.
 */

/** The mp3 bytes, base64. */
export const TASK_NOTIFICATION_SOUND_BASE64 = \`
${wrapped}
\`
`

writeFileSync(outPath, header)
console.log(`sound-data.ts: ${base64.length} base64 chars from ${assetPath}`)
