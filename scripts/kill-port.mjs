#!/usr/bin/env node
/**
 * kill-port — 查出监听指定端口的进程，经确认后终止，用于解除端口占用。
 *
 *   pnpm dsh:kill-port <port> [--yes]
 *
 * Windows 走 netstat / tasklist / taskkill；POSIX 依次尝试
 * lsof → ss → netstat → fuser 找监听进程，/ ps / kill。
 * --yes 跳过确认。
 */

import { spawnSync } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const args = process.argv.slice(2)
const yes = args.includes('--yes') || args.includes('-y')
const port = args.find((a) => /^\d+$/.test(a)) || '3080'

if (+port < 1 || +port > 65535) {
  console.log('usage: pnpm dsh:kill-port <port> [--yes]')
  process.exit(1)
}

const isWindows = process.platform === 'win32'

function runCapture(command) {
  const r = spawnSync(command, { shell: true, encoding: 'utf8' })
  return (r.stdout || '').trim()
}

/** 命令是否存在（command -v 是 POSIX 内置，Linux/macOS 通用）。 */
function has(command) {
  return spawnSync(`command -v ${command}`, { shell: true, encoding: 'utf8' }).status === 0
}

/** 从任意文本里抽出所有非 0 的数字（去重），用于解析 PID。 */
function extractPids(text) {
  return [...new Set(text.match(/\d+/g) || [])].filter((n) => n !== '0')
}

/** Windows：netstat -ano 里 LISTENING 行的最后一列是 PID。 */
function windowsListeners() {
  const out = runCapture(`netstat -ano | findstr /C:":${port} "`)
  const pids = new Set()
  for (const line of out.split(/\r?\n/)) {
    if (/LISTENING/i.test(line)) {
      const pid = line.trim().split(/\s+/).pop()
      if (pid && pid !== '0') pids.add(pid)
    }
  }
  return [...pids]
}

/** POSIX：按 lsof → ss → netstat → fuser 回退，谁先给出结果用谁。
 * 各发行版自带工具差异极大（minimal 镜像常连 lsof 都没有），
 * 因此必须逐个探测能力，而不是押注单一命令。 */
function posixListeners() {
  const attempts = [
    // lsof 最精确：-sTCP:LISTEN 只取监听态，直接返回 PID 列表
    ['lsof', () => extractPids(runCapture(`lsof -ti tcp:${port} -sTCP:LISTEN`))],
    // iproute2：LISTEN 行的本地地址列末段是端口，Process 列形如 users:(("node",pid=1234,fd=20))
    [
      'ss',
      () => {
        const pids = new Set()
        for (const line of runCapture('ss -ltnp').split(/\r?\n/)) {
          const cols = line.trim().split(/\s+/)
          if (cols[0] !== 'LISTEN') continue
          if ((cols[3] || '').split(':').pop() !== String(port)) continue
          for (const m of line.matchAll(/pid=(\d+)/g)) pids.add(m[1])
        }
        return [...pids]
      },
    ],
    // net-tools：本地地址列末段是端口，末列形如 1234/node
    [
      'netstat',
      () => {
        const pids = new Set()
        for (const line of runCapture('netstat -tlnp').split(/\r?\n/)) {
          const cols = line.trim().split(/\s+/)
          if (!/^tcp/i.test(cols[0]) || !/LISTEN/i.test(line)) continue
          if ((cols[3] || '').split(':').pop() !== String(port)) continue
          const pid = (cols[cols.length - 1] || '').split('/')[0]
          if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid)
        }
        return [...pids]
      },
    ],
    // psmisc：stdout 形如 "3080/tcp:            1234"，冒号前是端口、之后才是 PID
    [
      'fuser',
      () => extractPids(runCapture(`fuser -n tcp ${port} 2>/dev/null`).split(':').pop() || ''),
    ],
  ]

  for (const [cmd, probe] of attempts) {
    if (!has(cmd)) continue
    try {
      const pids = probe()
      if (pids.length) return pids
    } catch {
      // 单个工具异常不应中断回退链
    }
  }
  return []
}

function listeners() {
  return isWindows ? windowsListeners() : posixListeners()
}

function describe(pid) {
  if (isWindows) {
    const name = runCapture(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`)
      .split(/\r?\n/)
      .filter(Boolean)[0]
      ?.match(/^"([^"]+)"/)?.[1] ?? '(unknown)'
    const cl = spawnSync(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
      { shell: true, encoding: 'utf8' },
    )
    return { pid, name, cmdline: (cl.stdout || '').trim() || '(无法获取命令行)' }
  }
  const cmdline = runCapture(`ps -p ${pid} -o command=`) || '(无法获取命令行)'
  return { pid, name: cmdline.split(' ')[0], cmdline }
}

const pids = listeners()
if (pids.length === 0) {
  console.log(`kill-port: 端口 ${port} 没有监听进程`)
  if (!isWindows && !['lsof', 'ss', 'netstat', 'fuser'].some(has)) {
    console.log(
      'kill-port: 系统缺少 lsof/ss/netstat/fuser，无法探测端口占用。' +
        '请安装其一（如 iproute2 的 ss、net-tools 的 netstat）。',
    )
  }
  process.exit(0)
}

console.log(`端口 ${port} 被以下进程监听：\n`)
for (const pid of pids) {
  const { name, cmdline } = describe(pid)
  console.log(`  PID ${pid}  ${name}`)
  console.log(`    ${cmdline}\n`)
}

let confirmed = yes
if (!confirmed) {
  const rl = readline.createInterface({ input, output })
  const answer = (await rl.question('终止以上进程？(y/N) ')).trim().toLowerCase()
  rl.close()
  confirmed = answer === 'y' || answer === 'yes'
}

if (!confirmed) {
  console.log('kill-port: 已取消')
  process.exit(0)
}

for (const pid of pids) {
  const kill = isWindows
    ? spawnSync(`taskkill /PID ${pid} /T /F`, { shell: true, encoding: 'utf8' })
    : spawnSync(`kill -9 ${pid}`, { shell: true, encoding: 'utf8' })
  if (kill.status !== 0) {
    process.stderr.write(kill.stderr || `kill-port: 终止 PID ${pid} 失败\n`)
    process.exit(kill.status ?? 1)
  }
  console.log(`kill-port: 已终止 PID ${pid}`)
}
