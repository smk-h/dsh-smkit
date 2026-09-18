<!-- more -->

本文说明 dsh-smkit 的 MCP 功能怎么测：覆盖哪几类 MCP、每一类的操作步骤与通过判据、以及配套测试脚本的用法。文中命令均以仓库根目录为当前目录，`$DSH_HOME` 默认是 `~/.dsh`。

## 一、 测试准备

### 1. 前置条件

（1）Node 版本满足 `package.json` 的 `engines`（`^22.19.0 || >=24.0.0`）；

（2）已有一个可启动的 dsh web 环境（`dsh web` 等价于 `dsh --profile web`）；

（3）准备一个**工作区目录**用于测试——工作区级的 MCP 服务器只有在打开该工作区时才会被激活，本仓库本身就是这样一个工作区。

### 2. 构建与装入

宿主端与浏览器端都要重新构建后才能看到改动。用仓库自带的辅助脚本一步完成打包与装入：

```sh
# scripts/dsh-smkit.mjs
pnpm smkit:install          # pnpm pack（prepack 会跑 tsc + tsdown + verify）后装入 web profile
```

等价的纯离线自检（不启动 dsh，只验证插件本体能被加载、`apply` 能挂上路由）：

```sh
pnpm build && pnpm verify && pnpm test
```

### 3. 启动与确认

（1）前台重启 dsh web，日志与访问链接直接输出到当前终端：

```sh
pnpm smkit:debug
```

（2）确认插件已进入配置层：

```sh
dsh --profile web --dump-config | grep smai-kit
# == @smai-kit/dsh-smkit
# - id: mcp-manager
#   name: '@smai-kit/dsh-smkit'
```

（3）浏览器硬刷新（Ctrl+F5）后打开「设置 → MCP」，应当能看到导航里多出 MCP 一行；改动过客户端代码而没硬刷新时，界面会继续跑旧脚本，是排错时最容易踩的坑。

## 二、 测试脚本用法

### 1. 脚本分工

仓库内置五个测试用脚本，按职责分工，都不随 npm 包发布（`package.json` 的 `files` 只含 `lib`）：

| 脚本 | 角色 | 传输 |
| ---- | ---- | ---- |
| [`scripts/slow-mcp.mjs`](../scripts/slow-mcp.mjs) | 连接阶段可控的 MCP 服务器 | stdio |
| [`scripts/ssh-stub-mcp.mjs`](../scripts/ssh-stub-mcp.mjs) | 连上之后自己断开的 MCP 服务器（验掉线自动重连） | stdio（经 ssh） |
| [`scripts/http-mcp.mjs`](../scripts/http-mcp.mjs) | 本地回环的 MCP 服务器，覆盖三种鉴权 | Streamable HTTP |
| [`scripts/http-mcp-cli.mjs`](../scripts/http-mcp-cli.mjs) | 上面那个的一键起停命令 | —— |
| [`scripts/kill-port.mjs`](../scripts/kill-port.mjs) | 端口占用排查与终止 | —— |

【**关键区别**】

`stdio` 类型的条目由**插件替你 spawn** 进程，所以配置写好就会自己起来；`http` 类型的条目插件只往 `url` 发请求，**不会**拉起任何进程，必须在测试前自己启动、测完自己收——这是 HTTP 传输的固有属性，不是脚本的缺陷。

### 2. slow-mcp.mjs（stdio 测试服务器）

单文件、零依赖，只暴露一个 `repeat` 工具（原样回显 `text` 参数）。它的用途是把「连接耗时」和「连接失败」两个场景变成可控的：

| 参数 | 含义 | 默认 |
| ---- | ---- | ---- |
| `--delay=<秒>` | `initialize` 延迟应答的秒数 | `30` |
| `--fail` | `initialize` 延迟后返回错误 | 关闭 |
| `--name=<名字>` | 写进 `serverInfo` 与应答文本，便于区分多实例 | `slow-mcp` |

