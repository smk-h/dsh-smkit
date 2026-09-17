#!/usr/bin/env node
/**
 * slow-mcp — 连接阶段延迟的测试用 MCP 服务器（stdio，无依赖单文件）。
 *
 * initialize 停顿 --delay 秒后才应答，tools/list 与工具调用立即返回。用于人工
 * 验证设置页的"连接中"转圈、保存立即返回列表、连接失败展示等场景。可以在设置
 * 页用不同名字、不同参数注册多个实例同时观察（例如一个 --delay=45、一个
 * --delay=45 --fail、一个默认 30）。
 *
 * 启动参数：
 *   --delay=<秒>   initialize 延迟秒数，默认 30。连接阶段的请求固定 60 秒超时
 *                  （tools/call 的超时另在「设置 → MCP → 高级」里配），因此
 *                  建议 30~55；超过 60 必定以超时错误告终（也是有效场景）
 *   --fail         initialize 延迟后返回错误，连接转圈结束后显示失败
 *   --name=<名字>  写进 serverInfo 与应答文本，便于区分多个实例，默认 slow-mcp
 *
 * 注册为 stdio 服务器：command = node，args = [<本文件绝对路径>, --delay=45]
 */

// ---------- 启动参数解析 ----------

// 同时支持 --delay=45 与 --delay 45 两种写法；未提供时返回 null。
const argv = process.argv.slice(2)
const argValue = (name) => {
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null
}

// --delay 容错：未传用默认 30，非法值（非数字）也回退 30，不允许为负。
const requested = argValue('delay')
const seconds = requested == null ? 30 : Number(requested)
const delaySeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 30)
const fail = argv.includes('--fail')
const name = argValue('name') ?? 'slow-mcp'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 启动信息打 stderr：stdio 传输只把 stdout 当 JSON-RPC 通道，stderr 仅在
// 进程异常退出时作为错误摘要出现，所以这里不会干扰协议。
process.stderr.write(`[${name}] delay=${delaySeconds}s fail=${fail} pid=${process.pid}\n`)

// ---------- 对外暴露的工具 ----------

// 唯一的工具：原样返回 text。应答文本带上实例名，注册多个实例时能区分
// 这次调用打到的是哪一个。
const TOOLS = [
  {
    name: 'repeat',
    description: '原样返回 text 参数（本服务器的连接阶段被刻意延迟）',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要回显的文本' },
      },
    },
  },
]

// ---------- JSON-RPC 方法分发 ----------

// 客户端建立连接 = initialize + tools/list 两步；只有 initialize 被延迟，
// 所以设置页卡片的"连接中"时长 ≈ delay。tools/list 与 tools/call 立即返回。
async function handle(method, params) {
  switch (method) {
    case 'initialize': {
      if (delaySeconds > 0) await sleep(delaySeconds * 1000)
      if (fail) throw rpcError(-32000, `${name}: initialize failed after ${delaySeconds}s (injected)`)
      // protocolVersion 回显客户端请求的版本，避免版本协商失败。
      return {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name, version: '1.0.0' },
      }
    }
    case 'tools/list':
      return { tools: TOOLS }
    case 'tools/call': {
      const text = String(params?.arguments?.text ?? '')
      return { content: [{ type: 'text', text: `repeat(${name}): ${text || 'pong'}` }] }
    }
    case 'ping':
      // 健康检查，立即应答。
      return {}
    default:
      throw rpcError(-32601, `method not found: ${method}`)
  }
}

// 把任意异常包装成带错误码的 Error，dispatch 统一转成 JSON-RPC error 应答。
function rpcError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

// ---------- stdio 读写 ----------

// stdin 按行切分：stdio MCP 用"一行一个 JSON"编帧，半行留在缓冲区等下个 chunk。
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) void dispatch(line)
  }
})
// 客户端关闭 stdin（比如停用/删除服务器）时随之退出。
process.stdin.on('end', () => process.exit(0))

// 单条消息处理：无 id 的是通知（如 notifications/initialized），直接忽略；
// 有 id 的是请求，必须应答且 id 原样带回——客户端靠 id 匹配挂起的请求。
async function dispatch(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.id == null || typeof message.method !== 'string') return // notification
  try {
    const result = await handle(message.method, message.params)
    write({ jsonrpc: '2.0', id: message.id, result })
  } catch (error) {
    write({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: error.code ?? -32603, message: error.message },
    })
  }
}

// stdout 上只允许出现 JSON-RPC 行——任何多余输出都会破坏客户端的按行解析。
function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
