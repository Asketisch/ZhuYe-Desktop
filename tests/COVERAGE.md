# 能力 → 套件映射（发布审查口径）

> 本文档是烛夜（ZhuYe）**发布阶段**的功能审查口径：每个能力域由哪一层
> 验、验的是**真后端**还是**模拟后端**、哪些能力**显式排除**以及为什么。
>
> 与 submodule 的 `zhuye-agent/tests/COVERAGE.md` 同构 —— 覆盖不是
> 「跑过多少测试」，而是「**哪些能力没被验到，���什么**」。

---

## 1. 分层模型

| 层 | 套件 | 测什么 | 后端真伪 | 退出码 |
|---|---|---|---|---|
| L1 | `tests/static/` | 源码与仓库状态：命令面**四方**一致（后端实现 ↔ `lib.rs` 注册表 ↔ 前端包装 ↔ 测试替身 `fakeBackend`）、路由↔视图、版本四处一致、CHANGELOG / 能力矩阵新鲜度、仓库卫生、调试残留、生产文件大小预算棘轮、真后端命令覆盖棘轮 | 静态分析 | 0 = 通过 |
| L2 | `tests/frontend/` | 真实前端的行为：`tsc --noEmit` + vitest 全量（`src/` 99 个文件 + `tests/` 10 个文件） | **模拟**（`fakeBackend`） | 0 = 通过 |
| L3 | `tests/backend/` | **真后端**：`cargo fmt` / `clippy` / doc-test（`///` 示例绊网，`--all-targets` 不含 doctest）/ `cargo test --workspace --all-targets`（含能力覆盖层 `src-tauri/tests/ipc_*.rs`）/ llvm-cov 行覆盖报告（装了才跑，报告型无门槛；2026-11 首测 **86.55%**） | **真** | 0 = 通过 |
| L4 | `tests/artifact/` | 发布产物：`.app` 结构 / Info.plist 键与版本 / 前端资源已嵌入 / 无开发残留 / **签名封印 + 授权已嵌入**（`codesign_entitlements_ok`，自测 `codesign-entitlements.test.sh` 同步编排）/ DMG 内封印 | 真产物 | 0 = 通过 |
| L5 | `tests/e2e/` | 视觉回归（全路由 × dark/light 截图基线，真实前端 + fakeBackend 浏览器态构建）+ WebDriver 真窗口冒烟（仅 Linux，`tauri-driver`）；依赖缺失时默认跳过，`E2E_REQUIRED=1` 强制 | 模拟（视觉）/ 真（窗口） | 0 = 通过（skip 不算失败） |
| L6 | `tests/live/` | **实模型演练**：`reflect_submit` → AgentThread → 真 provider（免费模型池）→ 真 SSE → `reflect_event` 通道的完整一轮；模型从清单**实时发现**（`model = "free"`）。默认跳过，`REFLECT_LIVE=1` 开启 | **真**（模型也是真的） | 0 = 通过（skip 不算失败） |

**为什么 L2、L3 与 L6 都要有**：L2 验前端行为与线格式（后端是模拟的），
L3 验真后端命令体的行为（但模型是假的）。模拟后端的 bug 会把真后端的 bug
遮住 —— 与 submodule「能力覆盖层不经过任何 SDK」的道理同源。L6 再补一格：
真命令体 + **真模型** + 真网络（真实 SSE 帧、真实思考过程、真实 429、真实
截断续作）。三层合起来才是完整功能面。

L6 与 submodule 的 `zhuye-agent/tests/live/` 同口径：默认 SKIP（不进 CI
门禁）、断言只到**协议形状**（不断言回答文本）、上游限流/地区门判为**跳过**
而不是失败。

**L3 能力覆盖层怎么做到「真」**：`src-tauri/tests/common/mod.rs` 用
`tauri::test::mock_builder()` 建 app，再挂上**生产同一份**命令注册表
（`reflect_desktop_lib::configure` —— 与 `run()` 共用同一个
`generate_handler!`），然后以 `InvokeRequest` 注入 JSON 负载驱动**真实
命令体**。没有前端 `invoke` 包装，没有 `fakeBackend`，没有 SDK 中间层。

---

## 2. 能力域 → 覆盖层

