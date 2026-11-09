#!/usr/bin/env node
/**
 * LV005 的执行脚本 —— 用例文档在 [LV005-MCP自动重连.md](./LV005-MCP自动重连.md)。
 *
 * 这份脚本只负责「跑」：起停 dsh、驱动无头浏览器、按判据核对进程表与桩日志。
 * 前置条件、场景步骤与判定口径都以那份文档为准；要改判据先改文档，再改这里。
 *
 * ## 为什么单独有一层
 *
 * `test/auto-reconnect.test.mjs` 用桩驱动状态机，验的是插件自己记录的状态，看不到
 * 真实子进程有没有被回收。这里走真 dsh、真工作区、真子进程，用仓库自带的
 * `scripts/ssh-stub-mcp.mjs` 制造两种断法：
 *
 *   exit  子进程自己退出（`--mode=exit`）→ onExit 立刻发现 → 重拉
 *   hang  进程还活着、只是不应答（`--mode=hang`）→ 探活 `tools/list` 卡满 60 秒
 *         超时后判定掉线 → 重拉，且旧进程必须被回收
 *
 * ## 用法
 *
 *     pnpm test:cases
 *     pnpm test:cases --only hang --skip-install
 *     node test/cases/mcp-reconnect.mjs --workspace <已注册工作区路径>
 *
 *   --workspace   要在里面跑用例的 dsh 工作区（目录必须已存在）
 *                 缺省时取 `~/.dsh/storages/workspace.json` 里第一个工作区
 *   --port        自己起的 dsh web 端口，默认 3099（不碰你正在用的实例）
 *   --only        exit | hang | both（默认 both）
 *   --skip-install  不重新打包安装插件，直接用 profile 里现有产物
 *
 * ## 被 `node --test` 发现时
 *
 * `pnpm test` 只跑 `test/*.test.mjs`，碰不到这里；但直接 `node --test` 会把 `test/`
 * 下所有脚本都当测试文件收进去。本脚本需要真 dsh 与浏览器，混进单元套件是灾难，
 * 所以入口处判断「是不是被测试 runner 拉起来的」，是就什么都不做。
 */

import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const STUB = join(REPO, 'scripts', 'ssh-stub-mcp.mjs')
const INSTALLER = join(REPO, 'scripts', 'dsh-smkit.mjs')
const KILL_PORT = join(REPO, 'scripts', 'kill-port.mjs')
const HOME = homedir()
const STATE_FILE = join(HOME, '.dsh', 'mcp-manager.json')
const WORKSPACE_STORE = join(HOME, '.dsh', 'storages', 'workspace.json')

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
    console.error(`\n✗ LV005 失败：${error?.message ?? error}`)
    process.exit(1)
  })
}

function parseArgs(argv) {
  const args = { workspace: '', port: 3099, only: 'both', skipInstall: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--workspace') args.workspace = argv[++i] ?? ''
    else if (arg === '--port') args.port = Number(argv[++i] ?? 3099)
    else if (arg === '--only') args.only = argv[++i] ?? 'both'
    else if (arg === '--skip-install') args.skipInstall = true
    else if (arg === '--help' || arg === '-h') {
      console.log('用法：node test/cases/mcp-reconnect.mjs [--workspace <路径>] [--port 3099] [--only exit|hang|both] [--skip-install]')
      process.exit(0)
    } else throw new Error(`未知参数 ${arg}`)
  }
  if (!['exit', 'hang', 'both'].includes(args.only)) throw new Error(`--only 只能是 exit / hang / both，收到 ${args.only}`)
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error(`--port 非法：${args.port}`)
  return args
}

