#!/usr/bin/env node
/**
 * http-mcp — 本地回环的 Streamable-HTTP 测试用 MCP 服务器（单文件、零依赖）。
 *
 * 与 slow-mcp.mjs 互补：那个走 stdio，这个走 HTTP。插件在 HTTP 侧有三条鉴权
 * 分支，用 --auth 切换，三条都覆盖：
 *
 *   none    不校验任何东西，也从不读取 Authorization（对应设置页的"无鉴权"）
 *   static  要求 Authorization: Bearer <token>（对应"静态令牌"，走 tokenEnv）
 *   oauth   授权码 + PKCE(S256) + 动态客户端注册 + refresh_token 轮换
 *
 * 传输层对齐插件的 http-transport.ts，可实测的行为：
 *   - 会话：initialize 应答带 Mcp-Session-Id，之后回带未知 id 会被拒（404）
 *   - 应答形态：默认 JSON；--sse 改成短 SSE 流（插件两种都能解）
 *   - 通知流：--list-changed 声明 tools.listChanged，并接受 GET 的 SSE 长连接
 *   - 连接耗时：--delay 延迟 initialize，--fail 让 initialize 必定失败
 *   - 工具数量：--tools 生成大量工具，用于实测按需代理（broker）
 *
 * 启动参数：
 *   --port=<端口>        监听端口，默认 8791
 *   --host=<地址>        监听地址，默认 127.0.0.1（仅回环）
 *   --path=<路径>        MCP 端点路径，默认 /mcp
 *   --auth=<模式>        none | static | oauth，默认 none
 *   --token=<令牌>       static 模式期望的令牌，默认 http-mcp-token
 *   --token-ttl=<秒>     oauth 签发的 access_token 有效期，默认 3600；设成 5
 *                        之类的短值，可观察 401 → refresh_token 重试
 *   --tools=<数量>       暴露的工具数量，默认 2
 *   --delay=<秒>         initialize 延迟秒数，默认 0
 *   --fail               initialize 延迟后返回错误
 *   --sse                POST 用 SSE 应答（默认 JSON）
 *   --list-changed[=<秒>]  声明 tools.listChanged 并开启 GET SSE 通知流；
 *                        带秒数时按该周期自动推送通知，不带则只等测试钩子触发
 *   --auto-approve       oauth：授权页直接跳回，不渲染同意页
 *   --name=<名字>        写进 serverInfo 与应答文本，默认 http-mcp
 *
 * 测试钩子（不属于 MCP 协议，仅供手工驱动）：
 *   POST /_test/tools-changed   向所有已打开的通知流推一条 list_changed
 *   POST /_test/expire-tokens   立即作废全部 access_token，逼出 401 → refresh
 *   GET  /_test/state           会话、令牌、通知流的计数
 *
 * 用法：设置页注册「类型 HTTP + URL http://127.0.0.1:8791/mcp」，鉴权按 --auth 选；
 * --auth=static 时先在环境里导出令牌（插件只存环境变量名，不存令牌本身）。
 *
 * 逐条手敲太啰嗦时用配套命令：pnpm http-mcp:serve / pnpm http-mcp:stop——它们的
 * 端口与鉴权模式跟工作区配置 .dsh/dshmm/mcp.json 里的 http-mcp-* 三条一一对应。
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

// ---------- 启动参数解析 ----------

// 同时支持 --k=v 与 --k v；旗标存在但后面跟的是另一个旗标时返回空串，不存在返回 null。
const argv = process.argv.slice(2)
function argValue(name) {
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  if (index < 0) return null
  const next = argv[index + 1]
  return next && !next.startsWith('--') ? next : ''
}

// 数字参数容错：缺省、非数字、越界都回退默认值，避免一个手滑的参数让进程起不来。
function numberArg(name, fallback, min = 0) {
  const raw = argValue(name)
  if (raw == null || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= min ? value : fallback
}

// 端口允许 0（交给内核挑一个空闲端口，便于并行起多个实例），越界值回退默认端口。
const requestedPort = numberArg('port', 8791, 0)
const port = requestedPort <= 65535 ? Math.round(requestedPort) : 8791
const host = argValue('host') || '127.0.0.1'
const basePath = argValue('path') || '/mcp'
const requestedAuth = argValue('auth')
const authMode = ['none', 'static', 'oauth'].includes(requestedAuth) ? requestedAuth : 'none'
const token = argValue('token') || 'http-mcp-token'
const tokenTtl = numberArg('token-ttl', 3600)
const toolCount = Math.max(1, Math.round(numberArg('tools', 2)))
const delaySeconds = numberArg('delay', 0)
const failInitialize = argv.includes('--fail')
const useSse = argv.includes('--sse')
const listChanged = argValue('list-changed') != null
const pushEvery = listChanged ? numberArg('list-changed', 0) : 0
const autoApprove = argv.includes('--auto-approve')
const name = argValue('name') || 'http-mcp'

// 日志里的地址：监听 0.0.0.0 时改回环地址，否则打印出来的 URL 没法直接点。
const shownHost = host === '0.0.0.0' ? '127.0.0.1' : host
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
const randomId = (prefix) => prefix + b64url(randomBytes(18))

/** 请求方实际用的源：从 Host 头取，这样 127.0.0.1 与 localhost 都能自洽。 */
const originOf = (req) => `http://${req.headers.host || `${shownHost}:${port}`}`