连接阶段（`initialize` / `tools/list`）的每个请求固定 60 秒超时，所以 `--delay` 建议取 30～55；超过 60 必定以超时错误告终，那也是一个有效场景。工具调用（`tools/call`）的超时可以在「设置 → MCP → 高级」里改（默认 60000 毫秒，见「四、6」）。注册为 stdio 服务器时写 `command = node`、`args = [<本文件绝对路径>, --delay=45]`。

### 3. http-mcp.mjs（HTTP 测试服务器）

单文件、零依赖的 Streamable-HTTP 实现，传输层对齐插件的 [`src/host/features/mcp/mcp/http-transport.ts`](../src/host/features/mcp/mcp/http-transport.ts)：会话头、JSON 与 SSE 两种应答形态、GET 通知流、401 后刷新令牌重试。

【**启动参数**】

| 参数 | 含义 | 默认 |
| ---- | ---- | ---- |
| `--port=<端口>` | 监听端口（`0` 表示由内核挑一个空闲端口） | `8791` |
| `--host=<地址>` | 监听地址 | `127.0.0.1` |
| `--path=<路径>` | MCP 端点路径 | `/mcp` |
| `--auth=<模式>` | `none` / `static` / `oauth` | `none` |
| `--token=<令牌>` | `static` 模式期望的令牌值 | `http-mcp-token` |
| `--token-ttl=<秒>` | OAuth 签发的 `access_token` 有效期 | `3600` |
| `--tools=<数量>` | 暴露的工具数量：`repeat` 加 `bulk_1`…`bulk_N-1` | `2` |
| `--delay=<秒>` | `initialize` 延迟秒数 | `0` |
| `--fail` | `initialize` 延迟后返回错误 | 关闭 |
| `--sse` | POST 用短 SSE 流应答，而不是 JSON | 关闭 |
| `--list-changed[=<秒>]` | 声明 `tools.listChanged` 能力并开启 GET 通知流；带秒数时按周期自动推送 | 关闭 |
| `--auto-approve` | OAuth 授权页直接跳回，不渲染同意页 | 关闭 |
| `--name=<名字>` | 日志前缀与 `serverInfo.name` | `http-mcp` |

【**HTTP 端点**】

| 路径 | 方法 | 用途 |
| ---- | ---- | ---- |
| `/mcp` | POST | JSON-RPC 主通道（`Accept: text/event-stream` 时也可用 GET 开通知流、DELETE 终止会话） |
| `/.well-known/oauth-authorization-server` | GET | OAuth 元数据发现（含授权、令牌、注册三个端点） |
| `/register` | POST | 动态客户端注册（RFC 7591） |
| `/oauth/authorize` | GET | 授权同意页，同意后 302 回插件的回调地址 |
| `/oauth/token` | POST | 授权码换令牌、`refresh_token` 刷新（PKCE S256 校验） |

【**测试钩子**】

这三个端点不属于 MCP 协议，只供手工驱动测试：

| 路径 | 方法 | 用途 |
| ---- | ---- | ---- |
| `/_test/tools-changed` | POST | 向所有已打开的通知流推一条 `notifications/tools/list_changed` |
| `/_test/expire-tokens` | POST | 立即作废全部 `access_token`，逼出 401 → 刷新链路 |
| `/_test/state` | GET | 返回会话、令牌、通知流的计数，用于确认服务端状态 |

### 4. http-mcp-cli.mjs（起停命令）

它把三个实例按预设拉起来，端口与鉴权模式跟下节的示例配置一一对应：

| 模式 | 端口 | 实例名 | 启动参数 |
| ---- | ---- | ------ | -------- |
| `none` | 8791 | `http-mcp-none` | `--auth=none --tools=5 --list-changed` |
| `static` | 8792 | `http-mcp-static` | `--auth=static --token=test-token` |
| `oauth` | 8793 | `http-mcp-oauth` | `--auth=oauth` |

```sh
# 三个一起（前台，Ctrl+C 全部结束）
pnpm http-mcp:serve

# 只起其中一个，可逗号分隔多个模式
pnpm http-mcp:serve oauth
pnpm http-mcp:serve none,static

# 收工：按端口收，手工起的实例也一起覆盖
pnpm http-mcp:stop
pnpm http-mcp:stop oauth
```

