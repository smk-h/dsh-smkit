#!/usr/bin/env node
/**
 * LV006 的执行脚本 —— 用例文档在 [LV006-MCP上游共存退避.md](./LV006-MCP上游共存退避.md)。
 *
 * 这份脚本只负责「跑」：临时把上游 `dsh-mcp-manager` 装进同一个 profile、起停
 * dsh、用无头浏览器核对「MCP 半退避、其余功能照常、上游接管」三件事，然后还原
 * profile 清单。前置条件、场景步骤与判定口径都以那份文档为准。
 *
 * ## 为什么单独有一层
 *
 * `test/upstream-standdown.test.mjs` 只验探测函数读哪种清单；`test/client-language.test.mjs`
 * 用 VM 跑客户端包、断言字典与页签。两者都碰不到真实 dsh 的加载器，也复现不了
 * 「同名 locale 命名空间 + 同语言 → 整个 entry 失败」这条只有真加载器才会走的路。
 *
 * ## 用法
 *
 *     pnpm test:cases:standdown
 *     pnpm test:cases:standdown --skip-install
 *     node test/cases/mcp-standdown.mjs --profile web --port 3099
 *
 *   --profile      要装上游的 dsh profile，默认 web
 *   --port         自己起的 dsh web 端口，默认 3099（不碰你正在用的实例）
 *   --skip-install 不重新打包安装本插件，直接用 profile 里现有产物
 *   --upstream     上游包的安装引用，默认 github:hyqhyq3/dsh-mcp-manager#v0.17.0
 *
 * ## 被 `node --test` 发现时
 *
 * 本脚本需要真 dsh、真 profile 改动与浏览器，混进单元套件是灾难，所以入口处判断
 * 「是不是被测试 runner 拉起来的」，是就什么都不做。
 */

import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const INSTALLER = join(REPO, 'scripts', 'dsh-smkit.mjs')
const KILL_PORT = join(REPO, 'scripts', 'kill-port.mjs')
const HOME = homedir()
const UPSTREAM = 'dsh-mcp-manager'
const DEFAULT_REF = 'github:hyqhyq3/dsh-mcp-manager#v0.17.0'

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** 被 `node --test` 收进来时什么都不做；只有直接执行才是用例。 */
const runAsCase = (() => {
  if (process.env.NODE_TEST_CONTEXT) return false
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return pathToFileURL(resolve(entry)).href === import.meta.url
  } catch {
    return false
  }
})()

if (runAsCase) {
  await main(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(`\n✗ LV006 失败：${error?.message ?? error}`)
    process.exit(1)
  })
}

function parseArgs(argv) {
  const args = { profile: 'web', port: 3099, skipInstall: false, upstream: DEFAULT_REF }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--profile') args.profile = argv[++i] ?? 'web'
    else if (arg === '--port') args.port = Number(argv[++i] ?? 3099)
    else if (arg === '--upstream') args.upstream = argv[++i] ?? DEFAULT_REF
    else if (arg === '--skip-install') args.skipInstall = true
    else if (arg === '--help' || arg === '-h') {
      console.log('用法：node test/cases/mcp-standdown.mjs [--profile web] [--port 3099] [--skip-install] [--upstream <ref>]')
      process.exit(0)
    } else throw new Error(`未知参数 ${arg}`)
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error(`--port 非法：${args.port}`)
  return args
}

/** playwright 可能装在本地，也可能只在全局；浏览器目录同理。 */
function loadPlaywright() {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/ms-playwright')) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/ms-playwright'
  }
  const require = createRequire(import.meta.url)
  try {
    return require('playwright')
  } catch {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
    return require(join(globalRoot, 'playwright'))
  }
}