// ---------- 运行期状态 ----------

/** initialize 建立的会话；后续请求回带未知 id 会被拒，模拟真实的会话校验。 */
const sessions = new Set()
/** OAuth：动态注册的客户端 → 允许的回调地址（换令牌时要逐字比对）。 */
const clients = new Map()
/** OAuth：授权码 → 换令牌所需的一切，一次性。 */
const codes = new Map()
/** OAuth：access_token → 过期时间戳。 */
const accessTokens = new Map()
/** OAuth：refresh_token → client_id，刷新时轮换。 */
const refreshTokens = new Map()
/** 已打开的 GET 通知流（SSE），用于推 tools/list_changed。 */
const streams = new Set()

// ---------- 日志 ----------

const startedAt = Date.now()
const elapsed = () => `+${((Date.now() - startedAt) / 1000).toFixed(1)}s`
// stderr 专用：stdout 留给"像 stdio MCP 一样能被管道读走"的余地，且 HTTP 模式下
// 进程常在前台跑，日志直接打在终端上更容易和设置页的转圈对齐时间。
function log(line) {
  process.stderr.write(`[${name} ${elapsed()}] ${line}\n`)
}

// ---------- 对外暴露的工具 ----------

// 第 1 个是真正干活的 repeat；其余是占位工具，只用来把工具数量撑到 --tools。
const TOOLS = [
  {
    name: 'repeat',
    description: '原样返回 text 参数（本服务器是可本地启动的 HTTP 测试实例）',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要回显的文本' },
      },
    },
  },
  ...Array.from({ length: toolCount - 1 }, (_, index) => ({
    name: `bulk_${index + 1}`,
    description: `占位工具 ${index + 1}（由 --tools 生成，用于撑起工具数量）`,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要回显的文本' },
      },
    },
  })),
]

// ---------- JSON-RPC 方法分发 ----------

// 客户端建立连接 = initialize + notifications/initialized + tools/list；只有
// initialize 受 --delay/--fail 影响，其余立即返回。
async function handle(method, params) {
  switch (method) {
    case 'initialize': {
      if (delaySeconds > 0) await sleep(delaySeconds * 1000)
      if (failInitialize) throw rpcError(-32000, `${name}: initialize failed after ${delaySeconds}s (injected)`)
      return {
        // protocolVersion 回显客户端请求的版本，避免版本协商失败。
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26',
        capabilities: { tools: listChanged ? { listChanged: true } : {} },
        serverInfo: { name, version: '1.0.0' },
      }
    }
    case 'tools/list':
      return { tools: TOOLS }
    case 'tools/call': {
      const tool = TOOLS.find((candidate) => candidate.name === params?.name)
      if (!tool) throw rpcError(-32602, `unknown tool: ${String(params?.name)}`)
      const text = String(params?.arguments?.text ?? '')
      return { content: [{ type: 'text', text: `${tool.name}(${name}): ${text || 'pong'}` }] }
    }
    case 'ping':
      return {}
    default:
      throw rpcError(-32601, `method not found: ${method}`)
  }
}