实例的 `--name` 与工作区配置里的条目名逐字相同，所以终端日志前缀（`[http-mcp-oauth +2.6s] POST /mcp tools/list → 200`）能直接对上设置页里的那一行。启动时还会把预设端点与 `.dsh/dshmm/mcp.json` 里的 http 条目双向核对，两边对不上会打印提示——端口写岔一个数字正是「服务在跑、插件却一直 fetch failed」的常见原因。

### 5. kill-port.mjs（端口兜底）

`http-mcp:stop` 已经覆盖了 8791～8793，但手工起在别的端口、或 dsh web 自身的端口被残留进程占用时，用它：

```sh
pnpm dsh:kill-port 8793     # 列出占用该端口的进程，确认后终止
pnpm dsh:kill-port 3080 -y  # -y 跳过确认
```

### 6. ssh-stub-mcp.mjs（ssh 自断线测试服务器）

单文件、零依赖。它被拉起后过一段时间**自己断开**，用来验证插件的掉线自动重连（测试步骤见「四、7」）。与 `slow-mcp.mjs` 的分工不同：那个测连接阶段，这个测"连上之后掉线"。

两种断开方式的差别，正好对应插件区分的那两条检测路径：

| `--mode` | 断开的物理含义 | 插件靠什么发现 |
| ---- | ---- | ---- |
| `exit`（默认） | 进程自己退出 → sshd 关会话 → 本地 ssh 退出 | 子进程退出事件，**立即**触发重连 |
| `hang` | 进程与 ssh 会话都活着，只是不再应答 | 探活（定期 `tools/list`），卡满 60 秒超时后判定掉线 |

| 参数 | 含义 | 默认 |
| ---- | ---- | ---- |
| `--lifetime=<毫秒>` | 多久后自动断开；`0` 表示不自动断开 | `20000` |
| `--mode=<exit\|hang>` | 断开方式（见上表） | `exit` |
| `--log=<路径>` | 启动/断开/协议流水写到这里（同时写 stderr）。相对路径按 cwd 解析，父目录不存在会自动创建——配合配置里的 `cd <仓库> &&`，`--log=.tmp/ssh-stub.log` 落在仓库根的 `.tmp/`（已在 `.gitignore` 里）。每行开头是**北京时间**定宽时间戳（`2026-09-18 10:45:26.096`，UTC+8） | 只写 stderr |
| `--name=<名字>` | 写进 `serverInfo`、应答文本，并作为**每行日志的前缀**（`--name=node-stub` → `[node-stub] …`），同一份脚本起多个实例时用它区分 | `ssh-stub` |

除定时断开外，它还提供三个工具便于在对话里**精确控制**时机，不必等定时器：`stub_echo`（回显）、`stub_die`（应答后退出）、`stub_hang`（应答后停止应答）。

同一个脚本也能当**本地 node** 服务器用（不经 ssh），此时验的是"子进程退出即瞬时发现"这条路径——比 ssh 那条少一跳，不依赖 sshd / 密钥 / 端口：

```json
"node-stub": {
  "type": "stdio",
  "command": "node",
  "args": ["./scripts/ssh-stub-mcp.mjs", "--name=node-stub", "--lifetime=20000", "--log=.tmp/node-stub.log"],
  "env": {}
}
```

本地条目的**相对脚本路径与相对 `--log` 都由插件按工作区根解析**（工作区级 `cwd` 默认就是工作区根），所以不需要 `cd`，日志直接落在仓库的 `.tmp/`（已被 `.gitignore` 忽略）。判据与「四、7」相同，只是"掉线"改成 `kill -9 <node 的 pid>`。

每次启动都会往 `--log` 追加一行 `===== START pid=… =====`，所以 `grep -c START <log>` 就是"被拉起了几次"——这是重连是否生效的直接判据。`--help` 打印全部参数。

## 三、 测试配置写法

