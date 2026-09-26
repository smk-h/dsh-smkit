## 一、 项目简介

### 1. 背景

我有一个 MCP 项目 [smk-h/embedded-mcp-toolkit](https://github.com/smk-h/embedded-mcp-toolkit)，它每次启动都会写入一个日志文件。[dsh-v0.1.5-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) 原本就支持直接配置 MCP，但这种配置是全局生效的：只要 dsh 启动，就必定拉起该 MCP，并且在任何工作区都能操作它。可我大多数时候只是启动 dsh ，并不一定需要连接这个 MCP，于是每次启动都会白白多出一个日志文件。

我的需求很明确：**只在打开某个工作区时，才启用该工作区的 MCP**。顺着这个需求，找到了下面两个插件：

- [hyqhyq3/dsh-mcp-manager](https://github.com/hyqhyq3/dsh-mcp-manager)：按工作区启用 MCP，避免全局常驻
- [yangfch3/dsh-mcp-mgr](https://github.com/yangfch3/dsh-mcp-mgr)：提供重启按钮，点击即可重启 MCP

[hyqhyq3/dsh-mcp-manager](https://github.com/hyqhyq3/dsh-mcp-manager) 确实好用，满足了我的核心需求，但很快又出现了新问题：我大部分使用场景是在 Linux 服务器上通过 SSH 启动 Windows 中的 MCP，长时间不用后连接会断开，MCP 失去响应（这个我没有具体深究，右面有必要再说），这时只能重启 dsh（现在本插件已支持掉线自动重连，见 [2.1.4](#214-掉线自动重连)，不必再手动重启）；而「重启 MCP」的能力又只存在于 [yangfch3/dsh-mcp-mgr](https://github.com/yangfch3/dsh-mcp-mgr) 中。两者分属不同插件，总不能一次装两个，那也太麻烦了。

所以我决定参考以上两位作者的项目，用 AI 搓一个同时满足这两点的插件，以后也方便加入自己的一些需求。如有需求，请使用作者原版插件，本插件仅供自己学习使用，也许后续作者直接支持了，这里可能就会放弃这个插件了。

> [!NOTE]
> 本项目功能对齐上游 [hyqhyq3/dsh-mcp-manager](https://github.com/hyqhyq3/dsh-mcp-manager) 的 `b029407c`（v0.12.0，2026-09-11）。两个仓库没有共同提交历史，同步指功能语义对齐而非 git 合并；两者各自独立发布，版本号不互相对应。

### 2. 项目介绍

dsh-smkit 是运行在 [DeepSeek Harness（dsh）](https://deepseek-harness.github.io/deepseek-harness/) 上的 Cordis 插件，基于 MIT 协议开源，目前提供七个功能：MCP 管理、技能管理、会话删除、自定义配置、OpenSpec 管理、主题中心与完成通知。

#### 2.1 MCP 管理

「设置 → MCP」页统一登记、启停、编辑、删除 MCP 服务器，停用的服务器不会在启动时被拉起：

- **传输**：远程 HTTP 支持 OAuth PKCE + 动态客户端注册、静态 Bearer Token 与无鉴权三种认证，无鉴权模式不发送 `Authorization` 头，适合本机这类不做认证的端点（如 `http://127.0.0.1:9316/mcp`）；本地 stdio 直接拉起子进程。
- **工作区隔离**：工作区独享的服务器写在 `<workspace>/.dsh/dshmm/mcp.json`，全局服务器也可按工作区屏蔽；作用域选择旁可一键打开当前生效的配置文件（全局为 `~/.dsh/mcp-manager.json` 状态文件，工作区为该工作区的 `mcp.json`）。
- **命名**：服务器名取 1～32 位 `[A-Za-z0-9_-]`，与工具原始名拼成模型可见的 `mcp__<服务器名>__<工具名>`；不同工作区可声明同名服务器，规则见 2.1.5。
- **运行时控制**：可重启或关闭单个服务器的连接，长连接断开后不必重启 dsh；「高级」里还可开启掉线自动重连，由插件自己发现并重建连接（见 2.1.4）。

##### 2.1.1 工具清单

已连接的服务器不只知道「有几个工具」：

- 行上是一句可点开的工具摘要（`N 个工具` + 折叠箭头），点开才列出注册的工具名——几十个工具也只是一行，不点不占地方。
- 鼠标悬浮、或用键盘 Tab 到某个工具名，弹出该工具在服务端声明的原始描述与入参（参数名、类型、是否必填与说明）；浮层可滚动、可走进去看，点它不会消失，文字可直接选中复制。

##### 2.1.2 按需工具代理

「设置 → MCP」页提供「按需 MCP 工具调用」开关（可选）：开启后该 MCP 仅暴露 search、describe、execute 三个 broker 工具，避免几十个工具一次性占满上下文。

##### 2.1.3 工具调用超时

「设置 → MCP → 高级」可配置工具调用超时，默认 60000 毫秒，范围 1000～1800000：

- 只作用于 `tools/call`；连接阶段（`initialize` / `tools/list`）仍是固定 60 秒。
- 保存后立即生效，不需要重连服务器，也不需要重启 dsh。

##### 2.1.4 掉线自动重连

同一个「设置 → MCP → 高级」里的「自动重连」块（默认开启）：传输断开后插件自己重建连接，不必手动点「重启」，也不必重启 dsh。

- **只对「连上过、又掉线」的连接重试**。所谓重连，前提是它真的连上过：第一次就没连上的（地址不通、命令写错、令牌没配、还没走完认证跳转）原样留着，不排队重试；已经处于「待认证」的也不会被反复敲门。这条规则同样延续到重试链里——重试过程中若落到需要人处理的状态（最典型是「待认证」，比如令牌过期且刷新失败），就地停手并把决定权交回给人，而不是一直敲。
- **两种掉线都发现得了**。一是**子进程退出**——stdio 服务器的子进程自己死了就立刻触发重连；远程 SSH 场景下这个子进程正是 `ssh` 通道本身，链路断掉它就会退出，所以这条路是即时的。二是**链路半死**——进程还在、会话已经没了（半开 TCP、卡死的通道），这种情况没有任何信号，靠「探活间隔」定期发一次 `tools/list` 去问，问不通即算掉线。
- **`tools/call` 失败不触发重连**。工具返回 `isError` 和传输层断掉在这一层是同一种错误形状，据此重连会因为一次普通的工具报错就把好连接拆掉；退出信号加探活已经覆盖了同类情况，不必猜。
- **退避与放弃**：重试间隔从 1 秒起翻倍，到「重试间隔上限」（默认 30000 毫秒，范围 1000～600000）为止，带 20% 以内的抖动；「最大重试次数」（0～100）填 0（默认）表示不限制、一直重试。
- **探活间隔**（默认 30000 毫秒，范围 0 或 1000～600000）填 0 就关掉探活，只留子进程退出信号。
- **状态可见**：重连期间该行显示「重连中」并继续转圈，行内的错误文字写明原因和下一次重试的时间；次数用尽则落到「错误」并注明已放弃。
- **主动停止优先**：重启、关闭、停用、删除、工作区释放、插件卸载都会取消已经排上的重试——否则刚点完「关闭」，2 秒后又被拉起来。
- **落在哪**：四个值写入 `~/.dsh/mcp-manager.json`（`autoReconnect`、`reconnectMaxAttempts`、`reconnectMaxDelayMs`、`healthCheckIntervalMs`），保存后立即生效，下一次掉线就按新值走。
- **SSH 侧建议**：链路真的断掉时，本地 `ssh` 得自己先察觉才会退出。给参数补上 `-o ServerAliveInterval=60 -o ServerAliveCountMax=3`（每 60 秒一个保活包，连续 3 个无应答即断开退出）后，空闲连接不会被 NAT/隧道回收，断线也能在 180 秒内被 ssh 自己发现；不加也能跑，只是最坏要等一个探活周期再加一个请求超时。
- **怎么手动验证**：[`scripts/ssh-stub-mcp.mjs`](scripts/ssh-stub-mcp.mjs) 是一个会自己断开的 MCP 服务器，经本地回环 ssh 拉起即可复现掉线与重连；配置写法和判据表见 [`docs/LV001-MCP功能测试.md`](docs/LV001-MCP功能测试.md) 的「二、6」与「四、7」。

##### 2.1.5 命名规则

服务器名取 1～32 位 `[A-Za-z0-9_-]`：全局服务器是 `~/.dsh/mcp-manager.json` 里 `servers[].name`，工作区服务器是 `<workspace>/.dsh/dshmm/mcp.json` 里 `mcpServers` 的键。它会直接成为工具名的前缀，因此不允许其他字符。

工具对模型暴露的名字是 `mcp__<服务器名>__<工具原始名>`：

- 两处分隔符都是双下划线；工具原始名里非 `[A-Za-z0-9_-]` 的字符一律替换为 `_`（服务器名本身已受上面的字符集约束，不需要替换）。
- 公开名超过 64 字符时，保留前 51 个字符再补 `_` 与 12 位 sha256 后缀，避免不同工具因截断而撞名。
- 工具描述末尾附带 `[<服务器名> MCP]`，名字被截断后仍能看出它属于哪个服务器。
- 公开名的拼接与 dsh 内置 MCP 客户端逐字节一致，按名字反查服务器的调用方不必改动。
- 改服务器名会连带改变工具的公开名，此前按旧名字引用过它的会话与指令需要同步更新。

名字的唯一性按作用域划分，与工具的可见范围一致：

- **全局层全局唯一**：全局服务器的工具注册进共享的根注册表，每个 agent 都看得到，因此名字不能重复。
- **工作区层只避让全局层**：不同工作区可以声明同名服务器，各自独立进程、独立连接、独立凭据；工具注册进该工作区 agent 自己的注册表，所以不会有 agent 同时看到两份 `mcp__<名字>__*`。
- **同一工作区内唯一**：`mcp.json` 里 `mcpServers` 的键本身不重复。

在设置页新增或改名时，重名会被直接拒绝（409）；手写的 `mcp.json` 与全局服务器重名时，该行以「冲突」呈现并在行内给出错因，服务器不会被拉起。工作区层只避让全局同名，全局层还会计入当前已打开工作区的占名。

#### 2.2 技能管理

「设置 → Skills」把 Agent Skills 收进同一套设置页，目录选择器分两栏：

- **用户**：两个 home 一档（`~/.dsh` 与 `~/.agents`），选择器里就叫「用户」，内部以两个标签页分开，一次请求读齐两个目录。
- **项目**：每个工作区一档，名字用 dsh 自己存的 title（不是文件夹名）；选中后项目下的 `.dsh/skills` 与 `.agents/skills` 以两个标签页分开显示。
- **列表与操作**：顶部写出的就是这次实际读的目录；搜索框按名称、描述、适用场景与分组过滤，紧挨着它的刷新按钮可立即重读，不等下一次轮询。每行给出技能名、一句描述与所在分组、`链接`、`已停用` 等标记，点击整行打开详情（描述、适用场景、状态、调用方式、分组、根目录、文件路径），行尾是启停开关与移除按钮；列表每 3 秒自动刷新一次。
- **启停与移除**：启停是把头部在 `SKILL.md` ↔ `SKILL.md.disabled` 之间原地改名——dsh 只认 `SKILL.md`（单文件技能只认 `*.md`），所以停用后 agent 不再加载它，但文件仍留在磁盘上；移除前弹确认框，框里列出将要删除的那个文件或目录。
- **直接读磁盘**：这一页扫描那四个根目录而非 dsh 的技能注册表，并比官方 provider 多做三件事——跟随软链接与 Windows junction（移除只摘掉链接本身，绝不穿过链接删除目标）、读取嵌套技能（`<根>/<分组>/<技能>/SKILL.md`）、列出已停用的技能。

#### 2.3 删除会话

会话窗口右上角提供「删除会话」按钮。dsh 自带的「归档会话」只是把会话从列表里隐藏、日志仍留在磁盘上，这个按钮会真正删掉当前会话的本地数据：

- 删除范围是会话目录（全部日志世代与写锁）、投影缓存行与该会话的溢出文件目录，随后侧边栏条目同步消失，并在原工作区直接开好一个新会话（不必再选一次工作区），全程局部更新、不刷新页面。
- 确认框先列出这次要删的东西：会话 ID、标题、工作目录、创建时间，以及三个存储位置各自的**实测**占用与文件数、合计大小。这些数字来自宿主端的干跑，与真正删除走同一套路径解析与前置校验，因此不会出现「确认框说能删、点下去被拒」或「显示的大小与实删不一致」。
- 图片与文件附件按内容哈希存放在 `~/.dsh/attachments` 下，同一个字节可能被多个会话引用，删掉会破坏其他会话的历史，因此不在删除范围内。
- 按钮悬停时的气泡也是 dsh 界面里那一个：复用宿主平台的 `Tooltip` 组件（`@deepseek-ai/dsh-client-ui-primitives`，与标题栏右侧按钮同款），配色、动画与延迟跟宿主一致；宿主模块表里没有该模块时退回浏览器原生的 `title`，按钮功能不受影响。

#### 2.4 自定义配置

「设置 → 自定义设置」页收拢 dsh 里那些值得单独调、又不常改的配置，一个标签页一块：

- 「模型重试」为每个已注册的提供方路由配置模型请求失败后的自动重试——模式（normal / always）、重试次数、退避间隔与抖动比例；「其他设置」先列出后续准备接入的配置项。
- 写入的是 dsh 自己的 `settings.yaml` 对应配置段（`llm-pi-ai.providers.<路由>.retryPolicy`、`llm-deepseek.retryPolicy` 等），保存后立即生效、不需要重启 dsh；路由不在此页新增或删除，重试策略只跟随已注册的提供方。

#### 2.5 管理 OpenSpec

会话窗口右上角「删除会话」按钮旁是一个 atom 按钮，用来管理当前工作区的 [OpenSpec](https://github.com/Fission-AI/OpenSpec)。鼠标**移动到**按钮上即弹出面板（离开控件后有约 240 毫秒宽限，够鼠标斜着移到面板上；指针进到面板或回到按钮就取消）。这里特意不认「指针已在按钮上」这一个事实：这一排按钮靠着会话区右边缘，收起侧边栏（关掉最后一个标签页就会收起）会让整排按钮从静止的指针下面滑过去，浏览器同样会报一次「指针进入」——那没人真的去够这个按钮，面板不该因此弹出来；而手移进来的那一次，浏览器必定在同一帧里再补一个移动事件，所以按移动来开不会有延迟，指针停在按钮上不动只会等下一次移动。面板里写清三件事：

- **初始化状态**：这个工作区跑没跑过 `openspec init`（判据就是项目根目录下有没有 `openspec/`）；此外只报一件目录树答不了的事——布局里该有、磁盘上却没有的部分（`specs`、`changes`、`config.yaml` 这些当前 CLI 会写的）。项目根目录取最近的含 `.git` 的祖先，所以工作区在仓库子目录里（`packages/app`）也能定位到真正写入 `openspec/` 的那个根；早先版本留下的 `project.md` / `AGENTS.md` 不在「该有」之列，缺了不吭声。
- **技能与命令**：`openspec init --tools …` 留在各编辑器目录里的技能与命令（`.agents/skills/openspec-propose`、`.claude/commands/opsx`、`.cursor/commands/opsx-apply.md` 之类）按目录分组，收在标题后面、默认折叠，点标题展开（标题上的计数始终可见）；展开后条目两列排开，等宽对齐，超长名省略并把完整路径放在悬停提示里。同一目录被多个工具写入时（Codex、Zed 与厂商中立的 `agents` 都写 `.agents/skills`）只列一次并注明是哪几个工具。
- **文件树**：`openspec/` 放在面板最下面，按 `tree` 命令的格式展开（`├──` / `└──` 连线、等宽字体对齐，目录加粗，文件给实测大小，标题上带文件数与目录数）——生成物是本面板要回答的问题，store 的布局是读它时的参照。
- **一键初始化**：没初始化过时，面板底部给的是「初始化 OpenSpec」按钮，点击即在项目根目录执行 `openspec init --tools agents --force`。`agents` 是写入 `.agents/skills` 的厂商中立目标，正好是 dsh 加载技能的项目根之一，所以刚生成的技能立刻就能被看到；`--force` 与环境变量（`OPENSPEC_NO_ANIMATION` / `OPENSPEC_NO_UPDATE_CHECK` / `OPENSPEC_TELEMETRY=0` / `NO_COLOR`）把动画、颜色和版本检查都关掉，标准输入也是关闭的管道，因此没有终端也不会卡在提问上。失败分三类：没装 CLI（提示安装命令）、超时、CLI 自己报错（原文照搬），CLI 的输出直接显示在面板里。
- **一键删除**：面板底部的删除按钮，确认框里先列出将要删除的全部内容（`openspec/` 目录算一项，技能与命令各算一项），确认后连同技能一起删除；没能删掉的条目会留在面板里并写明原因，不会读成「已删干净」。`openspec/` 被手删、技能还在时不在这两种状态之间二选一，面板会同时给出「初始化」与「删除」。
- **只动 OpenSpec 自己的东西**：`.agents/skills`、`.claude/commands` 这类目录是共享的——前者装着机器上所有技能，后者装着使用者自己写的所有命令——所以删除的单位始终是一个条目（技能目录以 `openspec-` 开头，命令以 `opsx` 开头），**共享目录本身永远不是删除目标**。CLI 自己的归属标记 `.openspec-target` 也在删除范围内：它既不是技能也不是命令，但留着它，下次 `openspec update` 就会把刚删掉的技能装回来。真正确认时，确认框会写明这些目录里还有多少条目不属于 OpenSpec、会被保留；宿主端在删除前还会按前缀再校验一次目标，名字对不上就不删。

面板只呈现宿主端读到的结果，浏览器不自己拼路径：删除时宿主会用同一张工具表重新推导一遍目标，逐个校验「落在项目根内 + 位于该组目录的直接子级 + 仍带着 `openspec-` / `opsx` 前缀」，符号链接与 Windows junction 都只摘掉链接本身。

#### 2.6 主题中心

「设置 → 通用」页里的「主题中心」行内置 13 款主题配色：海洋、午夜、极光、森林、石墨、墨黑、薄荷、煤灰、终端、钢铁、秋日、抹茶、极简：

- **点卡片即生效**：一款主题就是一段以 `body[data-dsh-theme="<id>"]` 限定作用域的 CSS，换肤只动两处——整段替换专用 `<style id="dsh-theme-active-style">` 的文本、给 body 挂上属性。主题元素与其他设置页的样式各自独立，换任何一款都冲不掉设置界面自己。
- **昼夜三态**：自动 / 浅色 / 深色。「自动」把决定权交回宿主内置的外观设置；浅色与深色直接驱动宿主自己的 `data-ds-dark-theme` 属性，每款主题都带昼、夜两套配色，卡片预览跟随的是实际夜态而不是这里的偏好。
- **选择只存在浏览器里**：记在 localStorage 的 `dsh-theme:theme` / `dsh-theme:mode` 两个键上，刷新或重开页面即恢复；不写 dsh 的 `settings.yaml`，不落任何服务端文件，也不随工作区走。
- **编程接口**：插件挂载时把同一套状态暴露为 `window.dshTheme`（`list` / `get` / `set` / `reset` / `cycle` / `setMode` / `getMode`），控制台里就能换肤、轮播，效果与点卡片完全等价。

> [!NOTE]
> 主题 CSS 与卡片预览数据取自 [mux9056-bot/dsh-theme](https://github.com/mux9056-bot/dsh-theme)（Apache-2.0），本仓库只取其 30 款主题包并裁剪为上述 13 款；作者的这些主题都是纯色主题，很简约，但是颜色可能不是我想要的，所以参考了原作者的主题风格，后面自定义成自己喜欢的。

#### 2.7 完成通知

「设置 → smkit 配置 → 通知」页提供桌面通知：dsh 的任务完成、出错，或需要确认工具调用（`approval/request`）、回答提问（`user-questions/request`）时，由 **dsh 所在机器的进程**直接弹 Windows 系统通知并播放提示音——不经过网页，所以浏览器没开、页面已关也照常提醒；点击通知会用默认浏览器打开 dsh 页面（地址取自页面心跳上报的来源）。

- **触发时机**：监听宿主事件总线上的 `api-session/status`（`running` 由 `true` 变 `false` 即完成）、`api-session/error`（任务出错）、`approval/request` 与 `user-questions/request`（需要你确认 / 需要你回复），文案与 ZCode 相同：「任务已完成 / 任务出错 / 需要你的确认 / 需要你的回复 / 计划等待确认」。子代理会话的完成与出错不打扰（它们是父任务的内部机器），但子代理要确认时仍会提醒。
- **只在离开时打扰**：唯一的静默条件是「dsh 页面正被聚焦」——网页端每 5 秒上报一次聚焦心跳，失去焦点立即上报；心跳停止（页面关闭、浏览器退出）8 秒后恢复提醒。这就是 ZCode 的同一条规则：窗口聚焦时什么都不发，没有别的「离开检测」。
- **多任务并发**：不做聚合，几个会话同时结束就各弹一条；同一 `kind:目标` 在 3 秒窗口内只弹一次（确认与提问按交互对象去重），与 ZCode 的去重窗口一致。出错后紧跟的 `status → false` 不再补一条「任务已完成」。
- **提示音**：一段 mp3 由宿主解码到临时目录后经 MCI 播放，toast 本身静音——即声音只在通知真正弹出时响一次，不会双重响。资源与播放选择（`WinRT ToastNotificationManager` + `winmm` MCI，脚本经 `-EncodedCommand` 传输以保中文无损）见 [`src/host/features/notify/toast.ts`](src/host/features/notify/toast.ts)。
- **两个开关与常驻时长**：通知总开关、提示音子开关（默认都开）与「常驻时长」三档——标准（约 5 秒，默认）、加长（约 25 秒，`duration="long"`）、常驻（`scenario="reminder"`，一直显示直到手动关闭；该模式要求通知至少带一个按钮，所以常驻通知总是附带「知道了」关闭钮，已知 dsh 地址时再加「打开 dsh」）。设置落在 `~/.dsh/smkit-notify.json`，保存即生效；「发送测试通知」按钮无视聚焦抑制直接弹一条，方便确认链路。
- **远程部署的第二条投递路**：dsh 跑在远程主机上、页面经 SSH 隧道在本地浏览器打开时，宿主机器上没有屏幕可弹——此时面板多出「浏览器通知」一行，授权后由**浏览器代发**：宿主把决策经 `GET /smkit/api/notify/events` 事件流推给每个打开的页面，页面用 Web Notification API 弹出（`tag` 即去重键，多个标签页同收一帧也只显示一条），声音从 `/smkit/api/notify/sound` 拉取同一段 mp3 播放。隧道场景恰好满足 Web Notification 的安全上下文要求（页面地址是 `localhost`；用局域网 IP 访问则不支持）。去重、边缘触发与聚焦抑制仍全部在宿主侧完成，浏览器只负责显示。局限要说清：这条路要求标签页开着（后台标签、最小化浏览器都行），页面关了就收不到——要覆盖它得 Service Worker + Web Push，对本地工具过重，不做。Windows 宿主不走这条路（原生 toast 已覆盖包括页面关闭在内的一切情况），两条路按宿主平台二选一，不会双重弹。
- **限制**：仅 Windows 生效（其余平台挂载后静默跳过）；系统专注助手 / 勿扰模式可能在系统层拦截通知；toast 的通知来源显示为「Windows PowerShell」——dsh-smkit 没有自己的开始菜单快捷方式（AUMID），只能借用 PowerShell 的，这是 WinRT toast 的身份要求，无碍使用。

> [!NOTE]
> 提示音取自 [ZCode](https://github.com/zcode-ai/zcode)（Apache-2.0）自带的任务通知音效 `task-notification-pop.mp3`，逐字节未改动地随插件分发（[`src/host/features/notify/assets/`](src/host/features/notify/assets/)，构建为 base64 内联的 [`sound-data.ts`](src/host/features/notify/sound-data.ts)，可由 [`scripts/generate-sound-data.mjs`](scripts/generate-sound-data.mjs) 重新生成），故 dsh 的通知听感与 ZCode 完全一致。

### 3. 图标来源

插件的图标不从图标库引入运行时依赖，而是把上游的 SVG 数据内联进 [`src/client/platform/icons/`](src/client/platform/icons/)（多个页面共用的字形）与各特性的 `icons/` 目录（只有一个页面画的字形）：每个图标一个文件、以图标名命名，文件头部注明上游库、版本与许可。来源主要两处：

- [lucide](https://lucide.dev)（中文镜像站为 [lucide.nodejs.cn](https://lucide.nodejs.cn)）：导航图标、搜索与清空、刷新、连接中的弧线等。采用 ISC 许可，版权归 Lucide Contributors（2022）所有，其中部分版权归 Cole Bemis（2013 至 2022 年，源自 Feather 项目，MIT 许可）所有。
- 宿主自带的 `@deepseek-ai/dsh-client-ui-primitives`（MIT，© 2026 DeepSeek）：删除、作用域选择器（全局 / 项目 / 展开箭头 / 选中打勾）等与 dsh 界面保持一致的字形。

后续要升级或新增图标时，回到上游图标页复制 SVG，替换对应文件里 `nodes` 的路径数据，并同步更新文件头部；图标的渲染与 CSS mask 序列化统一由 [`Icon.tsx`](src/client/platform/icons/Icon.tsx) 的 `createIcon()` 与 `iconMaskDataUri()` 负责，不需要为此引入任何依赖。

## 二、 插件工作原理

### 1. 加载流程

教程中的最小运行方式是：启动器创建根 Context 并挂载 Loader，Loader 读取 `cordis.yml`，把每一行 `name` 指向的模块作为子插件挂载，随后以 `ctx` 上下文调用其 `apply`；没有内容继续运行时进程自行退出。

- `name` 导出是可选的显示元数据，用于在诊断信息中标识插件。
- `apply` 抛出异常时进程会终止并明确报错，不会静默跳过。
- 模块无法解析（路径或包名拼错）时，Cordis 通过 logger 服务报告而不使进程崩溃，因此新配置项无效果时应先检查拼写。

### 2. 插件包的三个组成部分

```text
dsh-smkit/
├── package.json       # ① 声明 dsh.bundle + peerDependencies
├── cordis.patch.yml   # ② bundle 贡献的配置层：insert 一行插件挂载项
├── src/index.ts       # ③ 插件本体（教程中的函数形态插件）
│     └→ lib/index.js  #    tsc 编译产物（运行时真正加载的文件）
├── test/verify.mjs    # 离线自检（prepack 时强制跑；不随包发布）
└── tsconfig.json / pnpm-workspace.yaml
```

#### 2.1 package.json 的 manifest

[`package.json`](package.json) 中的 `dsh.bundle` 字段指向配置层文件：

```jsonc
// package.json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

插件只依赖宿主提供的 `@deepseek-ai/cordis`（`Context` 类型），以 `peerDependencies` 声明即可，由宿主环境在运行时解析，不需要打进插件包。

#### 2.2 cordis.patch.yml 配置层

教程用 `cordis.yml` 里的 `- name: './hello.ts'` 挂载本地模块。`name` 是模块指定符，可以是相对路径，也可以是 npm 包名；dsh 插件包走的正是第二种——bundle 配置层用包名挂载已安装的插件代码。

[`cordis.patch.yml`](cordis.patch.yml) 用一个 `insert` 行完成这件事：

```yaml
# cordis.patch.yml
- insert:
    - id: hello          # 行 id：用户按它覆盖/禁用
      name: 'dsh-smkit'  # 按包名引用，Node 模块解析找到已安装代码
```

`dsh plugin --profile <name> add <包>` 安装时会扫描依赖里声明了 `dsh.bundle` 的包，把它的配置层追加进 `dsh.profile.bundles`；profile 启动时按「dsh-base 基础层 → 各 bundle 层 → profile 自身配置层 → 全局覆盖层」的顺序合并。

#### 2.3 插件本体

[`src/index.ts`](src/index.ts) 与教程示例一致：

```ts
// src/index.ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

### 3. 三种插件形态

教程给出了三种等价的插件形态，并建议在需要公开服务之前一直使用函数形态（本仓库即函数形态）：

（1）函数插件，本仓库当前使用的形态：

```ts
export function apply(ctx: Context) {}
```

（2）对象插件，即带 `name` 与 `apply` 的对象：

```ts
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}
```

（3）类插件，即 Service 子类（教程第 3 章详解）：

```ts
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myTutorialService')
  }
}
```

### 4. 两半的分工

插件分为宿主端与浏览器端两半，均以 TypeScript 编写：宿主端挂载 `/mcp-manager/api` 路由、管理 MCP 连接与工作区作用域，浏览器端负责渲染设置页与会话窗口中的删除按钮，两者通过同一组 API 通信；界面上的图标、选择器、提示气泡等共用部分都收在浏览器端的 `platform/` 层，各功能只提供自己的内容与样式。

## 三、 快速开始

### 1. 本地开发

```sh
pnpm install        # 装 devDeps（peer 会自动拉下来供类型检查）
pnpm build          # tsc 编译 src → lib
pnpm verify         # 离线自检：模块形态 / apply 输出 / 配置层与 manifest 一致性
pnpm dev            # watch 模式
```

### 2. 安装进 profile

```sh
# 方式 A：本地 checkout（跨盘符时不可用，见下方说明）
dsh plugin --profile demo add E:/AI/dsh-smkit

# 方式 B：tarball（预构建，免 allowBuilds 授权；跨盘符开发用这个）
pnpm pack
dsh plugin --profile demo add E:\AI\dsh-smkit\smai-kit-dsh-smkit-<version>.tgz

# 方式 C：git（安装时执行 prepare 脚本构建 lib/）
dsh plugin --profile demo add github:smk-h/dsh-smkit
```

方式 A 实测注意：当 profile（通常在 `C:` 盘的 `$DSH_HOME`）与项目不在同一盘符时，pnpm 会把 `link:` 目标当相对路径解析，在 profile 的 `node_modules` 下生成坏 junction，dsh 启动时警告 `dsh-smkit declares no dsh.bundle`，插件不会进层。此时改用方式 B。

方式 C 安装时 pnpm 会执行 `prepare` 脚本构建 `lib/`，需要先在 profile 的 `pnpm-workspace.yaml` 里授权构建脚本：

```yaml
# $DSH_HOME/profiles/demo/pnpm-workspace.yaml
allowBuilds:
  dsh-smkit: true
```

可用 `github:smk-h/dsh-smkit#<sha>` 锁定 commit。

### 3. 验证

```sh
dsh --profile demo --dump-config | Select-String "dsh-smkit" -Context 1
#   # == dsh-smkit
#   - id: hello
#     name: dsh-smkit
```

启动该 profile 时，加载器挂载插件并以 `ctx` 调用 `apply`，控制台输出教程预期的 `hello from my first plugin`。

### 4. 卸载与更新

```sh
dsh plugin --profile demo remove @smai-kit/dsh-smkit   # 同时移除依赖和层
dsh plugin --profile demo update @smai-kit/dsh-smkit   # pnpm update + reconcile
```

## 四、 调试

调试分两条路径：项目内调试不启动 dsh，改码后快速验证插件本体；宿主内调试把插件装进 profile，在真实 dsh 环境里验证挂载、启动与运行。两种路径都可以挂 VSCode 断点（见本章第 4 节）。

### 1. 项目内调试（不启动 dsh）

最快的回归循环是离线自检。`test/verify.mjs` 模拟加载器行为：以 ESM 方式 import `lib/index.js`、检查具名导出、调用 `apply` 并断言输出：

```sh
pnpm build && pnpm verify
```

要跳过编译直接跑 TypeScript 源码，建一个临时入口 `.scratch-run.ts`（用完删除）：

```ts
// .scratch-run.ts
import { apply } from './src/index.ts'

apply({})
```

```sh
pnpm dlx tsx .scratch-run.ts
# hello from my first plugin
```

### 2. 宿主内调试

前提：插件已按「三、 快速开始」装入 profile（下文以 `demo` 为例）。

#### 2.1 验证挂载与加载

先确认配置层已合成：

```sh
dsh --profile demo --dump-config | grep -A 2 dsh-smkit
# # == dsh-smkit
# - id: hello
#   name: dsh-smkit
```

再以与宿主加载器相同的解析方式，验证模块能从 profile 里加载运行：

```sh
cd ~/.dsh/profiles/demo && node -e "import('dsh-smkit').then(m => m.apply({}))"
# hello from my first plugin
```

#### 2.2 改码后的更新循环

仓库根目录的辅助脚本可一步完成打包与装入：

```sh
pnpm smkit:install --profile demo
```

等价的手动流程：

```sh
pnpm build                                  # 编译 src → lib
pnpm pack                                   # 重新打包（内含 lib/）
dsh plugin --profile demo install --force   # 在 profile 里重新拉取 tarball
```

顺手递增 `package.json` 的版本号再重新 `add`，可避免同名 tarball 被视为未变化。

#### 2.3 启动与日志

```sh
dsh --profile demo
```

插件在启动早期被加载，`apply` 里的 `console.log` 直接写入终端。注意：TUI 类 profile 需要真实终端，管道重定向下不回显；profile 首次启动会补装基础 bundle 的依赖链，耗时较长。确认插件行为后 Ctrl+C 退出。若启动报 `EADDRINUSE`（端口被残留进程占用），用 `pnpm port:kill <port>` 查出占用进程并确认终止。

#### 2.4 临时配置实验

要临时试配置而不改动 profile 文件，用一次性 overlay：

```sh
dsh --profile demo --patch ./extra.yml
```

profile 目录位于 `$DSH_HOME/profiles/<name>`，可用 `pnpm dsh:config` 在文件管理器中打开配置根目录。

### 3. Web UI 调试

Web UI 由 web profile 独有的 `@deepseek-ai/dsh-web-app` bundle 提供（`dsh web` 等价于 `dsh --profile web`）。profile 之间互相隔离：插件装在其他 profile 时，`dsh web` 不会加载它。要把插件带进 Web UI，运行辅助脚本（默认装入 web profile，`--profile` 可指定其他）：

```sh
pnpm smkit:install     # 打包（pnpm pack）并用 tarball 装入
pnpm smkit:uninstall   # 移除
```

然后重启 `dsh web`，启动日志里即可看到插件的 `console.log` 输出。改码后重新运行 `pnpm smkit:install` 即可更新；等价的手动操作与说明见「2.2 改码后的更新循环」。

两点提示：

- 当前插件只输出一行日志，Web UI 里没有可交互的内容；后期在 `apply` 里注册工具后，就可以在 Web UI 对话中调用工具并观察入参与返回，那才是 Web UI 调试的主战场。
- `dsh --profile demo` 这类自定义 profile 不含 `@deepseek-ai/dsh-web-app`，只加载插件、不监听端口、也不会打开浏览器，不能用它调 Web UI。

### 4. 断点调试

本插件编译时开启了 sourceMap，断点可以直接打在 `src/index.ts` 上，两种场景分别配置。

项目内断点用 launch 方式——直接以调试器运行自检脚本，`.vscode/launch.json` 加入：

```jsonc
// .vscode/launch.json
{
  "type": "node",
  "request": "launch",
  "name": "verify 自检",
  "program": "${workspaceFolder}/test/verify.mjs",
  "outFiles": ["${workspaceFolder}/lib/**/*.js"]
}
```

宿主内断点用 attach 方式——dsh 本体是 Node 脚本（`node_global\node_modules\@deepseek-ai\dsh\lib\bin.js`），插件在宿主进程内加载，先以 inspector 启动 profile，再在 VSCode 里 attach：

```sh
NODE_OPTIONS=--inspect-brk dsh --profile demo
```

```jsonc
// .vscode/launch.json 追加 attach 配置
{
  "type": "node",
  "request": "attach",
  "name": "attach dsh",
  "port": 9229,
  "outFiles": ["${workspaceFolder}/lib/**/*.js"]
}
```

断点打在 `lib/index.js`，sourceMap 会映射回 `src/index.ts`。

---
*本文档由 markdowncli 技能辅助生成*
