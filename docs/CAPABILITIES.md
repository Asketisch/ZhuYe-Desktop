# 核心能力 → GUI 覆盖矩阵

> 本文档是 ReflectDesktop（GUI）与 Reflect-Agent（harness 基座）之间的
> **能力对照表**。它回答两个问题：
> 1. 基座提供了哪些能力，GUI 是否能用、能看到？
> 2. 还没接的能力有哪些、为什么、后续怎么接？
>
> 审计范围：`reflect-agent/crates/**`（submodule 只读镜像）对照
> `src-tauri/src/**`（命令层）+ `src/**`（前端）。
>
> 最近审计：submodule `e4560bc`（v1.7 —— 含上游 7 周归并；本轮闭合
> §4.1 Goal 快照读口与 §3.18 todo 回灌，§3.19 os_level schema 对齐，
> 新增 `tool_call_args_delta` / `spec_fallback` 事件接线）。

## 阅读约定

| 记号 | 含义 |
|---|---|
| ✅ | 已接线：命令存在 + 前端有消费面 |
| 🟡 | 部分接线：能看到一部分，缺细节或缺配置面 |
| ❌ | 未接线：基座有能力，GUI 用不到 / 看不到 |
| ⛔ | 有意不接：本质是 CLI / SDK / 服务端专用，无 GUI 类比 |

---

## 1. 能力总览

| 能力族 | 核心 crate | 关键 API | GUI 状态 |
|---|---|---|---|
| 协议 Op / EventMsg | `reflect-protocol` | `Op`(24 变体) / `EventMsg`(**45** 变体) | ✅ 22/24 Op 有命令；**45/45** EventMsg 有 TS 类型 + reducer（逐条核对，2026-10-21） |
| 线程运行时 | `reflect-core` | `AgentThread` / `AgentConfig` / `TurnHandle` | 🟡 `AgentConfig` 缺权限解析器（已修，见 §3.1） |
| LLM / Provider | `reflect-llm` | `ModelRegistry` / `CredentialPool` / `RoutingPolicy` | 🟡 有 plans / quota + **凭证池健康度**（§3.15，冷却原因在核心内不公开） |
| 计价 | `reflect-llm::providers` | `price` / `is_priced` / `ModelPricing` | ✅ 费率卡由核心费率表**反解**（`app-core/src/pricing.rs`） |
| 权限 | `reflect-permissions` | `FilePermissionStore` / `StorePermissionResolver` | ✅ 三层 store 已挂载（CLI 同构）+ Settings 可见生效规则 |
| 配置 | `reflect-config` | `ReflectConfig`(~30 段) / `ConfigWatcher` | 🟡 结构化表单覆盖大部分 + **配置位置 / 分析健康度**（§3.15）；`mcp_servers` / `lsp_servers` / `permissions` 仅 raw TOML |
| MCP | `reflect-mcp` | `McpConnectionManager` / registry | ✅ 观测 + **增删 + 精选 catalog + 资源/prompt 浏览**（§3.12 / §3.16） |
| LSP | `reflect-lsp` | `LspConnectionManager` / `DiagnosticRegistry` | ✅ 启停 + 预热 + **诊断可见**（§3.10） |
| 工具注册表 | `reflect-tools` | `ToolRegistry` / `Sanitizer` / `WorktreeCoordinator` | ✅ 工具列表 + **worktree 状态可见**（§3.16） |
| Hooks | `reflect-hooks` | `HookEngine` / `HookEventKind`(12) | ✅ 列表 + **事件类型与可用决策**（§3.16） |
| Skills | `reflect-skills` | `SkillsCatalog` / `scan_skills_dirs` / `merge_bundled` | ✅ 已改为与运行时同源（消除列表分叉，见 §3.2） |
| 记忆 | `reflect-memory` | `MemoryStore` / `retrieve_relevant` | 🟡 CRUD + 路径对齐（§3.9）+ **分段视图 + 注入预算**（§3.15）；相关性排序仍不可见 |
| 会话笔记 | `reflect-notes` | `NoteStore` / `FileBackedNoteStore` | ✅ 只读面已补（Memory 视图 §3.3） |
| 恢复 | `reflect-recovery` | `SubagentRegistry` / `ActiveFileRecovery` | ✅ **已完成的子代理调用**可查（§3.15）；活跃文件恢复仍需消息历史 |
| 提示词 | `reflect-prompt` | `PromptLibrary` / `PromptSet` / `split_spec` | ✅ 层列表 + 重扫 + **生效正文**（§3.8） |
| 压缩 | `reflect-compact` | `Compactor` / `CompactReport` | ✅ 次数 / 节省 token + **逐次明细**（§3.7） |
| Rollout / 会话 | `reflect-rollout` | `replay` / `to_markdown` / `session_stats` / `all_model_usage` | ✅ |
| Telemetry | `reflect-telemetry` | model-io + **span 日志** | ✅ 两面都已接线（§3.4） |
| 子代理 | `reflect-subagent` | `SubAgentSpec` / `SubAgentFactory` | ✅ 运行态可见 + **agent 侧 `call_*` 已注册**（§3.14）+ **spec 可编辑**（§3.16） |
| Agent 定义 | `reflect-agent-def` | `AgentDefinition` / `source` | ✅ 含 v1.6 `source` 字段语义 + **活跃 agent 可切换**（§3.9） |
| 目标模式 | `reflect-goal` | `GoalController` / `GoalState` | ✅ enter/exit + **状态快照读口**（v1.7 上游 `GoalController::snapshot()`，`reflect_goal_snapshot` 命令 + 徽标 tooltip + 投影校准，§4.1） |
| 任务 / 团队 | `reflect-task` | `TaskManager` / `TodoWriteTool` | ✅ CRUD + claim + **产出 / 停止 / 释放**（§3.11）+ **agent 侧任务工具**（§3.14）；**todo 清单已展示**（§3.18），清单回灌已由上游闭合（§3.18） |
| 讨论 | `reflect-discussion` | `DiscussionOrchestrator` | ✅ |
| 流水线 | `reflect-pipeline` | `Pipeline::from_toml` / `PipelineReport` | ✅ |
| 插件 | `reflect-plugin` | `PluginManager` / `PluginManifest` | ✅ 列表 / 启停 / 卸载 / 本地安装 + marketplace（§3.13） |
| 沙箱 | `reflect-sandbox` | `OsSandbox` / `detect_backend` | ✅ 有效状态在状态栏可见（§3.5）+ **开关真正生效**（§3.19，每轮协议策略） |
| BM25 | `reflect-bm25` | `rank_lines` / `tokenize` | ✅ GUI 搜索可选 **BM25 相关性**（§3.16，与 agent 的 grep 同款） |
| AST | `reflect-ast` | `LanguageGrid` / `list_languages` | ❌ 语言网格不可见 |
| 配置分析 | `reflect-config::analytics` | `status_line` / `Health` | ❌ 配置文件路径 / watcher 健康度不可见 |