### 1. 全局与工作区

MCP 服务器分两个层级，配置位置与作用范围都不同：

| 层级 | 配置位置 | 生效范围 | 是否含机密 |
| ---- | -------- | -------- | ---------- |
| 全局（user） | 设置页写入 `~/.dsh/mcp-manager.json` | 所有工作区 | 是（OAuth 客户端注册与令牌存这里） |
| 工作区（workspace） | `<工作区>/.dsh/dshmm/mcp.json` | 仅该工作区 | 否（只存环境变量名，不存值） |

两处界面的行形态不同：全局行是「名称 + 状态胶囊」的卡片，展开后才有开关与操作按钮；工作区行是一行平铺（名称、状态点、状态胶囊、操作按钮），没有启用开关——工作区条目声明即生效，删除即从 `mcp.json` 移除。

### 2. stdio 条目

`slow-mcp.mjs` 用 stdio 注册，`env` 是给子进程的环境变量（值会写进文件）：

```jsonc
// <工作区>/.dsh/dshmm/mcp.json
{
  "mcpServers": {
    "slow-mcp-delay-30": {
      "type": "stdio",
      "command": "node",
      "args": ["./scripts/slow-mcp.mjs", "--delay=30"],
      "env": {}
    },
    "slow-mcp-delay-30-fail": {
      "type": "stdio",
      "command": "node",
      "args": ["./scripts/slow-mcp.mjs", "--delay=30", "--fail"],
      "env": {}
    }
  }
}
```

`args` 里的相对路径按工作目录（未指定 `cwd` 时即工作区根目录）解析。

### 3. HTTP 条目

三个 http 条目分别对应三种鉴权模式，也就是本仓库当前使用的测试配置：

```jsonc
// <工作区>/.dsh/dshmm/mcp.json
{
  "mcpServers": {
    "http-mcp-none": {
      "type": "http",
      "url": "http://127.0.0.1:8791/mcp",
      "authMode": "none",
      "headers": {},
      "headerEnv": {}
    },
    "http-mcp-static": {
      "type": "http",
      "url": "http://127.0.0.1:8792/mcp",
      "authMode": "static",
      "tokenEnv": "MCP_HTTP_TOKEN",
      "headers": {},
      "headerEnv": {}
    },
    "http-mcp-oauth": {
      "type": "http",
      "url": "http://127.0.0.1:8793/mcp",
      "authMode": "oauth",
      "headers": {},
      "headerEnv": {}
    }
  }
}
```

### 4. 字段与注意点

| 字段 | 适用类型 | 说明 |
| ---- | -------- | ---- |
| `type` | 两者 | `stdio` 或 `http`，缺省按 `http` 处理 |
| `command` / `args` / `env` / `cwd` | stdio | `env` 的值会写进文件并传给子进程 |
| `url` | http | 必须带端点路径（如 `/mcp`） |
| `authMode` | http | `oauth`（默认）/ `static` / `none` |
| `tokenEnv` | http + `static` | 只填环境变量**名**，值由 dsh 进程的环境提供 |
| `headers` / `headerEnv` | http | 自定义标头；`headerEnv` 的值同样是环境变量名 |

【**五个容易踩的点**】

（1）**`authMode` 不能省**——缺省值不是 `none` 而是 `oauth`：`normalizeAuthMode()` 只认 `static` / `none`，其它一律回退 `oauth`，所以无鉴权必须显式写 `"authMode": "none"`；

（2）**`env` 对 `http` 类型无效**——工作区配置里 `env` 只在 stdio 分支被读取，写在 http 条目里会被静默忽略，令牌类的东西只能通过 `tokenEnv` / `headerEnv` 指向环境变量；

（3）**名字即工具前缀**——条目名必须匹配 `^[A-Za-z0-9_-]{1,32}$`，它会成为公开工具名的前缀，形如 `mcp__<条目名>__<原始工具名>`，超长时以 sha256 后缀截断；

（4）**工作区条目没有启用开关**——不做区分地留着所有条目，那些没起服务的行会长期显示连接失败；按需增删即可；

