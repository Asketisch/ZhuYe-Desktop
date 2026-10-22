# 协议桥（Tauri ↔ Reflect-Protocol）

> **线格式 = `reflect_protocol::Event` / `Submission` 直接传递（snake_case JSON）。** 无自定义序列化器，无 DTO 层。同一信封与 TUI 和 `reflect exec` 共享。
>
> 阅读顺序：§1 信封 → §2 提交（UI → 后端）→ §3 事件（后端 → UI）→ §4 ID 配对 → §5 版本兼容性 → §6 生成的 TS 类型。

---

## 1. 信封

```rust
// reflect-agent/crates/protocol/reflect-protocol/src/event.rs
pub struct Event {
    pub id: String,     // matches Submission.id; EVENT_ID_NONE = "" for lifecycle
    pub msg: EventMsg,  // serde-tagged enum (snake_case)
}
```

两条通道：

- **UI → 后端**：`invoke('reflect_submit', { submission })` 其中 `submission: Submission = { id, op, ... }`。
- **后端 → UI**：`listen('reflect_event', handler)` 载荷为 `Event`。**单一通道名**；按 `msg.type`（snake_case 鉴别器）分派。

> 前端从不使用信封包装。Tauri 命令名是唯一框架。

---

## 2. 提交（UI → 后端）

`Op` 变体列在 `reflect-agent/crates/protocol/reflect-protocol/src/op.rs` 中；每个 1:1 映射到一个 Tauri 命令，其主体位于 `src-tauri/src/commands/<domain>.rs`（由 `src-tauri/src/commands/mod.rs` re-export）。完整集合见下方 §2.0 表格；规范的 Op→命令映射是唯一真相源，应在 `reflect-protocol/src/op.rs` 变更时重新生成。

> **注**:除 `UserInput` 经 `reflect_submit` 接受完整 `Submission` 外,其余 Op 命令
> 后端在 `commands/<domain>.rs` 内部构造 `Op` 并经 `MinimalAgent::submit_op` 投递。
> 所有 Op 命令返回 `string`(submission id,供前端 pairing/调试)。

> **v1.4 转向 / 子代理桥接**:`steer`(回合中途转向)与 `query_subagents`
> (子代理状态查询,应答 `subagent_status` 事件)经 `reflect_steer` /
> `reflect_query_subagents`(`commands/agent.rs`)桥接;前端 IPC 包装在
> `src/utils/commands/agent.ts`。Steer 的注入由引擎在 pre_loop 安全点
> 收割,**不发协议事件**(仅落 recorder),GUI 在 `store.steer` 内乐观
> 渲染插话。

> **Goal 模式(v1.2 P1)**:`enter_goal_mode { goal, verify_command?, token_budget? }` /
> `exit_goal_mode` 映射到 `reflect_enter_goal_mode` / `reflect_exit_goal_mode`
> (`commands/agent.rs` / `commands/goal.ts`)。进入目标模式后,core 侧
> `GoalController` 在每轮 turn 结束自校验(LM judge + 可选校验命令),未完成则
> steering 自动续作 —— **不需要新的用户提交**;GUI 经常规 turn/流式事件呈现
> 多轮续作,事件侧无 goal 专属变体。

### 2.0 Op 之外的命令（诊断 / 配置 / 域 I/O）

这些命令不对应 `Op` 变体；它们与 Op 派生的命令共存于相同的域模块中：

