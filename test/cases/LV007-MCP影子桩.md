<!-- more -->

本文是 LV007 功能用例：按需 MCP 工具代理在**不支持延迟加载**的模型路由上的验收。核心是两件事——模型实际收到的 MCP 工具定义是否换成了同名短桩、`/mcp help` 与 `/mcp call` 是否仍然按真实 schema 工作。用例由 [`mcp-shadow-stubs.mjs`](mcp-shadow-stubs.mjs) 自动执行，抓包由 [`llm-capture-proxy.mjs`](llm-capture-proxy.mjs) 完成，本文给出前置条件、步骤与判据——脚本只负责跑，判定口径以本文为准。

## 一、 用例定位

（1）用例编号 LV007，被测功能是「设置 → MCP → 按需 MCP 工具调用」在**路由没有声明 `toolUpdate`**时的降级路径：dsh 会把 `deferLoading` 标记剥掉、完整 schema 照发，插件改用同名短桩（描述一行、参数表留空、executor 保留）来压缩请求；以及两个伴生行为——`/mcp help` 读连接记录而不是注册表（短桩生效时仍给出真实参数），`/mcp call` 仍能执行。

（2）不放进单元测试的原因：[`test/shadow-stubs.test.mjs`](../shadow-stubs.test.mjs) 验的是桩的形状与注册签名，[`test/broker-search.test.mjs`](../broker-search.test.mjs) 验装配与目录，两者都看不到**发往模型的那份请求**。本用例把 provider 临时指向旁路代理，按请求体里的工具条目判定——这是唯一能证明「真的省了」的位置。

（3）与人工文档的关系：[`docs/LV500-MCP管理.md`](../../docs/LV500-MCP管理.md) 的「二、2 按需工具代理」说明了两种暴露方式，本用例是它的自动化验收。

（4）适用范围：改动 broker 装配、工具注册/同步、影子桩、broker 目录、`/mcp` 命令的取值来源之后跑一次。

## 二、 前置条件

（1）`dsh` 在 PATH 上，目标 profile（默认 `web`）的 `cordis.patch.yml` 里有 `baseURL:`——用例要临时把它改到本地代理，收尾还原。用例默认先执行一次 `scripts/dsh-smkit.mjs install --profile web`；只想跑现有产物时加 `--skip-install`。

（2）**能访问真实 LLM provider**：旁路代理只原样转发。判定不依赖模型回复的内容，但 turn 要能结束、界面回到空闲，脚本才会继续下一条输入。

（3）playwright 可解析，无头浏览器能启动；未设 `PLAYWRIGHT_BROWSERS_PATH` 且机器上存在 `/opt/ms-playwright` 时脚本自动指向它。

（4）目标工作区已在 dsh 里注册（缺省取 `~/.dsh/storages/workspace.json` 的第一个）。用例会把工作区 `mcp.json` 临时替换成只含一个测试服务器 [`scripts/rich-mcp.mjs`](../../scripts/rich-mcp.mjs)（三个工具、共 27 个参数）。

（5）用例默认使用 3099（dsh）与 8898（代理）两个端口，启动前先清理自己的旧实例，不会碰你正在用的实例。

## 三、 用例步骤

### 1. 环境准备

（1）备份 profile 的 `cordis.patch.yml`、工作区的 `.dsh/dshmm/mcp.json`、`~/.dsh/mcp-manager.json`。

（2）把 `cordis.patch.yml` 里的 `baseURL` 主机换成本地代理、路径原样保留（`http://127.0.0.1:<代理端口><原 pathname>`），这样 provider 适配器拼出来的请求路径不用改。

（3）起旁路代理：它把请求转给原 provider，并把请求体里的 MCP 工具条目（名字、描述、参数表）写进抓包日志。请求头不落盘，密钥不会进日志。

（4）写工作区 `mcp.json`，只放 `rich` 一个服务器。

### 2. 场景 A：关闭按需代理（对照组）

（1）状态文件写成 `onDemandToolInjection:false`，在 3099 拉起 `dsh web`。

（2）无头浏览器打开带 token 的链接，在工作区上点「New session」，发两轮对话，等界面回到空闲。

（3）收掉实例，读抓包日志：两次请求里的 `mcp__rich__*` 工具都应是完整定义。