function rpcError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

// ---------- HTTP 应答helpers ----------

function sendJson(res, code, value, headers = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(value))
}

/** 短 SSE 应答：单个 data 帧后结束（插件的 parseRpc 会退到 SSE 分支解析）。 */
function sendSse(res, message, headers = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.write(`data: ${JSON.stringify(message)}\n\n`)
  res.end()
}

/** 按 --sse 选 JSON 或 SSE 应答，两条分支对插件等价。 */
function sendRpc(res, message, headers = {}) {
  if (useSse) sendSse(res, message, headers)
  else sendJson(res, 200, message, headers)
}

function sendHtml(res, code, html) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:40px"><h2>${title}</h2>${body}</body>`
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function parseJson(text) {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

// ---------- 鉴权 ----------

/** 401 应答：带上 WWW-Authenticate，且不泄漏任何令牌内容。 */
function unauthorized(req, res, description) {
  log(`401 拒绝（auth=${authMode}）：${description}`)
  sendJson(res, 401, { error: 'invalid_token', error_description: description }, {
    'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${originOf(req)}/.well-known/oauth-protected-resource"`,
  })
}

/**
 * 校验 MCP 端点上的请求，失败时写出 401 并返回 false。
 * none 一律放行（并盯一眼有没有多余的 Authorization，那是插件的 bug）；
 * static 比对固定令牌；oauth 只认本进程签发且未过期的 access_token。
 */
function authorized(req, res) {
  const header = String(req.headers.authorization ?? '')
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''

  if (authMode === 'none') {
    if (header) log(`异常：无鉴权模式收到了 Authorization 头（${header.slice(0, 16)}…）`)
    return true
  }
  if (authMode === 'static') {
    if (presented === token) return true
    unauthorized(req, res, presented ? 'token mismatch' : 'no credentials')
    return false
  }
  const expiresAt = accessTokens.get(presented)
  if (presented && expiresAt !== undefined && expiresAt > Date.now()) return true
  unauthorized(
    req,
    res,
    expiresAt !== undefined ? 'access token expired' : presented ? 'unknown access token' : 'no credentials',
  )
  return false
}

// ---------- MCP 端点 ----------

async function handleMcpPost(req, res) {
  if (!authorized(req, res)) return

  const message = parseJson(await readBody(req))
  if (!message || typeof message.method !== 'string') {
    sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
    return
  }

  const presentedSession = req.headers['mcp-session-id']
  const sessionId = typeof presentedSession === 'string' ? presentedSession : ''
  if (sessionId && !sessions.has(sessionId)) {
    log(`404 未知会话 ${sessionId}`)
    sendJson(res, 404, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unknown session' } })
    return
  }

  const headers = {}
  let activeSession = sessionId
  if (message.method === 'initialize' && !activeSession) {
    activeSession = randomId('sess_')
    sessions.add(activeSession)
    headers['Mcp-Session-Id'] = activeSession
  }
  log(`POST ${basePath} ${message.method}${activeSession ? ` session=${activeSession}` : ''}`)

  // 无 id 的是通知（如 notifications/initialized）：按规范回 202 且不带正文。
  if (message.id == null) {
    res.writeHead(202, headers)
    res.end()
    return
  }

  try {
    const result = await handle(message.method, message.params)
    sendRpc(res, { jsonrpc: '2.0', id: message.id, result }, headers)
  } catch (error) {
    // JSON-RPC 层错误照常回 200，靠 error 对象表达；插件的 openHttp 据此判定失败。
    sendRpc(
      res,
      { jsonrpc: '2.0', id: message.id, error: { code: error.code ?? -32603, message: error.message } },
      headers,
    )
  }
}

/** GET 的 SSE 长连接：只在声明了 listChanged 时提供，否则按规范回 405。 */
function handleNotificationStream(req, res) {
  if (!listChanged) {
    res.writeHead(405, { Allow: 'POST, DELETE' })
    res.end()
    return
  }
  if (!String(req.headers.accept ?? '').includes('text/event-stream')) {
    res.writeHead(406, { Allow: 'GET with Accept: text/event-stream' })
    res.end()
    return
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  })
  res.write(': connected\n\n')
  streams.add(res)
  res.on('close', () => streams.delete(res))
  log(`通知流已打开（当前 ${streams.size} 条）`)
}

/** 向每条已打开的通知流写一帧，返回成功写入的条数。 */
function pushNotification(message) {
  let sent = 0
  for (const stream of streams) {
    if (stream.writableEnded || stream.destroyed) {
      streams.delete(stream)
      continue
    }
    stream.write(`data: ${JSON.stringify(message)}\n\n`)
    sent += 1
  }
  return sent
}

// ---------- OAuth 端点（仅 --auth=oauth 提供） ----------

function metadataFor(req) {
  const origin = originOf(req)
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  }
}

