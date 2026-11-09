#!/usr/bin/env node
/**
 * LV007 的执行脚本 —— 用例文档在 [LV007-MCP影子桩.md](./LV007-MCP影子桩.md)。
 *
 * 验的是「按需 MCP 工具调用」在**不支持延迟加载**的模型路由上到底把什么发给了
 * 模型。做法是把 profile 的 provider 临时指到本仓库的旁路代理
 * （[`llm-capture-proxy.mjs`](./llm-capture-proxy.mjs)），由代理记录每次请求里的
 * MCP 工具条目，再对着记录判定：
 *
 *   off  关掉按需代理 → 请求里是完整定义（对照组）
 *   on   打开按需代理 → 第一轮仍是完整定义（判定发生在装配时），第二轮起换成短桩
 *
 * 同时验两个容易漏的伴生行为：`/mcp help` 仍给出真实参数表（目录读连接记录），
 * 以及 `/mcp call` 仍能执行（短桩保留了 executor）。
 *
 * ## 用法
 *
 *     pnpm test:cases:shadow
 *     pnpm test:cases:shadow --skip-install
 *     node test/cases/mcp-shadow-stubs.mjs --workspace <已注册工作区路径>
 *
 *   --workspace   要在里面跑用例的 dsh 工作区；缺省取注册表里第一个
 *   --port        自己起的 dsh web 端口，默认 3099（不碰你正在用的实例）
 *   --proxy-port  旁路代理端口，默认 8898
 *   --only        off | on | both（默认 both）
 *   --skip-install 不重新打包安装本插件，直接用 profile 里现有产物
 *
 * ## 被 `node --test` 发现时
 *
 * 本脚本需要真 dsh、真 provider 配置与浏览器，混进单元套件是灾难，所以入口处
 * 判断「是不是被测试 runner 拉起来的」，是就什么都不做。
 */

import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const INSTALLER = join(REPO, 'scripts', 'dsh-smkit.mjs')
const KILL_PORT = join(REPO, 'scripts', 'kill-port.mjs')
const PROXY = join(HERE, 'llm-capture-proxy.mjs')
const RICH_MCP = join(REPO, 'scripts', 'rich-mcp.mjs')
const HOME = homedir()
const STATE_FILE = join(HOME, '.dsh', 'mcp-manager.json')
const WORKSPACE_STORE = join(HOME, '.dsh', 'storages', 'workspace.json')

const RICH_TOOLS = ['mcp__rich__serial_exec', 'mcp__rich__serial_shell_open', 'mcp__rich__board_control']

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
    console.error(`\n✗ LV007 失败：${error?.message ?? error}`)
    process.exit(1)
  })
}

function parseArgs(argv) {
  const args = { workspace: '', profile: 'web', port: 3099, proxyPort: 8898, skipInstall: false, only: 'both' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--workspace') args.workspace = argv[++i] ?? ''
    else if (arg === '--profile') args.profile = argv[++i] ?? 'web'
    else if (arg === '--port') args.port = Number(argv[++i] ?? 3099)
    else if (arg === '--proxy-port') args.proxyPort = Number(argv[++i] ?? 8898)
    else if (arg === '--only') args.only = argv[++i] ?? 'both'
    else if (arg === '--skip-install') args.skipInstall = true
    else if (arg === '--help' || arg === '-h') {
      console.log('用法：node test/cases/mcp-shadow-stubs.mjs [--workspace <路径>] [--profile web] [--port 3099] [--proxy-port 8898] [--only off|on|both] [--skip-install]')
      process.exit(0)
    } else throw new Error(`未知参数 ${arg}`)
  }
  if (!['off', 'on', 'both'].includes(args.only)) throw new Error(`--only 只能是 off / on / both，收到 ${args.only}`)
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error(`--port 非法：${args.port}`)
  if (!Number.isInteger(args.proxyPort) || args.proxyPort < 1 || args.proxyPort > 65535) throw new Error(`--proxy-port 非法：${args.proxyPort}`)
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

function stopPort(port) {
  try {
    execFileSync('node', [KILL_PORT, String(port), '--yes'], { cwd: REPO, stdio: 'ignore' })
  } catch {
    // 端口上本来就没有进程。
  }
}

/** 起旁路代理，返回停止函数。 */
async function startProxy(port, upstream, logPath) {
  execFileSync('node', [KILL_PORT, String(port), '--yes'], { cwd: REPO, stdio: 'ignore' })
  writeFileSync(logPath, '')
  const child = spawn('node', [PROXY], {
    cwd: REPO,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, LV007_PORT: String(port), LV007_UPSTREAM: upstream, LV007_LOG: logPath },
  })
  child.unref()
  // 代理起来之前 dsh 就发请求会直接连不上，先等它监听起来。
  const deadline = Date.now() + 15000
  for (;;) {
    try {
      execFileSync('node', ['-e', `require('node:net').connect(${port},'127.0.0.1').end()`], { stdio: 'ignore' })
      return () => stopPort(port)
    } catch {
      if (Date.now() > deadline) throw new Error(`旁路代理没有在 ${deadline} 之前监听 ${port}`)
      await sleep(200)
    }
  }
}