---

## 2. 有意不接线（⛔）

| 能力 | 原因 |
|---|---|
| `reflect-exec::serve` stdin JSONL 循环 | 服务端模式；桌面端是宿主而非客户端 |
| `Op::RegisterTools` / `Op::ToolExecutionResponse` | 远程工具协议要求客户端侧执行器进程 |
| `EventMsg::ToolExecutionRequest` | 同上 —— 桌面端不注册远程工具 |
| `reflect-py` Python 绑定 / `reflect-cli` 参数解析 | 无 GUI 类比 |
| `reflect_stream::postgres_session` / `sse_redis` | 多租户服务端会话存储 |
| `reflect-core::eval` | 测试/评测 harness，非用户面 |
| `reflect-ast` `search` / `replace` / `rename_symbol` | 上游 P0 未实现，仅 `list_languages` 可用 |
| `reflect-integration::WebhookNotifier` | 上游 stub，无 GUI 配置面对应 |
| `reflect_list_shell_sessions` | 桌面端**本地**诊断命令（列后端 shell 进程注册表的**当前活动**会话 id）。Terminal 视图自己就持有这批会话的状态并渲染成页签，比再查一次后端更准 → 界面用自己的状态即可 |

---

## 3. 本轮已闭合的缺口

### 3.1 权限层接线（安全行为分叉修复）

**问题**：CLI 装了三层权限 store（`config.toml [permissions]` >
`<workspace>/.reflect/permissions.toml` > `~/.reflect/permissions.toml`），
桌面端**根本没挂** `AgentConfig::with_permission_resolver` ——
`reflect-permissions` 在 `src-tauri/Cargo.toml` 里声明却从未使用。
结果：同一份配置在 CLI 里生效的 `deny` 规则，在桌面端被**静默忽略**。

**修复**：`src-tauri/src/state/permissions.rs` 按 CLI
(`reflect-exec` 的 `apply_permission_layers`) 同构装配三层链式 store
+ `HeuristicYoloClassifier`。GUI 侧新增
`reflect_list_permission_rules` + Settings → Permissions 分节的
「生效的权限规则」列表（只读，按匹配顺序展示）。

**取舍**：唯一需要 await 的「把 config 规则灌进内存 store」用
`futures::executor::block_on` 同步执行 —— 该 future 只做一次
`Mutex::push`，首次 poll 即就绪；桌面端线程构造既有在 Tauri `setup()`
同步段调用的、也有在 async 命令里调用的，独立执行器两边都安全。

### 3.2 Skills 列表与运行时对齐

**问题**：桌面端手写了一份 skills 扫描（扫 `cwd/.reflect/skills`），
与运行时（扫 `<workspace>/.reflect/skills` + `~/.reflect/skills`，
再 `merge_bundled` 合入内置技能）有**两处分叉**：目录不同 + 漏掉内置
技能。GUI 列出的技能少于 agent 实际能激活的。

**修复**：`reflect_list_skills` 改用核心的
`reflect_skills::{scan_skills_dirs, bundled_skills}`，目录与合并语义与
运行时逐行一致；DTO 补 `bundled` / `whenPaths` / `version` / `body` /
`pluginId`，UI 标注「内置」徽标与路径自动激活条件。

### 3.3 会话笔记只读面

**问题**：agent 运行时经 `AddSessionNoteTool` 把结论写进
`<notes_home>/session-notes/<thread_id>.jsonl`，这条链路**只有写、没有
读** —— 用户不知道 agent 记了什么。

**修复**：`reflect_list_session_notes` / `reflect_list_note_sessions`
+ Memory 视图下方的「会话笔记」面板。

### 3.4 Span 日志（trace 树）

**问题**：Traces 视图只读 model-io（每次 LLM 调用的请求/响应全文），
**从不读** span 日志 —— turn → model → tool 的父子链、耗时归因、
`reflect_goal` 事件全部不可见。

**修复**：`app-core/src/traces.rs` 新增 `list_span_logs` /
`read_span_log`（含树深度推导，父链缺失与成环都有防护）+
`reflect_list_span_logs` / `reflect_read_span_log` + Traces 视图
「Span 树」标签页。

### 3.5 OS 沙箱有效状态

**问题**：设置页有 `[sandbox].os_level` 开关，但看不到**实际**是否在
Seatbelt / Landlock 里跑。安全开关不可见 = 无法判断风险。

**修复**：`reflect_sandbox_status` + 状态栏徽标。**口径在 §3.19 重做** ——
此处最初用的是 `OsSandbox::from_env()`（env 路径），而 §3.19 接线后真正
生效的是**每轮协议覆盖**，两者不是同一条路径。

### 3.6 Token 计算做深（模型级用量 + 计价可解释）

**问题**：GUI 只显示「最后一次调用」的 token 快照，不显示命中的模型、
不做按模型累计、不解释费用从哪来。

