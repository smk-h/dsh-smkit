#!/usr/bin/env node
/**
 * ssh-stub-mcp — 用来验证「stdio over ssh 掉线后是否会被自动拉起」的一次性 MCP 服务器。
 *
 * 它是给 dsh-smkit 的自动重连（设置 → MCP → 高级 → 自动重连）做端到端验证用的：
 * 经本地回环 ssh 把它当远端 MCP 拉起来，让它过一会儿自己断开，再看插件是否重建连接。
 *
 * 与 `test/auto-reconnect.test.mjs` 的分工：那个用 spawn 直跑子进程、用桩 fetch，
 * 覆盖的是插件内部的重连状态机；本脚本走真实 ssh → sshd → node 三段，额外覆盖
 * 「远端命令结束 → sshd 关会话 → 本地 ssh 退出」这条线上形态完全一致的链路。
 *
 * 两种断开方式，都可以定时自动触发，也可以由工具手动触发：
 *
 *   --mode=exit（默认）  到点后进程自己退出（模拟远端 MCP 崩了 / 被杀）
 *                        → 子进程退出路径：插件侧立刻看到 `stdio process exited`
 *   --mode=hang          到点后不再应答，但进程与 ssh 会话都活着（模拟链路半死）
 *                        → 探活路径：插件下一次探活（tools/list）卡满 60 秒超时后判定掉线
 *
 *   工具 `stub_die` / `stub_hang` 分别手动触发上面两种，便于在对话里精确控制时机。
 *
 * 启动延迟：进程起来后默认**先静默 5 秒**才接 stdin（`--startup-delay=<ms>`，0 关掉），
 * 用来测「远端拉起得慢」这一形态——这段时间里插件的 initialize 没人应答，
 * 正好对着设置页上那条「连接中」看它多久变成就绪 / 是否被超时判定拖死。
 * 延迟不计进 `--lifetime`：lifetime 从**开始服务**那刻算起。
 *
 * 判据：每次启动都往 --log 追加一行 START（带 pid），所以
 *
 *     grep -c START .tmp/ssh-stub.log
 *
 * 就是「被拉起了几次」——大于 1 即说明重连生效，且能看出周期。
 *
 * 日志每行开头是**北京时间**的定宽时间戳（`2026-09-18 10:45:26.096`，UTC+8，
 * 本机无夏令时），照着点表看「隔了多久被拉起来」不用再心算时差。
 *
 * 用法（在 ssh 落地的那台机器上执行，本地回环自测就是本机）：
 *
 *     cd <仓库> && node scripts/ssh-stub-mcp.mjs --lifetime=20000 --log=.tmp/ssh-stub.log
 *     cd <仓库> && node scripts/ssh-stub-mcp.mjs --mode=hang --lifetime=30000 --log=.tmp/ssh-stub.log
 *
 * dsh 侧的 MCP 配置（参数必须写在远端命令里，**不能用 env**：ssh 默认不转发
 * 环境变量，没配 SendEnv/AcceptEnv 时 env 到不了远端）：
 *
 *     {
 *       "name": "ssh-stub",
 *       "type": "stdio",
 *       "command": "ssh",
 *       "args": [
 *         "-i", "~/.ssh/id_ed25519",
 *         "-o", "ServerAliveInterval=60", "-o", "ServerAliveCountMax=3",
 *         "127.0.0.1",
 *         "cd /绝对路径/仓库 && node ./scripts/ssh-stub-mcp.mjs --lifetime=20000 --log=.tmp/ssh-stub.log"
 *       ]
 *     }
 *
 * 末位是**一个整体命令字符串**（ssh 把它交给远端 shell 展开执行），不是多个参数。
 * 开头的 `cd` 有两个作用：`./scripts/…` 与相对 `--log` 都按 cwd 解析，远端 shell
 * 的 cwd 默认是登录目录（家目录），不先锚到仓库根就会出现 `Cannot find module
 * ./scripts/…` 或把日志写到别处。与 `remote-start-mcp.bat` 用 `cd /d "%~dp0"`
 * 锚定项目根是同一个套路。
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = '2025-03-26'

/** 把 `--key=value` / `--flag` 解析成对象（脚本自身够用，不引依赖）。 */
function parseArgv(argv) {
  const out = {}
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg)
    if (match) out[match[1]] = match[2] ?? 'true'
  }
  return out
}

const options = parseArgv(process.argv.slice(2))

