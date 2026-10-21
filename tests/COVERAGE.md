# 能力 → 套件映射（发布审查口径）

> 本文档是 ReflectDesktop **发布阶段**的功能审查口径：每个能力域由哪一层
> 验、验的是**真后端**还是**模拟后端**、哪些能力**显式排除**以及为什么。
>
> 与 submodule 的 `reflect-agent/tests/COVERAGE.md` 同构 —— 覆盖不是
> 「跑过多少测试」，而是「**哪些能力没被验到，���什么**」。

---

## 1. 分层模型

| 层 | 套件 | 测什么 | 后端真伪 | 退出码 |
|---|---|---|---|---|
| L1 | `tests/static/` | 源码与仓库状态：命令面**四方**一致（后端实现 ↔ `lib.rs` 注册表 ↔ 前端包装 ↔ 测试替身 `fakeBackend`）、路由↔视图、版本四处一致、CHANGELOG / 能力矩阵新鲜度、仓库卫生、调试残留、生产文件大小预算棘轮、真后端命令覆盖棘轮 | 静态分析 | 0 = 通过 |
| L2 | `tests/frontend/` | 真实前端的行为：`tsc --noEmit` + vitest 全量（`src/` 99 个文件 + `tests/` 10 个文件） | **模拟**（`fakeBackend`） | 0 = 通过 |
| L3 | `tests/backend/` | **真后端**：`cargo fmt` / `clippy` / `cargo test --workspace --all-targets`（含能力覆盖层 `src-tauri/tests/ipc_*.rs`） | **真** | 0 = 通过 |
| L4 | `tests/artifact/` | 发布产物：`.app` 结构 / Info.plist 键与版本 / 前端资源已嵌入 / 无开发残留 / 签名 | 真产物 | 0 = 通过 |

**为什么 L2 与 L3 都要有**：L2 验前端行为与线格式（后端是模拟的），
L3 验真后端命令体的行为。模拟后端的 bug 会把真后端的 bug 遮住 ——
与 submodule「能力覆盖层不经过任何 SDK」的道理同源。两层合起来才是完整
功能面。

**L3 能力覆盖层怎么做到「真」**：`src-tauri/tests/common/mod.rs` 用
`tauri::test::mock_builder()` 建 app，再挂上**生产同一份**命令注册表
（`reflect_desktop_lib::configure` —— 与 `run()` 共用同一个
`generate_handler!`），然后以 `InvokeRequest` 注入 JSON 负载驱动**真实
命令体**。没有前端 `invoke` 包装，没有 `fakeBackend`，没有 SDK 中间层。

---

## 2. 能力域 → 覆盖层