/** 工作区：显式给的最优先，否则取 dsh 注册表里的第一个。 */
function resolveWorkspace(explicit) {
  if (explicit) {
    const path = resolve(explicit)
    if (!existsSync(path)) throw new Error(`工作区不存在：${path}`)
    return path
  }
  if (!existsSync(WORKSPACE_STORE)) throw new Error('找不到 ~/.dsh/storages/workspace.json，请用 --workspace 指定工作区')
  const store = JSON.parse(readFileSync(WORKSPACE_STORE, 'utf8'))
  const first = Object.values(store.tables?.workspaces ?? {})[0]
  if (!first?.path) throw new Error('注册表里没有工作区，请用 --workspace 指定')
  return first.path
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
async function launchDsh(port, artifactDir) {
  const logPath = join(artifactDir, 'dsh-web.log')
  execFileSync('node', [KILL_PORT, String(port), '--yes'], { cwd: REPO, stdio: 'ignore' })
  writeFileSync(logPath, '')
  const command = `dsh web --port ${port} --no-open`
  spawn('setsid', ['sh', '-c', `${command} < /dev/null > "${logPath}" 2>&1`], {
    cwd: REPO,
    detached: true,
    stdio: 'ignore',
  }).unref()
  return { url: await waitForToken(logPath), logPath }
}

function stopDsh(port) {
  try {
    execFileSync('node', [KILL_PORT, String(port), '--yes'], { cwd: REPO, stdio: 'ignore' })
  } catch {
    // 端口上本来就没有进程：用例自己起的实例可能已经退出。
  }
}

/** 写工作区的 mcp.json；返回恢复函数。 */
function installServer(workspace, serverName, scenario, logPath) {
  const configPath = join(workspace, '.dsh', 'dshmm', 'mcp.json')
  const created = !existsSync(configPath)
  const backup = readFileSyncSilently(configPath)
  const entry = {
    mcpServers: {
      [serverName]: {
        type: 'stdio',
        command: 'node',
        args: [
          STUB,
          `--mode=${scenario}`,
          scenario === 'hang' ? '--lifetime=15000' : '--lifetime=8000',
          '--startup-delay=0',
          `--name=lv005-${scenario}`,
          `--log=${logPath}`,
        ],
        env: {},
      },
    },
  }
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(entry, null, 2)}\n`)
  return () => {
    if (!created) {
      writeFileSync(configPath, backup)
      return
    }
    // 只收掉自己造出来的这一层：`.dsh` 下可能还有用户的 skills 等东西。
    rmSync(configPath, { force: true })
    for (const dir of [dirname(configPath), dirname(dirname(configPath))]) {
      try {
        execFileSync('rmdir', [dir], { stdio: 'ignore' })
      } catch {
        break
      }
    }
  }
}

/** 桩自己写的日志：START 行数 + 进程是否还在。 */
function readStarts(logPath) {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.includes('===== START'))
    .map((line) => ({
      pid: /pid=(\d+)/.exec(line)?.[1],
      at: /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})/.exec(line)?.[1] ?? '',
    }))
    .filter((entry) => entry.pid)
}

function alive(pid) {
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

/** 一个场景：开会话 → 等它断 → 等它回来 → 核对进程。 */
async function runScenario({ page, workspace, scenario, artifactDir, api }) {
  const serverName = `lv005-${scenario}`
  const logPath = join(artifactDir, `${scenario}.log`)
  writeFileSync(logPath, '')
  const restoreConfig = installServer(workspace, serverName, scenario, logPath)
  const evidence = { scenario, serverName, logPath, steps: [] }

  const rowOf = (payload) =>
    payload.workspaces?.find((entry) => entry.path === workspace)?.servers?.find((entry) => entry.name === serverName)
  const waitRow = async (predicate, what, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    let last
    for (;;) {
      last = rowOf(await api('/smkit/api/workspaces'))
      if (last && predicate(last)) return last
      if (Date.now() > deadline) throw new Error(`${scenario}: ${what} 超时（最后一次：${JSON.stringify(last)}）`)
      await sleep(500)
    }
  }
  const step = (text, detail = '') => {
    evidence.steps.push({ text, detail })
    console.log(`   ${text}${detail ? ` — ${detail}` : ''}`)
  }

  try {
    const title = basename(workspace)
    const label = page.getByText(title, { exact: true }).first()
    await label.hover()
    await page.waitForTimeout(300)
    await page.locator(`[aria-label="New session in ${title}"]`).first().click({ force: true })
    await page.waitForTimeout(2000)
    step(`在 ${workspace} 打开一个会话（工作区因此变活）`)

    const connected = await waitRow((row) => row.status === 'connected', '首次连接', 60000)
    const firstStarts = readStarts(logPath)
    step('首次连接', `tools=${connected.toolCount} starts=${firstStarts.map((entry) => entry.pid).join(',') || '(尚未落盘)'}`)
    if (connected.toolCount === 0) throw new Error(`${scenario}: 连上了却没有工具`)

    const dropped = await waitRow((row) => row.status === 'reconnecting', '掉线', 150000)
    const reason = dropped.error ?? ''
    step('掉线', reason.slice(0, 140) || '(无文案)')
    const expectReason = scenario === 'hang' ? 'health check failed' : 'stdio process exited'
    if (!reason.includes(expectReason)) throw new Error(`${scenario}: 掉线原因不含「${expectReason}」：${reason}`)

    const revived = await waitRow((row) => row.status === 'connected', '重连', 60000)
    if (revived.toolCount === 0) throw new Error(`${scenario}: 重连后没有工具`)
    step('重连完成', `tools=${revived.toolCount}`)

    await sleep(1200)
    const starts = readStarts(logPath)
    step('桩日志', `${starts.length} 次 START：${starts.map((entry) => `${entry.at} pid=${entry.pid}`).join(' | ')}`)
    if (starts.length !== 2) throw new Error(`${scenario}: 期望拉起 2 次，实际 ${starts.length} 次`)

    const [oldPid, newPid] = starts.map((entry) => entry.pid)
    const oldAlive = alive(oldPid)
    const newAlive = alive(newPid)
    step('进程表', `旧 ${oldPid}=${oldAlive ? 'alive' : 'gone'}，新 ${newPid}=${newAlive ? 'alive' : 'gone'}`)
    if (!newAlive) throw new Error(`${scenario}: 新进程 ${newPid} 不在了，重连没有真正起来`)
    if (oldAlive) throw new Error(`${scenario}: 旧进程 ${oldPid} 仍存活，重建没有回收被替换的 transport`)

    evidence.ok = true
    evidence.starts = starts
    return evidence
  } catch (error) {
    evidence.ok = false
    evidence.error = error.message
    throw error
  } finally {
    restoreConfig()
  }
}

async function main(args) {
  const workspace = resolveWorkspace(args.workspace)
  const artifactDir = join(REPO, '.tmp', 'test-cases', 'LV005', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(artifactDir, { recursive: true })

  console.log('LV005 — MCP 自动重连功能验收')
  console.log(`  工作区   ${workspace}`)
  console.log(`  端口     ${args.port}`)
  console.log(`  产物     ${artifactDir}`)

  // 备份需要在收尾时恢复的两份文件。
  const workspaceConfig = join(workspace, '.dsh', 'dshmm', 'mcp.json')
  const backups = {
    workspaceConfig: { path: workspaceConfig, existed: existsSync(workspaceConfig), body: readFileSyncSilently(workspaceConfig) },
    state: { path: STATE_FILE, existed: existsSync(STATE_FILE), body: readFileSyncSilently(STATE_FILE) },
  }
  if (backups.state.existed) {
    const servers = JSON.parse(backups.state.body || '{}').servers ?? []
    if (servers.length > 0) console.log(`  注意     全局层有 ${servers.length} 个服务器，本用例会连带连上它们`)
  }

  const restore = () => {
    for (const item of [backups.workspaceConfig, backups.state]) {
      if (item.existed) writeFileSync(item.path, item.body)
      else rmSync(item.path, { force: true })
    }
  }

  const scenarios = args.only === 'both' ? ['exit', 'hang'] : [args.only]
  const results = []
  let browser
  try {
    if (!args.skipInstall) {
      console.log('\n[0/3] 打包并安装到 profile web（prepack 会跑 tsc + tsdown + verify）')
      execFileSync('node', [INSTALLER, 'install', '--profile', 'web'], { cwd: REPO, stdio: 'inherit' })
    } else {
      console.log('\n[0/3] 跳过安装，使用 profile web 里现有的插件产物')
    }

    console.log('\n[1/3] 启动用例自己的 dsh web')
    const { url, logPath } = await launchDsh(args.port, artifactDir)
    console.log(`      ${url}`)
    console.log(`      日志 ${logPath}`)

    const { chromium } = loadPlaywright()
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const api = (path) => page.evaluate(async (p) => (await fetch(p)).json(), path)

    console.log('\n[2/3] 打开 dsh web，把探活与重试压到秒级')
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    const applied = await page.evaluate(async () => {
      const response = await fetch('/smkit/api/settings/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoReconnect: true,
          healthCheckIntervalMs: 1000,
          reconnectMaxDelayMs: 1000,
          reconnectMaxAttempts: 0,
        }),
      })
      return { status: response.status, body: await response.json() }
    })
    if (applied.status !== 200) throw new Error(`写重连设置失败：${applied.status} ${JSON.stringify(applied.body)}`)
    console.log(`      ${JSON.stringify(applied.body)}`)

    console.log('\n[3/3] 逐场景执行')
    for (const scenario of scenarios) {
      console.log(`\n  ── ${scenario} ──`)
      const evidence = await runScenario({ page, workspace, scenario, artifactDir, api })
      results.push(evidence)
      await page.screenshot({ path: join(artifactDir, `shot-${scenario}.png`) })
    }
  } finally {
    await browser?.close().catch(() => {})
    stopDsh(args.port)
    await sleep(500)
    restore()
    const ok = results.length === scenarios.length && results.every((entry) => entry.ok)
    writeFileSync(join(artifactDir, 'result.json'), `${JSON.stringify({ ok, workspace, port: args.port, results }, null, 2)}\n`)
    console.log(`\n产物：${artifactDir}`)
    console.log(`结果：${ok ? '✓ 通过' : '✗ 失败'}（${results.length}/${scenarios.length} 个场景）`)
    if (!ok) process.exitCode = 1
  }
}
