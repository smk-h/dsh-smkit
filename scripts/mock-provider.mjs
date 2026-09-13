#!/usr/bin/env node
/**
 * mock-provider — 一个「每次都回同一个状态」的假 provider，用来验证 dsh 的重试配置。
 *
 *   pnpm mock-provider [选项]         起假 provider（前台，Ctrl+C 结束）
 *   pnpm mock-provider --help
 *
 * 它只做三件事：对**任意方法、任意路径**一律回同一个状态码（默认 429）；每收到一个
 * 请求打印一行（行首是自启动以来的序号，数重试次数一眼可见）；启动时打印一段可直接
 * 粘贴的 settings.yaml 片段。重试是 dsh 那一侧的事，次数由该路由的
 * `retryPolicy.maxRetries` 决定——本脚本不数次数、不设上限，来几次就打几行。
 *
 * 为什么默认是 429：dsh 的默认重试策略只认 EMPTY_RESPONSE / RATE_LIMIT / SERVER /
 * TIMEOUT / TRANSPORT 这五个 code，而 429 在两条适配器路径上都映射成 RATE_LIMIT
 * （`llm-deepseek` 按状态码，`llm-pi-ai` 按错误文本），所以默认**不用改 dsh 任何配置**
 * 就能看到重试。反过来，409 既不是 5xx 也不是 429：
 *   - `llm-deepseek` 按状态码映射（packages/llm/llm-deepseek/src/adapter.ts），409 → `HTTP_409`；
 *   - `llm-pi-ai` 按错误文本分类（packages/llm/llm-pi-ai/src/stream.ts），不含 429/5xx
 *     线索的 409 → `PI_AI_ERROR`。
 * 两者都不在默认集合里，现象就是「一次都不重试、直接本轮失败」。所以要严格回 409
 * （`--status 409`），得把对应 code 加进该路由的 `retryableCodes` 或改用
 * `mode: always`——启动时会按你选的状态码提示该改哪几行。
 */

import http from 'node:http'

const TAG = '[mock-provider]'

/** 每个状态码配一句可读文案，写进响应体也写进日志。 */
const STATUS_TEXT = {
  409: '服务器繁忙，请稍后重试',
  429: '请求过于频繁，请稍后重试',
  500: '服务内部错误',
  503: '服务暂时不可用',
}

/**
 * 可配置项：命令行旗标、配置键、类型与取值范围。
 *
 * 状态码限制在 400..599：这个脚本就是用来模拟失败的，2xx/3xx 会让它变成别的东西。
 */
const OPTIONS = [
  { flag: 'port', key: 'port', kind: 'integer', min: 1, max: 65_535, hint: '监听端口（默认 8799）' },
  {
    flag: 'status',
    key: 'status',
    kind: 'integer',
    min: 400,
    max: 599,
    hint: '每次请求返回的状态码（默认 429，默认策略即可重试；409 需自己加 retryableCodes）',
  },
]

const DEFAULTS = { port: 8799, status: 429 }

function usageLines() {
  return [
    '用法：pnpm mock-provider [选项]      起假 provider（任意方法、任意路径都回同一状态码）',
    '',
    '选项：',
    ...OPTIONS.map((option) => `      --${option.flag.padEnd(10)} ${option.hint}`),
    '',
    '例：',
    '      pnpm mock-provider                         起 429 假 provider（默认端口 8799）',
    '      pnpm mock-provider --status 409            严格按 409 语义（需在路由里加 retryableCodes）',
    '      pnpm mock-provider --port 8800             换个端口',
    '',
    '重试次数由 dsh 的 retryPolicy.maxRetries 决定：本脚本不数次数、不设上限，',
    '每来一个请求打一行，数它有几行就是 dsh 发了几次。',
  ]
}

/** 读一个数字取值并校验范围；不合法直接抛，由入口统一报错退出。 */
function readNumber(option, raw) {
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value)) {
    throw new Error(`--${option.flag} 需要整数，收到 ${JSON.stringify(raw)}`)
  }
  if (value < option.min || value > option.max) {
    throw new Error(`--${option.flag} 必须在 ${option.min} 到 ${option.max} 之间，收到 ${value}`)
  }
  return value
}

/** 解析 `--key value` / `--key=value`。未知参数报错而不是忽略：手滑不该起错东西。 */
function parseArgs(argv) {
  const config = { ...DEFAULTS }
  const byFlag = new Map(OPTIONS.map((option) => [option.flag, option]))
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) throw new Error(`无法识别的参数 ${arg}（选项都以 -- 开头）`)
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    const option = byFlag.get(flag)
    if (option === undefined) throw new Error(`无法识别的选项 --${flag}`)
    let raw = eq === -1 ? undefined : arg.slice(eq + 1)
    if (raw === undefined) {
      index += 1
      raw = argv[index]
    }
    if (raw === undefined) throw new Error(`--${flag} 缺少取值`)
    config[option.key] = readNumber(option, raw)
  }
  return config
}