/** RFC 7591 动态客户端注册：只认 redirect_uris，换令牌时会逐字比对。 */
async function handleRegister(req, res) {
  const body = parseJson(await readBody(req)) ?? {}
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((uri) => typeof uri === 'string' && uri)
    : []
  if (redirectUris.length === 0) {
    sendJson(res, 400, { error: 'invalid_client_metadata', error_description: 'redirect_uris is required' })
    return
  }
  const clientId = randomId('client_')
  clients.set(clientId, redirectUris)
  log(`动态注册客户端 ${clientId} redirect_uris=${redirectUris.join(' ')}`)
  sendJson(res, 201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: String(body.client_name ?? ''),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code', 'refresh_token'],
    response_types: Array.isArray(body.response_types) ? body.response_types : ['code'],
  })
}

function handleAuthorize(req, res, url) {
  const reject = (message) => sendHtml(res, 400, page('授权被拒绝', `<p>${message}</p>`))
  const clientId = url.searchParams.get('client_id') ?? ''
  const redirectUri = url.searchParams.get('redirect_uri') ?? ''
  const redirectUris = clients.get(clientId)

  if (!redirectUris) return reject(`未知的 client_id：${clientId}（插件应先做过动态注册）`)
  if (!redirectUris.includes(redirectUri)) {
    return reject(
      `redirect_uri 与注册值不一致：<br>请求 <code>${redirectUri}</code><br>注册 <code>${redirectUris.join(', ')}</code>`,
    )
  }
  if (url.searchParams.get('response_type') !== 'code') return reject('response_type 必须是 code')
  const challenge = url.searchParams.get('code_challenge') ?? ''
  if (!challenge || url.searchParams.get('code_challenge_method') !== 'S256') {
    return reject('只支持 PKCE 的 S256')
  }

  // 默认先渲染同意页（贴近真实授权服务器）；--auto-approve 或 approve=1 直接发码。
  if (!autoApprove && url.searchParams.get('approve') !== '1') {
    const approveUrl = new URL(url)
    approveUrl.searchParams.set('approve', '1')
    log(`渲染授权同意页 client=${clientId}`)
    return sendHtml(
      res,
      200,
      page(
        '授权请求',
        `<p>客户端 <code>${clientId}</code> 请求访问 <code>${name}</code></p>` +
          `<p><a href="${approveUrl}">同意并授权</a></p>`,
      ),
    )
  }

  const state = url.searchParams.get('state') ?? ''
  const code = randomId('code_')
  codes.set(code, { clientId, redirectUri, challenge, expiresAt: Date.now() + 5 * 60_000 })
  const target = new URL(redirectUri)
  target.searchParams.set('code', code)
  if (state) target.searchParams.set('state', state)
  log(`发放授权码 ${code.slice(0, 12)}… → ${redirectUri}`)
  res.writeHead(302, { Location: target.toString() })
  res.end()
}