**修复**：
- store 侧：`TokenSnapshot` 增 `byModel`（会话内按模型累计）与
  `sessionTotal`（真实会话累计，修正此前「累计 tokens」实为单次值的问题）；
- Inspector：token 段增「模型」行 + 「按模型（会话累计）」子区块；
- `/usage` 视图：新增「实时（本次会话）」与「费率」两个区块；
- `app-core/src/pricing.rs`：用 4 次合成用量**反解**核心静态费率表
  （`price()` 对 usage 线性），得到每模型输入/输出/缓存读/缓存写单价 ——
  唯一事实源仍是核心的表，桌面端不持第二份。

### 3.7 逐次压缩明细

**问题**：Inspector 只给一行 hover 摘要（「smart_prune: 0 msgs (7731 →
5344 tokens)」），用户无法核对「每次压缩各省了多少」。

**修复**：`CompactionStats` 增 `records`（逐次明细，封顶 50 条），
Inspector 增可展开的「逐次压缩明细」列表（策略 / 前 → 后 token / 节省量）。

### 3.8 提示词生效正文

**问题**：`/prompt` 只报**层文件名**（哪些层命中了），看不到层解析后的
**正文** —— 即模型真正吃到的那段提示词。

**修复**：`reflect_get_effective_prompt`（用核心的
`reflect_prompt::library().resolve(spec)`）返回当前模型实际生效的
section 正文，PromptLayersModal 里按需展开。

### 3.9 活跃 agent 接线（GUI 的 Agents 视图此前是死胡同）
**问题**：核心的 `build_default_m4(workspace, agent_name, …)` 按**名字**
找 agent 定义（CLI 用 `--agent` 传，缺省 `"default"`），而桌面端**硬编码
`"desktop"`**。后果两个：

1. **GUI 的 Agents 视图是死胡同** —— 用户能创建/编辑
   `~/.reflect/agents/*.md`，但运行时永远找不到它们。
2. **记忆路径对不上** —— 记忆文件路径由 agent 名派生
   （`.reflect/agent-memory/<agent>/MEMORY.md`），GUI 写
   `agent-memory/reflect/`、运行时读 `agent-memory/<agent>/` →
   **GUI 里编辑的记忆，agent 根本读不到**。

**修复**：
- 新增 `src-tauri/src/agent_state.rs`：活跃 agent 名由桌面端偏好文件
  （`~/.reflect/desktop.json`）决定，缺省 `"default"`（与 CLI 一致 ——
  两个前端共用同一 agent 定义与记忆目录）。放在桌面端自己的偏好文件而
  不是核心 config，因为核心 `ReflectConfig` 没有 `[active].agent` 字段
  （CLI 用命令行旗标），且桌面端的 config 读写会把解析后的结构重新
  序列化 —— 手写的自定义键会被抹掉。
- 线程构造改用该名字；记忆路径经**核心的 `reflect_memory::resolve_path`**
  解析，与运行时 pre_loop 注入逐字一致。
- 旧版桌面端（`agent-memory/reflect/`）留下的记忆在启动时**一次性迁移**
  到当前活跃 agent 目录（目标存在则不覆盖，不丢用户数据）。
- 新增 `reflect_get_active_agent` / `reflect_set_active_agent`：切换后
  replay 当前会话历史并强制重绑（新定义立刻生效），与 provider 热重载
  同款语义。Agents 视图新增「当前活跃」卡片 + 逐条「设为活跃」按钮。
- Memory 视图新增提示：agent 未声明 `memory` 作用域时，写入的内容
  **不会**被注入 system prompt（核心是「记忆按 agent 显式启用」）。
- 另加不变量测试：GUI 记忆路径 == 核心 `reflect_memory::resolve_path` 结果。

### 3.10 LSP 诊断（Problems）

**问题**：LSP 开着、文件也预热了，但**编译 / 检查器反馈一条都看不到** ——
诊断只进了 core 的 `DiagnosticRegistry` 被动缓存，GUI 侧无任何读取面。

**修复**：
- 新增 `reflect_lsp_diagnostics(path)`：读 core 的
  `LspConnectionManager::diagnostics()` → `DiagnosticRegistry::get(uri)`，
  输出一条条诊断（行/列 1-based、severity、message、source、code）。
  语义与核心 `LspTool` 同款 —— **只读被动缓存**，不主动 pull。
- `LspStatus` 增 `diagnostics` 聚合（文档数 / 条数 / 状态描述）。
- Files 视图编辑区下方新增 **Problems 面板**（当前文件的诊断），
  随文件打开轮询刷新。

### 3.11 任务产出 / 停止 / 释放

**问题**：任务板只能看到 subject / 状态 / 认领人 —— **看不到 worker 到底
产出了什么**，也**停不下卡住的 worker**、**释放不了僵死的认领**。

**修复**：新增三个命令，语义与核心工具**同款**（守卫在命令层，不在前端
重复实现）：
- `reflect_get_task_output(list, id)`：读任务 `output_path` 指向的文件
  （与核心 `TaskOutputTool` 同源）。**不阻塞** —— 产出还没写好时返回空串。
- `reflect_stop_task(list, id)`：守卫 `status == in_progress`；动作 =
  退回 `pending` + 清空 `owner`（同 `TaskStopTool`）。
- `reflect_release_task(list, id)`：守卫存在 `claimed_by`；动作 = 退回
  `pending` + 清空 `claimed_by` / `claimed_at`（同 `TaskReleaseTool`）。
- 任务板：行内新增「详情 / 停止 / 释放」按钮 + **详情抽屉**（描述 +
  产出文件路径 + 产出内容）。

> 注：核心的 `TodoWriteTool` **工具本身是实装的**（占位的只是它的
> `manager` 字段——上游注释："Phase 1 不用，仅占位避免破坏 register_all
> 签名"）。todo 清单的 GUI 展示见 §3.18。

