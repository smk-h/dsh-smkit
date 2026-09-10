#!/usr/bin/env node
/**
 * open-dsh-config — 在文件管理器中打开 dsh 配置目录
 * （$DSH_HOME 环境变量，默认 ~/.dsh）。
 *
 *   pnpm dsh:config
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

if (!fs.existsSync(dir)) {
  console.error(`open-dsh-config: 配置目录不存在：${dir}`)
  process.exit(1)
}

console.log(`open-dsh-config: ${dir}`)

// explorer 打开成功也返回非零退出码，这里只负责拉起，不检查退出码
const opener = { win32: 'explorer.exe', darwin: 'open', linux: 'xdg-open' }[process.platform]
spawn(opener, [dir], { detached: true, stdio: 'ignore' }).unref()
