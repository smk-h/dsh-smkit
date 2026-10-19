/**
 * The explorer menu's creating rows, in a real headless browser.
 *
 * Why this exists on top of `test/explorer-menu.test.mjs`: that suite drives the
 * bundle in a `vm` with a hand-written DOM stub, which can prove the CALLS but
 * not the PIXELS. This one loads the real bundle in Chromium, against a tree
 * shaped like `ui-sidebar-files`'s, and checks three things the stub cannot:
 *
 * 1. **style** — the inline editor is measured against the numbers the source
 *    plugin's sheet uses (`explorerRow`: 28px tall, 0 8px padding, 6px gap;
 *    `explorerRenameInput`: 22px tall, 1px business border, 3px radius, 12px
 *    text), with the host's tokens given concrete values here;
 * 2. **geometry** — the card is pinned to the directory row it belongs to: same
 *    left edge, same width, flush under the row;
 * 3. **function** — right-click → menu → create, through the REAL host route
 *    (`lib/host/features/explorer-ops/api.js`) and the REAL filesystem, so an
 *    empty file, an empty folder, a duplicate and an illegal name are judged by
 *    what landed on disk and what the editor said.
 *
 * The shell's own `Menu` and `FileTypeIcon` are replaced by stand-ins (this
 * plugin consumes them; it does not own them), and the host's design tokens are
 * given concrete values — everything the feature itself draws is the real thing.
 *
 * Run: `pnpm build && node e2e/explorer-menu.e2e.mjs`
 * Playwright is deliberately NOT a dependency of this package: point
 * `PLAYWRIGHT_HOME` at an install of it (`npm i playwright` in any directory),
 * or have it resolvable from the repo.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const bundle = join(repo, 'lib', 'client.js')
if (!existsSync(bundle)) {
  console.error(`missing ${relative(process.cwd(), bundle)} — run "pnpm build" first`)
  process.exit(1)
}

const toolRequire = createRequire(process.env.PLAYWRIGHT_HOME === undefined ? import.meta.url : `${process.env.PLAYWRIGHT_HOME}/`)
const { chromium } = toolRequire('playwright')
const { createExplorerHandlers } = await import(join(repo, 'lib', 'host', 'features', 'explorer-ops', 'api.js'))

/* ------------------------------------------------------------------ fixture */

/** The workspace the fake tree shows: one file at the root, one nested level. */
const root = mkdtempSync(join(tmpdir(), 'smkit-e2e-explorer-'))
const dirPath = join(root, 'src')
const draftPath = join(root, 'draft')
mkdirSync(join(dirPath, 'nested'), { recursive: true })
mkdirSync(draftPath)
writeFileSync(join(root, 'readme.md'), '# readme\n')
writeFileSync(join(dirPath, 'a.ts'), 'export const a = 1\n')

const escapeHtml = (text) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])

/** One entry as the shell's tree draws it: `li` + `button`, children on demand. */
function entryHtml(parent, name) {
  const path = join(parent, name)
  const isDir = statSync(path).isDirectory()
  if (!isDir) {
    return `<li data-files-entry="file" data-files-path="${escapeHtml(path)}"><button type="button" data-row-button><span class="name">${escapeHtml(name)}</span></button></li>`
  }
  const children = readdirSync(path)
    .filter((child) => !child.startsWith('.'))
    .sort((a, b) => Number(statSync(join(path, b)).isDirectory()) - Number(statSync(join(path, a)).isDirectory()) || a.localeCompare(b))
  return `<li data-files-entry="directory" data-files-path="${escapeHtml(path)}" data-expanded="false">`
    + `<button type="button" data-row-button aria-expanded="false"><span class="name">${escapeHtml(name)}</span></button>`
    + `<template data-children>${children.map((child) => entryHtml(path, child)).join('')}</template>`
    + '</li>'
}