| 命令 | 负载 | 返回 | 位置（Rust）/ 位置（TS）|
|---|---|---|---|
| `ping` | `null` | `{ msg, version }` | `src-tauri/src/commands/agent.rs` (barrel) / `src/utils/commands/health.ts` |
| `reflect_submit` | `{ submission }` | `string`（submission id） | `commands/agent.rs` / `commands/agent.ts`。**图片附件归一**：前端 Composer 的图片是 data-URL（base64）字符串，协议 `UserInputItem::Image.data` 是 `Vec<u8>`（serde 要求数字数组）；应用层在反序列化前把 `type:"image"` 条目的字符串 data（data-URL 或裸 base64）解码为字节数组，再交 serde。线格式保持紧凑，协议层不变 |
| `reflect_agent_status` | `null` | `{ ready, has_model, model, workspace, degraded_reason }` | `commands/agent.rs` / `commands/agent.ts` |
| `reflect_get_config` | `null` | `string` (TOML) | `commands/config.rs` / `commands/config.ts` |
| `reflect_save_config` | `{ toml }` | `null` | `commands/config.rs` / `commands/config.ts`。写盘前 `load_from_str` 校验；provider 相关段（`active` / `anthropic` / `openai` / `ollama` / `routing`）变化时重建 ModelRegistry + QuotaTracker 并强制重绑当前会话（coding plan 切换无需重启，见 `state/reload.rs`） |
| `reflect_set_model` | `{ provider, model, label? }` | `string`（解析后的完整 spec；无任何显式 model 时空串） | `commands/config.rs` / `commands/config.ts`。运行中切换模型 / 钉住 coding plan（协议 `Op` 无 SetModel）：写 `[active].provider` + `[active].credential`（`label` 非空时钉住该凭证条目）→ 复用 `reflect_save_config` 同款写盘 + `hot_reload_provider_stack`（重建 registry + 强制重绑），下一个 turn 生效。`provider` 仅接受 `anthropic \| openai \| ollama`；`label` 命中 `[[<provider>.credentials]]` 条目时 model 写入条目自身（条目 model 优先于段级）；`label` 缺省 / `'default'`（无数组条目）走段级 `[<provider>].model`；显式 `label` 找不到条目报错。上游 `resolve_model` 诚实解析（env > 钉住条目 model > 段级），未显式配置**不编造内置默认** → 返回空串，UI 显示「未配置模型」。Composer 内联模型选择器与 Models 页 plan 卡片消费 |
| `reflect_query_plan_quota` | `{ baseUrl, apiKey, checkVia }` | `PlanQuotaSnapshot`（`{ success, error, utilization, remaining_tokens, max_tokens, resets_at }`） | `commands/config.rs` / `commands/config.ts`。手动查询 coding plan 用量（Settings → Coding Plans 的「查询用量」按钮，仅对配置了 `quota.check_via` 的 coding plan / token plan 开放）：`checkVia`（`kimi \| zhipu \| minimax \| zenmux`）经 `state/quota.rs::make_provider` 同一份映射实例化 `reflect_llm::QuotaProvider`，对着厂商用量 API 查询（端点与 cc-switch 一致），与运行时 failover 判定共用实现。传显式 `baseUrl`/`apiKey`（非 provider+label），编辑中未保存的表单也能试查。`volcengine` / `anthropic_usage` / `open_a_i_usage` 暂未实现 → 命令报错；网络瞬时失败折叠为 `success=false`（与确定性失败同形，UI 处理一致） |
| `reflect_get_effort` | `null` | `string`（`low \| medium \| high`） | `commands/agent.rs` / `commands/permissions.ts`。直读线程内 `AgentConfig::current_effort()`（协议无 effort 回读事件）；线程未安装时回落 `low`。Composer 内联思考深度与 Models 页分段控件初始化用 |
| `reflect_list_tools` | `null` | `Vec<{ name, description }>` | `commands/agent.rs` / `commands/agent.ts` |
| `reflect_list_plugin_commands` | `null` | `Vec<PluginCommandInfo>`（`{ name, description? }`） | `commands/plugins.rs` / `commands/plugins.ts`。已挂载插件的 slash 命令只读快照（composer 弹层候选数据源）：取插件运行时的 `CommandRegistry.list()`；未挂载（占位线程 / 无 enabled 插件 / HOME 缺失）返回空列表。`name` 为命令全名（`plugin:ns:name` 形式），前端以 `/name args` 提交，展开仍由后端 submit 边界 `expand_submission` 统一做 —— 此命令无文件 IO |
| `reflect_credential_pool_status` / `reflect_recovery_state` / `reflect_memory_sections` / `reflect_config_info` | `null` | `CredentialPoolStatus[]` / `SubagentCallRecord[]` / `MemorySectionInfo[]` / `ConfigInfo`（均 camelCase） | `commands/runtime_status.rs` / `commands/runtimeStatus.ts`。**运行时状态只读面**：① 凭证池健康度（`total` / `healthy` / `healthyLabels`；核心 cooldown 集合私有 → 用 `healthy_clients()` 的健康集合反推冷却数，冷却**原因**核心内不公开故不编造）；② 已完成的子代理调用（core `SubagentRegistry::snapshot()`：工具名 / 任务摘要 / 结果摘要 / 迭代 / 时间）；③ 记忆分段（core `split_sections` 按 `## ` 切分 + 字符数，与 8000 字注入预算对照）；④ 配置位置与分析健康度（配置路径 / 是否存在 / 分析开关与状态 / 工作区 / 活跃 agent）。落点：Inspector（①②）、Memory 视图（③）、Settings 侧栏（④） |
| `reflect_list_plugins` / `reflect_list_marketplaces` / `reflect_toggle_plugin` / `reflect_uninstall_plugin` / `reflect_install_plugin` | `null` / `null` / `{ id, enabled }` / `{ id, scope }` / `{ path, marketplace, scope }` | `PluginInfo[]` / `MarketplaceInfo[]` / `null` / `null` / `null`（均 camelCase；`scope` 线上为小写枚举 `managed`/`user`/`project`/`local`） | `commands/plugins.rs` / `commands/plugins.ts`。**插件管理** —— 此前 GUI 只能看到插件带来的 slash 命令。`list_plugins` 给出已安装插件（id / 版本 / scope / 安装路径 / **是否启用**，启用态取自 config 的 `enabled_plugins`，与运行时挂载集合同源）；`list_marketplaces` 给出 config 的 `[plugins].marketplaces`（名字 / 源类型 directory·file·github·url / 安装位置 / 自动更新）；`toggle` 改 config → 落盘 → 核心 `reload_plugins` diff 同步（挂/卸插件，**不打断运行中的会话**）；`uninstall` / `install` 经核心 `PluginManager` 读写 `installed_plugins.json`（含 manifest 校验）。Collaboration 视图 PluginsPanel 消费 |
| `reflect_list_provider_models` | `{ baseUrl, apiKey, endpoint }` | `ProviderModelsResult`（`{ endpoint, models: [{ id, display_name, supports_vision }] }`） | `commands/models.rs` / `commands/models.ts`。对着 base_url + api_key 拉取可用模型列表：`openai` → `GET {base}/models`（Bearer）、`anthropic` → `GET {base}/v1/models`（`x-api-key` + `anthropic-version`）。`supports_vision` 取自 OpenRouter 风格 `architecture.input_modalities` / `input_modalities`（含 `image` 即视觉），官方 API 未返回时为 `null` → 由用户自行判断。Composer 模型选择器与 Coding Plans 表单消费。**兼作零 token 连通测试**（Plans 表单「测试连接」） |
| `reflect_test_provider_chat` | `{ baseUrl, apiKey, endpoint, model }` | `{ reply }` | `commands/models.rs` / `commands/models.ts`。发送测试消息「你好」验证鉴权/网络/推理链路：单条 user 消息，**刻意无 system 提示词、无 tools 定义**，`max_tokens = 32` 压低无效消耗。`openai` → `POST {base}/chat/completions`；`anthropic` → `POST {base}/v1/messages`（回复取 `content[]` text 块拼接）。Plans 表单「发送测试消息」按钮消费 |
| `reflect_list_sessions` / `reflect_rename_session` / `reflect_delete_session` / `reflect_replay_session` | `{ workspace?, limit?, offset? }` / — / — / — | `SessionInfo[]` / — / — / — | `commands/sessions.rs` / `commands/sessions.ts`。`workspace` 为可选过滤（`SessionInfo.workspace` 精确匹配；旧会话 `workspace = None` 仅在全量列表出现） |
| `reflect_create_session` | `null` | `string`（ThreadId） | `commands/sessions.rs` / `commands/sessions.ts`。纯 ID 分配（New Chat 先拿路由 id），不触发后端绑定；会话文件在首条 `UserInput` 时由后端物化并写 `SessionMeta.workspace`（workspace 值取自任意类型首条 `Submission` 的顶层 `workspace`，缺省回退 `cfg.current_workspace()`） |
| `reflect_bind_session` | `{ id }` | `string`（绑定后线程的 PermissionMode，如 `"plan"`） | `commands/sessions.rs` / `commands/sessions.ts`。把后端 `AgentThread` 换绑到指定 session id：replay 该 id 的 JSONL → `records_to_preload` → 重建线程（`with_session_id` + M4 recorder 同 id）。**权限模式绑定会话**：审计轨迹末次 `PermissionModeChanged` 经 `with_initial_permission_mode` 恢复为新线程初始模式（`Bypass` 按 v1.3 安全基线降级 `Prompt`；无记录落默认 `Auto`），provider 热重载的强制重绑则透传旧线程当前模式。**后端幂等**（同 id 短路，仍返回线程实际模式）；未知 id（刚 `reflect_create_session` 分配、未落盘）走空历史分支不报错。ChatView 挂载每个会话都调一次（bind → `syncPermissionMode(返回值)` → replay → hydrate 序列）；旧线程经 `cancel_token` 有界排空，cron driver 换 sender 后重启（job uuid 保留） |
| `reflect_fork_session` | `{ id, branch?, upToTurnId? }` | `string`（子会话 id） | `commands/sessions.rs` / `commands/sessions.ts`。GUI 入口对应 CLI `reflect session fork`：`rollout_index::fork_with_history` 复制父会话 JSONL（`upToTurnId` 截至某 turn 含，`None` 全量）生成新子会话，父文件 append `Fork` 血缘 marker，子会话继承父 SessionMeta model 并把 `branch`（默认 `manual`）写成自定义名（`_names`）。纯文件操作不触碰运行中的 AgentThread（同步 IO 包 `spawn_blocking`）；前端拿到子 id 后自行路由切换（ChatView 挂载 → bind + replay 即得完整历史）。会话列表 kebab 菜单「Fork」入口（Sidebar + ThreadsView 共用） |
| `reflect_archive_session` / `reflect_unarchive_session` / `reflect_list_archived_sessions` | `{ id }` / `{ id }` / `null` | `null` / `null` / `SessionInfo[]` | `commands/sessions.rs` / `commands/sessions.ts`（归档树 `~/.reflect/sessions-archive`，整树搬移、相对路径不变） |
| `reflect_generate_session_title` | `{ id, force? }` | `string`（最终标题） | `commands/sessions.rs` / `commands/sessions.ts`。AI 生成会话标题：replay 取首条 User + Assistant 文本 → MinimalAgent 的 SharedModelRegistry one-shot 调用（routing.main 模型）→ `derive_title` 清洗（≤48 字符）→ 写 `~/.reflect/sessions/_titles/<id>.title`。标题优先级：自定义名（`_names`）> AI（`_titles`）> 首条消息派生 —— 自定义名存在时直接返回不调模型；`force = false`（默认，turn 收尾自动触发）幂等返回已有 AI 标题；`force = true`（菜单「AI 重命名」）重新生成覆盖。归档/删除与 `_names` 同步搬移/清理 |
| `reflect_export_session` / `reflect_export_session_markdown` | `{ id }` / `{ id }` | `string` (path) / `string` (markdown) | `commands/export.rs` / `commands/sessions.ts` |
| `reflect_git_status` / `reflect_git_diff` / `reflect_git_log` | — | `GitStatus` / `string` / `Vec<GitLogEntry>` | `commands/git.rs` / `commands/git.ts`。`GitStatusEntry.staged: bool` 由 porcelain 两字符码的 index 列推导（`"M "` 已暂存 vs `" M"` 仅工作区 —— `status` 字段是 trimmed 码,二者折叠成同一个 "M",staged/working 分 tab 判定必须用 `staged`） |
| `reflect_git_stage` / `reflect_git_unstage` / `reflect_git_commit` | `{ paths: string[] }` / `{ paths: string[] }` / `{ message }` | `null` / `null` / `string`（短 hash） | `commands/git.rs` / `commands/git.ts`。P3 Git 操作化：`git add --`（空 paths = `add --all`）/ `git reset HEAD --` / `git commit -m`（非空校验）。不做 push/pull（远端凭证留在终端） |
| `reflect_gh_pr_list` | `{ limit? }` | `GhPullRequest[]` | `commands/git.rs` / `commands/git.ts`。shell out 到 `gh pr list --json`；gh 未安装 / 非 repo / 未登录 → Err 带原因（前端空态展示不打断） |
| `reflect_search_sessions` | `{ query, limit? }` | `SessionSearchHit[]` | `commands/sessions.rs` / `commands/sessions.ts`。P1 跨会话内容搜索：ASCII 折叠大小写不敏感子串匹配，grep 会话 JSONL 的 user/assistant 文本；覆盖活跃树 + 归档树，按最近序扫描上限 120 个会话，命中 `limit`（默认 20）即止；返回首个命中片段（前后 ~60 字符，空白折叠） |
| `reflect_run_shell` | `{ cmd }` | `ShellSession { id, command, cwd }` | `commands/shell.rs` / `commands/terminal.ts`; `reflect_terminal_output` event streams output |
| `reflect_kill_shell` | `{ session_id }` | `null` | `commands/shell.rs` / `commands/terminal.ts` |
| `reflect_list_shell_sessions` | `null` | `string[]` | `commands/shell.rs` / `commands/terminal.ts` |
| `reflect_list_dir` / `reflect_read_file` / `reflect_search_files` | `{ path?, maxDepth? }` / `{ path }` / `{ query, path?, maxResults?, rank? }` | `DirListing` / `FileReadResult` / search results | `commands/files.rs` / `commands/files.ts`; `commands/search.rs` / `commands/search.ts`。`rank` 缺省 `substring`（子串匹配）；`bm25` 走**相关性排序** —— 复用核心 `reflect_tools::bm25::{tokenize, rank_lines}`（`k1=1.2` / `b=0.75`，与核心 grep 工具逐字一致），GUI 搜索不再弱于 agent 自己的 grep |
| `reflect_write_file` | `{ path, content }` | `string`（写入的绝对路径） | `commands/files.rs` / `commands/files.ts`。工作区沙盒内写回文本文件；编辑器 Reject 恢复原文时由 inverse-patch 重建内容后调用，文件不存在则创建（含父目录） |
| `reflect_read_image_base64` | `{ path }` | `ImageBase64Result { path, mime_type, base64, size }` | `commands/files.rs` / `commands/files.ts`。Composer 拖拽图片附件管线：读任意路径的图片文件（**不做工作区沙盒**，拖拽来源任意）返回 base64，前端拼 data-URL 作 inline `Image` item 提交（core 的 `LocalImage` item 尚未接通）。扩展名白名单 png/jpg/jpeg/gif/webp/bmp，上限 20 MiB |
| `reflect_lsp_set_enabled` / `reflect_lsp_status` / `reflect_lsp_warmup` | `{ enabled }` / `null` / `{ path }` | `LspStatus`（`{ enabled, servers }`）/ 同左 / `{ warmed, server }` | `commands/lsp.rs` / `commands/lsp.ts`。LSP 按工作区**手动开启**（默认关）：开启 = bootstrap `[lsp_servers]`（注册 `lsp` tool + 起 server，幂等），关闭 = 反注册 tool + 停全部 server；关闭时不注入 `lsp` tool。`warmup` 对命中的 server `ensure_open`（didOpen 建索引）——编辑器打开代码文件时触发；未开启 / 无匹配 server 时 `warmed = false` 不报错。开启偏好的持久化（localStorage，按 workspace 路径）在 GUI 层 |
| `reflect_load_allowlist` / `reflect_save_allowlist` / `reflect_check_allowlist` | — | allowlist payload | `commands/allowlist.rs` / `commands/allowlist.ts` |
| `reflect_list_workspaces` / `reflect_set_workspace` / `reflect_current_workspace` | — | workspace payloads（`WorkspaceInfo { path, label, last_used, session_count }`，历史持久化于 `~/.reflect/workspaces.json`） | `commands/workspaces.rs` / `commands/workspaces.ts` |
| `reflect_pick_workspace_folder` | `null` | `string?`（原生目录选择框，取消 → `null`；走 `tauri-plugin-dialog` Rust API，不经 JS IPC） | `commands/workspaces.rs` / `commands/workspaces.ts` |
| `reflect_reveal_path` | `{ path }` | `null`（在 Finder / 资源管理器 / xdg-open 中定位） | `commands/workspaces.rs` / `commands/workspaces.ts` |
| `reflect_list_skills` | `null` | `SkillEntry[]` | `commands/skills.rs` / `commands/skills.ts` |
| `reflect_list_memory` / `reflect_add_memory` / `reflect_remove_memory` | `{ scope?, key?, value? }` | memory payloads | `commands/memory.rs` / `commands/memory.ts` |
| `reflect_list_hooks` / `reflect_toggle_hook` | — | hook payloads | `commands/hooks.rs` / `commands/hooks.ts` |
| `reflect_check_update` | `null` | update info | `commands/update.rs` / `commands/updates.ts` |
| `reflect_list_tasks` / `reflect_create_task` / `reflect_get_task` / `reflect_update_task` / `reflect_claim_task` / `reflect_delete_task` | `{ list }` / `{ list, subject, description, active_form?, owner?, metadata? }` / `{ list, id }` / `{ list, id, patch }` / `{ list, claimer }` / `{ list, id }` | `Task[]` / `Task` / `Task` / `{ task, updatedFields, statusChange? }` / `Task?` / `null` | `commands/tasks.rs` (Phase 1 multi-agent) / `commands/tasks.ts` |
| `reflect_list_teams` / `reflect_upsert_team` / `reflect_get_team` / `reflect_delete_team` | `null` / `{ team }` / `{ name }` / `{ name }` | `TeamFile[]` / `null` / `TeamFile` / `null` | `commands/tasks.rs` (Phase 1 multi-agent) / `commands/teams.ts` |
| `reflect_list_schedules` / `reflect_add_schedule` / `reflect_update_schedule` / `reflect_remove_schedule` / `reflect_get_schedule_status` | `null` / `{ schedule, prompt, name? }` / `{ id, schedule?, prompt?, name?, enabled? }` / `{ id }` / `null` | `CronJobSpec[]` / `CronJobSpec` / `CronJobSpec` / `bool` / `{ status, line, total, enabled }` | `commands/schedule.rs` (Phase 1 item 2) / `commands/schedule.ts` |
| `reflect_list_agent_defs` / `reflect_get_agent_def` / `reflect_save_agent_def` / `reflect_delete_agent_def` / `reflect_parse_agent_md` | `null` / `{ name }` / `{ def }` / `{ name }` / `{ text }` | `AgentDefinition[]` / `AgentDefinition` / `AgentDefinition` / `bool` / `AgentDefinition` | `commands/agents.rs` (Phase 1 item 3) / `commands/agents.ts`。v1.6:`AgentDefinition` 新增 `source: SystemPromptSource`(`custom` / `builtin_default`)—— 决定 system prompt 是用用户 md 原文(`custom`)还是按当前模型 spec 从提示词库解析 `system.main`(`builtin_default`)。**桌面端读写的 agent 文件恒为 `custom`**(上游 parser 对文件来源强制 Custom,frontmatter 不写该字段);`builtin_default` 只属引擎自带的默认 agent |
| `reflect_get_active_agent` / `reflect_set_active_agent` | `null` / `{ name }` | `ActiveAgentInfo`（camelCase） | `commands/agents.rs` / `commands/agents.ts`。**活跃 agent** —— 决定运行时加载哪条 agent 定义、以及记忆目录(`.reflect/agent-memory/<agent>/`)。桌面端此前硬编码 `"desktop"`,导致 GUI 的 Agents 视图是死胡同(能编辑定义,运行时永不加载)、且 GUI 写的记忆 agent 读不到。现由桌面端偏好(`~/.reflect/desktop.json`,缺省 `"default"` 与 CLI 一致)决定;`set` 会 replay 当前会话历史并强制重绑(新定义立即生效,与 provider 热重载同款语义)。`ActiveAgentInfo` 含 `defFound` / `memoryScopes`(空 = 不加载记忆,GUI 写入不会被注入)/ `injectBudgetChars`(核心 `MAX_MEMORY_INJECT_CHARS`)/ `memoryPaths` |
| `reflect_start_side_channel` / `reflect_cancel_side_channel` / `reflect_list_side_channels` / `reflect_get_side_channel` | `{ agent_name, prompt }` / `{ id }` / `null` / `{ id }` | `StartSideChannelResult` / `bool` / `SideChannelInfo[]` / `SideChannelInfo` | `commands/side_channel.rs` (Phase 2 item 1) / `commands/side_channel.ts` |
| `reflect_get_remote_config` / `reflect_update_remote_config` / `reflect_get_remote_status` | `null` / `{ host, port?, authToken?, autoConnect? }`(Tauri 按 camelCase 取 Rust 参数 `auth_token` / `auto_connect`) / `null` | `RemoteConfigSnapshot { host, port, authToken, autoConnect, endpoint, isReady }`(`#[serde(rename_all = "camelCase")]`) / 同上快照 / `RemoteStatus { state, message, endpoint, sinceMs }` | `commands/remote.rs` (Phase 2 item 2) / `commands/remote.ts` |
| `reflect_tailscale_status` / `reflect_tailscale_daemon_command_preview` / `reflect_tailscale_daemon_start` / `reflect_tailscale_daemon_stop` / `reflect_tailscale_daemon_status` | `null` (all) | `TailscaleStatus { installed, running, version, dnsName, hostName, tailnetName, ipv4, ipv6, suggestedRemoteHost, message }`(camelCase) / `string` / `string` / `string` / `{ running, pid }` | `commands/remote.rs` (Phase 2 item 2) / `commands/remote.ts` |
| `reflect_kms_list` / `reflect_kms_create` / `reflect_kms_delete` / `reflect_kms_list_pages` / `reflect_kms_get_page` / `reflect_kms_save_page` / `reflect_kms_search` / `reflect_dream` | `null` / `{ name, description? }` / `{ name }` / `{ wiki }` / `{ wiki, page }` / `{ wiki, page, content, title?, tags? }` / `{ query }` / `{ insights, sessionsAnalyzed }` | `WikiInfo[]` / `WikiInfo` / `null` / `Page[]` / `Page` / `Page` / `SearchResult[]` / `DreamResult` | `commands/kms.rs` (Phase 3 item 12) / `commands/kms.ts` |
| `reflect_get_autopilot_config` / `reflect_update_autopilot_config` / `reflect_autopilot_history` | `null` / `{ config }` / `null` | `AutopilotConfig` / `null` / `AutopilotRun[]` | `commands/autopilot.rs` (Phase 3 item 10) / `commands/autopilot.ts` |
| `reflect_list_activity` / `reflect_search_activity` / `reflect_clear_activity` / `reflect_activity_count` | `{ filter? }` / `{ query }` / `null` / `null` | `ActivityEvent[]` (camelCase; `id`, `tsMs`, `kind`, `actor`, `summary`, `taskId?`, `teamName?`, `level`) / `ActivityEvent[]` / `null` / `number` | `commands/activity.rs` (Phase 3 item 9) / `commands/activity.ts` |
| `reflect_list_squads` / `reflect_create_squad` / `reflect_get_squad` / `reflect_delete_squad` / `reflect_delegate_next` / `reflect_assign_squad_task` | `null` / `{ spec }` / `{ name }` / `{ name }` / `{ name, leaderActorId }` / `{ name, taskId, assignee? }` | `SquadSpec[]` / `null` / `SquadSpec` / `null` / `Task?` / `Task` | `commands/squad.rs` (Phase 3 item 11) / `commands/squad.ts` |
| `reflect_list_media` / `reflect_image_process` / `reflect_screenshot` / `reflect_computer_use` / `reflect_media_capabilities` | `{ dir }` / `{ spec }` / `null` / `{ action }` / `null` | `MediaAsset[]` / `ImageProcessResult` / `string` (base64 PNG) / `null` / `MediaCapabilities` | `commands/media.rs` (Phase 3 item 13) / `commands/media.ts` |
| `reflect_list_traces` / `reflect_get_trace` | `{ limit? }` / `{ id }` | `TraceSessionSummary[]`（camelCase） / `TraceCall[]`（camelCase） | `commands/traces.rs` / `commands/traces.ts`。CLI `reflect traces ls / show` 的 GUI 对应：只读查询 `~/.reflect/traces/model-io/` 的脱敏 JSONL（`reflect-telemetry`）。列表按最近降序带 rollout 标题 fallback；`id` 支持完整 UUID 或唯一前 8 字符前缀。Traces 视图（`/traces`）消费 |
| `reflect_list_discussions` / `reflect_run_discussion` | `{ discussionId? }` / `{ configPath }` | `DiscussionSessionInfo[]`（camelCase） / `DiscussionRunOutcome`（camelCase） | `commands/discussion.rs` / `commands/discussion.ts`。CLI `reflect discussion ls / run` 的 GUI 对应：逻辑在 `app-core/src/discussion.rs`（重组 `reflect-discussion` 的 LLM 组装，provider 不可用降级 `run_noop`）。运行期间 Collab* 事件经 `event_sink` 桥进 MinimalAgent session broadcast（信封 `id = EVENT_ID_NONE`），前端 collab_* reducer 实时渲染；`ls` 扫 rollout JSONL 的 `DiscussionTranscript` 记录。Collaboration 视图消费 |
| `reflect_run_team_pipeline` / `reflect_run_pipeline` | `{ teamName, topic }` / `{ configPath, topic, failurePolicy?, inputs? }` | `PipelineReport`（snake_case 直传 submodule 类型） | `commands/pipeline.rs` / `commands/pipeline.ts`。CLI `reflect pipeline team / run -c` 的 GUI 对应：逻辑在 `app-core/src/pipeline.rs`（registry 从配置引导、`REFLECT_MODEL=mock` 可离线跑通）。team 预设 = plan → prd → exec → verify 四阶段；TOML 路径跑任意 DAG。共享 `~/.reflect/tasks\|teams/` 存储（与 Squad 视图同源）。Collaboration 视图消费 |
| `reflect_validate_pipeline` / `reflect_list_pipeline_configs` / `reflect_save_pipeline_config` | `{ tomlSrc }` / `null` / `{ name, tomlSrc }` | `PipelineConfigSummary`（camelCase：`name` / `failurePolicy` / `nodes` / `nodeCount` / `missingTeams` / `valid` / `error?`）/ `PipelineConfigFile[]` / `PipelineConfigFile` | `commands/pipeline.rs` / `commands/pipeline.ts`。**Pipeline 配置编辑** —— 此前 GUI 只能跑一个已有的 TOML 文件（还得手写）。`validate` 走核心的 `Pipeline::from_toml`（与**实际运行同一条校验路径**，配置级 + wiring 级错误都如实返回），结构摘要只读顶层 `nodes` 表（不复刻核心 schema）；`save` 落盘 `~/.reflect/pipelines/<name>.toml`，**写前先校验，非法不落盘**。Collaboration 视图 Pipeline 编辑器消费 |
| `reflect_run_security_scan` | `null` | `SecurityScanResult`（camelCase：`ran` / `exitCode?` / `output` / `summary`） | `commands/security.rs` / `commands/security.ts`。在当前工作区跑一次 `cargo audit` —— 核心 `reflect_integration::security_scan::run_cargo_audit` 的**真实实现**（30s 超时、管道排空、IO 错误落结构化报告而非 panic）。阻塞调用放 `spawn_blocking`（可能跑 30s，不占住 async worker）。Settings → Advanced「安全扫描」卡片消费 |
| `reflect_pick_file` | `{ extensions? }` | `string?`（原生文件选择框，取消 → `null`；`tauri-plugin-dialog` Rust API，可选扩展名白名单过滤） | `commands/workspaces.rs` / `commands/workspaces.ts`。discussion / pipeline 的 TOML 配置入口 |
| `reflect_prompt_command` | `{ action }` | `string`（submission id） | `commands/prompts.rs` / `commands/prompts.ts`。`Op::PromptCommand` 派生命令（v1.6.1 提示词层管理）：`action` 是协议内联判别联合 —— `{ type: "list" }` 查询可用层 + 生效层（应答 `prompt_list` 事件），`{ type: "switch", layer: null }` 重扫提示词库（应答 `prompt_switched` 事件，`layer` 槽位预留，当前固定走全量重扫）。两个动作都不开 turn；前端 `/prompt` slash 展开 `PromptLayersModal` |
| `reflect_get_effective_prompt` | `null` | `EffectivePrompt`（camelCase：`model` / `layers` / `sections[{key, content}]`） | `commands/prompts.rs` / `commands/prompts.ts`。当前模型**实际生效**的提示词正文 —— 用核心的 `reflect_prompt::library().resolve(spec)` 解析（`PromptSet` 只公开 `get(key)`，故按核心 builder 引用的 key 列表取 `system.main` / `system.facade-main` / `system.plan-mode`）。与 `reflect_prompt_command` 的 `list` 互补：后者报**层文件名**,本命令报**层解析后的正文**。PromptLayersModal 按需展开 |
| `reflect_session_stats` / `reflect_all_model_usage` | `{ id }` / `null` | `SessionStats?` / `ModelUsage[]`（均 camelCase） | `commands/stats.rs` / `commands/stats.ts`。只读扫描 rollout JSONL（`~/.reflect/sessions/`）的**模型级 token 统计**：复用 `reflect-rollout::index::session_stats` / `all_model_usage`（与 CLI `reflect session stats` 同源，桌面端不复刻聚合）。`SessionStats` 含总量 + `perModel` 按模型拆分 + 压缩前后 token（`compactionTokensSaved`）+ 记忆读写次数 + 缓存命中率；会话尚无落盘记录 → `null`。`/usage` 视图消费 |
| `reflect_model_rate_cards` | `{ models }` | `RateCard[]`（camelCase） | `commands/stats.rs` / `commands/stats.ts`。模型**费率卡** —— 让费用在 GUI 里可解释。用 4 次合成用量反解核心静态费率表（`app_core::pricing`：`price()` 对 usage 线性），得每 1M token 的输入/输出/缓存读/缓存写单价。唯一事实源仍是核心的表（桌面端不持第二份），表更新后 GUI 自动跟随。模型不在表内 → `priced: false`，不给编造的数字 |
| `reflect_list_worktrees` | `null` | `WorktreeInfo[]`（camelCase） | `commands/git.rs` / `commands/git.ts`。列出仓库的 worktree，标出**改动被困在隔离 worktree**的风险。核心的 worktree 状态存在 `ToolContext` 里（进程内）读不到，但 worktree 文件系统可见 —— `git worktree list --porcelain` + 核心 `reflect_tools::worktree::worktree_dirty` 判脏。`isolated` = 非主工作树；`stranded` = 隔离 + 有未提交改动（**改动还没落回主分支**，丢工风险）。Git 视图「Worktrees」面板消费 |
| `reflect_list_mcp_resources` / `reflect_list_mcp_prompts` | `null` | `McpResourceInfo[]` / `McpPromptInfo[]`（camelCase） | `commands/mcp.rs` / `commands/mcp.ts`。MCP 三大原语里此前只有 tools 对用户可达 —— resources / prompts 只能被 LLM 调用，用户想复用某个 server 的资源或 prompt 模板时没有路径。直接问 rmcp peer（`list_all_resources()` / `list_all_prompts()`），与核心 `ListMcp*Tool` 同源 |
| `reflect_list_subagent_specs` / `reflect_get_subagent_spec` / `reflect_save_subagent_spec` / `reflect_delete_subagent_spec` | `null` / `{ role }` / `{ role, markdown }` / `{ role }` | `SubagentSpecInfo[]` / `string?` / `null` / `null`（均 camelCase） | `commands/subagents.rs` / `commands/subagents.ts`。**子代理 spec**（`call_<role>` 工具的来源，`~/.reflect/subagents/*.md` 或工作区同名目录）—— 与 agent 定义（`~/.reflect/agents/*.md`）是两套东西，此前**无任何编辑面**。合并口径与运行时同款（TOML `[[subagents]]` > workspace md > home md > 硬编码 explorer）。`markdown` 是完整文件内容（frontmatter + body），写前由后端 `parse_subagent_str` 校验，非法不落盘 |
| `reflect_list_hook_events` | `null` | `HookEventInfo[]`（camelCase：`kind` / `description` / `decisions`） | `commands/hooks.rs` / `commands/hooks.ts`。核心支持的 hook 事件类型（12 个 `HookEventKind`）与每个事件可用的 `HookDecision` —— 此前 GUI 只列 hook 的 name / kind / enabled，用户不知道能在哪些时机挂 hook、能做什么决策 |
| `reflect_list_permission_rules` | `null` | `PermissionRuleInfo[]`（camelCase） | `commands/permissions.rs` / `commands/permissions.ts`。**核心三层权限 store 的生效规则**（只读）：`config`（`config.toml` 的 `[permissions]`）> `project`（`<workspace>/.reflect/permissions.toml`）> `user`（`~/.reflect/permissions.toml`）。数组顺序即匹配顺序（first-match-wins，deny 优先）。Settings → Permissions 分节消费。**运行时同构**：桌面端线程构造按 CLI（`reflect-exec` 的 `apply_permission_layers`）同款方式挂载解析器 —— 此前桌面端未挂，CLI 生效的 deny 规则被静默忽略 |
| `reflect_lsp_diagnostics` | `{ path }` | `LspDiagnostic[]`（camelCase；行/列 1-based） | `commands/lsp.rs` / `commands/lsp.ts`。某文件的 **LSP 诊断**（编译器 / 检查器反馈）—— 读 core 的 `LspConnectionManager::diagnostics()` → `DiagnosticRegistry::get(uri)`。语义与核心 `LspTool` 同款：**只读被动缓存**（server 推 `textDocument/publishDiagnostics`，客户端不主动 pull）；文件未预热或 LSP 未开启 → 空列表。`LspStatus` 增 `diagnostics` 聚合（文档数 / 条数 / 状态描述）。Files 视图 Problems 面板消费 |
| `reflect_list_mcp_servers` / `reflect_mcp_catalog` / `reflect_upsert_mcp_server` / `reflect_delete_mcp_server` | `null` / `null` / `{ name, entry }` / `{ name }` | `McpServerInfo[]` / `McpCatalogEntry[]` / `null` / `null`（均 camelCase） | `commands/mcp.rs` / `commands/mcp.ts`。**MCP 服务管理** —— 此前 GUI 只能观测,加服务得手改 `config.toml` 的 `[mcp_servers.<name>]`。`list` 给出配置里的 server + transport + 启动命令 + **运行状态**；`catalog` 给出核心内置的精选清单（离线）+ 安装提示（`reflect_mcp::registry`）；`upsert` / `delete` 改内存 `ReflectConfig.mcp_servers` → 经**核心 `mcp_server_configs()` 编译校验**（非法配置不落盘）→ 落盘 → 运行时起/停（注册/反注册其工具，路径与启动时的 `bootstrap_mcp` 同款）。`entry` 的 transport 线上字段名是 **`type`**（配置里写 `type = "stdio"`）。Collaboration 视图 McpManager 面板消费 |
| `reflect_get_task_output` / `reflect_stop_task` / `reflect_release_task` | `{ list, id }` | `string` / `TaskUpdateResult` / `TaskUpdateResult` | `commands/tasks.rs` / `commands/tasks.ts`。任务**产出 / 停止 / 释放** —— 与核心工具同款语义（守卫在命令层，不在前端重复实现）：`get_task_output` 读任务 `output_path` 指向的文件（**不阻塞**，产出未写好时返回空串）；`stop_task` 守卫 `status == in_progress`，退回 `pending` + 清 `owner`（同 `TaskStopTool`）；`release_task` 守卫存在 `claimed_by`，退回 `pending` + 清 `claimed_by` / `claimed_at`（同 `TaskReleaseTool`）。任务板详情抽屉 + 行内按钮消费 |
| `reflect_list_session_notes` / `reflect_list_note_sessions` | `{ id }` / `null` | `SessionNoteInfo[]` / `NoteSessionInfo[]`（camelCase） | `commands/notes.rs` / `commands/notes.ts`。agent 经 `AddSessionNoteTool` 写入的持久会话笔记（`<notes_home>/session-notes/<thread_id>.jsonl`，`notes_home` = `$REFLECT_HOME` > `$HOME/.reflect`）的**只读**面 —— 此前后端只有写、没有读。Memory 视图「会话笔记」面板消费 |
| `reflect_list_span_logs` / `reflect_read_span_log` | `{ days? }` / `{ day, sessionId? }` | `SpanLogFile[]` / `TraceSpan[]`（camelCase） | `commands/traces.rs` / `commands/traces.ts`。**span 日志**（`~/.reflect/traces/log/reflect-YYYY-MM-DD.jsonl`）—— turn → model → tool 的父子 span 链（含耗时、状态、`reflect_goal` 事件）。model-io 的姊妹产物：model-io 给「每次调用的请求/响应全文」，span 给「turn 的结构与耗时归因」。`TraceSpan.depth` 由 `parentSpanId` 链推导（父缺失/成环均有防护）。Traces 视图「Span 树」页消费 |
| `reflect_sandbox_status` | `null` | `SandboxStatus`（camelCase） | `commands/sandbox.rs` / `commands/sandbox.ts`。**OS 沙箱有效状态**：`status`（disabled / seatbelt / landlock / no_backend）、`active`、`backend`、核心的 `statusLine`。用 `OsSandbox::from_env()` —— 与 `BashTool::execute` 读 env 的路径同一逻辑，故状态栏显示的与 bash 实际跑在哪个沙箱里一致 |
| `reflect_set_dock_badge` | `{ count? }` | `null` | `src-tauri/src/dock.rs` (macOS) / `src/utils/tauri.ts` (compat) |