function tokenError(res, error, description) {
  log(`令牌端点拒绝：${error} — ${description}`)
  sendJson(res, 400, { error, error_description: description })
}

function issueTokens(res, clientId) {
  const access = randomId('at_')
  const refresh = randomId('rt_')
  accessTokens.set(access, Date.now() + tokenTtl * 1000)
  refreshTokens.set(refresh, clientId)
  log(`签发令牌 client=${clientId} ttl=${tokenTtl}s access=${access.slice(0, 12)}…`)
  sendJson(res, 200, {
    access_token: access,
    token_type: 'Bearer',
    expires_in: tokenTtl,
    refresh_token: refresh,
    scope: 'mcp',
  })
}

async function handleToken(req, res) {
  const form = new URLSearchParams(await readBody(req))
  const grantType = form.get('grant_type')

  if (grantType === 'authorization_code') {
    const code = form.get('code') ?? ''
    const entry = codes.get(code)
    if (!entry || entry.expiresAt < Date.now()) {
      return tokenError(res, 'invalid_grant', '授权码不存在或已过期（授权码一次性）')
    }
    codes.delete(code)
    if (form.get('client_id') !== entry.clientId) return tokenError(res, 'invalid_grant', 'client_id 不匹配')
    if (form.get('redirect_uri') !== entry.redirectUri) {
      return tokenError(res, 'invalid_grant', 'redirect_uri 与授权时不一致')
    }
    const verifier = form.get('code_verifier') ?? ''
    const computed = b64url(createHash('sha256').update(verifier).digest())
    if (!verifier || computed !== entry.challenge) {
      return tokenError(res, 'invalid_grant', 'PKCE 校验失败：code_verifier 与 code_challenge 不匹配')
    }
    return issueTokens(res, entry.clientId)
  }

  if (grantType === 'refresh_token') {
    const presented = form.get('refresh_token') ?? ''
    const clientId = refreshTokens.get(presented)
    if (!clientId) return tokenError(res, 'invalid_grant', 'refresh_token 未知或已轮换')
    if (form.get('client_id') !== clientId) return tokenError(res, 'invalid_grant', 'client_id 不匹配')
    refreshTokens.delete(presented) // 轮换：旧 refresh_token 立即失效
    return issueTokens(res, clientId)
  }

  tokenError(res, 'unsupported_grant_type', `grant_type=${String(grantType)}`)
}

// ---------- 测试钩子 ----------