### 3. 场景 B：打开按需代理

（1）状态文件写成 `onDemandToolInjection:true`，重启 3099。

（2）同样开新会话、发两轮对话。

（3）再执行两条命令：`/mcp help mcp__rich__serial_exec`（应打印真实参数表）与 `/mcp call mcp__rich__serial_exec {"session_id":"ses-1","cmd":"ls"}`（应看到工具返回）。

（4）收掉实例，读抓包日志：第一轮仍是完整定义（判定发生在装配时，注册已经完成），第二轮起三个工具都应是短桩。

【**注意**】「第一轮仍是完整定义」是已知行为，不是缺陷：dsh 在装配 waterfall 之前就把工具表收好了，短桩要等这一轮装配拿到路由判定后重注册，从下一轮开始生效。用例把它写成判据，防止有人把这段延迟当成回归。

### 4. 执行方式

```sh
pnpm test:cases:shadow                 # 两个场景都跑
pnpm test:cases:shadow --only on       # 只跑场景 B
pnpm test:cases:shadow --skip-install
node test/cases/mcp-shadow-stubs.mjs --workspace /path/to/workspace --port 3099 --proxy-port 8898
```

整轮耗时约 2～3 分钟，主要花在两次 `dsh web` 启动与四轮对话上。

## 四、 通过判据

**场景 A（关闭）**

| 序号 | 判据 | 取值来源 |
| ---- | ---- | -------- |
| 1 | 抓到了至少一次含 MCP 工具的请求 | `capture-off.jsonl` |
| 2 | 每次请求里三个 `mcp__rich__*` 工具的参数表都非空 | 同上，`parameters.properties` 的键数 |

**场景 B（开启）**

| 序号 | 判据 | 取值来源 |
| ---- | ---- | -------- |
| 1 | 第一轮请求里三个工具仍是完整定义 | `capture-on.jsonl` 的第一条 |
| 2 | 最后一轮请求里三个工具的参数表全为空（短桩） | 同上，最后一条 |
| 3 | 短桩描述长度 ≤ 160 字 | 同上 |
| 4 | 短桩描述指向 `mcp_describe_tool` / `mcp_execute_tool` | 同上 |
| 5 | 同一请求里有 `mcp_search_tools`、`mcp_describe_tool`、`mcp_execute_tool` | 同上 |
| 6 | 短桩体积小于全量的 50% | 两条记录里 MCP 工具条目的 JSON 字节数 |
| 7 | `/mcp help` 输出含 `max_bytes`（真实参数名） | 页面正文 |
| 8 | `/mcp call` 输出含 `accepted`（工具被执行） | 页面正文 |

任何一条不满足，脚本以非零码退出，终端会打印具体是哪一条与实测数值（例如「短桩体积小于全量的 50%（817 vs 4012 字节）」）。

## 五、 产物与清理

（1）产物不自动删除，目录为 `.tmp/test-cases/LV007/<时间戳>/`，含 `capture-off.jsonl`、`capture-on.jsonl`（每次请求的 MCP 工具条目）、`dsh-web-*.log`、`off/` 与 `on/` 下的 `turn1.png`、`turn2.png`、`help.png`、`call.png`，以及汇总的 `result.json`。

（2）复核方式：

```sh
node -e "const l=require('fs').readFileSync('.tmp/test-cases/LV007/<时间戳>/capture-on.jsonl','utf8').trim().split('\n').map(JSON.parse);console.log(l.map(e=>e.mcp.map(t=>({n:t.function.name,p:Object.keys(t.function.parameters.properties).length}))))"
```

（3）收尾会按备份还原 `cordis.patch.yml`、工作区 `mcp.json`、`~/.dsh/mcp-manager.json`，并按端口收掉自己的 dsh 与代理。

（4）副作用：状态文件在用例期间被临时改写（全局服务器被清空，收尾恢复）；工作区里会留下一个新建的会话。

（5）若机器访问不到 provider：抓包仍然成立（请求已经发出），但对话不会结束，脚本会在等待空闲超时后继续——`/mcp help` 与 `/mcp call` 两条判据不依赖模型，仍能判定；A 场景的对照结论也仍然成立。

---

*本文档由 markdowncli 技能辅助生成*