| 能力域 | 命令 | 真后端覆盖（层 / 文件） | 前端覆盖 |
|---|---|---|---|
| Agent 生命周期 | `submit` `interrupt` `compact` `rewind` `shutdown` | L3 `ipc_agent_ops.rs` + `ipc_shutdown.rs`（shutdown 独立进程验证，避免污染共享 app） | `chat.full-flow` |
| 审批 | `tool_approval` `hook_approval` `plan_approval` | L3 `ipc_agent_ops.rs` | `modals.approvals-questions` |
| Plan / Goal 模式 | `enter/exit_plan_mode` `enter/exit_goal_mode` | L3 `ipc_agent_ops.rs` | `flows.chat-plan-goal-edit` |
| Goal 状态快照 | `goal_snapshot` | L3 `ipc_goal.rs`（挂载 / 覆盖 / 退出全周期轮询断言） | store `syncGoalSnapshot` + Composer goal 徽标 tooltip |
| 权限 / 强度 / steer | `set/cycle_permission_mode` `set/get_effort` `steer` | L3 `ipc_agent_ops.rs` | `composer.slash-history-attachments` |
| 追问 | `ask_user_question_response` `ask_user_input_response` | L3 `ipc_agent_ops.rs` | `modals.approvals-questions` |
| 会话生命周期 | `create` `bind` `list` `rename` `fork` `delete` `archive` `unarchive` `list_archived` `replay` `export` `search_sessions` | L3 `ipc_core.rs` | `sessions.lifecycle` |
| 会话统计 | `session_stats` `all_model_usage` `model_rate_cards` | L3 `ipc_core.rs` | `usage` |
| 配置 | `get_config` `save_config` `config_info` `set_model` | L3 `ipc_core.rs` + `ipc_model_discovery.rs`（本地模拟清单失败及相同配置重试） | `settings.config` |
| 运行时状态 | `agent_status` `credential_pool_status` `recovery_state` `memory_sections` `sandbox_status` | L3 `ipc_core.rs` / `ipc_workspace.rs` | `StatusBar` / `AppShell` |
| 工具 / 技能 / hooks | `list_tools` `list_skills` `list_hooks` `toggle_hook` `list_hook_events` | L3 `ipc_core.rs` + `ipc_hooks.rs`（运行时注册表、重绑、配置更新和任务事件）；Unix 上经真实插件验证首条命令、会话开始 / 结束及任务 hook | — |
| 记忆 | `list/add/remove_memory` | L3 `ipc_core.rs` | `MemoryView` |
| 会话笔记 | `list_session_notes` `list_note_sessions` | L3 `ipc_core.rs` | `MemoryView` |
| 权限规则 / 白名单 | `list/add_permission_rule` `load/save/check_allowlist` | L3 `ipc_core.rs` + `ipc_permission_errors.rs`（权限文件损坏时报告错误）+ `ipc_permission_concurrency.rs`（并发追加不报错、store 保持可解析）+ `ipc_permission_read_only.rs`（Unix 只读文件报权限错误）；`state/permissions.rs` 单测验证用户目录不可用 | `PermissionRulesSection` |
| 活动日志 | `list/search/clear_activity` `activity_count` | L3 `ipc_core.rs` | — |
| Agent 定义 | `list/get/save/delete_agent_def` `parse_agent_md` `get/set_active_agent` | L3 `ipc_core.rs` + `ipc_agent_preferences.rs`（损坏与其他偏好保留） | `AgentsView` |
| Autopilot | `get/update_autopilot_config` `autopilot_history` | L3 `ipc_core.rs` + `ipc_autopilot_errors.rs`（损坏文件报错） | — |
| Traces / Span | `list_traces` `get_trace` `list_span_logs` `read_span_log` | L3 `ipc_core.rs` | `TracesView` |
| 工作区 | `list/set/current_workspace` | L3 `ipc_workspace.rs` + `ipc_workspace_history.rs`（损坏历史保留与报错） | `useCurrentWorkspace` / `WorkspacesView.test.tsx`（读取错误） |
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
| MCP | `list_mcp_servers` `mcp_catalog` `upsert/delete_mcp_server` `list_mcp_resources` `list_mcp_prompts` | L3 `ipc_domains.rs` + `ipc_mcp_lifecycle.rs`（空配置启动后新增服务的失败事件）；`mcp.rs` 单测覆盖工具冲突和替换后的所有权清理 | `McpManager` |
| LSP | `lsp_status` `lsp_set_enabled` `lsp_diagnostics` | L3 `ipc_domains.rs`；上游共享工具单测覆盖固定文件句柄及大小上限，`zhuye-lsp` 单测覆盖路径校验和文档同步，mock server 集成测试覆盖工具调用 | — |
| 提示词层 | `get_effective_prompt` `prompt_command` | L3 `ipc_domains.rs` | `PromptLayersModal` |
| KMS 知识库 | `kms_list/create/delete/save_page/get_page/list_pages/search` | L3 `ipc_domains.rs`（含独占创建）+ `ipc_kms_links.rs`（外部符号链接） | `KmsView` |
| Side-channel | `start/cancel/list/get_side_channel` + `side_channel_started/finished/status` 事件信封 | L3 `ipc_domains.rs`(含终态补发断言) | `SideChannelView` |
| 讨论 / 流水线 | `list_discussions` `validate_pipeline` `list/save_pipeline_config` | L3 `ipc_domains.rs` | `CollaborationView` |
| 远程 / tailscale | `get/update_remote_config` `get_remote_status` `tailscale_status` `tailscale_daemon_command_preview` `tailscale_daemon_status` | L3 `ipc_domains.rs` | `RemoteView` |
| 探针 | `ping` | L3 `ipc_core.rs` | `app.smoke` |
| **事件回传通路** | `reflect_event` 通道(非命令):信封 `{ id, msg }`、`msg.type` 判别子、`EVENT_ID_NONE` 生命周期 id、Submission↔Event id 配对 | L3 `ipc_events.rs` | `agent.protocol-events` |
| **事件转发器韧性** | 转发器在 `RecvError::Lagged` 之后必须存活(慢订阅者不杀死转发器) | L3 `ipc_events.rs` | — |
| **线格式契约(参数形状)** | 全部 185 条命令的参数样本:fakeBackend 收得下 + 真后端反序列化 | L2 `ipc.payload-contract` + L3 `ipc_payload_contract.rs` + L1 `payload-sample-complete` | 同左(fakeBackend 侧) |
| **持久化往返契约(语义)** | 21 对「写 → 读」(allowlist / config / memory / schedule / mcp / 权限规则 / agent def / 活跃 agent / 子代理 / squad / team / pipeline / KMS / 任务 / 工作区 / autopilot / remote / 文件 / LSP) | L2 `ipc.roundtrip-contract` + L3 `ipc_roundtrip_contract.rs` 双端同表 | 同左(fakeBackend 侧) |
| **假模型全链路** | 有模型的完整一轮:submit → AgentThread → HTTP → SSE 解析 → 事件回传(文本流 / bash 工具 + 审批门 + tool_result 第二跳 / HTTP 500 / 流中 interrupt 及恢复) | L3 `ipc_mock_provider.rs`(wiremock 本地假网关,离线确定性) | `chat.full-flow`(ScriptedAgent 模拟层,与 L3 互补) |
| **并发不变量** | 并行只读 / submit 风暴 + 交错 interrupt / 并发配置写(文件始终合法 TOML、不死锁) | L3 `ipc_concurrency.rs` | — |
| **重启恢复** | 进程退出后以同一 `~/.zhuye` 重启:配置 / 记忆 / 白名单 / agent 定义 / squad / 任务 / 工作区读回 | L3 `ipc_restart.rs`(子进程两阶段) | `sessions.lifecycle`(切换水合,单进程内) |
| **数据目录统一** | 桌面与核心共享同一个 `.zhuye` 数据目录；就地追加（权限规则 / 项目记忆）读-改-写，保留文件已有内容 | L3 `ipc_namespace_compat.rs` | — |
| **i18n 渲染级** | 34 条路由 zh-CN 挂载:页面出现中文、无裸 i18n key | — | `views.route-matrix`(zh-CN 遍) |
| **可访问性(audit)** | 34 条路由 axe-core 审计:serious/critical 违规为零(jsdom 无布局,color-contrast 留给视觉层) | — | `a11y.route-matrix`(与路由矩阵共享同一份表) |
| **可访问性(键盘)** | 模态 Tab 焦点陷阱;Escape 线上回执(审批 deny / plan revise);堆叠模态仅栈顶响应 | — | `a11y.keyboard` |
| **性能预算** | reduceEvent 1 万 delta / 5k 会话分桶 / 2k 记录会话水合渲染 / 500 rollout 索引 / 5k 行回放(PERF_STRICT=1 收紧) | L3 `ipc_perf_budgets.rs` | `perf.budgets` |
| **配置向前兼容** | 旧版本/未知键配置在新进程启动:已知键生效、未知键不致命、agent 存活(fixtures: 最小/旧版/未知键/全量) | L3 `ipc_config_compat.rs`(每夹具独立子进程) | — |
| **宿主壳层(菜单)** | 自定义菜单 id ↔ 常量表 ↔ 事件分支对齐;每个发事件的 id 逐个驱动,恰好发出对应 `menu-*` 事件 | `menu.rs` 内嵌单测(mock runtime) | — |
| **视图渲染错误边界** | 视图 render 抛错 → 回退 + 壳层存活 / Retry 恢复 / 切路由复位(此前整树白屏) | — | `errors.boundary` |
| **产物深度(Linux/Windows)** | .deb 解包(usr/bin 可执行 + .desktop(Exec) + 图标 + control 版本) / .AppImage(AppRun + .desktop) / .msi 管理映像(exe + ProductVersion) / 启动冒烟(CI 门控) | L4 `artifact/run.sh` | — |
| **视觉回归** | 38 条路由 × dark/light 截图与基线逐字节比对(布局/主题回归零容忍);真实前端 + `fakeBackend` 经 alias shim 进浏览器态构建;时钟冻结 + 动画禁用保证确定性 | L5 `e2e/visual.spec.ts` | — |
| **真窗口 E2E(冒烟)** | 构建产物起真窗口:壳层挂载、侧栏/导航存在、状态条非空、截图留存 | L5 `e2e/window.smoke.test.ts`(`tauri-driver`,仅 Linux;macOS 无 WKWebView WebDriver,官方口径跳过) | — |
| **实模型全链路** | 有**真模型**的完整一轮:`reflect_submit` → AgentThread → 真 provider(免费模型池)→ 真 SSE → `reflect_event` 通道。断言:model spec 解析成真实 id(非占位串)、turn 有终态、usage 字段齐全、工具调用成对。**不断言回答文本** | L6 `ipc_live_free_model.rs`(默认 SKIP,`REFLECT_LIVE=1` 开启) | — |
| **模型发现(清单实时拉取)** | `model = "free"` → 运行时查 provider 清单 → 按免费规则挑一个 → 写进运行时配置;失败**如实上报**(不回落占位串) | L6 `ipc_live_free_model.rs`(随实模型层跑) | — |
| **实模型能力域矩阵** | 15 个场景覆盖**其余依赖模型的命令面**:工具调用(bubble 自动批准)/ 工具审批(prompt→批准→真跑)/ 中断 / 压缩 / 回退 / plan 模式(plan_request→plan_ready→plan_approved)/ goal 模式 / 会话标题生成 / 任务工具 / 子代理 / 追问 / 讨论(llmBacked=true)/ 流水线 / 团队流水线。**模型不配合判跳过**(非失败) | L6 `ipc_live_capabilities.rs`(默认 SKIP) | — |