/** The page: the shell's tree shape, the host tokens, and the module table. */
function pageHtml() {
  const rows = readdirSync(root)
    .filter((name) => !name.startsWith('.'))
    .sort((a, b) => Number(statSync(join(root, b)).isDirectory()) - Number(statSync(join(root, a)).isDirectory()) || a.localeCompare(b))
    .map((name) => entryHtml(root, name))
    .join('')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>explorer menu e2e</title>
<style>
  /* The host tokens this feature reads, with concrete values so the style
     assertions are about the plugin's own rules rather than about a theme. */
  :root {
    --dsw-font-xxs-12: 12px/1.4 "Noto Sans", system-ui, sans-serif;
    --dsw-font-xxxs-11: 11px/1.4 "Noto Sans", system-ui, sans-serif;
    --dsw-alias-bg-layer-1: rgb(255, 255, 255);
    --dsw-alias-label-primary: rgb(17, 17, 17);
    --dsw-alias-label-tertiary: rgb(136, 136, 136);
    --dsw-alias-state-business-primary: rgb(59, 130, 246);
    --dsw-alias-state-error-primary: rgb(220, 38, 38);
    --dsw-alias-border-l1: rgb(221, 221, 221);
    --dsw-alias-bg-layer-2: rgb(250, 250, 250);
    --dsw-alias-interactive-bg-hover: rgb(240, 240, 240);
  }
  html, body { margin: 0; font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-primary); }
  #host { padding: 8px; width: 360px; }
  ul { margin: 0; padding: 0 0 0 16px; list-style: none; }
  #tree { padding: 0; }
  li > button[data-row-button] {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 28px;
    padding: 0 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  li > button[data-row-button]:hover { background: rgb(240, 240, 240); }
</style></head>
<body>
<div id="host"><ul id="tree" data-files-state="tree" data-files-root="${escapeHtml(root)}">${rows}</ul></div>

<script>
  window.__harness = { applied: false, error: null }

  /* The shell's module table, as the web profile seeds it. */
  window.__ModuleLoader__ = {
    load({ factory }) {
      const requireShim = (name) => {
        if (name === 'react') {
          return {
            createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
            Fragment: 'Fragment',
          }
        }
        if (name === 'react-dom') return { createPortal: (node) => node }
        if (name === 'react-dom/client') {
          return {
            createRoot(container) {
              /* The host's Menu, reduced to the props this plugin passes it:
                 a card of rows, each one calling onSelect(id). It is portalled
                 to <body> as the real one is — the plugin's own host node is
                 display:none, so rendering INTO it would be invisible. */
              let stubMenu = null
              const dismiss = () => {
                if (stubMenu !== null) stubMenu.remove()
                stubMenu = null
                window.__menu = null
              }
              return {
                render(node) {
                  if (node === null || node === undefined || node.props === undefined) return
                  /* The editor's glyph slot: a second root of this same stub. */
                  if (typeof node.props.kind === 'string' && node.props.items === undefined) {
                    container.replaceChildren()
                    const glyph = document.createElement('span')
                    glyph.setAttribute('data-stub-icon', node.props.kind)
                    glyph.textContent = node.props.kind.slice(0, 2).toUpperCase()
                    container.appendChild(glyph)
                    return
                  }
                  dismiss()
                  if (node.props.open !== true) return
                  const menu = document.createElement('div')
                  menu.setAttribute('data-stub-menu', '')
                  menu.style.cssText = 'position:fixed;left:8px;top:8px;z-index:1001;background:#fff;border:1px solid #ccc;padding:4px;display:flex;flex-direction:column;gap:2px'
                  for (const item of node.props.items ?? []) {
                    const row = document.createElement('button')
                    row.type = 'button'
                    row.setAttribute('data-item', item.id)
                    row.textContent = item.label
                    row.addEventListener('click', () => node.props.onSelect(item.id))
                    menu.appendChild(row)
                  }
                  document.body.appendChild(menu)
                  stubMenu = menu
                  window.__menu = node.props
                },
                unmount() { dismiss() },
              }
            },
          }
        }
        if (name === '@deepseek-ai/dsh-client-ui-primitives') {
          return {
            Menu: (props) => props,
            writeClipboard: async () => true,
            /* The shell's glyph component and classifier, reduced to what the
               editor reads: a kind, and the element that carries it. */
            FileTypeIcon: (props) => props,
            classifyFileType: (fileName) => {
              const base = String(fileName).split('/').pop()
              const dot = base.lastIndexOf('.')
              return dot > 0 ? base.slice(dot + 1) : 'file'
            },
          }
        }
        throw new Error('no platform module ' + name)
      }
      window.__client = factory(requireShim)
    },
  }
</script>
<script src="/client.js"></script>
<script>
  /* A tree that expands the way the shell's does: children arrive on the first
     click, and the row reports its state — which is what the feature reads to
     decide whether it has to open a directory before creating inside it. */
  for (const button of document.querySelectorAll('li[data-files-entry="directory"] > button[data-row-button]')) {
    button.addEventListener('click', () => {
      const item = button.parentElement
      const open = item.getAttribute('data-expanded') === 'true'
      if (open) {
        const list = item.querySelector(':scope > ul')
        if (list !== null) list.remove()
        item.setAttribute('data-expanded', 'false')
        button.setAttribute('aria-expanded', 'false')
        return
      }
      const template = item.querySelector(':scope > template')
      const list = document.createElement('ul')
      list.innerHTML = template === null ? '' : template.innerHTML
      item.appendChild(list)
      item.setAttribute('data-expanded', 'true')
      button.setAttribute('aria-expanded', 'true')
    })
  }

  const dictionaries = {}
  const disposes = []
  const ctx = {
    effect(fn) { const dispose = fn(); disposes.push(dispose) },
    provide() {},
    reflect: { get: () => undefined },
    on: () => () => {},
    locale: {
      register(namespace, dicts) { dictionaries[namespace] = dicts; return () => { delete dictionaries[namespace] } },
      bind(namespace) { return (key) => dictionaries[namespace]?.zh?.[key] ?? key },
    },
    slots: { inject(_name, setup) { setup() }, register() { return () => {} }, entries: () => [] },
    sessions: {},
    theme: { overrideTokens() {} },
  }
  try {
    window.__client.apply(ctx)
    window.__harness.applied = true
  } catch (error) {
    window.__harness.error = String(error && error.stack || error)
  }
  window.__harness.dispose = () => { for (const dispose of disposes.reverse()) dispose?.() }
</script>
</body></html>`
}

/* ------------------------------------------------------------------- server */

/** Every creating request the page made, in order (`/explorer/*` only). */
const calls = []
const handlers = createExplorerHandlers()

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(pageHtml())
    return
  }
  if (url.pathname === '/client.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
    createReadStream(bundle).pipe(res)
    return
  }
  if (url.pathname === '/__calls') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(calls))
    return
  }
  const api = '/smkit/api'
  if (url.pathname.startsWith(api)) {
    const rest = url.pathname.slice(api.length)
    if (!rest.startsWith('/explorer/')) {
      res.writeHead(404)
      res.end()
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    calls.push({ rest, body: JSON.parse(text) })
    // The handler wants the body as a stream again; this is the same bytes.
    const replay = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      async *[Symbol.asyncIterator]() { yield Buffer.from(text) },
    }
    const facts = { url, rest, origin: 'http://localhost', idMatch: null }
    for (const handle of handlers) {
      if (await handle(replay, res, facts)) return
    }
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(404)
  res.end()
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

/* -------------------------------------------------------------------- tests */

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const failures = []
let checks = 0

/** One assertion, reported rather than thrown, so one failure does not hide the rest. */
function check(name, fn) {
  checks += 1
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${String(error.message).split('\n')[0]}`)
  }
}

/** One async assertion with the same reporting. */
async function checkAsync(name, fn) {
  checks += 1
  try {
    await fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${String(error.message).split('\n')[0]}`)
  }
}