**`reflect_terminal_output` event** (B8-01):

```ts
interface ReflectShellOutputChunk {
  session_id: string;
  stream: 'stdout' | 'stderr' | 'exit' | 'error';
  data: string;     // 文本行(exit 时为退出码字符串)
  seq: number;      // 同一 session 内的单调递增序号
}
```

`Submission` wraps the op:

```rust
pub struct Submission {
    pub id: String,
    pub op: Op,
    pub client_user_message_id: Option<String>,
    pub trace: Option<TraceContext>,
    pub workspace: Option<String>,   // v1.x：会话归属（首条 UserInput 时写入 SessionMeta.workspace）
    pub source_command: Option<String>, // v1.x：插件 slash 命令来源标注（后端展开时写入，前端不构造）
}
```

`workspace` 带 `#[serde(default, skip_serializing_if = "Option::is_none")]` —— 旧线格式不写该键，
后端回退 `cfg.current_workspace()`；GUI 端由 `useCurrentWorkspace` 注入当前激活工作区。
`source_command` 同为可选字段，由后端在插件命令展开（`/plugin:ns:name args` → 命令正文，
`state/plugins.rs::expand_submission`）时标注，仅作 rollout / 遥测来源，前端不读写。

### 2.1 `UserInputItem`（`reflect-agent/crates/protocol/reflect-protocol/src/item.rs`）