| **事件面线格式契约(全变体)** | 协议 `EventMsg` **全部 50 个变体**的最小合法样本(`tests/contracts/events.json`):真协议 serde 反序列化 + wire roundtrip + 未知 type/缺必填字段探测器 | L2 `ipc.event-contract` + L3 `ipc_event_contract.rs` + L1 `event-parity`(Rust enum ↔ TS 联合 ↔ 样本表三方奇偶) | 同左(fakeBackend 侧) |
| **视图行为(九切片)** | home / models / skills / prompts / debug / dictation / about / apps / mobile 的交互与数据投影:会话导航、set_model/set_effort 线格式、`mcp__` 前缀分组、模板经 store.submit、ping 版本面、本地连接翻转 | — | `views.untested-slices`(路由矩阵之外的交互增量) |
| **门禁自测(测试测试的脚本)** | `lib.sh` 原语(tcase/tfinish/suite_absorb/run_with_timeout 状态分类)、`run_all.sh` 聚合(未知套件/报告结构/GATE_STRICT 无跳过不误报)、LIVE_CASE 折叠(与 `live/run.sh` 消费同一份 awk) | L1 `static/*.test.sh`(7 个自测统一编排) | — |
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

> **L6 已覆盖编排命令**：`reflect_run_pipeline` /
> `reflect_run_discussion` / `reflect_run_team_pipeline` 三条在
> `ipc_live_capabilities.rs` 里都有实模型场景（讨论断言
> `llmBacked === true` —— 证明真的走了模型而不是 noop 回落；流水线需要
> 一个**与节点标签同名**的 team，这是上游的硬约束）。

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
- **Windows 不进 Rust test 矩阵**:能力覆盖夹具靠 `HOME` 隔离,而
  Windows 的 `dirs::home_dir()` 走 `USERPROFILE` —— 跑测试会污染真实
  用户目录。Windows 由 clippy 矩阵(编译级)与 release 产物构建覆盖。