const row = (path) => `li[data-files-path="${path}"]`
const card = page.locator('[data-smkit-explorer-new-row]')

/** Right-click one row's button, the way a user does. */
async function openMenuOn(path) {
  await page.locator(`${row(path)} > button[data-row-button]`).click({ button: 'right' })
  await page.locator('[data-stub-menu]').waitFor()
}

/** Pick one row of the open menu. */
async function pick(id) {
  await page.locator(`[data-stub-menu] [data-item="${id}"]`).click()
}

/** The card's own geometry and computed style, plus the anchor row's box. */
async function measure(path) {
  return page.evaluate((selector) => {
    const button = document.querySelector(`${selector} > button[data-row-button]`)
    const node = document.querySelector('[data-smkit-explorer-new-row]')
    const list = document.querySelector(`${selector} > ul`)
    const indent = list === null ? 0 : Number.parseFloat(getComputedStyle(list).paddingLeft) || 0
    const input = node.querySelector('input')
    const box = (element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
    }
    const style = (element) => {
      const computed = getComputedStyle(element)
      return {
        height: computed.height,
        width: computed.width,
        padding: `${computed.paddingTop} ${computed.paddingRight} ${computed.paddingBottom} ${computed.paddingLeft}`,
        gap: computed.columnGap,
        font: computed.fontSize,
        radius: computed.borderTopLeftRadius,
        borderWidth: computed.borderTopWidth,
        borderStyle: computed.borderTopStyle,
        borderColor: computed.borderTopColor,
        background: computed.backgroundColor,
        color: computed.color,
        placeholderColor: getComputedStyle(element, '::placeholder').color,
      }
    }
    return {
      indent,
      row: box(button),
      card: box(node),
      input: box(input),
      cardStyle: style(node),
      inputStyle: style(input),
      focused: document.activeElement === input,
      placeholder: input.getAttribute('placeholder'),
      label: input.getAttribute('aria-label'),
      kind: node.getAttribute('data-smkit-explorer-new-kind'),
    }
  }, row(path))
}

