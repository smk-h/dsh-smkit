<!-- more -->

本文是 LV005 功能用例：MCP 掉线自动重连的端到端验收。覆盖「子进程自己退出」与「进程还在但不应答」两条掉线路径，并按进程表判定重连时有没有回收被替换的 transport。用例由 [`mcp-reconnect.mjs`](mcp-reconnect.mjs) 自动执行，本文给出前置条件、步骤与判据——脚本只负责跑，判定口径以本文为准。

## 一、 用例定位

（1）用例编号 LV005，被测功能是「设置 → MCP → 高级」里的自动重连，以及工作区层连接重建时的 transport 回收。

（2）不放进单元测试的原因：[`test/auto-reconnect.test.mjs`](../auto-reconnect.test.mjs) 用桩驱动状态机，验的是插件自己记录的状态，看不到真实子进程是否被回收；本用例走真 dsh、真工作区、真子进程，依据是进程表与桩自己写的日志。

（3）与人工文档的关系：[`docs/LV001-MCP功能测试.md`](../../docs/LV001-MCP功能测试.md) 的「四、7」是人工操作版，本用例是它的自动化提炼，只覆盖自动重连这一条线。

（4）适用范围：改动了连接建立、断开、重连、工作区释放这几条路径后跑一次；日常改界面或命令不需要跑。

## 二、 前置条件

（1）`dsh` 在 PATH 上，`profile web` 里能装入当前代码。用例默认先执行一次 `scripts/dsh-smkit.mjs install --profile web`（其 prepack 会跑 `tsc` + `tsdown` + `verify`）；只想跑现有产物时加 `--skip-install`。

（2）playwright 可解析：本地 `node_modules` 或全局 npm root 均可。无头浏览器要能启动，未设 `PLAYWRIGHT_BROWSERS_PATH` 而机器上存在 `/opt/ms-playwright` 时，脚本自动指向它。

（3）目标工作区已在 dsh 里注册。插件只给「打开过会话的工作区」连 MCP，所以这个目录必须是 dsh 认得的。未用 `--workspace` 指定时，脚本取 `~/.dsh/storages/workspace.json` 里的第一个工作区。

（4）用例默认使用 3099 端口（可用 `--port` 改），启动前先按该端口清理自己的旧实例，不会碰你正在用的 3080。

## 三、 用例步骤

### 1. 环境准备

（1）用例在 3099 端口拉起 `dsh web --port 3099 --no-open`，从日志里取出带 token 的访问链接。

（2）无头浏览器打开该链接，通过 `POST /smkit/api/settings/reconnect` 把重连压到秒级：探活 1000 毫秒、重试间隔上限 1000 毫秒、次数不限、自动重连开启。

（3）向工作区写入只含一个测试服务器的 `.dsh/dshmm/mcp.json`，服务器是 [`scripts/ssh-stub-mcp.mjs`](../../scripts/ssh-stub-mcp.mjs)。

（4）在侧栏该工作区上点「New session」，开一个会话——工作区因此变成「活的」，插件才会去连它的 MCP。

### 2. 场景 A：子进程自己退出

（1）服务器以 `--mode=exit --lifetime=8000` 启动，连上 8 秒后自行退出。

（2）插件走 `onExit` 路径，行状态出现「重连中」，错误文案含 `stdio process exited`。

（3）约 1 秒后重拉，行状态回到「已连接」，工具数恢复。

### 3. 场景 B：进程还在但不应答

（1）服务器以 `--mode=hang --lifetime=15000` 启动，连上 15 秒后不再应答，进程与连接都保持存活。

（2）插件靠探活发现：下一次 `tools/list` 卡满固定的 60 秒连接期超时，判定掉线，行状态显示「重连中」，错误文案含 `health check failed`。

（3）重连成功，行状态回到「已连接」，**旧进程必须已经不在进程表里**。

【**注意**】这一步是本用例的重点：重建时若不回收被替换的 transport，就会留下一个无人引用的子进程（stdio 桥还占着远端会话），单元测试和界面都看不出来。

### 4. 执行方式

```sh
pnpm test:cases                        # 两个场景都跑
pnpm test:cases --only hang            # 只跑场景 B
pnpm test:cases --only exit --skip-install --workspace /path/to/workspace
```

单场景耗时：exit 约 25 秒；hang 约 90 秒，其中 60 秒是固定的探活超时，压不下去。

## 四、 通过判据

每个场景同时满足以下五条才算通过：

| 序号 | 判据 | 取值来源 |
| ---- | ---- | -------- |
| 1 | 首次连接成功，工具数 > 0 | `GET /smkit/api/workspaces` 里该服务器的行 |
| 2 | 掉线被看见，文案命中断线方式 | 行上的 `error`：exit → `stdio process exited`；hang → `health check failed` |
| 3 | 重连后回到「已连接」，工具数 > 0 | 同上 |
| 4 | 桩日志里恰好两次 `===== START` | 产物里的 `exit.log` / `hang.log` |
| 5 | 第一个 pid 已不在进程表 | `kill(pid, 0)` 的返回 |

任何一条不满足，脚本以非零码退出，并在终端打印失败原因，例如「旧进程仍存活，重建没有回收被替换的 transport」。

## 五、 产物与清理

（1）产物不自动删除，目录为 `.tmp/test-cases/LV005/<时间戳>/`，含 `exit.log`、`hang.log`（桩自己写的 START / 断开 / 协议流水）、`shot-*.png`、`result.json`、`dsh-web.log`。

（2）复核命令：

```sh
grep -E '===== START|now hanging|self-exit' .tmp/test-cases/LV005/<时间戳>/*.log
```

（3）收尾会备份并恢复工作区的 `.dsh/dshmm/mcp.json` 与 `~/.dsh/mcp-manager.json`，并按端口杀掉用例自己起的 dsh 实例；你原来跑着的实例不受影响。

（4）副作用：工作区里会留下一个新建的会话（开会话是把工作区变活的唯一入口），需要时手工删掉即可。

（5）读日志时注意：换配置或收尾关连接也会让桩打出 `self-exit: SIGTERM received`，那是清理动作，不是重连回收。判断泄漏要看重连发生的那一刻旧 pid 是否还在。

---

*本文档由 markdowncli 技能辅助生成*