/**
 * 把 profile 的 provider 指到旁路代理。
 *
 * 读的是 `cordis.patch.yml` 里的 `baseURL:`；把主机换成本地代理、路径原样保留，
 * 这样 provider 适配器拼出来的请求路径不用改。返回原值与还原函数。
 */
function redirectProvider(profileDir, proxyPort) {
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const body = readFileSyncSilently(patchPath)
  const match = /^(\s*baseURL:\s*)(["']?)(\S+)\2\s*$/m.exec(body)
  if (!match) throw new Error(`没在 ${patchPath} 里找到 baseURL，无法把 provider 指向旁路代理`)
  const original = match[3]
  const url = new URL(original)
  const redirected = `http://127.0.0.1:${proxyPort}${url.pathname}`
  writeFileSync(patchPath, body.replace(match[0], `${match[1]}${redirected}`))
  return {
    upstream: `${url.origin}${url.pathname}`,
    restore: () => writeFileSync(patchPath, body),
  }
}

/** 写工作区的 mcp.json（只放一个富参数测试服务器）；返回恢复函数。 */
function installRichServer(workspace) {
  const configPath = join(workspace, '.dsh', 'dshmm', 'mcp.json')
  const created = !existsSync(configPath)
  const backup = readFileSyncSilently(configPath)
  const entry = {
    mcpServers: {
      rich: { type: 'stdio', command: 'node', args: [RICH_MCP], env: {} },
    },
  }
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(entry, null, 2)}\n`)
  return () => {
    if (!created) {
      writeFileSync(configPath, backup)
      return
    }
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

/** 抓包日志 → 每次请求里 MCP 工具的读数。 */
function readCaptures(logPath) {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => Array.isArray(entry.mcp) && entry.mcp.length > 0)
    .map((entry) => {
      const tools = entry.mcp.map((tool) => ({
        name: String(tool.function?.name ?? tool.name),
        description: String(tool.function?.description ?? ''),
        properties: Object.keys(tool.function?.parameters?.properties ?? {}).length,
        bytes: JSON.stringify(tool).length,
      }))
      return { at: entry.at, tools, rich: tools.filter((tool) => tool.name.startsWith('mcp__rich__')) }
    })
    .filter((entry) => entry.rich.length > 0)
}

/**
 * 等这一刻的 turn 收尾。
 *
 * 界面在生成中会把「发送」换成停止态，所以「发送按钮回来」就是空闲信号；
 * 发完就先等 1.5 秒再开始轮询，避免抢在界面切到 running 之前判空。
 */
async function waitForIdle(page, timeoutMs = 120000) {
  await page.waitForTimeout(1500)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const send = await page.locator('[aria-label="Send message"], [aria-label="发送消息"]').count()
    if (send > 0) return true
    if (Date.now() > deadline) return false
    await page.waitForTimeout(400)
  }
}

/** 在页面里发一条输入（对话或 `/mcp` 命令），并等它跑完。 */
async function sendTurn(page, text) {
  await waitForIdle(page)
  const composer = page.locator('div[contenteditable="true"]').last()
  await composer.click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  const idle = await waitForIdle(page)
  if (!idle) console.log('   注意：等待空闲超时，继续按现状判定')
  await page.waitForTimeout(500)
}

async function openSession(page, workspace) {
  const title = basename(workspace)
  const label = page.getByText(title, { exact: true }).first()
  await label.hover()
  await page.waitForTimeout(300)
  await page.locator(`[aria-label="New session in ${title}"]`).first().click({ force: true })
  await page.waitForTimeout(4000)
}

/** 跑一个场景：起 dsh → 两轮对话（可选 help/call）→ 收尾。 */
async function runScenario({ scenario, args, workspace, artifactDir, browser, proxyUpstream }) {
  const logPath = join(artifactDir, `dsh-web-${scenario}.log`)
  const capturePath = join(artifactDir, `capture-${scenario}.jsonl`)
  const shotDir = join(artifactDir, scenario)
  mkdirSync(shotDir, { recursive: true })

  const stopProxy = await startProxy(args.proxyPort, proxyUpstream, capturePath)
  const evidence = { scenario, capturePath, steps: [] }
  const step = (text, detail = '') => {
    evidence.steps.push({ text, detail })
    console.log(`   ${text}${detail ? ` — ${detail}` : ''}`)
  }

  try {
    const tokenUrl = await launchDsh(args.port, logPath)
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(tokenUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3500)
    await openSession(page, workspace)
    step('打开会话', workspace)

    await sendTurn(page, 'hi')
    await page.screenshot({ path: join(shotDir, 'turn1.png') })
    step('第一轮对话已完成')

    await sendTurn(page, 'say ok')
    await page.screenshot({ path: join(shotDir, 'turn2.png') })
    step('第二轮对话已完成')

    if (scenario === 'on') {
      await sendTurn(page, '/mcp help mcp__rich__serial_exec')
      await page.mouse.wheel(0, 2500)
      await page.waitForTimeout(600)
      const helpText = await page.locator('body').innerText()
      evidence.helpText = helpText
      await page.screenshot({ path: join(shotDir, 'help.png') })
      step('/mcp help 已执行', helpText.includes('max_bytes') ? '含真实参数 max_bytes' : '未看到真实参数')

      await sendTurn(page, '/mcp call mcp__rich__serial_exec {"session_id":"ses-1","cmd":"ls"}')
      const callText = await page.locator('body').innerText()
      evidence.callText = callText
      await page.screenshot({ path: join(shotDir, 'call.png') })
      step('/mcp call 已执行', callText.includes('accepted') ? '工具返回 accepted' : '未见工具输出')
    }

    await page.close()
    stopPort(args.port)
    // 关掉 dsh 之后代理不会再有请求，读到的就是这一场的全部。
    evidence.captures = readCaptures(capturePath)
    step('抓到的请求', `${evidence.captures.length} 次含 MCP 工具`)
    return evidence
  } finally {
    stopPort(args.port)
    stopProxy()
  }
}

async function main(args) {
  const workspace = resolveWorkspace(args.workspace)
  const profileDir = join(HOME, '.dsh', 'profiles', args.profile)
  if (!existsSync(join(profileDir, 'cordis.patch.yml'))) throw new Error(`profile 里没有 cordis.patch.yml：${profileDir}`)
  const artifactDir = join(REPO, '.tmp', 'test-cases', 'LV007', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(artifactDir, { recursive: true })

  console.log('LV007 — 按需 MCP 影子桩功能验收')
  console.log(`  工作区  ${workspace}`)
  console.log(`  端口    ${args.port}（代理 ${args.proxyPort}）`)
  console.log(`  产物    ${artifactDir}`)

  const backups = {
    state: { path: STATE_FILE, existed: existsSync(STATE_FILE), body: readFileSyncSilently(STATE_FILE) },
  }
  const restoreState = () => {
    if (backups.state.existed) writeFileSync(backups.state.path, backups.state.body)
    else rmSync(backups.state.path, { force: true })
  }
  if (backups.state.existed) {
    const servers = JSON.parse(backups.state.body || '{}').servers ?? []
    if (servers.length > 0) console.log(`  注意    全局层有 ${servers.length} 个服务器，用例期间会被临时清空，收尾恢复`)
  }
  const writeState = (onDemand) => {
    writeFileSync(STATE_FILE, `${JSON.stringify({ servers: [], workspaceTokens: {}, onDemandToolInjection: onDemand, autoReconnect: true, healthCheckIntervalMs: 1000 })}\n`)
  }

  let browser
  let redirect
  let restoreWorkspace
  const results = []
  try {
    if (!args.skipInstall) {
      console.log('\n[准备] 打包并安装当前代码')
      execFileSync('node', [INSTALLER, 'install', '--profile', args.profile], { cwd: REPO, stdio: 'inherit' })
    }
    redirect = redirectProvider(profileDir, args.proxyPort)
    console.log(`[准备] provider → 旁路代理（原 ${redirect.upstream}）`)
    restoreWorkspace = installRichServer(workspace)

    const { chromium } = loadPlaywright()
    browser = await chromium.launch()

    const only = args.only
    if (only !== 'on') {
    console.log('\n[场景 A] 关闭按需代理：请求里应是完整定义')
    writeState(false)
    const off = await runScenario({ scenario: 'off', args, workspace, artifactDir, browser, proxyUpstream: redirect.upstream })
    const offFull = off.captures.every((entry) => entry.rich.every((tool) => tool.properties > 0))
    const offBytes = off.captures.at(-1)?.rich.reduce((sum, tool) => sum + tool.bytes, 0) ?? 0
    results.push({
      scenario: 'off',
      checks: [
        ['抓到了请求', off.captures.length > 0],
        ['每个 MCP 工具都带完整参数', offFull],
      ],
      offBytes,
      ok: off.captures.length > 0 && offFull,
    })
    }

    if (only !== 'off') {
    console.log('\n[场景 B] 打开按需代理：第二轮起应换成短桩')
    writeState(true)
    const on = await runScenario({ scenario: 'on', args, workspace, artifactDir, browser, proxyUpstream: redirect.upstream })
    const first = on.captures[0]
    const last = on.captures.at(-1)
    const stubTools = last?.rich ?? []
    const fullTools = first?.rich ?? []
    const onBytes = stubTools.reduce((sum, tool) => sum + tool.bytes, 0)
    const fullBytes = fullTools.reduce((sum, tool) => sum + tool.bytes, 0)
    const brokerNames = (last?.tools ?? []).map((tool) => tool.name)
    const helpText = on.helpText ?? ''
    const callText = on.callText ?? ''

    const checks = [
      ['第一轮仍是完整定义（判定发生在装配时）', fullTools.length === 3 && fullTools.every((tool) => tool.properties > 0)],
      ['最后一轮三个工具都换成短桩', stubTools.length === 3 && stubTools.every((tool) => tool.properties === 0)],
      [`短桩描述不超过 160 字（最长 ${Math.max(0, ...stubTools.map((tool) => tool.description.length))}）`, stubTools.every((tool) => tool.description.length <= 160)],
      ['短桩描述指向 describe/execute', stubTools.every((tool) => /mcp_describe_tool/.test(tool.description))],
      ['请求里同时有 broker 三工具', ['mcp_search_tools', 'mcp_describe_tool', 'mcp_execute_tool'].every((name) => brokerNames.includes(name))],
      [`短桩体积小于全量的 50%（${onBytes} vs ${fullBytes} 字节）`, fullBytes > 0 && onBytes < fullBytes * 0.5],
      ['/mcp help 仍给出真实参数表', /max_bytes/.test(helpText)],
      ['/mcp call 仍能执行', /accepted/.test(callText)],
    ]
    results.push({ scenario: 'on', checks, onBytes, fullBytes, ok: checks.every(([, ok]) => ok) })
    }

    for (const entry of results) {
      console.log(`\n   场景 ${entry.scenario}：`)
      for (const [text, ok] of entry.checks) console.log(`   ${ok ? '✓' : '✗'} ${text}`)
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    stopPort(args.port)
    restoreWorkspace?.()
    redirect?.restore()
    restoreState()
    console.log('\n[收尾] 已恢复 provider 配置、工作区 mcp.json 与状态文件')
  }

  const expected = args.only === 'both' ? 2 : 1
  const ok = results.length === expected && results.every((entry) => entry.ok)
  writeFileSync(join(artifactDir, 'result.json'), `${JSON.stringify({ at: new Date().toISOString(), workspace, ok, results }, null, 2)}\n`)
  console.log(`\n========== 结果 ==========`)
  for (const entry of results) console.log(`  场景 ${entry.scenario}：${entry.ok ? '通过' : '未通过'}`)
  console.log(`  产物：${artifactDir}`)
  if (!ok) throw new Error('至少一条判据未通过')
}