### 3.12 MCP 服务管理（扩展机制的自助入口）
**问题**：MCP 是基座最主要的扩展机制，但 GUI 此前**只能观测** ——
加一个 server 必须手改 `config.toml` 的 `[mcp_servers.<name>]`。
Collaboration 视图的空态原话就是「Add an `[mcp_servers.<name>]` section in
Settings → Advanced」。

**修复**：
- 4 个新命令（`commands/mcp.rs`）：
  - `reflect_list_mcp_servers`：配置里的全部 server + transport +
    启动命令 + **运行状态**（合并 store 的 lifecycle 事件 → 失败原因）。
  - `reflect_mcp_catalog`：核心内置的**精选 catalog**（离线清单 + 安装
    提示，走 `reflect_mcp::registry`）—— 解决「我不知道能装哪些」。
  - `reflect_upsert_mcp_server` / `reflect_delete_mcp_server`：改内存
    `ReflectConfig.mcp_servers` → 经**核心的 `mcp_server_configs()` 编译
    校验**（非法配置不落盘）→ 落盘 → 运行时起/停（注册/反注册其工具）。
- 运行时起停复用 `mcp::start_one_server` / `stop_one_server`，与启动时的
  `bootstrap_mcp` 同款路径（含 `McpToolInvoked` 事件通道）—— 新增的
  server 与启动时的行为完全一致。
- Collaboration 视图新增 **McpManager 面板**：已配置列表（运行状态 +
  删除）、新增表单（stdio command+args / http+sse url）、精选 catalog
  一键加入。

### 3.13 插件管理

**问题**：GUI 此前只能看到插件带来的 **slash 命令** —— 装了什么、哪个加载
失败、启用哪些、marketplace 有哪些，**全部不可见**；启停只能手改
`~/.reflect/config.toml` 的 `[plugins] enabled_plugins`，卸载只能手改
`installed_plugins.json`。

**修复**（`commands/plugins.rs`）：
- `reflect_list_plugins`：已安装插件（id / 版本 / scope / 安装路径 / 安装
  时间 / **是否启用**）+ git commit sha。启用状态取自 config 的
  `enabled_plugins` —— 与运行时实际挂载的集合同源。
- `reflect_list_marketplaces`：config 的 `[plugins].marketplaces`
  （名字 / 源类型 directory·file·github·url / 安装位置 / 自动更新）。
- `reflect_toggle_plugin`：改 config → 落盘 → 核心 `reload_plugins`
  diff 同步（挂/卸插件，**不打断运行中的会话**）。
- `reflect_uninstall_plugin` / `reflect_install_plugin`：经核心
  `PluginManager` 读写 `installed_plugins.json`（含 manifest 校验）。
  安装用目录选择器（复用既有的 `reflect_pick_workspace_folder` —— 它是
  纯目录选择器，不改工作区）。

Collaboration 视图新增 **PluginsPanel**：已安装列表（启停开关 + 卸载）、
marketplace 列表、本地安装表单。

### 3.14 工具注册表补齐（agent 侧「能不能用」的关键缺口）

**问题**：桌面端的工具注册表此前只有 **15 个基础工具**（Bash / Read /
Write / …），**缺三族**：

| 缺失 | 后果 |
|---|---|
| 任务工具（`reflect_task::register_task_tools`） | GUI 建的 task，agent **既看不到也改不了** —— 任务板对 agent 是单向的 |
| 会话笔记工具（`reflect_notes::AddSessionNoteTool`） | agent 写不了会话笔记 → §3.3 的笔记读取面**永远是空的** |
| 子代理工具（`call_<role>`） | agent 无法委派子任务 → Inspector 的子代理区块**永远是空的** |

CLI 三族都注册（`reflect-exec` 的 `bootstrap_m5` + `headless.rs`）。
两个前端能力不一致 —— GUI 展示了任务板 / 子代理 / 笔记，agent 却用不上。

**修复**（新增 `state/subagents.rs`）：
- `register_task_tools`：进程级注册（task manager 是单例）。
- `register_note_tool`：**每会话**注册（笔记 store 路径含 thread id），
  rebind 时同名覆盖。
- `bootstrap_subagents`：按 CLI 口径合并 spec
  （TOML `[[subagents]]` > workspace `.reflect/subagents/*.md` >
  home `~/.reflect/subagents/*.md` > 硬编码 explorer），注册
  `call_<role>` 工具，并把 `call_<role>` 补进 `m4.skills` 的 always-on
  可见集 —— 否则模型请求里没有子代理工具的 schema，LLM 永远无法委派。

加了一条注册表测试（断言 `TaskCreate` / `TaskOutput` 等在册）。

### 3.15 运行时状态可观测（S 级批量）

四项基座有、GUI 完全看不到的「系统此刻怎么了」，现补齐只读面
（`commands/runtime_status.rs`）：

| 能力 | 命令 | 落点 |
|---|---|---|
| 凭证池健康度 | `reflect_credential_pool_status` | Inspector「凭证池」分区（总数 / 健康数 / 冷却中）。核心的 cooldown 集合是私有字段 → 用 `healthy_clients()` 的健康集合反推「总数 − 健康数 = 冷却中」（冷却**原因**在核心内不公开，不编造） |
| 已完成的子代理调用 | `reflect_recovery_state` | Inspector 分区 —— 读 core 的 `SubagentRegistry::snapshot()`（任务摘要 / 结果摘要 / 迭代序号 / 时间）。回答「agent 刚才派了哪些子代理、结论是什么」 |
| 记忆分段 | `reflect_memory_sections` | Memory 视图「记忆分段」区块 —— 用 core 的 `split_sections` 按 `## ` 切分 + 注入预算占用。GUI 此前显示整份原文，而 agent 实际吃的是切分 + 筛选后的条目 |
| 配置位置与分析健康度 | `reflect_config_info` | Settings 侧栏顶部 —— 配置文件路径 / 是否存在 / 分析上报开关 + 状态 / 工作区 / 活跃 agent。手改 `config.toml` 的用户终于知道应用读的是哪个文件 |

