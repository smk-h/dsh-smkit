#!/usr/bin/env node
/**
 * http-mcp-cli — 本地测试用 http-mcp 实例的起停命令。
 *
 *   pnpm http-mcp:serve [<模式>[,<模式>...]]   起实例（前台，Ctrl+C 全部结束）
 *   pnpm http-mcp:stop  [<模式>[,<模式>...]]   收实例（按端口，手工起的也覆盖）
 *   pnpm http-mcp:serve --help
 *
 * 为什么起和收在同一个文件：两者共用下面这份端口表，且在同一个进程视角里才方便
 * 做「服务在跑、插件却 fetch failed」那种端口写岔的核对；分成两个文件时，用法
 * 输出还得带一个只用来区分调用方的参数，反而不如合并省事。
 *
 * 服务本体仍是独立的 `http-mcp.mjs`：那是单实例、可以脱离本文件直接运行的 MCP。
 *
 * 工作区配置 `.dsh/dshmm/mcp.json` 里的 `http-mcp-*` 是 http 类型：插件只往
 * `url` 发 HTTP 请求，**不会**替你把进程拉起来（只有 stdio 类型才由插件
 * spawn），所以这几条在测之前必须自己先跑起来。
 *
 * 静态令牌那条要求 dsh 进程里有 `MCP_HTTP_TOKEN=test-token`（插件只存环境变量
 * 名，不存令牌本身）。本脚本读的是自己的环境，只能提醒、不能代劳——那个变量
 * 必须设在启动 dsh 的那个环境里。
 */

import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = '[http-mcp-cli]'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = path.join(ROOT, 'scripts', 'http-mcp.mjs')
const KILL_PORT = path.join(ROOT, 'scripts', 'kill-port.mjs')

// 插件侧的工作区配置文件（源码里的 WORKSPACE_CONFIG_REL）。这里不复用 src 的
// 常量：脚本要能在没构建 lib/ 的情况下直接跑，所以只读这个文件做一致性核对。
const WORKSPACE_CONFIG = path.join(ROOT, '.dsh', 'dshmm', 'mcp.json')

/** static 实例期望的令牌值。插件只存环境变量名，值由 dsh 进程的环境提供。 */
const STATIC_TOKEN = 'test-token'

// 端口只在两处出现——这里，和 `.dsh/dshmm/mcp.json`。插件只按 url 发请求，端口
// 写岔一个数字就会表现成「服务明明在跑，却一直 fetch failed」，改动必须同步。
//
// `name` 刻意与 mcp.json 里的条目名逐字相同：http-mcp 把 `--name` 用作日志前缀
// 与 serverInfo.name，于是终端里的 `[http-mcp-oauth …]` 一眼就能对上设置页里
// 那一行。
const PRESETS = [
  {
    mode: 'none',
    name: 'http-mcp-none',
    port: 8791,
    args: ['--auth=none', '--tools=5', '--list-changed'],
    auth: '鉴权选「无鉴权」',
  },
  {
    mode: 'static',
    name: 'http-mcp-static',
    port: 8792,
    args: ['--auth=static', `--token=${STATIC_TOKEN}`],
    auth: `鉴权选「静态令牌」，tokenEnv = MCP_HTTP_TOKEN，值 ${STATIC_TOKEN}`,
  },
  {
    mode: 'oauth',
    name: 'http-mcp-oauth',
    port: 8793,
    args: ['--auth=oauth'],
    auth: '鉴权选「OAuth」，点「去认证」后在同意页点同意',
  },
]

/** 实例在设置页里对应的 URL。 */
const urlOf = (preset) => `http://127.0.0.1:${preset.port}/mcp`

function usageLines() {
  return [
    '用法：pnpm http-mcp:serve [<模式>[,<模式>...]]   起实例（前台，Ctrl+C 全部结束）',
    '      pnpm http-mcp:stop  [<模式>[,<模式>...]]   收实例（按端口，手工起的也覆盖）',
    '      <模式> 取 none | static | oauth，省略则三个都要',
    '',
    ...PRESETS.map((preset) => `      ${preset.mode.padEnd(7)} ${urlOf(preset).padEnd(28)} ${preset.auth}`),
  ]
}

/** 解析位置参数。未知模式不回退到「全部」，而是报错退出——手滑不该起错东西。 */
function selectPresets(argv, command) {
  const first = argv.find((arg) => !arg.startsWith('-'))
  const modes = first ? first.split(',').map((mode) => mode.trim()).filter(Boolean) : []
  const wanted = modes.length > 0 ? modes : PRESETS.map((preset) => preset.mode)
  const unknown = wanted.filter((mode) => !PRESETS.some((preset) => preset.mode === mode))
  if (unknown.length > 0) {
    console.log(`http-mcp:${command}: 未知的模式 ${unknown.join(', ')}`)
    console.log(usageLines().join('\n'))
    process.exit(1)
  }
  return PRESETS.filter((preset) => wanted.includes(preset.mode))
}

// ---------- serve ----------

/** 读工作区配置里所有 http 条目，只用于启动后的核对提醒；读不到返回 null。 */
function configuredHttpServers() {
  try {
    const raw = JSON.parse(readFileSync(WORKSPACE_CONFIG, 'utf8'))
    const servers = raw?.mcpServers
    if (!servers || typeof servers !== 'object') return []
    return Object.entries(servers)
      .filter(([, cfg]) => cfg?.type === 'http' && typeof cfg?.url === 'string')
      .map(([name, cfg]) => ({ name, url: cfg.url }))
  } catch {
    return null
  }
}