- **菜单构建不能在测试线程跑**:muda 绑定主线程(macOS 实测
  `MenuChild can only be created on the main thread`),「构建出的菜单 ↔
  常量表」互校因此退化为静态对齐自检 + 行为派发测试(`menu.rs` 单测)。
- **dock / 全局快捷键为平台运行时绑定**(AppKit 主线程 / global-shortcut
  插件),无纯逻辑可单测;dock 的降级语义由 `ipc_workspace.rs` 的
  「mock runtime 下静默 no-op」覆盖,快捷键由人工验收。
- **启动冒烟默认关**:本机跑门禁会弹真窗口抢焦点;`CI=1` 或
  `ARTIFACT_LAUNCH_SMOKE=1` 时启用,Linux 需 xvfb-run。
- **`kms_list_pages` 的 `Page.name` 实际带 `.md` 后缀**(与 app-core
  结构体文档注释「不含 .md」相悖) —— 契约按**实际行为**对齐(fake 与
  roundtrips 均为带后缀形态),上游文档注释待修正。
- **空字符串工具结果在 OpenAI 兼容网关上有路线性雷**(L6 免费池实测):
  `zhuye-discussion` 的 `read_messages` 空邮箱返回 `text: ""` →
  `zhuye-llm` 序列化为 `"content": ""` → Kilo 网关 Cohere 路线 400
  (`all elements in tool_results must have the 'outputs' property`)。
  wiremock(L3)与 Anthropic 直连不触发,只有部分 OpenAI 兼容路线判死。
  上游待修(工具层占位文本或序列化层归一化);修复前 L6 discussion 场景
  在该路线上稳定 FAIL,属**已定位的上游缺陷**,不是演练层的误判。