（5）**`http` 条目不会自动拉起进程**——见「二、2」的分工表，测之前先 `pnpm http-mcp:serve`。

## 四、 分类测试与通过判据

### 1. stdio 本地进程

验证 stdio 传输、连接耗时展示、以及失败可读性三类行为。用「三、2」的两条配置。

（1）确认两条 `slow-mcp-*` 行已出现，初始状态先不要点任何按钮；

（2）观察 `连接中` 状态的持续时间——由于 `--delay=30`，它应当转约 30 秒才落定；

（3）等 `slow-mcp-delay-30` 变成 `已启用` 后，在会话里调用 `mcp__slow-mcp-delay-30__repeat`，参数 `text` 填任意字符串；

（4）观察 `slow-mcp-delay-30-fail`：延迟结束后应变成 `错误`，卡片上给出注入的失败原因。

【**通过判据**】

| 检查点 | 期望 |
| ------ | ---- |
| 连接中时长 | `slow-mcp-delay-30` 约 30 秒后才落定，不是瞬时 |
| 成功后的工具数 | 显示 `1 个工具` |
| 工具调用结果 | 返回 `repeat(slow-mcp-delay-30): <你传入的文本>` |
| 失败注入 | `slow-mcp-delay-30-fail` 落到 `错误`，原因是 `initialize failed after 30s (injected)` |
| 失败可读性 | 错误里带得出服务端给的原因，而不是一句 `fetch failed` |

### 2. HTTP 无鉴权

验证 HTTP 传输本身，以及无鉴权模式**不发送** `Authorization` 头。服务端用 `--auth=none`，配置用 `http-mcp-none`（该实例额外带了 `--tools=5 --list-changed`）。

（1）`pnpm http-mcp:serve none` 启动 8791；

（2）回到设置页，对 `http-mcp-none` 点「重启」；

（3）观察服务端终端：每来一个请求打一行日志；

（4）在会话里调用 `mcp__http-mcp-none__repeat`。

【**通过判据**】

| 检查点 | 期望 |
| ------ | ---- |
| 状态 | 变 `已启用` |
| 工具数 | `5 个工具`（`repeat` 加 `bulk_1`～`bulk_4`） |
| 服务端日志 | 依次出现 `POST /mcp initialize`、`POST /mcp notifications/initialized`、`POST /mcp tools/list` |
| 授权头 | 日志里**不应**出现「无鉴权模式收到了 Authorization 头」的异常行 |
| 通知流 | 日志出现「通知流已打开（当前 1 条）」，因为该实例声明了 `listChanged` |
| 工具调用 | 返回 `repeat(http-mcp-none): <你传入的文本>` |

### 3. HTTP 静态令牌

验证 `tokenEnv` 的解析路径，以及令牌缺失时给出的提示。

（1）令牌值不在配置文件里，只在 dsh 进程的环境里，所以要在**启动 dsh 的那个终端**先导出，再启动：

```sh
MCP_HTTP_TOKEN=test-token pnpm smkit:debug
```

（2）`pnpm http-mcp:serve static` 启动 8792（预设的 `--token=test-token` 与上面一致）；

（3）对 `http-mcp-static` 点「重启」；

（4）把该行的令牌改成一次错误值（改环境变量后重启 dsh）复现失败分支。

【**通过判据**】

| 检查点 | 期望 |
| ------ | ---- |
| 令牌就位时 | 变 `已启用`，`2 个工具` |
| 令牌缺失时 | 停在 `待认证`，红字 `missing token (set the env var)`；此时插件根本没发请求，服务端日志无新行 |
| 令牌错误时 | 服务端日志出现 `401 拒绝（auth=static）：token mismatch`，卡片落到 `错误` |
| 无认证按钮 | 该行**不应**出现「去认证」——静态令牌没有浏览器往返 |

### 4. HTTP OAuth

验证完整的授权码 + PKCE + 动态注册往返，以及 401 后的刷新重试。服务端用 `--auth=oauth`，配置用 `http-mcp-oauth`。