| 变体 | 字段 | 前端来源 |
|---|---|---|
| `Text` | `text: String` | 输入框文本 |
| `Image` | `data: Vec<u8>, mime_type: String` | 拖拽或粘贴（前端 base64 解码） |
| `LocalImage` | `path: PathBuf` | 文件选择器（后端从磁盘读取） |
| `Skill` | `name: String, args: Option<JSON>` | `/skill name` 或技能选择器 |
| `QuestionAnswer` | `request_id, answers` | LLM 提问的回复（`AskUserQuestionResponse` 的替代路径） |
| `File` | `path: String, range?: FileRange` | Composer `@` 文件弹层（`MentionPicker`）。`path` 为相对工作区 POSIX 路径；`FileRange { start_line, end_line }` 可选。core 侧 `user_input_items_to_messages` 展开为 `@<path>` / `@<path>:L<n>-L<m>` 文本块，真实读取由 LLM `/read` 工具按需触发 |

`File` 为纯新增 variant（旧 reader 不受影响）；`SessionInfo.workspace` / `RolloutRecord::SessionMeta.workspace`
同样带 serde 兼容注解 —— 旧 JSONL 反序列化为 `None`，前端按"未归属"展示。

### 2.2 提交 ID 生命周期

- 前端生成 UUID v4 → `Submission.id`。
- 后端从 `reflect_submit` 返回相同 id（回显）。
- 前端将入站 `Event.id` 与原始 `Submission.id` 关联以解锁输入器 / 标记 turn 完成。
- `EVENT_ID_NONE = ""` 事件（生命周期：`SessionConfigured`、`ShutdownComplete`、`PermissionModeChanged` …）没有对应的提交。
- `SessionConfigured.session_id`（v1.x 起）等于线程预分配 id：与 rollout 文件名
  （`~/.reflect/sessions/YYYY/MM/DD/<id>.jsonl`）、`SessionMeta.session_id` 及
  前端路由 id 一致（`reflect_bind_session` 经 `with_session_id` 注入，`submission_loop`
  在 `SessionConfiguredEvent::new` 后覆盖 `sc.session_id = session_id`）。旧版本曾发出
  随机 UUID，仅作 turn 事件标识。