> **AST 语言网格**这一项**有意不接**：核心的 `LanguageGrid` 的 grammar
> 由 `lang-*` feature 编译，桌面端没有启用任何 grammar
> （`reflect-ast` 默认无 grammar）→ 列表恒为空。启用 grammar 会把
> tree-sitter 语法包拉进桌面构建，属于独立的构建决策，不是接线缺口。

### 3.16 又一批：worktree / MCP 原语 / 子代理 spec / BM25 搜索 / Hook 事件

| 能力 | 命令 | 落点 | 要点 |
|---|---|---|---|
| **worktree 状态** | `reflect_list_worktrees` | Git 视图「Worktrees」面板 | 核心的 worktree 状态在 `ToolContext` 里（进程内）读不到，但 worktree **文件系统可见** —— `git worktree list --porcelain` + 核心的 `worktree_dirty` 判脏。标出 `isolated`（隔离工作树）与 `stranded`（隔离 + 有未提交改动 → **改动还没落回主分支**，丢工风险） |
| **MCP 资源 / prompt** | `reflect_list_mcp_resources` / `reflect_list_mcp_prompts` | McpManager 的「资源与 Prompt」折叠区 | MCP 三大原语里此前只有 tools 对用户可达。直接问 rmcp peer（`list_all_resources()` / `list_all_prompts()`），与核心 `ListMcp*Tool` 同源 |
| **子代理 spec** | `reflect_list_subagent_specs` / `reflect_get_subagent_spec` / `reflect_save_subagent_spec` / `reflect_delete_subagent_spec` | Agents 视图新增「子代理 spec」页签 | 与 **agent 定义**（`~/.reflect/agents/*.md`）是两套东西 —— 后者是主 agent 的 prompt / 工具白名单，前者是 `call_<role>` 工具的来源，此前**无任何编辑面**。合并口径与运行时同款（TOML > workspace md > home md > 硬编码 explorer）。编辑器直接改**原始 md**（frontmatter + body），写前由后端 `parse_subagent_str` 校验，非法不落盘 |
| **BM25 搜索** | `reflect_search_files` 增 `rank` 参数 | Search 视图文件页的排序切换 | GUI 搜索此前是纯子串匹配，弱于 agent 自己的 grep。`bm25` 模式复用核心 `reflect_tools::bm25::{tokenize, rank_lines}`（`k1=1.2` / `b=0.75`，与核心 grep 工具**逐字一致**） |
| **Hook 事件类型** | `reflect_list_hook_events` | Hooks 视图「可挂载的事件」折叠区 | 此前只列 hook 的 name / kind / enabled —— 用户不知道**能在哪些时机**挂 hook、每个时机能做什么决策。现列出 12 个 `HookEventKind` + 每个事件可用的 `HookDecision` |

### 3.17 Pipeline 配置编辑 + 安全扫描

**Pipeline 编辑**：此前 GUI 只能**跑**一个已有的 TOML 文件（还得手写），
新增拓扑只能靠「手改文件 + 跑失败才知道写错了」。现在：

- `reflect_validate_pipeline(toml)` —— 校验走核心的 `Pipeline::from_toml`
  （与**实际运行同一条校验路径**），返回结构摘要（节点 / 缺 team / 错误）。
  摘要只读顶层 `nodes` 表，节点内部字段交给核心判 —— 不在桌面端复刻核心 schema。
- `reflect_list_pipeline_configs` / `reflect_save_pipeline_config` ——
  落盘 `~/.reflect/pipelines/<name>.toml`，**写前先校验，非法不落盘**。
- Collaboration 视图新增 Pipeline 编辑器（TOML 文本框 + 防抖实时校验 +
  节点徽标 + 缺 team 提示 + 保存）。

**安全扫描**：审计初稿把核心的 `reflect_integration::security_scan`
标为「上游 stub」—— **核实后是错的**：它是**真实实现**（`cargo audit`、
30s 超时、管道排空、IO 错误落结构化报告而非 panic）。已接：

- `reflect_run_security_scan()` —— 阻塞调用放 `spawn_blocking`（可能跑
  30s，不占住 async worker）；Settings → Advanced 的「安全扫描」卡片。

> 修正记录：审计初稿的两处误判 —— ① `reflect-integration` 的安全扫描
> **不是** stub；② 核心的 `TodoWriteTool` 的 `manager` 字段是占位
> （上游注释："Phase 1 不用，仅占位避免破坏 register_all 签名"），
> **但工具本身是实装的** —— 见 §3.18。

---

### 3.18 agent 的 todo 清单（`TodoWrite`）

**核实的核心事实**（`reflect-task/src/tools/todo_write.rs`）：

- `TodoWriteTool` **是实装的**：校验 `todos[]`（`content` 非空 / `status ∈
  {pending, in_progress, completed}`），产出 `ToolOutput.metadata.todos`
  （`{ content, status, activeForm }`，**整体覆盖**语义）+ `metadata.count`。
  工具的 `manager` 字段才是占位（留给未来 `TodoWrite → TaskCreate` 桥接）。
- `TodoRow` 带 `#[serde(rename_all = "camelCase")]` → 线上字段是
  **`activeForm`**（不是 `active_form`）。
- 核心的 `reflect-task/src/lib.rs` 文档写「TodoWrite 走
  `ToolContext.metadata["todos"]`」，**与实现不符** —— 实现写在
  `ToolOutput.metadata`。上游文档漂移，本仓库按**实现**接线。

**GUI 侧接线**（前端纯消费，零后端改动）：

- `src/stores/agent/types.ts` —— `TodoItem` + `AgentState.todos`
  （会话作用域，每次 `TodoWrite` 整体覆盖）。
- `src/stores/agent/reducer.ts` —— `tool_call_end` 分支：仅当对应
  `tool_call` 的 `toolName === 'TodoWrite'` 时，从 `output.metadata.todos`
  提取清单（`extractTodos`）。非 `TodoWrite` 工具即便带 `metadata.todos`
  也不采信。
