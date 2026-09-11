#!/usr/bin/env node
/**
 * verify-npm-publish-skip — 验证 .cnb/workflows/npm-publish.yml 中
 * 「版本已存在则跳过发布」逻辑（沙箱模拟：无网络、不真正发布）。
 *
 * embedded-mcp-toolkit/test/ci/verify-npm-publish-skip.sh 的 mjs 移植：
 *   1. 从 yml 提取「发布到 npm」阶段的 script 块（测试真实内容而非副本）
 *   2. 沙箱中放置 stub package.json 与假 npm/pnpm 命令：
 *      - npm view <name>@<ver> version → 查 fixture 文件，命中输出版本退出 0，
 *        未命中模拟 E404 退出 1
 *      - pnpm publish → 仅记录调用，不真正发布
 *   3. 断言：版本已存在 → 跳过且不调用 publish、不写 .npmrc；
 *            版本不存在 → 调用 publish 并注入 token
 *
 * 用法：
 *   node test/ci/verify-npm-publish-skip.mjs            # 沙箱模拟
 *   node test/ci/verify-npm-publish-skip.mjs --network  # 追加真实 registry 连通性检查
 *
 * 依赖 bash（Windows 上即 Git Bash；CI 的 node:24 镜像自带）。bash 不可用
 * 时整体跳过（不算失败），由 CI 的 Linux 环境兜底执行。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const YML = join(ROOT, '.cnb', 'workflows', 'npm-publish.yml')
const STUB_PKG = { name: '@smai-kit/dsh-smkit', version: '0.1.0' }

let pass = 0
let fail = 0
const note = (...m) => console.log(...m)
const ok = (m) => { pass++; console.log('  \x1B[32mPASS\x1B[0m', m) }
const bad = (m) => { fail++; console.log('  \x1B[31mFAIL\x1B[0m', m) }

/* ---------- 1. 从 yml 提取「发布到 npm」阶段的 script 块 ---------- */
const lines = readFileSync(YML, 'utf8').split(/\r?\n/)
const stageIdx = lines.findIndex((l) => l.trimStart().startsWith('- name: 发布到 npm'))
if (stageIdx === -1) {
  console.error(`❌ 未能从 ${YML} 找到「发布到 npm」阶段`)
  process.exit(1)
}
const scriptIdx = lines.findIndex((l, i) => i > stageIdx && /script: \|\s*$/.test(l))
const body = []
for (let i = scriptIdx + 1; i < lines.length; i++) {
  const line = lines[i]
  if (line.trim() === '') { body.push(''); continue }
  if (line.length - line.trimStart().length < 12) break
  body.push(line.slice(12))
}
const script = body.join('\n')
if (!script.includes('npm view')) {
  console.error('❌ 未能从 yml 提取到发布脚本（缺少 npm view 检查?）')
  process.exit(1)
}
note(`已从 yml 提取发布脚本（${body.length} 行）`)

/* ---------- 2. 搭建沙箱 ---------- */
const bashCheck = spawnSync('bash', ['-c', 'true'])
if (bashCheck.error || bashCheck.status !== 0) {
  note('⏭️  bash 不可用，沙箱验证跳过（CI Linux 环境会执行）')
  process.exit(0)
}

const sb = mkdtempSync(join(tmpdir(), 'dsh-smkit-ci-publish-'))
const bin = join(sb, 'bin')
const home = join(sb, 'home')
const calls = join(sb, 'calls')
const registry = join(sb, 'registry')
mkdirSync(bin, { recursive: true })
mkdirSync(home, { recursive: true })

// stub package.json：与真实项目一致的 name/version
writeFileSync(join(sb, 'package.json'), JSON.stringify(STUB_PKG))

// 假 npm：view 查 fixture，publish 仅记录调用
// （逐行数组拼接而非模板字符串，避免 bash 的 ${2##*@} 被 JS 插值）
const NPM_STUB = [
  '#!/usr/bin/env bash',
  'echo "npm $*" >> "$FAKE_NPM_CALLS"',
  'case "$1" in',
  '  view)',
  '    if [ -f "$FAKE_NPM_REGISTRY" ] && grep -Fxq "$2" "$FAKE_NPM_REGISTRY"; then',
  '      echo "${2##*@}"; exit 0',
  '    fi',
  '    echo "npm error code E404" >&2',
  '    exit 1 ;;',
  '  publish) exit 0 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n')