### 2.3 `ThreadSettingsOverrides` —— 后端盖章的字段

`Op::UserInput.thread_settings`（`ThreadSettingsOverrides`）里有两个字段是
**后端说了算**，前端传什么都不算数：

| 字段 | 桌面端行为 |
|---|---|
| `sandbox_policy` | **无条件覆盖**为后端配置推导出的值（`OsSandbox` = 开 OS 沙箱，`WorkspaceOnly` = 关）。沙箱是安全设置，事实源只能是后端的配置快照。见 `docs/CAPABILITIES.md` §3.19。 |
| `model` / `approval_policy` / `max_tool_concurrency` | 原样透传（前端目前不设；`max_tool_concurrency` 可用于每轮调工具并发上限） |

核心把这三个字段映射成每轮的真实行为（`reflect-core/src/submission_loop.rs`）：
`sandbox_policy` → `ToolContext.os_sandbox`（`OsSandbox` → `Some(true)`，
其余 → `Some(false)`）→ 前台 `BashTool` 与后台 bash 两条路径都读它。

---

## 3. 事件（后端 → UI）

`EventMsg` 使用 `#[serde(tag = "type", rename_all = "snake_case")]`（变体列表位于 `reflect-agent/crates/protocol/reflect-protocol/src/event_msg.rs`）。