（1）`pnpm http-mcp:serve oauth` 启动 8793（不加 `--auto-approve`，以便看到同意页）；

（2）对 `http-mcp-oauth` 点「去认证」，浏览器新标签页落在服务端的授权同意页；

（3）点页面上的「同意并授权」，页面 302 回插件的回调地址，插件在服务端完成换令牌与连接；

（4）回设置页确认状态，然后在会话里调用 `mcp__http-mcp-oauth__repeat`；

（5）测刷新链路：作废服务端已签发的令牌，再点一次「重启」。

```sh
# 让下一次 /mcp 请求必定 401，逼插件走 refresh_token
curl -X POST http://127.0.0.1:8793/_test/expire-tokens
```

【**通过判据**】

| 检查点 | 期望 |
| ------ | ---- |
| 按钮名 | 未连接时是「去认证」，连接后变「重新认证」 |
| 点击后 | 按钮原地变成灰底三个点、不可点（不是消失），状态胶囊转 `认证中` |
| 同意页 | 显示客户端 ID 与 `http-mcp-oauth`，是一个可点击的「同意并授权」链接 |
| 回跳页 | 显示 `✅ Authorized`，并写明已连上、注册了几个工具 |
| 状态与工具数 | 变 `已启用`，`2 个工具` |
| 服务端日志顺序 | `动态注册客户端 …` → `渲染授权同意页 …` → `发放授权码 …` → `签发令牌 …` |
| 刷新链路 | 作废令牌后点「重启」仍能回到 `已启用`；日志里出现第二次 `签发令牌`（来自 `grant_type=refresh_token`） |
| 令牌刷新轮换 | 旧的 `refresh_token` 被轮换作废，重放会得到 `invalid_grant` |
| 机密落盘位置 | 令牌**不在** `mcp.json` 里，而在 `~/.dsh/mcp-manager.json` |

### 5. 按需工具代理

验证 broker：开启后模型侧只看到三个代理工具，而不是每个 MCP 工具一个。用工具数最多的 `http-mcp-none`（5 个）最能看出差别。

（1）确保 `http-mcp-none` 处于 `已启用`；

（2）在 MCP 设置页打开「按需 MCP 工具调用」开关；

（3）在新会话里观察工具清单，再依次调用 `mcp_search_tools`、`mcp_describe_tool`、`mcp_execute_tool`。

【**通过判据**】

| 检查点 | 期望 |
| ------ | ---- |
| 工具清单 | 不再逐个出现 `mcp__http-mcp-none__*`，只有 `mcp_search_tools` / `mcp_describe_tool` / `mcp_execute_tool` |
| `mcp_search_tools` | 能按关键词或以 `server` 过滤搜到 `mcp__http-mcp-none__bulk_2` 这类条目 |
| `mcp_describe_tool` | 传入工具全名后返回其入参 schema |
| `mcp_execute_tool` | 传入工具全名与参数后返回该工具的真实结果 |
| 越界工具 | 传入当前会话不可见的工具名时报 `is not visible in this session` |

### 6. 工具调用超时

「设置 → MCP → 高级」里的超时只作用于 `tools/call`，连接阶段仍是固定 60 秒。

（1）配好并启用一个带有已知耗时工具的服务器（例如某个要跑几十秒的批量工具）；

（2）在 MCP 页工具栏点「高级」，把超时改成小于该工具耗时的值（如 `1000`），保存；

（3）在新会话里调用该工具。

【**通过判据**】

| 检查点 | 期望 |
| ------ | ---- |
| 调用结果 | 到设定的毫秒数即以错误结束，而不是挂满 60 秒 |
| 生效时机 | 保存后不需要重启 dsh，也不需要重连服务器，下次调用就按新值 |
| 恢复默认 | 点「恢复默认」后回到 `60000`，`~/.dsh/mcp-manager.json` 里的 `toolCallTimeoutMs` 键消失 |
| 越界输入 | 小于 1000 或大于 1800000 的毫秒值被拒绝，磁盘上的值不变 |