| 能力域 | 命令 | 真后端覆盖（层 / 文件） | 前端覆盖 |
|---|---|---|---|
| Agent 生命周期 | `submit` `interrupt` `compact` `rewind` `shutdown` | L3 `ipc_agent_ops.rs` | `chat.full-flow` |
| 审批 | `tool_approval` `hook_approval` `plan_approval` | L3 `ipc_agent_ops.rs` | `modals.approvals-questions` |
| Plan / Goal 模式 | `enter/exit_plan_mode` `enter/exit_goal_mode` | L3 `ipc_agent_ops.rs` | `flows.chat-plan-goal-edit` |
| 权限 / 强度 / steer | `set/cycle_permission_mode` `set/get_effort` `steer` | L3 `ipc_agent_ops.rs` | `composer.slash-history-attachments` |
| 追问 | `ask_user_question_response` `ask_user_input_response` | L3 `ipc_agent_ops.rs` | `modals.approvals-questions` |
| 会话生命周期 | `create` `bind` `list` `rename` `fork` `delete` `archive` `unarchive` `list_archived` `replay` `export` `search_sessions` | L3 `ipc_core.rs` | `sessions.lifecycle` |
| 会话统计 | `session_stats` `all_model_usage` `model_rate_cards` | L3 `ipc_core.rs` | `usage` |
| 配置 | `get_config` `save_config` `config_info` `set_model` | L3 `ipc_core.rs` | `settings.config` |
| 运行时状态 | `agent_status` `credential_pool_status` `recovery_state` `memory_sections` `sandbox_status` | L3 `ipc_core.rs` / `ipc_workspace.rs` | `StatusBar` / `AppShell` |
| 工具 / 技能 / hooks | `list_tools` `list_skills` `list_hooks` `toggle_hook` `list_hook_events` | L3 `ipc_core.rs` | — |
| 记忆 | `list/add/remove_memory` | L3 `ipc_core.rs` | `MemoryView` |
| 会话笔记 | `list_session_notes` `list_note_sessions` | L3 `ipc_core.rs` | `MemoryView` |
| 权限规则 / 白名单 | `list/add_permission_rule` `load/save/check_allowlist` | L3 `ipc_core.rs` | `PermissionRulesSection` |
| 活动日志 | `list/search/clear_activity` `activity_count` | L3 `ipc_core.rs` | — |
| Agent 定义 | `list/get/save/delete_agent_def` `parse_agent_md` `get/set_active_agent` | L3 `ipc_core.rs` | `AgentsView` |
| Autopilot | `get/update_autopilot_config` `autopilot_history` | L3 `ipc_core.rs` | — |
| Traces / Span | `list_traces` `get_trace` `list_span_logs` `read_span_log` | L3 `ipc_core.rs` | `TracesView` |
| 工作区 | `list/set/current_workspace` | L3 `ipc_workspace.rs` | `useCurrentWorkspace` |
| 文件 | `list_dir` `read_file` `write_file` `search_files` | L3 `ipc_workspace.rs` | `FilesView` / `FileTree` |
| Git | `git_status` `git_diff` `git_log` `git_stage` `git_unstage` `git_commit` | L3 `ipc_workspace.rs`（临时仓库内） | `GitView` / `DiffViewer` |
| 终端 | `run_shell` `kill_shell` `list_shell_sessions` | L3 `ipc_workspace.rs` | `TerminalView` |
| 媒体 | `list_media` `media_capabilities` `image_process` | L3 `ipc_workspace.rs` | `MediaView` |
| 任务 | `list/create/get/update/claim/stop/release/delete_task` `get_task_output` | L3 `ipc_domains.rs` | `TasksBoardView` |
| 团队 | `list/upsert/get/delete_team` | L3 `ipc_domains.rs` | `TeamEditor` |
| Squad | `list/create/get/delete_squad` `delegate_next` `assign_squad_task` | L3 `ipc_domains.rs` | `SquadView` |
| 定时任务 | `list/add/update/remove_schedule` `get_schedule_status` | L3 `ipc_domains.rs` | `ScheduleView` |
| 插件 | `list_plugins` `list_marketplaces` `toggle_plugin` `list_plugin_commands` | L3 `ipc_domains.rs` | `PluginsPanel` |
| 子代理 spec | `list/save/get/delete_subagent_spec` | L3 `ipc_domains.rs` | `CollaborationView` |
| MCP | `list_mcp_servers` `mcp_catalog` `upsert/delete_mcp_server` `list_mcp_resources` `list_mcp_prompts` | L3 `ipc_domains.rs` | `McpManager` |
| LSP | `lsp_status` `lsp_set_enabled` `lsp_diagnostics` | L3 `ipc_domains.rs` | — |
| 提示词层 | `get_effective_prompt` `prompt_command` | L3 `ipc_domains.rs` | `PromptLayersModal` |
| KMS 知识库 | `kms_list/create/delete/save_page/get_page/list_pages/search` | L3 `ipc_domains.rs` | `KmsView` |
| Side-channel | `start/cancel/list/get_side_channel` | L3 `ipc_domains.rs` | `SideChannelView` |
| 讨论 / 流水线 | `list_discussions` `validate_pipeline` `list/save_pipeline_config` | L3 `ipc_domains.rs` | `CollaborationView` |
| 远程 / tailscale | `get/update_remote_config` `get_remote_status` `tailscale_status` `tailscale_daemon_command_preview` `tailscale_daemon_status` | L3 `ipc_domains.rs` | `RemoteView` |
| 探针 | `ping` | L3 `ipc_core.rs` | `app.smoke` |
| **事件回传通路** | `reflect_event` 通道(非命令):信封 `{ id, msg }`、`msg.type` 判别子、`EVENT_ID_NONE` 生命周期 id、Submission↔Event id 配对 | L3 `ipc_events.rs` | `agent.protocol-events` |

**合计**：后端 185 条 `reflect_*` 命令中，能力覆盖层**直接驱动 179 条
（96.8%）**；余下 6 条在 §3 逐条说明排除理由。

---

## 3. 显式排除项（自动跑不了 / 不该自动跑）

**覆盖数字**：后端共 **185** 条 `reflect_*` 命令，能力覆盖层**驱动了 179 条
（96.8%）**。下面 6 条**有意排除** —— 每条都写明原因。排除必须是**有理由
的**，不能是「没顾上」。