> **命名**：Rust `enum` 使用 **PascalCase 结构变体**（如 `TurnStarted(TurnStartedEvent)`），但 serde 发出 **snake_case** 鉴别器（`turn_started`）供前端使用。前端 TypeScript 使用 snake_case 形式。

### 3.1 Lifecycle (7)

| 变体 | 触发方 | UI 影响 |
|---|---|---|
| `session_configured` | First turn of a thread | Show banner; persist `session_id` |
| `turn_started` | `Op::UserInput` accepted | Spinner on; clear composer draft |
| `turn_complete` | LLM turn finished | Spinner off; unlock composer; accumulate cost |
| `turn_aborted` | `Op::Interrupt` / error | Red toast |
| `turn_rewound` | `Op::Rewind` success | Truncate local scrollback; redraw |
| `submission_closed` | v1.3 SDK serve 模式的 per-submission 通道排空标记 | none —— Desktop 内嵌 AgentThread 不发本事件；TS 类型联合已补齐，reducer no-op 保穷尽 |
| `shutdown_complete` | `Op::Shutdown` | Quit / hide |

### 3.2 LLM output (4)

| 变体 | 字段 | UI |
|---|---|---|
| `agent_message` | `text: String` | Non-streaming final bubble |
| `agent_message_delta` | `delta: String` | Stream chunk → append to last assistant bubble |
| `thinking_delta` | `delta: String` | Reasoning block (collapsible) |
| `token_count` | `TokenCountEvent` (info) | StatusBar token/cost indicator + Inspector "Token Usage" section (input/output/cached/cache_write/total/cost/provider/credential/model). `TokenCountEvent` 字段：`input_tokens`、`output_tokens`、`cached_tokens`、`cache_write_tokens`（M8，input 子集，不计入 total）、`total_tokens`、`cost_usd?`、`provider?`、`credential_label?`、`model?`（v1.x 模型级统计:本轮实际命中的模型 spec 如 `"openai/gpt-4o"`；旧引擎不上报 → 缺省） |