/**
 * 该状态码在**默认**重试策略下会不会被重试：429 → RATE_LIMIT、5xx → SERVER，两条
 * 适配器路径都是这个结果（`llm-deepseek` 看状态码，`llm-pi-ai` 看文本，而文本里带着
 * 状态码本身）。其余 4xx 一律落到各自「不可重试」的那一类。
 */
const retriedByDefault = (status) => status === 429 || status >= 500

/** 启动时打印可粘贴的 dsh 配置：少了这段，用户就得自己拼 baseURL 与 retryableCodes。 */
function reportRecipe(config) {
  const byDefault = retriedByDefault(config.status)
  console.log(`${TAG} 把下面这段加进 $DSH_HOME/settings.yaml，然后重启 dsh web（或强刷页面）：`)
  console.log('')
  console.log('      llm-pi-ai:')
  console.log('        providers:')
  console.log('          mock-provider:')
  console.log('            api: openai-completions')
  console.log(`            baseURL: http://127.0.0.1:${config.port}/v1`)
  console.log('            models:')
  console.log('              - id: any-model')
  console.log('            retryPolicy:')
  console.log('              mode: normal')
  console.log('              maxRetries: 3')
  // 只有默认不会被重试的状态码才写 retryableCodes：429/5xx 走默认集合，多写一行
  // 反而让人以为少了它就不生效。
  if (!byDefault) {
    console.log('              retryableCodes: [PI_AI_ERROR, EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]')
  }
  console.log('              backoff: { initialDelayMs: 500, maxDelayMs: 2000, jitterRatio: 0 }')
  console.log('')
  if (byDefault) {
    console.log(`${TAG} 要点：${config.status} 在两条适配器路径上都映射成 ${config.status === 429 ? 'RATE_LIMIT' : 'SERVER'}，`)
    console.log(`${TAG}       属于默认 retryableCodes，所以上面这段不用再写 retryableCodes 就会重试。`)
  } else {
    console.log(`${TAG} 要点：${config.status} 不在默认 retryableCodes 内（llm-pi-ai 映射为 PI_AI_ERROR，`)
    console.log(`${TAG}       llm-deepseek 映射为 HTTP_${config.status}），上面那行 retryableCodes 正是让它被重试的关键；`)
    console.log(`${TAG}       省掉它就会「一次都不重试、直接本轮失败」。`)
  }
  console.log(`${TAG}       若 pi-ai 报缺密钥，再加一行 apiKeyEnv: MOCK_PROVIDER_KEY，并在启动 dsh 的环境里导出任意值`)
  console.log(`${TAG}       （本服务不看鉴权头，只负责每次都给同一种失败）。`)
  console.log(`${TAG} 启动后随便问一句：打了几行就是 dsh 发了几次请求（maxRetries=3 应为 4 行）。`)
}

// ---------- 入口 ----------

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(usageLines().join('\n'))
  process.exit(0)
}

let config
try {
  config = parseArgs(argv)
} catch (error) {
  console.log(`${TAG} ${error.message}`)
  console.log(usageLines().join('\n'))
  process.exit(1)
}

const message = STATUS_TEXT[config.status] ?? '服务器繁忙，请稍后重试'
/** 自启动以来收到的请求数，只用于行首序号——不参与任何判断。 */
let received = 0

const server = http.createServer((req, res) => {
  received += 1
  // 请求体一律丢掉：这个 provider 不看内容，但必须把流读干，否则连接会挂着等我们。
  req.resume()
  const body = JSON.stringify({
    error: { message, type: 'server_busy', code: 'SERVER_BUSY', status: config.status },
  })
  res.writeHead(config.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
  console.log(`${TAG} #${received} ${req.method} ${req.url} → ${config.status} ${message}`)
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`${TAG} 端口 ${config.port} 已被占用（pnpm dsh:kill-port ${config.port} 可查出占用进程）`)
  } else {
    console.log(`${TAG} 启动失败：${error.message}`)
  }
  process.exit(1)
})

server.listen(config.port, '127.0.0.1', () => {
  console.log(`${TAG} 假 provider 已就绪：http://127.0.0.1:${config.port}/v1（任意方法、任意路径均回 ${config.status} ${message}）`)
  console.log(`${TAG} 每收到一个请求打印一行，Ctrl+C 结束`)
  reportRecipe(config)
})