| 命令 | 排除原因 | 替代覆盖 |
|---|---|---|
| `reflect_screenshot` | 截取**真实屏幕** —— 涉隐私 + 需录屏权限 | 无（人工验收） |
| `reflect_computer_use` | 操作**真实鼠标键盘** —— 会抢用户输入 | 无（人工验收） |
| `reflect_reveal_path` | 在系统文件管理器里**打开**目录 —— 会动用户桌面 | 无（人工验收） |
| `reflect_tailscale_daemon_start` / `_stop` | 启停**真实系统守护进程** | `tailscale_daemon_command_preview` / `tailscale_daemon_status` 验命令拼装与状态面 |
| `reflect_run_security_scan` | 内部跑 `cargo audit` —— 需网络 + 数十秒 | `audit.yml` 独立 workflow 覆盖 |

**「网络类只验错误路径」的含义**：`reflect_check_update` /
`reflect_gh_pr_list` / `reflect_list_provider_models` /
`reflect_test_provider_chat` / `reflect_query_plan_quota` 依赖**外网**。
CI 无网时它们**必须**返回结构化错误，不能 panic、不能挂死 —— 能力覆盖层
正是盯这一条：网络类只验错误路径的健壮性。

**「编排类只验失败路径」的含义**：`reflect_run_pipeline` /
`reflect_run_discussion` / `reflect_run_team_pipeline` 需要**真模型**才能
跑起来，但它们的**输入校验**（配置文件不存在 / 团队不存在）可以在无模型
环境下确定性地验 —— 能力覆盖层只跑失败路径，确认错误是结构化的、且
**不会**误起任何编排。

**`reflect_generate_session_title` 的特例**：它**已覆盖**，但只覆盖到前置
守卫（空会话 → 「session has no user message to summarize」）。真正生成
标题需要模型，不在自动层。

---

## 4. 已知债务（棘轮项）

下列指标当前存量不达标，由 `tests/static/baseline.json` 记录基线，
**新增违规立即失败**，存量逐步偿还：

| 项 | 现状 | 棘轮规则 |
|---|---|---|
| 生产文件 ≤ 500 行 | `src-tauri/src/commands/sessions.rs` 等 11 个文件超限 | 新增超限文件 → L1 失败 |
| `PROTOCOL_BRIDGE.md` 命令覆盖率 | 91.9% | 覆盖率跌破基线 → L1 失败 |
| 真后端命令覆盖 | 能力覆盖层驱动 **179/185** 条（96.8%） | 覆盖数跌破基线 → L1 失败 |

另有**已知的实现层不一致**（由能力覆盖层发现，非门禁失败项）：

- `tests/helpers/fakeBackend.ts` 的 `reflect_save_allowlist` 用
  `entries` 键，而**真后端**用的是 `prefixes`（见
  `src-tauri/src/commands/allowlist.rs`）。前端的
  `src/utils/commands/allowlist.ts` 用的是 `prefixes`（正确）——
  也就是说**测试替身**与真后端不一致。这正是能力覆盖层存在的意义：
  模拟层的偏差不会流到线上，但也不该被当成「已覆盖」。

另有**已知的真后端行为特征**（能力覆盖层照实记录，不算缺陷）：

- **配置命令是「读快照 → 改一项 → 整份写回」**。`upsert_mcp_server` /
  `lsp_set_enabled` / `save_pipeline_config` / `add_schedule` /
  `toggle_plugin` / `save_config` 都如此。两个这样的命令**并发**执行会
  丢更新（后写的拿的是更早的快照）。真实桌面里命令都从同一个 UI 线程
  发起，不会并发；能力覆盖层里则用 `common::state_lock()` 把它们串起来，
  否则断言不确定（实测会随机丢 MCP 条目）。
- **记忆是「每 scope 一条」而非「每 key 一条」**：`reflect_list_memory`
  返回的两条记录 `key` 固定为 `"(all)"`，`value` 是该 scope 的
  `MEMORY.md` 全文。增删是按 `## <key>` 块做的。
- **`reflect_create_session` 只分配 id，不落盘** —— 归档搬的是磁盘上的
  文件，所以对新分配的 id 归档是 no-op（后端日志：`not found (no-op)`）。
- **`reflect_upsert_mcp_server` 写的是配置**，`reflect_list_mcp_servers`
  读的是同一份配置快照 —— 两者在同一次调用序列里一致。
- **`reflect_toggle_plugin` 对不存在的插件幂等返回 `Ok(null)`**，不报错。
- **`reflect_release_task` 对未认领的任务报错**（`not claimed (nothing
  to release)`）；`reflect_claim_task` 在无待认领任务时返回 `null`。

---

## 5. 怎么读这张表

- 某个能力域在「真后端覆盖」列有文件 → 发布前它会被**真的**跑一遍；
- 只在「前端覆盖」列 → 它只验了前端行为，后端行为靠 L3 同域用例兜底；
- 两列都空 → **未覆盖**，应当补用例（不允许默默留着）；
- 在 §3 排除表 → 有意识地不自动跑，理由已备案。
