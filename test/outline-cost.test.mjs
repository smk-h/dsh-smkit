/**
 * The outline's cost, host side: how long the scanner itself takes, and what it
 * returns, for files of the sizes the route accepts.
 *
 * This is the half the browser measurement (`docs/LV510-代码大纲.md`) cannot
 * separate: the measured click-to-panel time is read + decode + scan + JSON +
 * render, and only this file says which share is the scan. The content is
 * generated here rather than read from disk, so the numbers do not depend on
 * whatever happens to be in the workspace.
 *
 * The budgets are deliberately loose — they exist to catch a scanner that went
 * quadratic (or lost a loop guard), not to pin a machine's speed. The printed
 * medians are the real output; `t.diagnostic` keeps them in the test report.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { scanSource } = await import('../lib/host/features/outline/scan.js')
const { profileFor } = await import('../lib/host/features/outline/profiles/index.js')

/** One block: a struct and a function, so the scanner should see two symbols. */
function block(index) {
  return [
    `/* block ${index}: a comment line, so the scanner has trivia to skip */`,
    `struct item_${index} {`,
    `    int field_${index};`,
    `    const char *name_${index};`,
    `};`,
    '',
    `int handle_${index}(struct item_${index} *item, int flags)`,
    `{`,
    `    if (item == 0) {`,
    `        return -${index};`,
    `    }`,
    `    return item->field_${index} + flags;`,
    `}`,
    '',
  ].join('\n')
}

/** A C file with `count` blocks, and its size in bytes. */
function source(count) {
  let text = `/* generated: ${count} blocks */\n\n`
  for (let index = 1; index <= count; index += 1) text += block(index) + '\n'
  return { text, bytes: Buffer.byteLength(text) }
}

const C = profileFor('sample.c')
assert.ok(C !== undefined, 'the C profile must claim .c')
const PROFILE = C.profile

/** Median of `runs` scans of one text, in milliseconds. */
function medianScan(text, runs = 7) {
  const timings = []
  for (let run = 0; run < runs; run += 1) {
    const started = process.hrtime.bigint()
    scanSource(text, PROFILE, {})
    timings.push(Number(process.hrtime.bigint() - started) / 1e6)
  }
  timings.sort((a, b) => a - b)
  return timings[Math.floor(timings.length / 2)]
}

test('the scanner finds two symbols per block at every size', (t) => {
  for (const count of [100, 500, 2000, 5000, 9000]) {
    const { text } = source(count)
    const symbols = scanSource(text, PROFILE, {})
    assert.equal(symbols.length, count * 2, `${count} blocks should yield ${count * 2} symbols`)
    assert.equal(symbols[0].name, 'item_1')
    assert.equal(symbols[0].kind, 'struct')
    assert.equal(symbols[1].name, 'handle_1')
    assert.equal(symbols[1].kind, 'function')
    assert.equal(symbols.at(-1).name, `handle_${count}`)
    t.diagnostic(`${count} blocks (${text.length} chars): ${symbols.length} symbols`)
  }
})

test('the scan stays linear in file size, and well inside the route budget', (t) => {
  const rows = []
  for (const count of [100, 500, 2000, 5000, 9000]) {
    const { text, bytes } = source(count)
    // One warm-up pass, so the first scan of a size does not pay for the JIT.
    medianScan(text, 1)
    const ms = medianScan(text)
    rows.push({ blocks: count, bytes, ms })
    t.diagnostic(`${String(bytes).padStart(8)} B, ${String(count).padStart(5)} blocks: ${ms.toFixed(2)} ms`)
  }

  // The route accepts up to 4 MiB; 2.5 MB (9000 blocks) is the largest file the
  // browser lane measured. A second is several times the observed cost while
  // still catching a scanner that went quadratic.
  const largest = rows.at(-1)
  assert.ok(largest.ms < 1000, `2.5 MB should scan in well under a second, took ${largest.ms.toFixed(1)} ms`)

  // The scan is one pass over the text, so a 4.5× larger file must not cost an
  // order of magnitude more. This is the property a refactor breaks first.
  const small = rows.find((row) => row.blocks === 2000)
  const ratio = largest.ms / Math.max(small.ms, 0.01)
  assert.ok(ratio < 10, `9000 blocks cost ${ratio.toFixed(1)}× the 2000-block scan`)
})