writeFileSync(join(bin, 'npm'), NPM_STUB)

// 假 pnpm：本项目发布走 pnpm publish，仅记录调用不真正发布
const PNPM_STUB = [
  '#!/usr/bin/env bash',
  'echo "pnpm $*" >> "$FAKE_NPM_CALLS"',
  'exit 0',
].join('\n')
writeFileSync(join(bin, 'pnpm'), PNPM_STUB)

/** 在沙箱中执行提取出的脚本，返回合并后的输出。registryLine 非空表示该版本已发布。 */
function runCase(registryLine) {
  writeFileSync(calls, '')
  writeFileSync(registry, registryLine ? `${registryLine}\n` : '')
  rmSync(join(home, '.npmrc'), { force: true })
  const r = spawnSync('bash', ['-c', script], {
    cwd: sb,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      NPM_ACCESS_TOKENS: 'fake-token',
      FAKE_NPM_CALLS: calls,
      FAKE_NPM_REGISTRY: registry,
      PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    },
  })
  return `${r.stdout ?? ''}${r.stderr ?? ''}`
}

const spec = `${STUB_PKG.name}@${STUB_PKG.version}`
const npmrc = join(home, '.npmrc')
const callsText = () => readFileSync(calls, 'utf8')

/* ---------- 场景 A：版本已存在 → 跳过发布 ---------- */
note('')
note('[A] 版本已存在于 npm registry:')
const outA = runCase(spec)
if (outA.includes('跳过发布') && !callsText().includes('pnpm publish')) {
  ok('输出跳过提示，且未调用 pnpm publish')
} else {
  bad('版本已存在时应跳过发布')
}
if (!existsSync(npmrc)) {
  ok('跳过时未写入 .npmrc（未暴露 token）')
} else {
  bad('跳过时不应写入 .npmrc')
}

/* ---------- 场景 B：版本不存在 → 执行发布 ---------- */
note('')
note('[B] 版本不存在于 npm registry:')
const outB = runCase('')
if (outB.includes('发布成功') && callsText().includes('pnpm publish')) {
  ok('调用 pnpm publish 并输出成功提示')
} else {
  bad('版本不存在时应执行发布')
}
if (callsText().includes('--tag latest')) {
  ok('稳定版本发布到 latest dist-tag')
} else {
  bad('稳定版本应发布到 latest dist-tag')
}
if (readFileSync(npmrc, 'utf8').includes('fake-token')) {
  ok('发布前已写入 .npmrc（注入 token）')
} else {
  bad('发布前未写入 .npmrc')
}

/* ---------- 场景 C（可选）：真实 registry 连通性 ---------- */
if (process.argv[2] === '--network') {
  note('')
  note('[C] 真实 registry 检查:')
  const shellOpt = process.platform === 'win32'
  const hit = spawnSync('npm', ['view', 'dsh-better-sidebar@0.19.0', 'version'], { encoding: 'utf8', shell: shellOpt })
  if (hit.status === 0) {
    ok('已存在的包查询成功（退出码 0 → 会走跳过分支）')
  } else {
    bad('查询已存在的包失败（网络不可用?）')
  }
  const miss = spawnSync('npm', ['view', `${spec.replace(/\d+$/, '0.0.0-no-such-version')}`, 'version'], { encoding: 'utf8', shell: shellOpt })
  if (miss.status === 0) {
    bad('不存在的版本不应查询成功（会误判为已存在）')
  } else {
    ok('不存在版本退出码非 0（符合 if 判断，会走发布分支）')
  }
}

rmSync(sb, { recursive: true, force: true })
note('')
note(`结果: PASS=${pass} FAIL=${fail}`)
process.exit(fail === 0 ? 0 : 1)