function handleTestHook(req, res, url) {
  if (url.pathname === '/_test/tools-changed') {
    const sent = pushNotification({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    log(`手工推送 tools/list_changed → ${sent} 条流`)
    return sendJson(res, 200, { streams: sent })
  }
  if (url.pathname === '/_test/expire-tokens') {
    const dropped = accessTokens.size
    accessTokens.clear()
    log(`已作废 ${dropped} 个 access_token（下次 /mcp 回 401，插件应走 refresh_token）`)
    return sendJson(res, 200, { expired: dropped })
  }
  if (url.pathname === '/_test/state') {
    return sendJson(res, 200, {
      authMode,
      sessions: sessions.size,
      clients: clients.size,
      accessTokens: accessTokens.size,
      refreshTokens: refreshTokens.size,
      codes: codes.size,
      streams: streams.size,
    })
  }
  return sendJson(res, 404, { error: 'not_found' })
}

// ---------- 路由 ----------

async function route(req, res, url) {
  if (url.pathname.startsWith('/_test/')) return handleTestHook(req, res, url)

  const isOauthPath =
    url.pathname.startsWith('/.well-known/') || url.pathname === '/register' || url.pathname.startsWith('/oauth/')
  if (isOauthPath) {
    if (authMode !== 'oauth') {
      return sendJson(res, 404, { error: 'not_found', hint: `当前 --auth=${authMode}，OAuth 端点未启用` })
    }
    if (url.pathname === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
      return sendJson(res, 200, metadataFor(req))
    }
    if (url.pathname === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
      const origin = originOf(req)
      return sendJson(res, 200, { resource: `${origin}${basePath}`, authorization_servers: [origin] })
    }
    if (url.pathname === '/register' && req.method === 'POST') return handleRegister(req, res)
    if (url.pathname === '/oauth/authorize' && req.method === 'GET') return handleAuthorize(req, res, url)
    if (url.pathname === '/oauth/token' && req.method === 'POST') return handleToken(req, res)
    return sendJson(res, 404, { error: 'not_found' })
  }

  if (url.pathname !== basePath) {
    return sendJson(res, 404, { error: 'not_found', hint: `MCP 端点是 ${basePath}` })
  }

  if (req.method === 'POST') return handleMcpPost(req, res)
  if (req.method === 'GET') return handleNotificationStream(req, res)
  if (req.method === 'DELETE') {
    const sessionId = req.headers['mcp-session-id']
    if (typeof sessionId === 'string') sessions.delete(sessionId)
    log(`DELETE 会话 ${typeof sessionId === 'string' ? sessionId : '(无)'}`)
    res.writeHead(204)
    res.end()
    return
  }
  res.writeHead(405, { Allow: 'POST, GET, DELETE' })
  res.end()
}

// ---------- 启动 ----------

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || `${shownHost}:${port}`}`)
  // 把状态码记下来，响应收尾时统一打一行日志（长连接在关闭时才收尾）。
  let status = 0
  const writeHead = res.writeHead.bind(res)
  res.writeHead = (code, ...rest) => {
    status = code
    return writeHead(code, ...rest)
  }
  res.on('finish', () => {
    log(`${req.method} ${url.pathname} → ${status}`)
  })
  void route(req, res, url).catch((error) => {
    log(`处理 ${url.pathname} 抛错：${error?.message ?? error}`)
    if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' })
    else res.end()
  })
})

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    process.stderr.write(
      `[${name}] 端口 ${port} 已被占用：换一个 --port，或用 pnpm dsh:kill-port ${port} 查占用进程。\n`,
    )
    process.exit(1)
  }
  throw error
})

server.listen(port, host, () => {
  // --port=0 时由内核选端口，因此说明里的地址必须用实际绑定的那个。
  const bound = server.address()
  const actualPort = typeof bound === 'object' && bound ? bound.port : port
  const endpoint = `http://${shownHost}:${actualPort}${basePath}`
  const hints = {
    none: '鉴权选"无鉴权"',
    static: `鉴权选"静态令牌"，环境变量里导出令牌值，例如 HTTP_MCP_TOKEN=${token}`,
    oauth: '鉴权选"OAuth"，点授权后在同意页点"同意并授权"（--auto-approve 可跳过）',
  }
  const notify = !listChanged ? 'off' : pushEvery > 0 ? `每 ${pushEvery}s 自动推送` : '仅测试钩子触发'
  process.stderr.write(
    [
      `[${name}] 监听 ${endpoint}`,
      `[${name}] auth=${authMode} tools=${toolCount} sse=${useSse ? 'on' : 'off'} listChanged=${notify} pid=${process.pid}`,
      ...(authMode === 'oauth'
        ? [`[${name}] OAuth 元数据 http://${shownHost}:${actualPort}/.well-known/oauth-authorization-server`]
        : []),
      `[${name}] 设置页注册：类型 HTTP，URL ${endpoint}，${hints[authMode]}`,
      '',
    ].join('\n') + '\n',
  )
})

if (pushEvery > 0) {
  setInterval(() => {
    const sent = pushNotification({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
    if (sent > 0) log(`自动推送 tools/list_changed → ${sent} 条流`)
  }, pushEvery * 1000)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('退出')
    for (const stream of streams) stream.end()
    server.close()
    process.exit(0)
  })
}