- `src/features/shell/TodoPanel.tsx` —— Inspector「概览」分区渲染清单
  （完成数 / 总数徽标 + 每项状态徽标 + 已完成项删除线）。

**上游侧的回灌已闭合**（v1.7 `d621397`）：

1. ~~LLM 看不到自己的清单~~ —— core 新增 `AgentConfig.todos_slot`
   会话级共享槽：`tool_exec` 在 `TodoWrite` 产出 `metadata.todos` 时渲染成
   `- [ ] / - [~] / - [x]` 三态清单写进槽，`pre_loop` 把槽内容注入
   core prompt 的 `## Current Todo List` 段 —— agent 每轮都能看到
   自己刚写的清单。
2. ~~核心注释指向的 reducer 不存在~~ —— 回灌改在 core 侧（pre_loop 注入）
   完成，不再依赖不存在的 TUI reducer。

GUI 如实展示「agent 写了什么」，让用户能核对 agent 自以为的进度；
「agent 真正按清单执行」由上游 pre_loop 注入闭环。

---

### 3.19 OS 沙箱开关真正生效（此前是死旋钮）

**问题**：`[sandbox].os_level` 是 GUI 里唯一一个**写了不生效**的安全开关。

核心的 OS 沙箱有三条来源，桌面端此前**一条都没接**：

| 来源 | 语义 | 桌面端此前 |
|---|---|---|
| 配置 `[sandbox].os_level` | 用户意图（bool） | ✗ 只写盘，不生效 |
| 协议 `ThreadSettingsOverrides.sandbox_policy` | 每轮覆盖 → `ToolContext.os_sandbox` | ✗ 从不设置 |
| env `REFLECT_SANDBOX_OS_LEVEL` | 进程级开关 | ✗ 从不读 |

于是 `ctx.os_sandbox` 恒为 `None` → BashTool 走 `OsSandbox::from_env()`
→ **env 未设置时默认开启**（核心安全基线）→ 配置写 `false` 也没用，
状态栏显示的还是 env 推导值。CLI 侧同样如此：桥接只处理 `true`
（`headless.rs:103`），`false` 分支直接落空 —— 该配置项在**两个前端**
都是死旋钮。

**修复**（桌面端闭环；上游 schema v1.7 起改为 `Option<bool>`）：

- **`app-core/src/sandbox.rs`**（纯函数，可测）—— 唯一事实源：
  - `normalize_os_level(os_level: Option<bool>)`：**没写（`None`）→
    `true`**（核心基线「默认要求 OS sandbox」），显式值 → 原样。
    （核心 schema v1.7 前是 `bool` + `#[serde(default)]`，解析后无法
    区分「没写」与「写了 false」，当时桌面端用「嗅探原始 TOML」的
    workaround 补齐；上游改 `Option<bool>` 后 workaround 已移除。）
  - `resolve_os_sandbox_enabled(cfg, env_raw)`：**env 优先于配置**
    （与核心 CLI 桥接注释一致：`REFLECT_SANDBOX_OS_LEVEL=0` 可临时
    覆盖配置）。
  - `sandbox_policy_for(enabled)` → 协议策略。
- **每轮下发协议策略**（`state/submit.rs::stamp_sandbox_policy`）——
  在 `Op::UserInput.thread_settings.sandbox_policy` 上盖：
  开启 → `SandboxPolicy::OsSandbox`；关闭 → `SandboxPolicy::WorkspaceOnly`
  （核心的映射是 `matches!(p, SandboxPolicy::OsSandbox)`，见
  `reflect-core/src/submission_loop.rs`；`OsSandbox` = 开 OS 层，
  `WorkspaceOnly` / `FullAccess` = 关 OS 层，文件工具路径检查不受影响）。
  → 核心把它转成 `ToolContext.os_sandbox`，**前台 bash 与后台 bash
  两条路径同时生效**。
  - 走协议通道而非改进程 env：Rust 2024 下 `std::env::set_var` 是
    `unsafe`，多线程进程里改 env 有 UB 风险；协议通道天然按轮生效，
    配置改动下一轮即生效。
  - **无条件覆盖**客户端传来的 `sandbox_policy` —— 沙箱是安全设置，
    事实源只能是后端配置快照。
- **配置归一**（`reflect_app_core::sandbox::load_config_with_sandbox_baseline`
  + `reflect_save_config`）—— 内存里的 `cfg.sandbox.os_level` 始终是
  **有效值**，Settings 的开关、状态栏徽标、每轮策略三者一致。
- **状态口径重做**（`commands/sandbox.rs`）—— 改用与工具**同一个**
  构造器 `OsSandbox::with_enabled(enabled)` 计算，新增 `enabled` 与
  `envOverride` 字段：用户用 env 覆盖时在 tooltip 里如实标注，
  否则「在设置里拨开关看不到变化」会被当成 bug。

**为什么不在桌面端直接改 env**：见上（unsafe + UB 风险）；且 env 是
**进程级**的，改了会同时影响后台任务与其它工具，而协议通道是
**按轮**精确控制的。

**上游 schema 已对齐**（v1.7 `1a781b6`）：核心的 `SandboxSection::os_level`
改为 `Option<bool>`，解析后即可区分「没写」（`None`）与「写了 false」
（`Some(false)`）。桌面端不再需要嗅探原始 TOML —— `app-core/src/sandbox.rs`
的 `sandbox_intent_from_toml` / `SandboxOsLevelIntent` 已移除，
`normalize_os_level(Option<bool>)` 直接从解析后的 cfg 归一
（`None` → 基线开启），`load_config_with_sandbox_baseline` 与
`reflect_save_config` 归一后恒写 `Some(有效值)`。三条来源（配置 / 协议
每轮覆盖 / env 覆盖）的优先级与行为不变。

---

### 3.20 「有命令无界面」的三处漏网（反向审计）