自动化覆盖见 [`test/tool-timeout.test.mjs`](../test/tool-timeout.test.mjs)：它断言了写入校验（越界 400）、落盘与清除，以及超时确实中断了在途的 `tools/call`。

### 7. stdio over ssh 掉线自动重连

验证「**连上过的**服务器掉线后会被自己拉起来」。用 [`scripts/ssh-stub-mcp.mjs`](../scripts/ssh-stub-mcp.mjs) 经本地回环 ssh 拉起，走的是真实 `ssh → sshd → node` 三段，与线上经 ssh 拉起远端 MCP 的形态一致。

【**前置条件**】本机有 sshd 且能免密回环登录：

```sh
ssh -o BatchMode=yes 127.0.0.1 'node -v'
```

返回版本号即可用。报 `Permission denied` 就先做免密（`ssh-keygen -t ed25519`，公钥追加到 `~/.ssh/authorized_keys`）；报 `Connection refused` 说明 sshd 没在监听——**先确认端口**：容器/沙箱里的 sshd 常常不在 22（本仓库的开发容器就是 36000），此时命令与配置都要加 `-p <端口>`，配置里那句远端命令的 `-p` 也要同步。

【**配置**】把 `<仓库绝对路径>` 换成实际路径，作为 stdio 条目加入（「设置 → MCP」右上 ＋ 添加，或写进 `.dsh/dshmm/mcp.json`）：

```json
{
  "mcpServers": {
    "ssh-stub": {
      "type": "stdio",
      "command": "ssh",
      "args": [
        "-i", "~/.ssh/id_ed25519",
        "-o", "ServerAliveInterval=60", "-o", "ServerAliveCountMax=3",
        "127.0.0.1",
        "cd <仓库绝对路径> && node ./scripts/ssh-stub-mcp.mjs --name=ssh-stub --lifetime=20000 --log=.tmp/ssh-stub.log"
      ]
    }
  }
}
```

四个容易踩的点：

- 末位那个 `cd … && node …` 是**一整条远端命令**（ssh 把它交给远端 shell 执行），不要拆成多个数组元素；`--lifetime` 之类的参数只能写在命令行里——`env` 到不了远端，ssh 默认不转发环境变量；
- 开头的 `cd <仓库绝对路径> &&` 不能省：远端 shell 的 cwd 默认是登录目录（家目录），不先锚到仓库根，`./scripts/…` 会解析成 `<家目录>/scripts/…`，报 `Cannot find module`（`remote-start-mcp.bat` 用 `cd /d "%~dp0"` 锚定项目根，是同一个套路）；
- 正因为 cwd 被锚到了仓库根，`--log=.tmp/ssh-stub.log` 会落在仓库的 `.tmp/`（`.gitignore` 已忽略该目录，不存在时脚本自动创建）；
- `-o ServerAliveInterval=60 -o ServerAliveCountMax=3` 是给真实链路用的：前者让空闲连接不被 NAT/隧道回收，后者让链路真断时本地 ssh 最迟 180 秒自己退出，插件才有即时可靠的触发点。

【**步骤**】

（1）「设置 → MCP → 高级」确认「自动重连」为开，「探活间隔」`30000`、「最大重试次数」`0`（不限制），保存；

（2）加入上面的条目，等该行变成「已启用」；

（3）另开一个终端盯日志：`tail -f .tmp/ssh-stub.log`，此时应已有第一行 `===== START pid=… =====`；

（4）等 `--lifetime` 到期（默认 20 秒），或在对话里让它调用 `stub_die`（想手动控制时机就用这个）。

【**通过判据**】