### 3.3 Tools (4)

| 变体 | 字段 | UI |
|---|---|---|
| `tool_call_begin` | `ToolCallBeginEvent` | Tool row running indicator |
| `tool_call_end` | `ToolCallEndEvent` | Tool row done / failed / cancelled；`tool_name == "TodoWrite"` 时另取 `output.metadata.todos` → Inspector「Todo 清单」面板（`{ content, status, activeForm }`，`activeForm` 为 camelCase） |
| `tool_call_output_delta` | `ToolCallOutputDeltaEvent` (v1.4 A3) | none —— 长工具执行期间逐段 stdout/stderr 增量预览（完整输出仍以 `tool_call_end` 为准）；reducer no-op 保穷尽，避免高频重渲染 |
| `tool_execution_request` | `ToolExecutionRequestEvent` (v1.3 SDK) | none —— serve 模式下 core 请求客户端本地执行其经 `Op::RegisterTools` 注册的远程工具（回执 `Op::ToolExecutionResponse`，`call_id` 配对）。Desktop 内嵌 AgentThread 不注册远程工具，reducer no-op 保穷尽 |

### 3.4 Approvals / AskUser (4)

| 变体 | 前端响应 | 配对 Op |
|---|---|---|
| `approval_request` (Tool/Hook/Plan) | Open `ApprovalModal` | `tool_approval` / `hook_approval` |
| `ask_user_question` | Open `QuestionModal` (multi-Q) | `ask_user_question_response` (id = sub_id) |
| `ask_user_input` | Open `AskUserModal` (free text) | `ask_user_input_response` |
| `permission_bubble` | Non-blocking toast (Bubble mode) | none |

### 3.5 Compaction / Errors (3)

| Variant | UI |
|---|---|
| `context_compacted` | "Compacting..." badge → fade |
| `error` | Red error bubble (recoverable) |
| `stream_error` | Retry countdown |

### 3.6 Config / Routing / Collab (5)

| Variant | UI |
|---|---|
| `config_reloaded` | Toast "Config reloaded" |
| `routing` | Status bar provider switch indicator |
| `collab_started` / `collab_message` / `collab_finished` | Collab sidebar / timeline |

> **Coding plan 自动切换**：前端 `stores/agent/planFailover.ts` 消费
> `quota_exhausted`（见 §3.12 插件/配额组）与耗尽特征的 `error` 事件，
> 自动改写 `[active].provider` 并 `reflect_save_config`（触发 §2.0 的热
> 重载链路），toast 告知切换结果。

### 3.7 MCP (3)

| Variant | UI |
|---|---|
| `mcp_server_started` | Status bar MCP segment |
| `mcp_server_failed` | Error toast |
| `mcp_tool_invoked` | Tool row "(via mcp:server)" badge |

### 3.8 LSP (2) — v0.5+

| Variant | UI |
|---|---|
| `lsp_server_started` | Status bar LSP segment |
| `lsp_server_failed` | Error toast |

### 3.9 Plan (7)

| Variant | UI |
|---|---|
| `plan_request` | "Enter plan mode?" confirm modal |
| `plan_ready` | Plan markdown modal (Accept / Submit Changes) |
| `plan_approved` | Status bar plan badge |
| `plan_rejected` | Status hint |
| `plan_draft_updated` | none —— 草稿正文覆盖式刷新(TUI 用于预览);GUI 决策路径走 `plan_ready` → PlanReadyModal,reducer no-op 保穷尽 |
| `plan_step` | Plan 视图「执行进度」清单 —— 核心在 agent 执行已批准 plan 时逐 step 上报;reducer 按 `index` 就地更新或追加(与核心 TUI 语义同构),`plan_ready` 到达时清空上一份 |
| `permission_mode_changed` | Status bar mode badge updates |

### 3.10 Subagent observability (2) — v1.4+

| 变体 | 字段 | UI |
|---|---|---|
| `subagent_progress` | `SubagentProgressEvent`（通道一:推送） | Inspector 子代理区块滚动 feed（封顶 200 条）—— 父级 `CallSubAgentTool` 转发的子代理中间进度（message / tool_begin / tool_end） |
| `subagent_status` | `SubagentStatusEvent`（通道二:查询应答） | Inspector 子代理区块状态快照（`reflect_query_subagents` 发起;turn 收尾且 feed 非空时自动刷新,亦可手动） |

### 3.11 Prompt layers (2) — v1.6.1
提示词按模型自动匹配外置到 `.reflect/prompts/*.md`（`.reflect/prompts/` 用户目录层 + 内置厂商层，三级回退 default → 厂商 → 精确模型名）。引擎侧经 `Op::PromptCommand` 暴露查询与重扫，两个动作都**不开 turn** —— 应答事件经 per-submission 通道 + 会话扇出双路送达。

| 变体 | 字段 | UI |
|---|---|---|
| `prompt_list` | `PromptListEvent`：`available: Vec<String>`（可绑定的层文件名，不含 `.md`）、`current_spec: String`（当前 model spec）、`active_layers: Vec<String>`（当前 spec 实际命中的用户层，内嵌厂商层不记录） | `PromptLayersModal` 展示「当前模型 / 生效层 / 可用层」；`/prompt` slash 展开（经 `reflect_prompt_command` 的 `list` 动作发起）。reducer 写 `store.prompt`（**进程级** —— 提示词库不随会话切换重置） |
| `prompt_switched` | `PromptSwitchedEvent`：`action: String`（`"reload"`；预留未来聚焦切换的层名）、`active_layers: Vec<String>`（重扫后当前 spec 的生效用户层） | toast 提示「提示词已刷新」并展示新命中层；reducer 更新 `store.prompt.activeLayers` + 记 `switchedAt`。「重新扫描」按钮发起 `switch` 动作（用户改了 `.reflect/prompts/*.md` 后让改动即时生效） |

### 3.12 Plugin / Quota (2)

| 变体 | 字段 | UI |
|---|---|---|
| `plugin_loaded` | `PluginLoadedEvent`：`plugin: String`、`scope: String`、`version: String`、`skill_count: usize`、`command_count: usize` | Collaboration → Plugins 面板「运行时已挂载」列表 —— 与「配置里启用了哪些」是**两件事**，这里记的是运行时真正挂载成功的（挂载失败 / 被 scope 过滤时不会到这）。reducer 写 `store.loadedPlugins`（**进程级** —— 插件在 AgentThread 装配 / 配置重载时挂载，与会话无关），同 id 再来一条则覆盖 |
| `quota_exhausted` | `QuotaExhaustedEvent`：`provider: String`、`label: String`、`used_tokens: u64`、`max_tokens: u64`、`window_ends_secs: u64` | toast warn「配额耗尽」+ coding plan 自动 failover（`stores/agent/planFailover.ts` 消费） |