/** 端口/模式两边写岔是最难查的一类问题（服务在跑，插件却一直 fetch failed）。 */
function reportConfigDrift(selected) {
  const configured = configuredHttpServers()
  if (configured === null) {
    console.log(`${TAG} 未读到 ${path.relative(ROOT, WORKSPACE_CONFIG)}，跳过核对`)
    return
  }
  const configuredUrls = new Set(configured.map((entry) => entry.url))
  const startedUrls = new Set(selected.map(urlOf))

  const notConfigured = selected.filter((preset) => !configuredUrls.has(urlOf(preset)))
  if (notConfigured.length > 0) {
    console.log(`${TAG} 注意：${notConfigured.map(urlOf).join('、')} 不在工作区配置里，插件不会去连`)
  }
  const notServed = configured.filter((entry) => !startedUrls.has(entry.url))
  if (notServed.length > 0) {
    console.log(
      `${TAG} 注意：配置里的 ${notServed
        .map((entry) => `${entry.name}(${entry.url})`)
        .join('、')} 这次没有实例，那几行会显示连接失败`,
    )
  }
}

function serve(selected) {
  // 子进程的 stdout/stderr 直接继承：http-mcp 每个请求打一行日志，交错的输出靠
  // 它自己的 --name 前缀区分，比在这里再包一层前缀更省事，也不会漏掉颜色。
  let shuttingDown = false
  const running = new Map()

  function start(preset) {
    const child = spawn(
      process.execPath,
      [SERVER, `--name=${preset.name}`, `--port=${preset.port}`, ...preset.args],
      { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
    )
    running.set(child, preset)
    child.on('error', (error) => {
      console.log(`${TAG} ${preset.name} 拉起失败：${error.message}`)
    })
    child.on('exit', (code, signal) => {
      running.delete(child)
      console.log(`${TAG} ${preset.name} 已退出（${signal ?? `code ${code}`}）`)
      // 全都没了就别再挂着——比如三个端口都被占，用户看到的应该是一条命令直接结束。
      if (running.size === 0 && !shuttingDown) {
        console.log(`${TAG} 所有实例都已退出`)
        process.exit(0)
      }
    })
  }

  // 子进程与本进程同在一个进程组，终端 Ctrl+C 本就会同时送到它们；这里再显式收
  // 一遍是为了覆盖 SIGTERM（比如被别的脚本 kill）与前台被抢占的情况。
  function shutdown() {
    if (shuttingDown) return
    shuttingDown = true
    for (const child of running.keys()) child.kill()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  for (const preset of selected) start(preset)

  console.log(`${TAG} 已启动 ${selected.length} 个实例（Ctrl+C 或 pnpm http-mcp:stop 结束）`)
  for (const preset of selected) {
    console.log(`${TAG}   ${preset.name.padEnd(16)} ${urlOf(preset).padEnd(28)} ${preset.auth}`)
  }
  if (selected.some((preset) => preset.mode === 'static')) {
    const token = process.env.MCP_HTTP_TOKEN
    if (token !== STATIC_TOKEN) {
      console.log(
        `${TAG} 提醒：static 实例期望 MCP_HTTP_TOKEN=${STATIC_TOKEN}，当前${
          token === undefined ? '未设置' : '值不匹配'
        }。该变量要设在 dsh 进程的环境里，脚本这里读到也没用`,
      )
    }
  }
  reportConfigDrift(selected)
}

// ---------- stop ----------

function stop(selected) {
  let failed = 0
  for (const preset of selected) {
    console.log(`${TAG} 收 ${preset.name}（端口 ${preset.port}，${urlOf(preset)}）`)
    // 按端口收而不是按 PID：实例可能来自本脚本，也可能是手敲 http-mcp.mjs 起的、
    // 或某个终端关掉后留下的残留，只有按端口三种才都覆盖得到。复用 kill-port，
    // 它会先列出占用该端口的 PID 与命令行再动手，不会闷头杀掉别的东西。
    const result = spawnSync(process.execPath, [KILL_PORT, String(preset.port), '--yes'], {
      cwd: ROOT,
      stdio: 'inherit',
    })
    if (result.status !== 0) failed += 1
  }
  // 每个端口的结果已由 kill-port 打印（「已终止 PID x」或「没有监听进程」），
  // 这里只在有失败时补一句，便于脚本化时看退出码。
  if (failed > 0) console.log(`${TAG} 有 ${failed} 个端口没能收干净`)
  process.exit(failed > 0 ? 1 : 0)
}

// ---------- 入口 ----------

const argv = process.argv.slice(2)
const command = argv[0]?.startsWith('-') ? undefined : argv[0]

// --help 要在派发之前拦下：`pnpm http-mcp:serve --help` 会被展开成
// `serve --help`，若只在「命令不认识」的分支里处理，它就会被当成模式参数漏过去，
// 命令一执行就把实例真的起起来了。
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(usageLines().join('\n'))
  process.exit(0)
}

if (command !== 'serve' && command !== 'stop') {
  if (command) console.log(`http-mcp-cli: 未知的命令 ${command}`)
  console.log(usageLines().join('\n'))
  process.exit(1)
}

const selected = selectPresets(argv.slice(1), command)
if (command === 'serve') serve(selected)
else stop(selected)
