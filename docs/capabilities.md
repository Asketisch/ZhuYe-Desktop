# 核心能力 → GUI 覆盖矩阵

> 本文档是烛夜 ZhuYe（GUI）与烛夜 agent 基座（submodule，上游更名 ZhuYe）之间的
> **能力对照表**。它回答两个问题：
> 1. 基座提供了哪些能力，GUI 是否能用、能看到？
> 2. 还没接的能力有哪些、为什么、后续怎么接？
>
> 审计范围：`zhuye-agent/crates/**`（submodule 只读镜像）对照
> `src-tauri/src/**`（命令层）+ `src/**`（前端）。
> 历史各轮审计流水见文末「[历史审计记录](#历史审计记录)」。

> 最近审计：submodule `9aa360f`（ZhuYe main tip，完整 SHA `9aa360fa`；工具×模式×阻塞交互组合穷举后八修：ExitPlanMode 非 Plan 模式守卫（此前批准后无条件翻模式=Prompt 静默降级/Deny 提权）、force_final_answer 在 Plan 保留 ExitPlanMode、ask_question 补 900s 死线（headless 强开审批挂死）、Shutdown 清 plan gate waiters、gate 白名单补纯读调研工具（web_search/web_fetch/image_view/background_status/read_skill_resource）、headless resume hook 注册与 normal 对齐、--full-auto×--plan-mode 互斥、子代理注册 PlanModeGate。桌面配套：主线程无条件注册 PlanModeGate（此前 GUI 无 gate，Plan 只读边界靠审批层软约束）+ 侧通道接 InheritedPlanGate/继承模式句柄。上一轮 `56f88360` plan 审批可靠性四修，见 §3.32。fix(plan) 审批可靠性四修：① blocking plan 审批等待改听**回合级**取消令牌——此前只听会话级，plan 弹窗待决时停止/中断唤不醒，turn 悬挂（TurnAborted 不发、active_turns 残留）；② `Op::SetPermissionMode` / Cycle 先 `cancel_all` 清空在途 plan gate waiters——迟到的 PlanApproval 不再二次翻转模式覆盖用户手动设置，spawn waiter 不再泄漏；③ `apply_plan_approval_choice` 的模式切换补落盘 `PermissionModeChanged`——修 resume「幽灵 Plan 复活」（bind 取最后一条记录）；④ `zhuye exec` plan 审批自动应答（PlanReady→ManualApprove+Interrupt 收尾、退出码归零；PlanRequest→Revise）——headless 无交互方不再无限挂死。桌面配套：前端 `permission_mode_changed` 事件清悬挂 plan 弹窗。上一轮 `883a581` 为两笔纯文档提交（AGENTS 分层体系），再上一轮 `199a3d3b` rollout 首行修复见 §3.32。）

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
| 协议 Op / EventMsg | `reflect-protocol` | `Op`（26 变体）/ `EventMsg`（50 变体） | 🟡 24 个 Op 有桌面命令，另 2 个是远程工具协议专用；事件均有 TS 类型和契约样本，部分显式 no-op 或由视图直接订阅。接线不等于运行态已验证 |
| 线程运行时 | `reflect-core` | `AgentThread` / `AgentConfig` / `TurnHandle` | 🟡 权限解析器已接线（§3.1）；运行态覆盖缺口见 `tests/RUNTIME_COVERAGE.md` |
| LLM / Provider | `reflect-llm` | `ModelRegistry` / `CredentialPool` / `RoutingPolicy` / `output_budget` / `reasoning_effort` | 🟡 plans / quota、凭证池健康度、自适应输出预算、`max` / `ultra` 档位与按模型钳制已接线；冷却原因在核心内不公开 |
| 计价 | `reflect-llm::providers` | `pricing_table` / `pricing_for` / `RateCard` | ✅ 费率卡直接读核心公开费率表（develop 收编;桌面反解 shim 已删） |
| Autopilot | `reflect-stream::autopilot` | 配置/历史持久化 + 到期判定 + `fire_if_due` 闭环 | 🟡 桌面后台驱动已接线，指定 agent 经 side-channel 执行；历史终态关联存在并发错配风险，见 `tests/RUNTIME_COVERAGE.md` |
| 侧通道 | `reflect-core::side_channel` | `SideChannelDriver` / `SideChannelRegistry` / `Op::Start\|Cancel\|QuerySideChannels` | ✅ **引擎原生执行**(develop WP9 收编):driver 经线程工厂注入,命令走协议三 Op,事件三变体全接线(reducer + 视图订阅);registry 进程级共享,跨会话 rebind 存活 |
| 权限 | `reflect-permissions` | `FilePermissionStore` / `StorePermissionResolver` / 回合审批策略 | ✅ 三层 store 已挂载；Settings 可见规则，会话可独立选择审批策略及 Plan 工作模式 |
| 配置 | `reflect-config` | `ReflectConfig`(~30 段) / `ConfigWatcher` / `[context_windows]` / `[prompt_guard]` | 🟡 结构化表单覆盖大部分 + **配置位置 / 分析健康度**（§3.15）；上下文窗口、思考强度和 prompt guard 随配置生效，但 guard/窗口明细没有专属配置面 |
| 思考强度 | `reflect-llm::reasoning_effort` | 按模型族与端点描述支持档位 / 拒绝后逐级降档 | ✅ Composer 与 Models 页共用 `reflect_effort_capability`，只提供可用档位并显示实际生效值 |
| 模型清单发现 | `reflect-config::discovery` / `reflect-llm::model_catalog` | `resolve_model_spec` / `fetch_catalog` / `pick_free_model` / `FreeModelRules` | ✅ `model = "free"` 解析成真实 id + **`[model_discovery]` 可配** + 模型列表标注免费（§3.24） |
| MCP | `reflect-mcp` | `McpConnectionManager` / registry | ✅ 观测 + **增删 + 精选 catalog + 资源/prompt 浏览**（§3.12 / §3.16） |
| LSP | `reflect-lsp` | `LspConnectionManager` / `DiagnosticRegistry` | ✅ 启停 + 预热 + **诊断可见**（§3.10） |
| 工具注册表 | `reflect-tools` | `register_builtin_tools` / `ToolRegistry` / `Sanitizer` / `WorktreeCoordinator` / `LoopGuard` / `checkpoint_tool` | ✅ 与上游共用 27 个内置工具清单，桌面注入 AST；工具列表、worktree 状态、checkpoint 与循环失控守卫随运行时生效（§3.16） |
| 注入防护（F01） | `reflect-sanitize` | `PromptGuard` / `GuardStats` / `Op::QueryGuardStats` / `EventMsg::GuardStats` | ✅ 默认开启（设置「提示注入防护」开关）；工具输出 Block/Review 在消息流渲染 🛡 注入徽标；外部工具定义注册期扫描由引擎侧 fail-closed 执行 |
| Hooks | `reflect-hooks` | `HookEngine` / `HookEventKind`(12) | ✅ 当前引擎注册表与启停 + **事件类型与可用决策**（§3.16）；未注册的内置项需先在配置中启用 |
| Skills | `reflect-skills` | `SkillsCatalog` / `scan_skills_dirs` / `merge_bundled` | ✅ 已改为与运行时同源（消除列表分叉，见 §3.2） |
| 记忆 | `reflect-memory` | `MemoryStore` / `retrieve_relevant` | 🟡 CRUD + 路径对齐（§3.9）+ **分段视图 + 注入预算**（§3.15）；相关性排序仍不可见 |
| 会话笔记 | `reflect-notes` | `NoteStore` / `FileBackedNoteStore` | ✅ 只读面已补（Memory 视图 §3.3） |
| 恢复 | `reflect-recovery` | `SubagentRegistry` / `ActiveFileRecovery` | ✅ **已完成的子代理调用**可查（§3.15）；活跃文件恢复仍需消息历史 |
| 提示词 | `reflect-prompt` | `PromptLibrary` / `PromptSet` / `split_spec` | ✅ 层列表 + 重扫 + **生效正文**（§3.8） |
| 压缩 | `reflect-compact` | `Compactor` / `CompactReport` | ✅ 次数 / 节省 token + **逐次明细**（§3.7） |
| Rollout / 会话 | `reflect-rollout` | `replay` / `to_markdown` / `session_stats` / `all_model_usage` | ✅ |
| Telemetry | `reflect-telemetry` | model-io + **span 日志** | ✅ 两面都已接线（§3.4） |
| 子代理 | `reflect-subagent` | `SubAgentSpec` / `SubAgentFactory` / `Op::Interrupt.child_id` | ✅ 运行态可见与取消、**agent 侧 `call_*` 已注册**（§3.14）+ **spec 可编辑**（§3.16） |
| Agent 定义 | `reflect-agent-def` | `AgentDefinition` / `source` | ✅ 含 v1.6 `source` 字段语义 + **活跃 agent 可切换**（§3.9） |
| 目标模式 | `reflect-goal` | `GoalController` / `GoalState` | ✅ enter/exit + **状态快照读口**（v1.7 上游 `GoalController::snapshot()`，`reflect_goal_snapshot` 命令 + 徽标 tooltip + 投影校准，§4.1） |
| 任务 / 团队 | `reflect-task` | `TaskManager` / `TodoWriteTool` | ✅ CRUD + claim + **产出 / 停止 / 释放**（§3.11）+ **agent 侧任务工具**（§3.14）；**todo 清单已展示**（§3.18），清单回灌已由上游闭合（§3.18） |
| 讨论 | `reflect-discussion` | `DiscussionOrchestrator` | ✅ 顺序和并发讨论可运行，实时事件、失败与取消终态、历史筛选、取消入口和 transcript 持久化已接线 |
| 流水线 | `reflect-pipeline` | `Pipeline::from_toml` / `PipelineReport` | ✅ shell 节点可执行；桌面适配层透传自定义模板输入并保留失败传播 |
| 插件 | `reflect-plugin` / `zhuye-wasm` | `PluginManager` / `PluginManifest` / Wasm Hook + Tool | ✅ 列表 / 启停 / 卸载 / 本地安装 + marketplace；WASM hook/tool 随插件运行时加载，但详情面仅到文件与启停状态（§3.13） |
| 沙箱 | `reflect-sandbox` | `OsSandbox` / `detect_backend` | ✅ 有效状态在状态栏可见（§3.5）+ **开关真正生效**（§3.19，每轮协议策略） |
| BM25 | `reflect-bm25` | `rank_lines` / `tokenize` | ✅ GUI 搜索可选 **BM25 相关性**（§3.16，与 agent 的 grep 同款） |
| AST | `reflect-ast` | `LanguageGrid` / `list_languages` | ❌ 语言网格不可见 |
| 配置分析 | `reflect-config::analytics` | `status_line` / `Health` | 🟡 设置页显示配置路径与分析状态；watcher 健康度不可见 |

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

## 3. 缺口闭合台账

各条目的完整「问题 / 修复 / 取舍」论证见 git 历史与对应轮次的变更日志条目；此处保留台账与关键落点。

### 3.1 权限层接线（安全行为分叉修复）

CLI 三层权限 store 桌面端此前未挂载（deny 规则被静默忽略）→ `src-tauri/src/state/permissions.rs` 按 CLI 同构装配三层链式 store + `HeuristicYoloClassifier`；`reflect_list_permission_rules` + Settings → Permissions「生效的权限规则」只读列表。

### 3.2 Skills 列表与运行时对齐

桌面手写扫描与运行时两处分叉（目录不同 + 漏内置技能）→ `reflect_list_skills` 改用核心 `scan_skills_dirs` / `bundled_skills`，DTO 补 `bundled` / `whenPaths` / `version` / `body` / `pluginId`，UI 标注「内置」徽标。

### 3.3 会话笔记只读面

笔记链路只有写没有读 → `reflect_list_session_notes` / `reflect_list_note_sessions` + Memory 视图「会话笔记」面板。

### 3.4 Span 日志（trace 树）

Traces 只读 model-io，turn → model → tool 父子链不可见 → `app-core/src/traces.rs` 新增 `list_span_log` / `read_span_log`（树深度推导，父链缺失与成环防护）+ Traces 视图「Span 树」标签页。

### 3.5 OS 沙箱有效状态

设置开关看不到实际是否生效 → `reflect_sandbox_status` + 状态栏徽标（口径在 §3.19 重做为每轮协议策略）。

### 3.6 Token 计算做深（模型级用量 + 计价可解释）

只有「最后一次调用」快照 → `TokenSnapshot` 增 `byModel` / `sessionTotal`；Inspector / `/usage` 视图扩展；费率卡经 `app-core/src/pricing.rs` 反解核心静态费率表（该 shim 已在 §3.25 退役，直接读核心公开费率表）。

### 3.7 逐次压缩明细

Inspector 只有一行 hover 摘要 → `CompactionStats.records` 逐次明细（封顶 50 条）+ 可展开列表（策略 / 前 → 后 token / 节省量）。

### 3.8 提示词选择与预览

`/prompt` 与设置页选择器（ZhuYe 默认 / 智能选择 / 手动方案 + 共享默认 + 恢复跟随）；面板展示生效方案、回落原因、系统文案与工具描述；会话覆盖随 rollout 恢复。

### 3.9 活跃 agent 接线（Agents 视图死胡同 + 记忆路径对不上）

桌面硬编码 `"desktop"` 导致 `~/.zhuye/agents/*.md` 定义永远找不到、记忆写读路径分裂 → `src-tauri/src/agent_state.rs`：活跃名由 `~/.zhuye/desktop.json` 决定（缺省 `"default"`，与 CLI 共用定义与记忆目录）；记忆路径经核心 `reflect_memory::resolve_path`；旧目录一次性迁移；`reflect_get/set_active_agent` 切换后重放重绑。

### 3.10 LSP 诊断（Problems）

诊断只进核心被动缓存 → `reflect_lsp_diagnostics(path)`（只读，不主动 pull）+ `LspStatus.diagnostics` 聚合 + Files 视图 Problems 面板（随文件打开轮询刷新）。

### 3.11 任务产出 / 停止 / 释放

任务板只读 → `reflect_get_task_output`（不阻塞）/ `reflect_stop_task` / `reflect_release_task`（守卫与动作同核心 `TaskStopTool` / `TaskReleaseTool`）+ 行内按钮与详情抽屉。核心 `TodoWriteTool` 工具本身实装，占位的只是 `manager` 字段。

### 3.12 MCP 服务管理

GUI 只能观测，加 server 要手改 config → `commands/mcp.rs` 四命令：`list_mcp_servers`（含运行状态与失败原因）/ `mcp_catalog`（核心精选 catalog）/ `upsert` / `delete`（经核心 `mcp_server_configs()` 编译校验，非法不落盘，运行时起停复用 `bootstrap_mcp` 同款路径）；Collaboration 视图 McpManager 面板。

### 3.13 插件管理

只能看 slash 命令，启停卸载要手改文件 → `commands/plugins.rs`：`list_plugins`（启用状态与运行时同源）/ `list_marketplaces` / `toggle_plugin`（`reload_plugins` diff 同步，不打断会话）/ `uninstall` / `install`（经核心 `PluginManager`，含 manifest 校验）；PluginsPanel。

### 3.14 工具注册表补齐（agent 侧「能不能用」的关键缺口）

桌面此前只有 15 个基础工具，缺任务 / 会话笔记 / 子代理三族 → `state/subagents.rs`：`register_task_tools`（进程级）、`register_note_tool`（每会话）、`bootstrap_subagents`（按 CLI 口径合并 spec + 注册 `call_<role>` + 补进 always-on 可见集）；注册表测试断言在册。

### 3.15 运行时状态可观测（S 级批量）

四项只读面落 `commands/runtime_status.rs`：凭证池健康度（`healthy_clients()` 反推冷却数，原因核心不公开不编造）、已完成子代理调用（`SubagentRegistry::snapshot()`）、记忆分段与注入预算、配置位置与分析健康度。AST 语言网格**有意不接**（桌面未启用任何 grammar，列表恒为空，属独立构建决策）。

### 3.16 worktree / MCP 原语 / 子代理 spec / BM25 搜索 / Hook 事件

| 能力 | 命令 | 落点 |
|---|---|---|
| worktree 状态 | `reflect_list_worktrees` | Git 视图 Worktrees 面板（`isolated` / `stranded` 标注丢工风险） |
| MCP 资源 / prompt | `reflect_list_mcp_resources` / `reflect_list_mcp_prompts` | McpManager 折叠区（直问 rmcp peer，与核心工具同源） |
| 子代理 spec 编辑 | `reflect_{list,get,save,delete}_subagent_spec` | Agents 视图子代理页签（编辑原始 md，写前核心校验非法不落盘） |
| BM25 搜索 | `reflect_search_files` 增 `rank` 参数 | Search 视图排序切换（k1/b 与核心 grep 逐字一致） |
| Hook 事件类型 | `reflect_list_hook_events` | Hooks 视图可挂载事件折叠区 |

### 3.17 Pipeline 配置编辑 + 安全扫描

Pipeline 只能跑不能编 → `reflect_validate_pipeline`（校验走核心 `Pipeline::from_toml`，与实际运行同一路径）+ `list/save_pipeline_config`（写前校验非法不落盘）+ Collaboration 编辑器（防抖实时校验）。安全扫描：审计初稿误判「上游 stub」，核实为真实实现 → `reflect_run_security_scan`（`spawn_blocking`，30s 超时）+ Settings 安全扫描卡片。

### 3.18 agent 的 todo 清单（`TodoWrite`）

前端纯消费：`TodoWrite` 工具产出的 `metadata.todos` 经 reducer 采集（仅 `toolName === 'TodoWrite'` 采信，整体覆盖）+ Inspector TodoPanel 渲染；上游回灌已闭合（v1.7 `todos_slot` 共享槽 + `pre_loop` 注入 `## Current Todo List` 段）。

### 3.19 OS 沙箱开关真正生效（此前是死旋钮）

三条来源（配置 `[sandbox].os_level` / 协议每轮覆盖 / env）桌面一条都没接，配置写 false 也没用 → `app-core/src/sandbox.rs` 纯函数唯一事实源（`normalize_os_level`：`None` → 基线开启；env 优先于配置）+ `state/submit.rs::stamp_sandbox_policy` 每轮在 `Op::UserInput.thread_settings.sandbox_policy` 盖章（**无条件覆盖**客户端传值——沙箱是安全设置）+ 配置归一恒写有效值 + 状态口径与工具同构造器（env 覆盖如实标注 tooltip）。上游 schema v1.7 改 `Option<bool>` 后原始 TOML 嗅探 workaround 已移除。

### 3.20 「有命令无界面」的三处漏网（反向审计）

拿「命令存在 + 前端有消费面」双标准反扫全部 182 个后端命令：**零死命令**；12 个前端包装无界面消费，逐个核实后——`set_dock_badge` 假阳性、Markdown 转录导出与更新检查为真缺口并已接线（命令面板「导出当前会话(Markdown)」+ 新建 `UpdatesSection.tsx`）、team 编辑见 §3.22、allowlist 改写见 §3.23、shell 会话列表归入 §2 有意不接。

### 3.21 两条「有类型无渲染」的事件（`plan_step` / `plugin_loaded`）

reducer 有 case 但 `return {}` → `plan_step` 按 `index` 就地更新/追加（Plan 视图「执行进度」清单）+ `plan_ready` 到达清空；`plugin_loaded` 记进程级 `loadedPlugins`（同 id 覆盖）+ Plugins 面板「运行时已挂载」列表。

### 3.22 团队可建可改可删

加团队只能手写 JSON → `TeamEditor.tsx`：团队面板（列表 + 编辑 / 删除 + 表单成员行增删）；口径与核心对齐（`lead_agent_id` 前端推导 `team-lead@<name>`、名字规则同 `validate_team_name`、`SystemTime` JSON 形态订正 TS 类型错误）。

### 3.23 「始终允许」写进核心权限层（消灭桌面端私有第二套真值）

桌面端私有 `approval_allowlist.json` 与核心权限层功能重复且不可见 → **不接旧机制，改写它**：`reflect_add_permission_rule` 追加到 `~/.zhuye/permissions.toml`（CLI/GUI 共用，resolver 每次评估重读即生效）；审批弹窗第四动作「始终允许…」；授权范围刻意保守——Bash 整条命令精确匹配（不用首词通配）、只读工具整体放行、写类工具不给按钮（规则模型无路径维度）。

### 3.24 模型清单发现（`model = "free"` 跨模型降级链接线）

上游 v1.7 R3 动态模型 id 桌面三处断点（同步解析拿占位串 / app-core 镜像函数脱节 / 协议缺 `spec_fallback`）→ `state/agent.rs::resolve_model_spec_with_discovery` 统一入口（静态同步、动态走清单发现、失败如实上报）；`install_agent_thread` 改 async，registry 延迟到解析完成才发布；热重载失败保留旧 model 进 `degraded_reason`；前端 `spec_fallback` 变体 + `[model_discovery]` 配置面 + 模型列表免费标记 + 数组字段直接写字面量修复二次编码。

### 3.25 submodule develop 重叠收敛（app-core 九模块切换上游单一事实源）

| app-core 模块 | 处置 |
|---|---|
| `paths` | 删除 → `reflect_config::paths`（同名 1:1，上游多 getpwuid 兜底） |
| `actor` | 删除 → `reflect_task::Actor` |
| `squad` | 删除 → `reflect_task::squad`（上游修 created_at 丢失 / NotFound 映射） |
| `autopilot` | 删除 → `reflect_stream::autopilot`（真实 cron 到期 + `fire_if_due`） |
| `pricing` | 删除 → `reflect_llm::providers` 公开费率表（反解 hack 退役） |
| `kms` | 删除 → `reflect_kms`（API 逐字一致） |
| `activity` | 收缩为再导出垫片 → `reflect_telemetry::activity`；桌面留 `ActivityLog` 句柄支撑 Inbox 清空 |
| `sandbox` | 收缩为两小助手 → 解析/优先级走 `reflect_sandbox::os_sandbox` |
| `side_channel` | 删除 → `reflect_core::side_channel` 引擎原生（§3.26） |

保留（无重叠的桌面装配）：`media` / `stats` / `tailscale` / `traces` / `discussion` / `pipeline`。

### 3.26 Side-channel 引擎原生执行（driver 接线 + 事件面全通）

develop WP9「桌面缺失的那一半」→ `thread_factory.rs` 构造 `SideChannelDriver` 注入 `AgentConfig`；`SideChannelRegistry` Arc 共享（跨会话 rebind 存活）；四命令保持 wire 形状、内部改提交协议三 Op 等配对应答；三事件变体进类型联合 + reducer + 视图订阅；终态经 `side_channel_forwarder` 以 `EVENT_ID_NONE` 信封补发。

### 3.27 submodule 接线 main（`0220677` → `321cb825`，v0.1.10 + 5）

| 上游能力 | 桌面接线 | 状态 |
|---|---|---|
| `Op::RescanExtensions` + 事件 | 命令四方接线 + reducer toast；GUI 触发按钮待接 | 🟡 |
| 思考档位 `max` / `ultra` | Composer 控件 + `/effort` + Models 视图 | ✅ |
| `ThinkingDelta.kind` | payload 类型登记；渲染暂不区分 | 🟡 |
| `PermissionRule.resource_glob` | 命令输入支持（serde default）；规则 UI 未暴露 | 🟡 |
| WASM 插件宿主 / 配置导入 / 会话队列调度 / secrets / audit | 随引擎自动生效，无专属消费面 | 🟡 |
| `RolloutError` / `build_default_m4` 不可失败化 | `recorder_guard` / `thread_factory` 跟随适配 | ✅ |

主仓 workspace 镜像 8 个新继承键（wasmtime 锁 `=30.0.1` 与上游同代）。

### 3.28 submodule 跟随 main（`321cb825` → `54c8a001`，v0.1.11）

版本 bump 四处同步；协议/运行时 API 零变化，桌面无适配；全量门禁复跑通过。

### 3.29 submodule 跟随 main（`54c8a001` → `5f45f0ac`，v0.1.12）

SDK 文档门禁进 CI、协议全集补齐；运行时新增 `[prompt_guard]`（opt-in）。桌面适配一处：zhuye-llm `ChatEvent::AgentMessage` 变体补穷举 match；前端协议面零变更。

### 3.30 完整复审 `d063a5f → 5f45f0ac`（v0.1.12）

审计 538 个文件。协议面：`Op` 26 变体（24 有桌面命令，2 个远程工具协议专用）；`EventMsg` 50 变体三方奇偶覆盖。能力族结论：

| 能力族 | 桌面状态 |
|---|---|
| 运行时安全（PromptGuard / 审批 TTL / 循环守卫 / 中毒判定） | 🟡 自动生效；guard 与中毒退役无专属 UI |
| Provider / 配置（输出预算 / 档位钳制 / 上下文窗口 / 免 Key） | ✅ Composer / Models / plans 消费 |
| 工具（单一事实源 / checkpoint / 循环守卫 / Bash 参数面） | ✅ 共享清单，语义纳入 IPC 回归 |
| 编排（side-channel / steering / queue scheduler / cron / autopilot） | ✅ 已接线（queue scheduler 不接，桌面有自己的会话队列） |
| 导入 / 插件（zhuye-import / WASM / 用户级 slash） | 🟡 插件与用户级 slash 可用；外部会话导入无桌面入口 |
| Rollout / KMS / 费率 / 编排 / CLI SDK | ✅ 已接线；⛔ CLI/SDK 形态不强制映射 GUI |

复审证据：静态门禁、真后端 L3 全量 3,407 条、前端全量 1,529 条测试通过；运行态证据见 `tests/RUNTIME_COVERAGE.md`。

### 3.31 增量复审 `5f45f0ac → f4bb7057`（v0.1.12）

上游 5 个提交集中在测试与 lint 收口；协议、命令面、事件面、工具接口与配置 schema 零变更，桌面无适配。桌面静态门禁 26/26、真后端 3,443 条、前端 1,536 条测试通过。

### 3.32 submodule 跟随 develop（`893faa95` → `199a3d3b`，v1.x）

上游修复「首条消息前切权限模式的会话被索引丢弃」（写路径 SessionMeta 守卫 + 读路径前 8 条扫描恢复存量坏文件）。桌面消费面：

| 能力 | 现在 |
|---|---|
| 会话列表完整性 | 存量坏文件免迁移恢复，workspace 归属找回（L3 回归在案） |
| `plan_draft_updated` | reducer 存 `planDraft`；Inspector「计划」tab 实时渲染；`plan_ready` 终稿优先展示；重放经最后一条 `plan_ready` 恢复 |
| Inspector 计划/Git tab | 补齐缺失的 `onClick` |
| 工作区移除语义 | `reflect_set_workspace` 可选 `unhide`；remove 按规范化路径匹配所有变体 |

同批上游 `893faa95`（折叠内联 System 消息）修复严格 provider 对压缩摘要中置 System 的 400 拒绝。

---

## 4. 剩余缺口与后续

当前子模块的能力矩阵已按 `f4bb7057` 复审；接线不等于全链路运行态验证。
已确认的运行态覆盖与待验证项见 `tests/RUNTIME_COVERAGE.md`；
以下记录此前已处理的项目。

- 「todo 清单只出不进」→ **上游已闭合**（zhuye-agent v1.7 `d621397`：
  `AgentConfig.todos_slot` 共享槽 + `tool_exec` 渲染清单 + `pre_loop`
  注入 `## Current Todo List` 段 —— agent 每轮都能看到自己刚写的清单）。
- 「Goal 状态可观测」→ **上游已闭合 + 桌面端已接线**（见 §4.1）。
- 「`[sandbox].os_level` 语义差」→ §3.19 桌面端闭环；上游 schema 亦已改为
  `Option<bool>`（v1.7），桌面端的原始 TOML 嗅探 workaround 已随之移除。
- 「免 Key 端点（免费模型池）配不出来」→ **上游 + 桌面端均已闭合**
  （上游 `122fc3e0`：`CredentialConfig.api_key` 改 `#[serde(default)]`，
  显式配了 `base_url` 就注册 provider；桌面端 `reflect_list_provider_models` /
  `reflect_test_provider_chat` 接受空 key，plan 编辑器允许留空并标注
  「免 Key」）。
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
  挂载 / 覆盖 / 退出全周期的快照形态）+ `ipc_agent_ops.rs`
  （无 provider 时不产生幽灵目标的快照断言）。

### 4.2 核心文件工具的路径竞态防护（上游已闭合，桌面端已接入 submodule）

`f755d73d` 已把「先检查、后按路径读写」改为固定文件/目录句柄，并校验任务列表 ID：

| 位置 | 现状 |
|---|---|
| `zhuye-tools/src/sandbox.rs` | `read` / LSP 文档同步固定只读句柄，写入固定父目录并用私有暂存目录 |
| `builtins/read.rs` | 同一句柄完成二进制嗅探、大小上限和内容读取 |
| `builtins/{write,edit,plan_write,notebook_edit}.rs` | 独占创建临时文件、句柄级替换、保留 mode / owner / ACL / xattr |
| `builtins/image_view.rs` | 固定只读句柄上检查大小并读取 |
| `zhuye-lsp/src/{tool.rs,document.rs}` | 路径解析拒绝外部/悬空符号链接，文档从固定句柄读取 |

覆盖由上游 crate 单测和 mock LSP server 集成测试提供；桌面侧工作区文件命令
仍保留自己的固定父目录实现并有 L3 用例覆盖。

> 上游文档漂移已订正（`3a1bab4b`，含于 `e4560bc`）：`reflect-task/src/lib.rs`
> 的 TodoWrite 清单通道描述与 `todo_write.rs` 模块注释均已与实现对齐。

---

## 5. 维护约定

- 基座升级（`git submodule update --remote`）后**重新跑一遍本审计**：
  新的 `Op` / `EventMsg` 变体、新的 crate 公开 API 都要在此登记。
- 协议不变量（`AGENTS.md`）：**所有 `Op` 变体 → Tauri 命令**、
  **所有 `EventMsg` 变体 → TS 类型 + reducer**。核对脚本见
  `docs/protocol-bridge.md`。
- 表中状态由「命令是否存在」+「前端是否有消费面」两项共同决定 ——
  有命令但无 UI 视为 🟡（半接线），不是 ✅。
- 本文档头部的「最近审计」锚行是静态门禁依赖（`tests/static/run.sh`
  比对 submodule sha），升级后必须同步更新该行。

---

## 历史审计记录

各轮 submodule 升级的审计流水（最新在上）：

- **上一轮 `199a3d3`**（rollout 首行修复：首条 UserInput 之前的 `PermissionModeChanged` / `PlanRequest` 等记录在 SessionMeta 未落盘时不再持久化（初始模式改由会话头落地时补记），`parse_first_session_meta` 在前 8 条非空行内扫描 SessionMeta 恢复存量坏文件 —— 修复「先切权限模式再发首条消息的会话被索引丢弃、workspace 归属丢失」。GUI 侧配套：`plan_draft_updated` 消费、Inspector 计划 tab 正文渲染、工作区移除不再被 incidental 切换复活（详见 §3.32）。）
- **上一轮 `893faa9`**（System 消息折叠修复：`ChatRequest::fold_system_messages` 把内联 `System`（压缩摘要 / PreCompact hook 注入 / resume 回放 summary）折叠进 `system` 块，消除严格 OpenAI 兼容网关的 `INVALID_REQUEST`（"System message must be at the beginning."），并修掉 Anthropic 静默丢弃内联 System 导致的内容丢失。本次仅在请求构造层修复，**产品命令、事件、配置与 SDK 公开面零变更，桌面无适配**。）
- **上一轮 `1239806`**（F01 注入防护强化：`[prompt_guard]` 由 opt-in 转**默认开启**，工具输出 Block/Review 裁决 + 外部工具定义注册期扫描（Block 拒绝注册）+ SHA-256 指纹上报；新增 `Op::QueryGuardStats` / `EventMsg::GuardStats`（additive，GUI 已接设置开关 + 工具行注入徽标），及 F24 Windows 沙箱 FFI 等 develop 线全部修复。）
- **注意**：bug-fix 分支原先指向的 `a32b62b`（流式不压缩 / 思考阶段断开重试 / 流式错误必定收尾 / 思考强度按端点能力自动适配）**未推送至 ZhuYe 上游**，本仓库暂以 `7196d3c5`（develop，含审批策略分离 `auto_approve`·`full_access` 变体 + CI 债修复）兜底。当前状态：①审批策略三档已全量支持，按用户偏好原样发送（上游 `fix/desktop-runtime-modes` 已合入）；②思考强度能力走上游静态能力表（与引擎 wire 前钳制同源）——「运行时已验证结论」层（effort_cache）仍待上游合入后叠加。
- **上一轮 `390a88a`**(F01 注入防护强化)之前为 `72d7d97`：TaskOutput block=true 只认非空内容，消除 Windows 上 writer create→write 窗口读到空串的竞态；发布批次 v0.1.14 同步。
- **上一轮 `e3da2540 → 58cebeb6`** 为两项 Windows 平台行为修复：safe_write 原子改名改走 NT 层 `NtSetInformationFile`（Win32 封装层整体拒绝非 NULL RootDirectory，code 87 的真根因；并按 Windows「不能替换仍有打开句柄的文件」约束在改名前释放旧目标句柄）；pipeline shell 节点用例按平台断言（Windows 无沙箱后端，fail-closed 拒绝是可达语义）。
- **上一轮 `0cca4c6a → e3da2540`** 为 safe_write 原子改名切到 FileRenameInformationEx：非 Ex 类拒绝非 NULL RootDirectory（code 87），write/edit/plan_write 落盘与 GUI 文件保存在 Windows 上恒红的根因；plan_write 绝对路径改按分量判定（Windows `is_absolute()` 对无盘符根路径漏网）。均为能力内部实现，产品命令、事件、配置与 SDK 公开面零变更，桌面无适配。
- **上一轮 `8e72bc4c → 0cca4c6a`** 为 Windows 文件锁句柄口径补漏：zhuye-telemetry 的 `activity.lock` 与 zhuye-audit 的 FileSink 公共 open 路径此前仍以纯 append 句柄加锁，`LockFileEx` 在 Windows 上直接 ACCESS_DENIED（code 5）——即上一轮 `1c09f6a4 → c728da8e`（zhuye-task 等三处）同一根因的剩余两处。均为能力内部实现，产品命令、事件、配置与 SDK 公开面零变更，桌面无适配。
- **上一轮 `c728da8e → 8e72bc4c`** 为三项 Windows 平台行为修复：zhuye-git 命令超时用 Job Object 整树终止（孙进程不再逃逸，与 Unix 进程组对等）、zhuye-lsp / zhuye-mcp / zhuye-shell 的 stdio 子进程 `env_clear` 后透传运行时候选变量（缺 SystemRoot 会让 node.exe 等 CRT 程序在输出前即崩溃）、zhuye-shell 会话 kill 整树终止（GUI 终端 kill 按钮在 Windows 上自此清场）。均为能力内部实现，产品命令、事件、配置与 SDK 公开面零变更，桌面无适配。上一轮 `1c09f6a4 → c728da8e` 为修正 Windows 文件锁句柄权限（`LockFileEx` 要求可读句柄），产品命令、事件、配置与 SDK 公开面零变更，桌面无适配。
- **上一轮完整审计覆盖 `f4bb7057 → 57907d5b` 全部 538 个文件**，按协议、运行时、工具、LLM/配置、编排、插件/导入、CLI/SDK 七个能力族逐项对照桌面命令与前端消费面（详见 §3.30）。命令面由静态门禁验证 189 个注册命令全部有前端消费面；事件面由三方奇偶门禁验证 50 个 `EventMsg` 变体；提交面由 Rust/TS/样本奇偶验证 26 个 `Op` 变体；运行态证据按域登记在 `tests/RUNTIME_COVERAGE.md`。
- **历史审计记录**：`d063a5f`（0.1.8 + 路径安全批次）复核过协议面、数据目录口径与核心文件工具；`e4560bc` / `c0377609` 批次闭合了 Goal 快照、todo 回灌、`os_level` schema、免 Key 端点、清单回灌、工具参数整包形态和审批门取消令牌观察。