| 检查点 | 期望 |
| ------ | ---- |
| 行状态 | 掉线瞬间变成「重连中」并转圈，行内 `error` 能看到 `stdio process exited: … self-exit: lifetime 20000ms elapsed (mode=exit)`（stub 的生命周期日志走 stderr，会作为断开原因回传） |
| 重启次数 | `grep -c START .tmp/ssh-stub.log` 变成 `2`，且新的 `pid` 与上一次不同 |
| 工具可用 | 重连后 `stub_echo` 仍能调用（工具重新注册，不需要重启 dsh） |
| 关闭优先 | 在「重连中」时点该行的「关闭」，等 3 秒以上：`START` 行数不再增加，状态停在「未连接」 |
| 探活路径 | 改用 `--mode=hang` 重跑：状态先长时间保持「已启用」（探活未到点），约「探活间隔」+ 60 秒后才变「重连中」——那 60 秒是探活请求自身的固定超时 |
| 未连上的不重试 | 把末位命令改成不存在的脚本（如 `node /nope.mjs`）重跑：状态落在「错误」，且**一条 `START` 行都不会有**——首次连接就失败的不进重试队列 |
| 状态留在磁盘 | 上面四步改的四个值写在 `~/.dsh/mcp-manager.json`（`autoReconnect` / `healthCheckIntervalMs` / `reconnectMaxAttempts` / `reconnectMaxDelayMs`），保存后立即生效，不需要重连服务器 |

自动化覆盖见 [`test/auto-reconnect.test.mjs`](../test/auto-reconnect.test.mjs)：六项用例用真子进程（kill 掉）、真端点（HTTP 桩）覆盖同一套状态机，但不经过 ssh；本脚本补的就是 ssh 这一段。

## 五、 问题排查

### 1. 连接类

| 症状 | 原因 | 处理 |
| ---- | ---- | ---- |
| `fetch failed (connect ECONNREFUSED 127.0.0.1:8793)` | 该端口上没有服务在听 | `pnpm http-mcp:serve` 起来；`/_test/state` 可确认模式对不对 |
| 改完端口后一直连不上 | 配置里的 `url` 与实际监听端口不一致 | `http-mcp:serve` 启动时的核对提示会指出差异 |
| `EADDRINUSE` | 端口被残留进程占用（上一次没退干净，或手工起了同名实例） | `pnpm http-mcp:stop`，必要时 `pnpm dsh:kill-port <port>` |
| `initialize failed: …` | 用了 `--fail` 或在延迟超过 60 秒 | 属于预期场景；去掉该参数重启服务端 |

### 2. 凭据类

| 症状 | 原因 | 处理 |
| ---- | ---- | ---- |
| 静态令牌行停在 `待认证`，红字 `missing token (set the env var)` | dsh 进程里没有 `tokenEnv` 指名的那个环境变量 | 在启动 dsh 的终端导出后重启 dsh；注意 `http` 条目的 `env` 字段无效 |
| 服务端日志 `token mismatch` | 环境变量值与服务端 `--token` 不一致 | 两边改成同一个值 |
| OAuth 行停在 `待认证`，点「去认证」无反应或报错 | 服务端不是 `--auth=oauth`，OAuth 端点返回 404 | 确认实例模式；`/oauth/authorize` 之外还会用到 `/.well-known/oauth-authorization-server` |
| 回跳页 `Authorization failed` | `state` 过期、授权码被重放，或回调地址与注册值不一致 | 从设置页重新点一次「去认证」；注意回调地址由插件按当前 `Host` 现算，换端口访问 GUI 会重新注册客户端 |

### 3. 状态与界面类

| 症状 | 原因 | 处理 |
| ---- | ---- | ---- |
| 一直停在 `认证中` | 授权流程开了标签页但没点同意，或标签页被直接关掉 | 点「重启」退出该状态，再重新发起认证 |
| 工作区行看不到 | 没打开该工作区，工作区条目不会激活 | 打开对应工作区后回设置页刷新 |
| 改了客户端代码但界面没变 | 浏览器缓存了旧的客户端脚本 | 重新 `pnpm smkit:install` 后重启 dsh web，并硬刷新（Ctrl+F5） |
| 全部条目都显示连接失败 | 服务端实例没起，而工作区条目没有启用开关可以关掉 | `pnpm http-mcp:serve`；不需要的条目直接从 `mcp.json` 删掉 |

---
*本文档由 markdowncli 技能辅助生成*