if (options.help !== undefined) {
  process.stdout.write(
    [
      'ssh-stub-mcp — 自断线用的 stdio MCP 服务器（验自动重连）',
      '',
      '  --lifetime=<ms>    多久后自动断开（默认 20000；0 表示不自动断开）',
      '                     从开始服务算起，不含下面的启动延迟',
      '  --startup-delay=<ms> 接 stdin 前先静默多久（默认 5000；0 表示立即服务）',
      '                     模拟远端 MCP 拉起慢：initialize 要等这么久才有人应答',
      '  --mode=<exit|hang> 断开方式：exit=进程退出（默认）；hang=只停止应答',
      '  --log=<path>       启动/断开/协议流水写到这里（默认只写 stderr）',
      '                     相对路径按 cwd 解析，父目录不存在会自动创建',
      '                     时间戳为北京时间：2026-09-18 10:45:26.096',
      '  --name=<label>     serverInfo 与每行日志前缀（默认 ssh-stub）——同一份脚本',
      '                     起多个实例时用它区分：--name=node-stub → [node-stub]',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

/** 日志目录不存在就建出来；建不了只提示，不影响被验证的行为本身。 */
function ensureLogDir() {
  if (!LOG_PATH) return
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true })
  } catch (error) {
    try {
      process.stderr.write(
        `${TAG} 无法创建日志目录 ${dirname(LOG_PATH)}: ${error?.message ?? error}\n`,
      )
    } catch {
      // stderr 也不可用就没什么可做的了。
    }
  }
}

const MODE = options.mode === 'hang' ? 'hang' : 'exit'
const LIFETIME_MS = Number(options.lifetime ?? 20_000)
const STARTUP_DELAY_MS = Number(options['startup-delay'] ?? 5_000)
const LOG_PATH = typeof options.log === 'string' ? options.log : ''
const LABEL = typeof options.name === 'string' && options.name ? options.name : 'ssh-stub'

/**
 * 日志行前缀跟着 `--name` 走，而不是写死脚本名：同一份脚本会被拉起成多个实例
 * （本地 node 一条、经 ssh 一条），日志文件各写各的，前缀若都一样就分不清谁是谁。
 */
const TAG = `[${LABEL}]`

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 日志时间戳，北京时间（UTC+8，无夏令时）。
 *
 * 按固定偏移平移后再取 ISO 字段，而不是 `toLocaleString('zh-CN', { timeZone })`：
 * 定宽文本才好排序、好肉眼比对，也不随 ICU 数据或 TZ 环境变量变样子。平移后的
 * UTC 读数正好就是北京时间的墙上时钟，取 `YYYY-MM-DD` 与 `HH:mm:ss.SSS` 两段即可。
 */