function readFileSyncSilently(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function readManifest(profileDir) {
  return JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
}

function bundlesOf(profileDir) {
  const manifest = readManifest(profileDir)
  const bundles = manifest.dsh?.profile?.bundles
  return Array.isArray(bundles) ? bundles : []
}

async function waitForToken(logPath, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  const pattern = /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/
  for (;;) {
    const found = pattern.exec(readFileSyncSilently(logPath))
    if (found) return found[0]
    if (Date.now() > deadline) throw new Error(`dsh web 没有在 ${timeoutMs} ms 内打印访问链接，见 ${logPath}`)
    await sleep(500)
  }
}

/** 起一个 dsh，拿到带 token 的 URL；日志留在产物目录里。 */
async function launchDsh(port, logPath) {
  execFileSync('node', [KILL_PORT, String(port), '--yes'], { cwd: REPO, stdio: 'ignore' })
  writeFileSync(logPath, '')
  spawn('setsid', ['sh', '-c', `dsh web --port ${port} --no-open < /dev/null > "${logPath}" 2>&1`], {
    cwd: REPO,
    detached: true,
    stdio: 'ignore',
  }).unref()
  return waitForToken(logPath)
}

function stopDsh(port) {
  try {
    execFileSync('node', [KILL_PORT, String(port), '--yes'], { cwd: REPO, stdio: 'ignore' })
  } catch {
    // 端口上本来就没有进程：用例自己起的实例可能已经退出。
  }
}

/** 在已装好的 profile 里增删上游插件，返回命令输出摘要。 */
function pluginAdd(profile, ref) {
  return execFileSync('dsh', ['plugin', '--profile', profile, 'add', ref], { cwd: REPO, encoding: 'utf8' })
}

function pluginRemove(profile) {
  return execFileSync('dsh', ['plugin', '--profile', profile, 'remove', UPSTREAM], { cwd: REPO, encoding: 'utf8' })
}

/**
 * 打开设置 → 本插件的设置区，读出页签；顺手取三组接口状态。
 *
 * @returns `{ booted, tabs, pageErrors, apis }`，`apis` 里每一项是 HTTP 状态码。
 */
async function inspect(page, tokenUrl, artifactDir) {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 200)))
  await page.goto(tokenUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const body = await page.locator('body').innerText()
  const apis = await page.evaluate(async () => {
    const read = async (path) => {
      try {
        const response = await fetch(path)
        return response.status
      } catch {
        return 0
      }
    }
    return {
      smkitServers: await read('/smkit/api/servers'),
      smkitSkills: await read('/smkit/api/skills'),
      upstreamServers: await read('/mcp-manager/api/servers'),
    }
  })
  await page.screenshot({ path: join(artifactDir, 'home.png') })

  await page.locator('[aria-label="Account menu"]').first().click()
  await page.waitForTimeout(600)
  await page.getByText(/^Settings$|^设置$/).first().click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: /smkit Settings/ }).first().click()
  await page.waitForTimeout(1500)
  const tabs = await page.locator('[role="tab"]').allInnerTexts()
  await page.screenshot({ path: join(artifactDir, 'settings.png') })

  return { booted: !body.includes('Failed to load plugins'), tabs, pageErrors, apis }
}