本节来自一次**反向审计**：不再问「基座有什么没接」，而是拿矩阵自己的
判定标准（「命令存在 + 前端有消费面」两项都满足）去扫**全部** 182 个
后端命令与 114 个前端包装。

**扫描结论**：

- **零死命令** —— 182 个后端 `reflect_*` 命令**全部**有前端调用点。
- **12 个前端包装没有界面消费** —— 逐个核实后分三类：

| 包装 | 核实结论 | 处置 |
|---|---|---|
| `reflect_set_dock_badge` | 假阳性 —— `src/utils/notify.ts` 在用 | 无需处置 |
| `reflect_export_session_markdown` | **真缺口** —— 核心 `to_markdown`（+ 本轮 §3.6 的用量小节）在 GUI 里**没有任何入口** | 已接线（见下） |
| `reflect_check_update` | **真缺口** —— 后端有探测实现，**界面里完全没有**；`src/features/update/` 目录根本不存在，而 `AGENTS.md` 的同步检查表却点名了 `sections/UpdatesSection.tsx` | 已接线（见下） |
| `reflect_{upsert,get,delete}_team` | 团队只能看不能改（任务板只读）—— 核心的多 agent 协调单元 | 仍为 🟡，见 §4 |
| `reflect_get_task` | 任务详情抽屉用 `reflect_get_task_output` 即可覆盖 | 无需处置 |
| `reflect_list_shell_sessions` | 终端会话列表（恢复旧 shell） | 仍为 🟡，低价值 |
| `reflect_{load,save,check}_allowlist` | 桌面端**本地**机制（`~/.reflect/approval_allowlist.json`），与核心 `reflect-permissions` 的 allow 规则**功能重复**；后端文档描述的「审批弹窗勾选 Always allow」流程在 GUI 里从未存在 | 仍为 🟡，低价值（核心权限面已在 §3.1 覆盖） |

**本轮闭合的两处**：

1. **Markdown 转录导出有入口了** —— 命令面板新增「导出当前会话(Markdown)」
   （`usePaletteActions.exportActiveMarkdown` → `reflect_export_session_markdown`
   → 核心 `to_markdown` + 用量小节），toast 回报落盘路径。
   此前 GUI 只能导出 JSON 原始记录，核心的 `to_markdown` 能力完全用不到。
2. **更新检查有界面了** —— 新建 `src/features/settings/sections/UpdatesSection.tsx`
   （正是 `AGENTS.md` 同步检查表点名的路径，此前**文件不存在**）：
   显示当前版本、点按探测、显示「已是最新 / 有新版 vX」徽标、发布说明、
   发布页链接；探测失败**如实展示** `error` 而不是静默吞掉。
   顺带把后端 `UpdateInfo` 的 DTO 改成 camelCase（桌面端出线约定，
   此前是 snake_case，与其它 DTO 不一致）。

**顺带修正的协议文档过期**：`PROTOCOL_BRIDGE.md` 的事件表此前只列 42 个
事件、且 `plan_draft_updated` / `plan_step` / `plugin_loaded` 三个**从未
登记**，段落计数也停在升级前的数字。现已补齐 3 行并修正计数
（Lifecycle 5→7、Plan 5→7、新增 §3.12 Plugin / Quota）。

### 3.21 两条「有类型无渲染」的事件（`plan_step` / `plugin_loaded`）

同样的反向审计在 **reducer 层**又挖出两条：核心的两个事件在 TS 类型
联合里有、在 reducer 里有 `case`，但 reducer 分支是 `return {}` —— 注释
直白写着「TODO:接入 plan 步骤 UI(目前仅补全类型,不渲染)」「TODO:展示到
plugins panel;目前仅补全类型」。**事件在流里，界面上什么都不发生**。

| 事件 | 此前 | 现在 |
|---|---|---|
| `plan_step` | reducer no-op —— agent 执行已批准的 plan 时**执行到哪一步完全不可见**（GUI 只在审批前展示 plan 正文） | reducer 按 `index` 就地更新或追加（与核心 TUI 语义同构），`plan_ready` 到达时清空上一份；Plan 视图新增「执行进度」清单（步骤标题 + 状态徽标 pending / in_progress / done / skipped） |
| `plugin_loaded` | reducer no-op —— 只能从**配置**反推「装了什么」，看不到**运行时真正挂载了什么**（挂载失败 / 被 scope 过滤时不会有事件） | reducer 记 `store.loadedPlugins`（**进程级** —— 插件在 AgentThread 装配 / 配置重载时挂载，与会话无关），同 id 再来一条则覆盖；Collaboration → Plugins 面板新增「运行时已挂载」列表（版本 / scope / skill 数 / 命令数） |

### 3.22 团队可建可改可删（核心 `TaskManager` 的 team 面）

§3.20 的反向审计里，「团队只能看不能改」是**唯一一个还属于基座能力**
的缺口（另外两项 shell 会话列表、allowlist 都是桌面端本地机制）。
核心的 `reflect-task` 早就实现了 `TaskManager::upsert_team` /
`delete_team` / `get_team`，存储在 `~/.reflect/teams/<name>.json`
（与 CLI / TUI 共享），但 GUI 只有任务板列表选择器里「点一下切到某个
team 的任务列表」—— 想加一个团队只能**手写 JSON**。

**实现**（`src/features/tasks-board/TeamEditor.tsx`）：

- 任务板头部新增「团队」按钮 → 展开团队管理面板：列出全部团队
  （描述 + 成员数）+ 每行的「编辑 / 删除」。
- 表单：名称 / 描述 / 成员列表（角色 / 显示名 / 系统提示词，
  可增删行）。新建与编辑共用一套表单。