/** The refusal line's text and style, when the card shows one. */
async function refusal() {
  return page.evaluate(() => {
    const node = document.querySelector('[data-smkit-explorer-new-invalid]')
    if (node === null) return null
    const error = node.querySelector('.smkit-explorer-new-row-error')
    const computed = getComputedStyle(error)
    return { text: error.textContent, color: computed.color, font: computed.fontSize, visible: computed.display !== 'none' }
  })
}

const callsNow = async () => (await fetch(`${base}/__calls`)).json()

try {
  await page.goto(base)
  await page.waitForFunction(() => window.__harness.applied === true || window.__harness.error !== null)
  const harnessError = await page.evaluate(() => window.__harness.error)
  if (harnessError !== null) throw new Error(`the bundled plugin failed to apply:\n${harnessError}`)

  /* ---------------------------------------------------------------- menu */
  console.log('\nmenu rows')
  await openMenuOn(dirPath)
  const dirLabels = await page.locator('[data-stub-menu] [data-item]').allTextContents()
  check('a directory row offers 新建文件夹 / 新建文件 first, then the copy rows', () => {
    assert.deepEqual(dirLabels, ['新建文件夹', '新建文件', '复制相对路径', '复制绝对路径'])
  })
  await page.screenshot({ path: join(tmpdir(), 'smkit-e2e-menu.png') })
  await page.evaluate(() => window.__menu?.onClose?.())

  await openMenuOn(join(root, 'readme.md'))
  const fileLabels = await page.locator('[data-stub-menu] [data-item]').allTextContents()
  check('a file row never offers the creating rows', () => {
    assert.deepEqual(fileLabels, ['复制相对路径', '复制绝对路径'])
  })
  await page.evaluate(() => window.__menu?.onClose?.())

  /* --------------------------------------------------------------- new file */
  console.log('\nnew file')
  await openMenuOn(dirPath)
  await pick('new-file')
  await card.waitFor()
  await page.screenshot({ path: join(tmpdir(), 'smkit-e2e-card-open.png') })
  const measured = await measure(dirPath)
  check('the card sits at the level’s indent, flush under the row, as wide as that level', () => {
    assert.ok(measured.indent > 0, 'the fixture indents children')
    assert.equal(Math.round(measured.card.left), Math.round(measured.row.left + measured.indent))
    assert.equal(Math.round(measured.card.width), Math.round(measured.row.width - measured.indent))
    assert.equal(Math.round(measured.card.top), Math.round(measured.row.bottom))
  })
  check('the card carries the source row’s metrics (28px tall, 0 8px, 6px gap, 4px radius)', () => {
    assert.equal(measured.cardStyle.height, '28px')
    assert.equal(measured.cardStyle.padding, '0px 8px 0px 8px')
    assert.equal(measured.cardStyle.gap, '6px')
    assert.equal(measured.cardStyle.radius, '4px')
    assert.equal(measured.cardStyle.font, '12px')
  })
  check('the input carries the source input’s metrics (22px, 1px business border, 3px radius, 12px)', () => {
    assert.equal(measured.inputStyle.height, '22px')
    assert.equal(measured.inputStyle.padding, '0px 6px 0px 6px')
    assert.equal(measured.inputStyle.borderWidth, '1px')
    assert.equal(measured.inputStyle.borderStyle, 'solid')
    assert.equal(measured.inputStyle.borderColor, 'rgb(59, 130, 246)')
    assert.equal(measured.inputStyle.radius, '3px')
    assert.equal(measured.inputStyle.font, '12px')
    assert.equal(measured.inputStyle.placeholderColor, 'rgb(136, 136, 136)')
  })
  check('the editor is the new-FILE one, focused, with the source’s placeholder and label', () => {
    assert.equal(measured.kind, 'file')
    assert.equal(measured.placeholder, '文件名称')
    assert.equal(measured.label, '新建文件')
    assert.equal(measured.focused, true)
  })
  const gap = await page.evaluate((selector) => {
    const list = document.querySelector(`${selector} > ul`)
    const first = list === null ? null : list.querySelector('li > button[data-row-button]')
    const node = document.querySelector('[data-smkit-explorer-new-row]')
    return {
      padding: list === null ? null : list.style.paddingTop,
      firstTop: first === null ? null : first.getBoundingClientRect().top,
      cardBottom: node.getBoundingClientRect().bottom,
    }
  }, row(dirPath))
  check('the level gives up one row so the card sits in a gap, not over the first entry', () => {
    assert.equal(gap.padding, '28px')
    if (gap.firstTop !== null) {
      assert.ok(gap.firstTop >= gap.cardBottom - 0.5, `the first entry starts at ${gap.firstTop}, the card ends at ${gap.cardBottom}`)
    }
  })

  const glyphSlot = () => page.evaluate(() => {
    const slot = document.querySelector('[data-smkit-explorer-new-row] .smkit-explorer-new-row-icon')
    const glyph = slot === null ? null : slot.querySelector('[data-stub-icon]')
    return glyph === null ? null : glyph.getAttribute('data-stub-icon')
  })
  await checkAsync('the glyph starts as the generic file type, as the source’s empty-name probe', async () => {
    assert.equal(await glyphSlot(), 'file')
  })

  const input = card.locator('input')
  await input.fill('notes.md')
  await checkAsync('and follows the typed name’s extension, as the source’s fileIcon(probe) does', async () => {
    assert.equal(await glyphSlot(), 'md')
  })
  await input.press('Enter')
  await card.waitFor({ state: 'detached' })
  check('Enter creates an EMPTY file at the row’s directory and closes the card', () => {
    assert.equal(readFileSync(join(dirPath, 'notes.md'), 'utf8'), '')
    assert.deepEqual(calls.at(-1), { rest: '/explorer/create-file', body: { path: dirPath, name: 'notes.md' } })
  })

  /* ------------------------------------------------------------- new folder */
  console.log('\nnew folder')
  await openMenuOn(dirPath)
  await pick('new-folder')
  await card.waitFor()
  const folderMeasure = await measure(dirPath)
  check('the folder editor uses the folder placeholder and label', () => {
    assert.equal(folderMeasure.kind, 'folder')
    assert.equal(folderMeasure.placeholder, '文件夹名称')
    assert.equal(folderMeasure.label, '新建文件夹')
  })
  await card.locator('input').fill('made')
  await card.locator('input').press('Enter')
  await card.waitFor({ state: 'detached' })
  check('Enter creates the folder', () => {
    assert.equal(statSync(join(dirPath, 'made')).isDirectory(), true)
  })

  /* --------------------------------------------------------------- refusals */
  console.log('\nrefusals')
  await openMenuOn(dirPath)
  await pick('new-file')
  await card.waitFor()
  await card.locator('input').fill('notes.md')
  await card.locator('input').press('Enter')
  await page.waitForTimeout(120)
  const duplicate = await refusal()
  check('a duplicate FILE says 同名文件已存在, in the source’s error ink', () => {
    assert.notEqual(duplicate, null)
    assert.equal(duplicate.visible, true)
    assert.equal(duplicate.text, '同名文件已存在')
    assert.equal(duplicate.color, 'rgb(220, 38, 38)')
    assert.equal(duplicate.font, '11px')
  })
  await checkAsync('the card stays open after a refusal', async () => {
    assert.equal(await card.count(), 1)
  })
  const errorGap = await page.evaluate((selector) => {
    const list = document.querySelector(`${selector} > ul`)
    const node = document.querySelector('[data-smkit-explorer-new-row]')
    const line = node.querySelector('.smkit-explorer-new-row-error')
    return { padding: list.style.paddingTop, cardBottom: node.getBoundingClientRect().bottom, errorBottom: line.getBoundingClientRect().bottom }
  }, row(dirPath))
  check('the refusal line gets its own gap too (card + 20px), so nothing is covered', () => {
    assert.equal(errorGap.padding, '48px')
    assert.ok(errorGap.errorBottom <= errorGap.cardBottom + 24, 'the line hangs just under the card')
  })
  await page.screenshot({ path: join(tmpdir(), 'smkit-e2e-refused.png') })
  await card.locator('input').press('Escape')
  await card.waitFor({ state: 'detached' })
  await checkAsync('closing the editor hands the level its padding back', async () => {
    const padding = await page.evaluate((selector) => {
      const list = document.querySelector(`${selector} > ul`)
      return list === null ? null : list.style.paddingTop
    }, row(dirPath))
    assert.equal(padding, '')
  })

  const before = (await callsNow()).length
  await openMenuOn(dirPath)
  await pick('new-file')
  await card.waitFor()
  await card.locator('input').fill('a/b')
  await card.locator('input').press('Enter')
  await page.waitForTimeout(120)
  const shape = await refusal()
  const after = (await callsNow()).length
  check('a name with a separator is refused here, with 文件名称无效, and never reaches the host', () => {
    assert.equal(shape.text, '文件名称无效')
    assert.equal(after, before)
  })
  await card.locator('input').press('Escape')

  await openMenuOn(dirPath)
  await pick('new-folder')
  await card.waitFor()
  await card.locator('input').fill('made')
  await card.locator('input').press('Enter')
  await page.waitForTimeout(120)
  const folderDuplicate = await refusal()
  check('a duplicate FOLDER keeps the host’s own sentence (no copy of its own in the source)', () => {
    assert.notEqual(folderDuplicate, null)
    assert.equal(folderDuplicate.text, '"made" already exists')
  })
  await card.locator('input').press('Escape')

  /* ---------------------------------------------------- collapsed directory */
  console.log('\ncollapsed directory')
  await openMenuOn(draftPath)
  await pick('new-file')
  await card.waitFor()
  const expanded = await page.evaluate((selector) => {
    const item = document.querySelector(selector)
    return {
      expanded: item.getAttribute('data-expanded'),
      hasList: item.querySelector(':scope > ul') !== null,
    }
  }, row(draftPath))
  check('the directory is opened first, so the new row lands in a visible level', () => {
    assert.equal(expanded.expanded, 'true')
    assert.equal(expanded.hasList, true)
  })
  await card.locator('input').fill('inside.txt')
  await card.locator('input').press('Enter')
  await card.waitFor({ state: 'detached' })
  check('and the file lands inside it', () => {
    assert.equal(existsSync(join(draftPath, 'inside.txt')), true)
  })

  /* ------------------------------------------------------- blur and IME keys */
  console.log('\nblur / IME')
  await openMenuOn(dirPath)
  await pick('new-file')
  await card.waitFor()
  await card.locator('input').fill('blurred.txt')
  await page.mouse.click(700, 620)
  await card.waitFor({ state: 'detached' })
  check('clicking away commits, as the source’s blur handler does', () => {
    assert.equal(existsSync(join(dirPath, 'blurred.txt')), true)
  })

  const beforeIme = (await callsNow()).length
  await openMenuOn(dirPath)
  await pick('new-file')
  await card.waitFor()
  await card.locator('input').fill('composed.txt')
  await card.locator('input').evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
  })
  await page.waitForTimeout(120)
  await checkAsync('an Enter that belongs to an IME composition creates nothing (and keeps the card)', async () => {
    assert.equal((await callsNow()).length, beforeIme)
    assert.equal(await card.count(), 1)
  })
  await card.locator('input').press('Escape')
  await card.waitFor({ state: 'detached' })
  check('Escape dismisses it without creating', () => {
    assert.equal(existsSync(join(dirPath, 'composed.txt')), false)
  })
  await page.screenshot({ path: join(tmpdir(), 'smkit-e2e-card.png') })
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
  rmSync(root, { recursive: true, force: true })
}

const failed = failures.length
console.log(`\n${checks - failed}/${checks} checks passed${failed === 0 ? '' : `, ${failed} failed`}`)
console.log(`screenshots: ${join(tmpdir(), 'smkit-e2e-menu.png')} (menu), ${join(tmpdir(), 'smkit-e2e-refused.png')} (refusal), ${join(tmpdir(), 'smkit-e2e-card.png')} (editor)`)
process.exit(failed === 0 ? 0 : 1)