---

## 4. ID 配对规则

| 事件 | 触发 Op | 字段 | 备注 |
|---|---|---|---|
| `approval_request` (工具) | `tool_approval` | `id = request_id` | |
| `approval_request` (钩子) | `hook_approval` | `id = request_id` | |
| `approval_request` (计划) | `plan_approval` | `id = request_id` | |
| `ask_user_question` | `ask_user_question_response` | `id = sub_id` | 每个问题有独立的 sub_id（每问题等待器） |
| `ask_user_input` | `ask_user_input_response` | `id = sub_id` | |
| `plan_request` | `enter_plan_mode` | `task` 回显 | 客户端发送前确认 |
| `plan_ready` | `plan_approval` | `id = plan_id` | |
| `*_delta` / `*_complete` | （任何用户操作） | `id = submission.id` | 流式块共享提交 id |

---

## 5. 版本兼容性

- **仅追加式演化**：新变体不会破坏现有代码（反序列化器忽略未知字段）。
- **Snake_case 标签**防止 Rust 重命名重构泄漏到线格式。
- 可选字段上的 **`#[serde(default)]`**在发布期间保护前端免受缺失键的影响。
- **前端类型重新生成**：当 `reflect-protocol` 变更时，运行：

  ```bash
  # 在 Reflect-Agent 仓库中：
  cargo run -p reflect-protocol --example dump_schema > /tmp/reflect-schema.json
  # 在 ReflectDesktop 中：
  npx json2ts /tmp/reflect-schema.json -o src/types/protocol.ts
  ```

- **子模块升级**：`git submodule update --remote reflect-agent` 拉取最新核心 crate（见 `SUBMODULE.md`）。升级后，重新运行 dump → json2ts 流水线。

---

## 6. 前端 TypeScript 接口

`src/types/protocol.ts` 是规范的镜像。分为两部分：

```ts
// Submission side (UI → backend)
export type ReflectSubmission = {
  id: string;
  op: ReflectOp;
  client_user_message_id?: string;
  trace?: TraceContext;
};

export type ReflectOp =
  | { type: 'user_input'; items: ReflectItem[]; thread_settings?: ThreadSettingsOverrides }
  | { type: 'compact' }
  | { type: 'interrupt' }
  | { type: 'shutdown' }
  | { type: 'rewind'; to_turn_id?: string }
  | { type: 'steer'; priority?: 'attachment' | 'now'; items: ReflectItem[] }   // v1.4 A2 → reflect_steer
  | { type: 'query_subagents'; child_id?: string }                              // v1.4 C1 → reflect_query_subagents
  | { type: 'tool_approval'; id: string; decision: ReviewDecision }
  | { type: 'hook_approval'; id: string; decision: ReviewDecision }
  | { type: 'enter_plan_mode'; task: string }
  | { type: 'exit_plan_mode' }
  | { type: 'enter_goal_mode'; goal: string; verify_command?: string; token_budget?: number }
  | { type: 'exit_goal_mode' }
  | { type: 'plan_approval'; id: string; decision: ReviewDecision }
  | { type: 'set_effort'; effort: ReasoningEffort }
  | { type: 'ask_user_question_response'; id: string; answers: AskUserAnswer }
  | { type: 'ask_user_input_response'; id: string; text: string }
  | { type: 'set_permission_mode'; mode: PermissionMode }
  | { type: 'cycle_permission_mode' };

// Event side (backend → UI)
export type ReflectEvent = { id: string; msg: ReflectEventMsg };

export type ReflectEventMsg =
  | { type: 'session_configured'; /* ... */ }
  | { type: 'turn_started'; /* ... */ }
  | { type: 'turn_complete'; /* ... */ }
  // ... variant union, snake_case discriminators
  | { type: 'permission_mode_changed'; from: PermissionMode; to: PermissionMode };
```

### 6.1 桥接模式

前端 IPC 层分为三个角色：

1. **底层桥接** — `src/utils/bridge.ts` 导出 `invoke` / `listen`，带 Tauri 上下文回退和 `isMissingTauriInvokeError` 防护。
2. **域包装器** — `src/utils/commands/{health,agent,approvals,plan,permissions,questions,config,sessions,events,workspaces,skills,memory,hooks,git,terminal,files,allowlist,updates,search}.ts` re-export 类型化包装器。`src/utils/commands/index.ts` 桶文件聚合它们。
3. **兼容桶文件** — `src/utils/tauri.ts` 和 `src/utils/commands.ts` 从 `./bridge`、`./commands`、`./types` re-export，使现有的 `@/utils/tauri` 和 `@/utils/commands` 导入继续工作。**新代码应直接从 `@/utils/commands/{domain}` 或 `@/utils/bridge` 导入。**

```ts
// src/utils/bridge.ts (low-level)
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';

function isMissingTauriInvokeError(e: unknown): boolean { /* ... */ }

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> { /* ... */ }
export async function listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<UnlistenFn> { /* ... */ }
```

```ts
// src/utils/commands/agent.ts (per-domain wrapper)
import { invoke } from '../bridge';

export async function reflect_submit(s: ReflectSubmission): Promise<string> {
  return await invoke<string>('reflect_submit', { submission: s });
}

export async function onReflectEvent(handler: (e: ReflectEvent) => void) {
  return await listen<ReflectEvent>('reflect_event', (ev) => handler(ev.payload));
}
```

### 6.2 Reducer 模式

`src/services/agentEventBus.ts`（引用计数总线）转发至 `src/stores/agent/reducer.ts` —— `ReflectEventMsg` 的规范 reducer。`src/services/agent.ts` 保留为兼容性 re-export，将 `useAgent` / `handle_event` 转发到 store。`src/stores/agentStore.ts` 是用户可见的兼容门面，从 `./agent` re-export `useAgentStore` / `reduceEvent` / 类型。新增变体：

1. 在 `src/types/protocol.ts` 添加 `ReflectEventMsg` 分支。
2. 在 `src/stores/agent/reducer.ts` 添加 `case 'new_variant':`。
3. 在 `src/stores/agentStore.test.ts` 和/或总线测试中覆盖单元测试。

---

## 7. 故障模式

| 症状 | 原因 | 修复 |
|---|---|---|
| 前端收到 `unknown variant` | 协议已添加但 TS 未重新生成 | 重新运行 `dump_schema` + `json2ts` |
| 提交被静默丢弃 | 后端反序列化错误 | 检查 `src-tauri/src/commands/<domain>.rs` 中的 `tracing` 日志 |
| 事件携带过时 id | 提交 id 被覆盖 | 仅使用 `crypto.randomUUID()` |
| 审批模态框不关闭 | 前端忘记派发 `*_approval` Op | 检查 `src/features/modals/ModalShell.tsx` `onSubmit` |
| `EVENT_ID_NONE` 配对为提交 | 生命周期事件按 id 匹配 | 在 `src/stores/agent/reducer.ts` 过滤 `e.id === ''` |

---

## 8. 参考

- Rust 真相源：`reflect-agent/crates/protocol/reflect-protocol/src/{event,event_msg,op,item,submission}.rs`
- TS 镜像：`src/types/protocol.ts`
- Tauri 命令注册表：`src-tauri/src/lib.rs`（处理程序列表）+ `src-tauri/src/commands/mod.rs`（桶文件）+ `src-tauri/src/commands/<domain>.rs` 中各域主体
- 事件转发器：`src-tauri/src/events.rs::forward_agent_events`
- 前端事件扇出：`src/services/agentEventBus.ts` → `src/stores/agent/reducer.ts`；`src/services/agent.ts` 中的兼容 re-export
- IPC 底层桥接：`src/utils/bridge.ts`
- IPC 包装器（规范，按域）：`src/utils/commands/<domain>.ts` 由 `src/utils/commands/index.ts` 聚合
- IPC 兼容桶文件：`src/utils/tauri.ts`、`src/utils/commands.ts`
- Agent store：`src/stores/agent/`（规范实现）带兼容门面 `src/stores/agentStore.ts`