- **口径与核心对齐**：
  - `lead_agent_id` 由前端按核心规则推导（`team-lead@<name>`）——
    核心 `upsert_team` 会校验它不等于推导值就报错，这个必然量不该
    让用户手填；
  - 名字规则 `[a-z0-9_-]{1,64}` 与核心 `validate_team_name` 一致
    （前端先拦一道给即时反馈，后端仍是最终裁决）；
  - 时间字段是核心 `SystemTime` 的 JSON 形态
    （`{ secs_since_epoch, nanos_since_epoch }`，**不是**数字）——
    顺带订正了 TS 侧把 `created_at` / `joined_at` 标成 `number | string`
    的类型错误（此前没有任何构造路径，所以错得没被发现）。

### 3.23 「始终允许这条命令」写进核心权限层（消灭桌面端私有的第二套真值）

§3.20 扫出的 allowlist 三命令（`reflect_load/save/check_allowlist`）是
**桌面端本地**机制（`~/.reflect/approval_allowlist.json`，前缀匹配），
后端注释描述的「审批弹窗勾选 Always allow」流程**从未在 GUI 存在**。

**为什么不把它接起来，而是改写它**：核心的 `reflect-permissions` 已经
提供了**同一件事的正规实现**，而且有三个桌面端私有文件没有的优势：

| | 桌面端 allowlist | 核心权限层 |
|---|---|---|
| 真值 | 桌面端私有文件，与 CLI 互不可见 | `~/.reflect/permissions.toml`，**CLI 与 GUI 共用** |
| 生效 | 只能由前端在弹窗前自查后转发批准 | 核心 `StorePermissionResolver` **每次评估都重读文件** → 写完即生效，无需重启 |
| 可见 | 无界面 | Settings → Permissions「生效的权限规则」列表实时显示 |

所以本轮**没有**再接一套机制，而是把「始终允许」直接写进核心的用户级
权限文件 —— 一套真值，且用户能核对「我到底放行了什么」。

**实现**：

- 后端 `reflect_add_permission_rule`（`commands/permissions.rs`）——
  往 `~/.reflect/permissions.toml` 追加一条 allow 规则
  （`FilePermissionStore::add` 落盘；同名规则由核心自动去重）。
- 前端 `src/features/modals/allowRule.ts`（纯函数）—— 从一次待审批的
  工具调用推导规则，**授权范围刻意保守**：
  - **Bash** → `shell_pattern = <整条命令>`（精确匹配）。**不用**
    「首词 + 通配」——`git *` 这类前缀会把 `rm` / `curl|sh` 一起放行。
  - **只读工具**（read / grep / glob）→ 整个工具放行（无副作用）。
  - **写类工具**（write / edit / delete / notebook / web_fetch）→ **不给**
    按钮：核心的规则模型没有路径维度，放行整个写工具等于一次性打开
    「AcceptEdits」模式,不该由一次点击顺手做掉。
- 审批弹窗新增第四个动作「始终允许…」，写完规则即批准本次调用；
  写失败**如实展示错误**而不是静默吞掉。
- reducer 的 `PendingApproval` 增 `args`（原始工具参数）—— 推导规则
  需要原值,`argsSummary` 是截断过的展示串。

---

## 4. 剩余缺口与后续

**当前没有待接线缺口。** 此前列表中的各项已分别闭合：

- 「todo 清单只出不进」→ **上游已闭合**（reflect-agent v1.7 `d621397`：
  `AgentConfig.todos_slot` 共享槽 + `tool_exec` 渲染清单 + `pre_loop`
  注入 `## Current Todo List` 段 —— agent 每轮都能看到自己刚写的清单）。
- 「Goal 状态可观测」→ **上游已闭合 + 桌面端已接线**（见 §4.1）。
- 「`[sandbox].os_level` 语义差」→ §3.19 桌面端闭环；上游 schema 亦已改为
  `Option<bool>`（v1.7），桌面端的原始 TOML 嗅探 workaround 已随之移除。
- 「团队只能看不能改」→ §3.22；「allowlist 三命令无消费方」→ §3.23 改写
  （不再接桌面端私有机制，而是把「始终允许」写进核心权限层）；
  「shell 会话列表」→ §2 归为**有意不接线**（桌面端本地诊断命令，
  界面用自己的会话状态更准）。

### 4.1 Goal 状态可观测（上游已闭合,桌面端已接线）

上游 v1.7 补了 `GoalController::snapshot() -> Option<GoalState>` 与
`AgentThread::goal_snapshot()` 读口。桌面端接线：

- **命令**：`reflect_goal_snapshot`（`commands/agent.rs`）—— 直读线程
  快照，未进入目标模式（或 rebind 丢控制器）返回 `null`。
- **IPC**：`src/utils/commands/goal.ts` 的 `reflect_goal_snapshot()`，
  `GoalSnapshotPayload` 镜像 `GoalState`（snake_case 出线）。
- **消费**：store 的 `syncGoalSnapshot`（会话 hydrate 后与 goal turn
  收尾拉取）校准 `goalActive` 投影 —— 此前投影在会话切换 / rebind 后
  与真实状态脱节，现在以快照为准；Composer goal 徽标 tooltip 展示
  轮次 / token / 状态（`composer.goalBadgeDetail`）。
- **覆盖**：L3 `src-tauri/tests/ipc_goal.rs`（stub provider 配置下断言
  挂载 / 覆盖 / 退出全周期的快照形态）。

> 上游文档漂移仍待订正：`reflect-task/src/lib.rs` 称 TodoWrite 走
> `ToolContext.metadata["todos"]`，实现实际写在 `ToolOutput.metadata`。

---

## 5. 维护约定

- 基座升级（`git submodule update --remote`）后**重新跑一遍本审计**：
  新的 `Op` / `EventMsg` 变体、新的 crate 公开 API 都要在此登记。
- 协议不变量（`AGENTS.md`）：**所有 `Op` 变体 → Tauri 命令**、
  **所有 `EventMsg` 变体 → TS 类型 + reducer**。核对脚本见
  `docs/PROTOCOL_BRIDGE.md`。
- 表中状态由「命令是否存在」+「前端是否有消费面」两项共同决定 ——
  有命令但无 UI 视为 🟡（半接线），不是 ✅。