- **`EventMsg::AskUserInput` 的 `discriminant()` 与 serde wire tag 不一致**(上游内部):
  discriminant 返回 `"ask_user"`,serde `rename_all=snake_case` 的 wire tag 是
  `ask_user_input`。事件面契约(L3 `ipc_event_contract.rs`)因此锚定
  **wire type**(重序列化后的 `type` 字段)而非 discriminant —— wire 才是
  `reflect_event` 通道上消费者看到的形态。上游待统一(discriminant 跟随
  serde tag),修复后桌面无感(前端走 wire)。
- **`ContextCompactedStrategy::LlMSummarize` 的 wire 值是 `ll_m_summarize`**
  (serde snake_case 对 `LlMSummarize` 的缩写分段),不是 `llm_summarize`。
  前端 `ContextCompactedPayload.strategy` 已按 wire 修正 —— 此前类型写的
  `llm_summarize` 永远匹配不上真实事件(事件面契约实测抓到)。
- **side-channel `startedAtMs` 双时间源**(L3 实测,毫秒翻边时 flaky):
  `registry.start()` 给句柄打一次 `now_ms()`(快照/列表数据源),上游
  `submission_loop` 构造协议 `SideChannelStarted` 应答时**重新取**
  `now_ms()`(`submission_loop.rs:1190`)—— 两次调用跨毫秒边界时相差
  1ms,桌面 ipc_domains 的严格相等断言偶发失败。桌面测试改为身份字段
  严格断言 + 时间戳 ≤5ms 容差;上游待修(`driver.start()` 返回句柄
  stamp 供协议应答复用,单一事实源),修复后可收回严格相等。

---

## 5. 怎么读这张表

- 某个能力域在「真后端覆盖」列有文件 → 发布前它会被**真的**跑一遍；
- 只在「前端覆盖」列 → 它只验了前端行为，后端行为靠 L3 同域用例兜底；
- 两列都空 → **未覆盖**，应当补用例（不允许默默留着）；
- 在 §3 排除表 → 有意识地不自动跑，理由已备案。
