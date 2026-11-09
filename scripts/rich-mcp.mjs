#!/usr/bin/env node
/**
 * rich-mcp — 参数很多的 stdio MCP 服务器，用来量「工具定义占多少 context」。
 *
 * 三个工具、几十个参数、每个参数都带说明，结构和真实设备类 MCP（串口、SSH、
 * 板卡控制）一致。按需代理开启时，这三个工具的完整定义应该被收成同名短桩；
 * 关闭时则是完整定义——两次请求的字节差就是这个功能省下的部分。
 *
 *   node scripts/rich-mcp.mjs
 *
 * dsh 侧的 MCP 配置（stdio）：
 *
 *   { "name": "rich", "type": "stdio", "command": "node",
 *     "args": ["/绝对路径/scripts/rich-mcp.mjs"] }
 */

const PROTOCOL_VERSION = '2025-03-26'
const SERVER_INFO = { name: 'rich-mcp', version: '1' }

/** One property, described the way a real device server would. */
const property = (type, description, extra = {}) => ({ type, description, ...extra })

const TOOLS = [
  {
    name: 'serial_exec',
    description:
      'Run one command on an already-open serial session and capture everything the device writes back until the prompt returns or the timeout expires. Use serial_shell_open first; this tool never opens or closes the port itself.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: property('string', 'Session handle returned by serial_shell_open, e.g. ses-8f21c0'),
        cmd: property('string', 'Exact bytes to send; a trailing newline is appended unless newline is "none"'),
        timeout: property('number', 'Seconds to wait for the device to settle before returning partial output'),
        mode: property('string', 'How the output is decoded', { enum: ['text', 'binary'] }),
        encoding: property('string', 'Text decoding used when mode is "text"', { enum: ['utf-8', 'utf-16le', 'latin1'] }),
        newline: property('string', 'Line ending appended to cmd', { enum: ['lf', 'crlf', 'cr', 'none'] }),
        strip_ansi: property('boolean', 'Drop ANSI colour and cursor sequences from the captured output'),
        echo: property('boolean', 'Include the command itself in the returned output'),
        max_bytes: property('number', 'Hard cap on the captured output, in bytes'),
        truncate_marker: property('string', 'Marker inserted where output was cut short'),
      },
      required: ['session_id', 'cmd'],
    },
    answer: (args) => `serial_exec accepted ${Object.keys(args).length} argument(s)`,
  },
  {
    name: 'serial_shell_open',
    description:
      'Open a serial port and keep a shell session on it. The returned session handle is what serial_exec and serial_close take. Opening is exclusive: a second caller gets a busy error until the first session is closed.',
    inputSchema: {
      type: 'object',
      properties: {
        port: property('string', 'Device path or COM name, e.g. /dev/ttyUSB0 or COM7'),
        baud: property('number', 'Line speed in bits per second', { enum: [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600] }),
        data_bits: property('number', 'Bits per character', { enum: [5, 6, 7, 8] }),
        parity: property('string', 'Parity mode', { enum: ['none', 'even', 'odd', 'mark', 'space'] }),
        stop_bits: property('number', 'Stop bits per character', { enum: [1, 1.5, 2] }),
        flow_control: property('string', 'Hardware or software flow control', { enum: ['none', 'rtscts', 'xonxoff'] }),
        login_user: property('string', 'User name to send at the login prompt; omit to wait for a manual login'),
        login_password_env: property('string', 'Environment variable holding the password, never the password itself'),
        prompt: property('string', 'Regular expression that marks a ready shell prompt'),
        startup_delay_ms: property('number', 'Milliseconds to wait after opening before the first write'),
        owner: property('string', 'Free-form label recorded with the session, shown by serial_list'),
      },
      required: ['port', 'baud'],
    },
    answer: (args) => `serial_shell_open accepted ${Object.keys(args).length} argument(s)`,
  },
  {
    name: 'board_control',
    description:
      'Drive the board-level controls exposed by the debug probe: reset, power cycle, boot-mode straps and the recovery watchdog. Every action is logged with the caller and the previous state so a failed flash can be reconstructed afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        action: property('string', 'Control to actuate', { enum: ['reset', 'power_cycle', 'set_straps', 'clear_straps', 'watchdog_arm', 'watchdog_kick'] }),
        target: property('string', 'Board identifier as reported by board_list'),
        straps: property('string', 'Comma-separated strap values, e.g. "boot0=1,boot1=0"'),
        hold_ms: property('number', 'How long the control stays asserted before release'),
        reason: property('string', 'Recorded in the audit log next to the action'),
        dry_run: property('boolean', 'Resolve and log the action without actuating anything'),
      },
      required: ['action', 'target'],
    },
    answer: (args) => `board_control accepted ${Object.keys(args).length} argument(s)`,
  },
]

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool.answer]))

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function error(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

function handle(message) {
  if (message.id === undefined) return

  switch (message.method) {
    case 'initialize':
      reply(message.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO })
      return
    case 'tools/list':
      reply(message.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
      return
    case 'tools/call': {
      const name = message.params?.name
      const answer = BY_NAME.get(name)
      if (answer === undefined) {
        error(message.id, -32602, `unknown tool: ${name}`)
        return
      }
      const args = message.params?.arguments ?? {}
      reply(message.id, { content: [{ type: 'text', text: answer(args) }] })
      return
    }
    default:
      reply(message.id, {})
  }
}

let buffer = ''

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let lf = buffer.indexOf('\n')
  while (lf !== -1) {
    const line = buffer.slice(0, lf).trim()
    buffer = buffer.slice(lf + 1)
    lf = buffer.indexOf('\n')
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    handle(message)
  }
})

process.stdin.on('close', () => {
  process.stdin.destroy()
})