function stamp() {
  const iso = new Date(Date.now() + BEIJING_OFFSET_MS).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}`
}

ensureLogDir()

/** 生命周期事件（启动 / 断开 / stdin 结束）：写日志文件，同时写 stderr。
 * stderr 会经 ssh 回到 dsh 的子进程 stderr 管道，插件把它作为断开原因放进
 * 「重连中」那行的 error 里——所以这几行是判断"上一次为什么退出"的直接证据。 */
function logLifecycle(message) {
  const line = `${stamp()} ${TAG} ${message}\n`
  if (LOG_PATH) {
    try {
      appendFileSync(LOG_PATH, line)
    } catch {
      // 日志写不了不影响被验证的行为本身。
    }
  }
  try {
    process.stderr.write(line)
  } catch {
    // stderr 管道已断（客户端掉线），忽略。
  }
}

/** 协议流水：只写日志文件，避免把 stderr 那点尾部空间冲掉。 */
function trace(message) {
  if (!LOG_PATH) return
  try {
    appendFileSync(LOG_PATH, `${stamp()} ${TAG} ${message}\n`)
  } catch {
    // 同上。
  }
}

let hanging = false
let exitStarted = false

/** 结束进程：先把 stdout 里排队的响应刷出去再退出。
 * 管道写是异步的，直接 process.exit() 会把还没发完的响应截断。 */
function exitSoon(reason) {
  if (exitStarted) return
  exitStarted = true
  logLifecycle(`self-exit: ${reason}`)
  process.stdout.write('', () => process.exit(0))
  // 兜底：stdout 已关闭等情况下空写回调可能不触发，不能把进程吊死在这里。
  setTimeout(() => process.exit(0), 200)
}

/** 停止应答但保持进程与 ssh 会话存活（模拟链路半死）。 */
function setHanging(reason) {
  if (hanging) return
  hanging = true
  logLifecycle(
    `now hanging: ${reason}; 进程与 ssh 会话保持存活，等插件的探活请求卡满超时`,
  )
}

const TOOLS = [
  {
    name: 'stub_echo',
    description: '回显一段文字，用来确认这条连接是通的（也可当作 keepalive 调用）',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '要回显的文字' } },
      required: [],
    },
  },
  {
    name: 'stub_die',
    description:
      '让本服务器进程立即退出，模拟远端 MCP 崩掉 → 插件应走「子进程退出」路径并自动重连',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'stub_hang',
    description:
      '让本服务器停止应答但保持进程存活，模拟链路半死 → 插件应靠探活发现并自动重连',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
]

function textResult(text) {
  return { content: [{ type: 'text', text }] }
}

function reply(id, result) {
  if (hanging) {
    trace(`dropped reply to request #${id} (hanging)`)
    return
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function handle(message) {
  // 通知（无 id）只记流水：initialize 之后的 notifications/initialized 就是一条。
  if (message.id === undefined) {
    trace(`notification ${message.method}`)
    return
  }
  trace(`request ${message.method} (#${message.id})`)
  switch (message.method) {
    case 'initialize':
      reply(message.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: LABEL, version: '1' },
      })
      return
    case 'tools/list':
      reply(message.id, { tools: TOOLS })
      return
    case 'tools/call': {
      const name = message.params?.name
      const text = message.params?.arguments?.text
      if (name === 'stub_die') {
        reply(message.id, textResult(`bye — ${LABEL} 即将退出（模拟远端进程死掉）`))
        exitSoon(`stub_die called (mode 无关，手动触发)`)
        return
      }
      if (name === 'stub_hang') {
        reply(
          message.id,
          textResult(
            `ok — ${LABEL} 从现在起不再应答（模拟链路半死）；探活卡满超时后插件会判定掉线`,
          ),
        )
        setHanging('stub_hang called')
        return
      }
      reply(message.id, textResult(`echo: ${text ?? '(no text)'} pid=${process.pid}`))
      return
    }
    default:
      // ping 以及其它可选请求：回一个空结果，够协议跑通。
      reply(message.id, {})
  }
}

const startupDelay = Number.isFinite(STARTUP_DELAY_MS) && STARTUP_DELAY_MS > 0 ? STARTUP_DELAY_MS : 0

logLifecycle(
  `===== START pid=${process.pid} mode=${MODE} ` +
    `startup-delay=${startupDelay > 0 ? `${startupDelay}ms` : 'none'} ` +
    `lifetime=${LIFETIME_MS > 0 ? `${LIFETIME_MS}ms` : 'none'} ` +
    `log=${LOG_PATH || '(stderr only)'} argv="${process.argv.slice(2).join(' ')}" =====`,
)

/**
 * 开始服务：接 stdin，并起 lifetime 计时。
 *
 * 启动延迟到点前不调用它，这段时间里 readline 还没建、stdin 一个字节都不读，
 * 客户端发来的 `initialize` 就留在管道里没人应答——这正是"远端拉起慢"的形态。
 * lifetime 也从这一刻算起，所以 `--startup-delay=5000 --lifetime=20000` 是
 * "静默 5 秒、再服务 20 秒"，总共 25 秒后断开。
 */
function serve() {
  if (startupDelay > 0) logLifecycle(`serving (startup delay ${startupDelay}ms elapsed)`)

  const lifetime = Number.isFinite(LIFETIME_MS) && LIFETIME_MS > 0 ? LIFETIME_MS : 0
  if (lifetime > 0) {
    setTimeout(() => {
      if (MODE === 'hang') setHanging(`lifetime ${lifetime}ms elapsed (mode=hang)`)
      else exitSoon(`lifetime ${lifetime}ms elapsed (mode=exit)`)
    }, lifetime)
  }

  const lines = createInterface({ input: process.stdin })

  lines.on('line', (line) => {
    const text = line.trim()
    if (!text) return
    let message
    try {
      message = JSON.parse(text)
    } catch {
      trace(`ignored non-JSON line: ${text.slice(0, 80)}`)
      return
    }
    handle(message)
  })

  // stdin 被关掉 = 客户端（ssh 会话）已经没了，自己也该走：留着只会变成孤儿进程，
  // 占着串口/日志不放。这正是"重连不会堆积进程"的那一环。
  lines.on('close', () => {
    logLifecycle('stdin end (client disconnected)')
    process.exit(0)
  })
}

if (startupDelay > 0) setTimeout(serve, startupDelay)
else serve()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => exitSoon(`${signal} received`))
}