async function main(args) {
  const profileDir = join(HOME, '.dsh', 'profiles', args.profile)
  if (!existsSync(join(profileDir, 'package.json'))) throw new Error(`profile 不存在：${profileDir}`)

  const artifactDir = join(REPO, '.tmp', 'test-cases', 'LV006', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(artifactDir, { recursive: true })

  if (bundlesOf(profileDir).includes(UPSTREAM)) {
    console.log('  注意     运行前清单里已有上游：用例会先移除它做基线，收尾再按运行前状态还原')
  }

  console.log('LV006 — MCP 上游共存退避功能验收')
  console.log(`  profile  ${args.profile}（${profileDir}）`)
  console.log(`  端口     ${args.port}`)
  console.log(`  上游     ${args.upstream}`)
  console.log(`  产物     ${artifactDir}`)

  // 需要还原的文件：清单与 lockfile。node_modules 里残留的上游包不影响判定
  // （探测读的是清单），所以不为了干净去删它。
  const backups = ['package.json', 'pnpm-lock.yaml'].map((name) => {
    const path = join(profileDir, name)
    return { name, path, existed: existsSync(path), body: readFileSyncSilently(path) }
  })
  const restoreProfile = () => {
    for (const item of backups) {
      if (item.existed) writeFileSync(item.path, item.body)
      else rmSync(item.path, { force: true })
    }
  }

  const results = []
  let browser
  try {
    if (!args.skipInstall) {
      console.log('\n[准备] 打包并安装当前代码')
      execFileSync('node', [INSTALLER, 'install', '--profile', args.profile], { cwd: REPO, stdio: 'inherit' })
    }
    if (bundlesOf(profileDir).includes(UPSTREAM)) {
      console.log('[准备] 清单里已有上游，先移除，保证场景 A 是干净基线')
      pluginRemove(args.profile)
    }

    const { chromium } = loadPlaywright()
    browser = await chromium.launch()

    // ---------- 场景 A：只有本插件 ----------
    console.log('\n[场景 A] 未装上游：MCP 半应正常工作')
    {
      const logPath = join(artifactDir, 'dsh-web-a.log')
      const tokenUrl = await launchDsh(args.port, logPath)
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const shotDir = join(artifactDir, 'a')
      mkdirSync(shotDir, { recursive: true })
      const seen = await inspect(page, tokenUrl, shotDir)
      await page.close()
      stopDsh(args.port)

      const checks = [
        ['页面正常启动', seen.booted],
        ['无页面异常', seen.pageErrors.length === 0],
        ['设置区有 MCP 页签', seen.tabs.includes('MCP')],
        [`/smkit/api/servers = 200（实际 ${seen.apis.smkitServers}）`, seen.apis.smkitServers === 200],
        [`/smkit/api/skills = 200（实际 ${seen.apis.smkitSkills}）`, seen.apis.smkitSkills === 200],
        [`上游接口不存在 = 404（实际 ${seen.apis.upstreamServers}）`, seen.apis.upstreamServers === 404],
      ]
      results.push({ scenario: 'A', name: '未装上游', checks, tabs: seen.tabs, apis: seen.apis, log: logPath, ok: checks.every(([, ok]) => ok) })
      for (const [text, ok] of checks) console.log(`   ${ok ? '✓' : '✗'} ${text}`)
    }

    // ---------- 场景 B：两个插件同 profile ----------
    console.log('\n[场景 B] 装上上游：MCP 半应退避，上游接管')
    {
      console.log(`   安装 ${args.upstream}`)
      pluginAdd(args.profile, args.upstream)
      if (!bundlesOf(profileDir).includes(UPSTREAM)) throw new Error('上游安装后清单里没有它，无法进入场景 B')

      const logPath = join(artifactDir, 'dsh-web-b.log')
      const tokenUrl = await launchDsh(args.port, logPath)
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const shotDir = join(artifactDir, 'b')
      mkdirSync(shotDir, { recursive: true })
      const seen = await inspect(page, tokenUrl, shotDir)
      await page.close()
      stopDsh(args.port)

      const checks = [
        ['页面正常启动（同名 locale 不再拖垮 entry）', seen.booted],
        ['无页面异常', seen.pageErrors.length === 0],
        ['设置区没有 MCP 页签', !seen.tabs.includes('MCP')],
        ['设置区仍有其余页签', seen.tabs.includes('Skills')],
        [`/smkit/api/servers = 404（实际 ${seen.apis.smkitServers}）`, seen.apis.smkitServers === 404],
        [`/smkit/api/skills = 200（实际 ${seen.apis.smkitSkills}）`, seen.apis.smkitSkills === 200],
        [`/mcp-manager/api/servers = 200（实际 ${seen.apis.upstreamServers}）`, seen.apis.upstreamServers === 200],
      ]
      results.push({ scenario: 'B', name: '装有上游', checks, tabs: seen.tabs, apis: seen.apis, log: logPath, ok: checks.every(([, ok]) => ok) })
      for (const [text, ok] of checks) console.log(`   ${ok ? '✓' : '✗'} ${text}`)
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    stopDsh(args.port)
    // 收尾：先从清单里摘掉上游，再按备份还原，保证 manifest/lockfile 逐字节回到运行前。
    try {
      if (bundlesOf(profileDir).includes(UPSTREAM)) pluginRemove(args.profile)
    } catch (error) {
      console.log(`   注意：移除上游失败（${error.message}），改用备份还原清单`)
    }
    restoreProfile()
    const restored = readFileSyncSilently(join(profileDir, 'package.json')) === (backups[0].existed ? backups[0].body : '')
    console.log(`\n[收尾] profile 清单${restored ? '已还原' : '与运行前不一致，请检查'}`)
  }

  const ok = results.length === 2 && results.every((entry) => entry.ok)
  writeFileSync(join(artifactDir, 'result.json'), `${JSON.stringify({ at: new Date().toISOString(), profile: args.profile, upstream: args.upstream, ok, results }, null, 2)}\n`)

  console.log('\n========== 结果 ==========')
  for (const entry of results) console.log(`  场景 ${entry.scenario}（${entry.name}）：${entry.ok ? '通过' : '未通过'}`)
  console.log(`  产物：${artifactDir}`)
  if (!ok) throw new Error('至少一条判据未通过')
}
