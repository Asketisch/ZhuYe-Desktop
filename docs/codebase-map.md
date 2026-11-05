# 代码库地图（任务导向）

烛夜 ZhuYe 的权威导航。使用方式：**「需要 X，编辑 Y」**。

相关文档：

- 设置 / 构建 / 发布：[`README.md`](../README.md)
- 架构：[`ARCHITECTURE.md`](ARCHITECTURE.md)
- GUI 设计历史：[`gui/00-index.md`](gui/00-index.md)
- IPC 信封：[`PROTOCOL_BRIDGE.md`](PROTOCOL_BRIDGE.md)
- 变更日志：[`CHANGELOG.md`](CHANGELOG.md)
- Agent 契约：[`AGENTS.md`](../AGENTS.md)

---

## 变更流向

对于后端行为，按以下顺序遵循路径：

1. 前端调用点：`src/features/**`（hooks/controllers/组件）
2. 前端 IPC API：`src/utils/commands/{domain}.ts`（兼容 re-export 位于 `src/utils/tauri.ts` 和 `src/utils/commands.ts`）
3. Tauri 命令注册：`src-tauri/src/lib.rs`（`invoke_handler` 枚举每个 `reflect_*` 命令）
4. Tauri 命令主体：`src-tauri/src/commands/mod.rs` 从 `src-tauri/src/commands/<domain>.rs` re-export
5. 应用状态（AgentThread 宿主）：`src-tauri/src/state.rs`（加上私有辅助 `hook_store.rs` / `memory_store.rs` / `shell_sessions.rs` / `workspace_state.rs`）
6. 事件转发器：`src-tauri/src/events.rs`
7. Reflect 协议类型：`zhuye-agent/crates/protocol/zhuye-protocol/src/{event.rs,event_msg/mod.rs,op.rs,item.rs}`

如果行为也需要在无头（CLI/TUI）中运行，该变更优先放在 ZhuYe 仓库（submodule），再升级 submodule 引用。

---

## 需要 X，编辑 Y

| 需求 | 主要文件 |
| --- | --- |
| 新增功能切片 / 路由 | `src/router.tsx`、`src/features/<slice>/<View>.tsx`、`src/features/shell/AppShell.tsx` |
| 从前端新增/修改 Tauri 命令 | `src/utils/commands/<domain>.ts`、`src-tauri/src/commands/<domain>.rs`、`src-tauri/src/commands/mod.rs`（re-export）、`src-tauri/src/lib.rs`（handler 列表）|
| 在 UI 中新增/修改事件处理 | `src/services/agent.ts`（兼容 re-export）+ `src/services/agentEventBus.ts`（引用计数扇出）、`src/stores/agent/reducer.ts`、`src/features/<slice>/use*Controller.ts` |
| 修改输入框（Composer）| `src/features/composer/{Composer,SlashPopup}.tsx`、`src/features/composer/{slashCommands,slashEngine}.ts`、`src/features/composer/{useComposerInput,useComposerSubmission,useAttachments,usePromptHistory}.ts`。旧路径 `src/features/messages/Composer.tsx` 是薄 re-export 层 —— 不要编辑。|
| 修改聊天渲染 | `src/features/messages/{ChatView,MessageList,ToolCells,Collapsible}.tsx` |
| 更改 IDE shell（布局 / 活动栏 / 状态栏） | `src/features/shell/{AppShell,ActivityBar,TitleBar,StatusBar,Inspector,PageShell}.tsx`。有状态的 shell 交互位于 `src/features/shell/hooks/{useCommandPaletteShortcut,usePaletteActions,useThemeCycle}.ts`。 |
| 更改审批 / 问题 / 计划模态框 | `src/features/modals/{ModalShell,index}.tsx`，各身体位于 `src/features/modals/{ApprovalModal,QuestionModal,AskUserModal,PlanReadyModal,ApprovalHistory}.tsx` |
| 更改会话列表（侧栏） | `src/features/sessions/components/{Sidebar,WorkspaceGroup}.tsx`、`src/features/sessions/utils/workspaceGroups.ts`、`src/features/sessions/hooks/{useSessions,useCollapsedGroups}.ts`（HomeView / ThreadsView 的时间分桶在 `src/features/sessions/utils/buckets.ts` + `BucketGroup.tsx`） |
| 更改设置持久化 | `src/features/settings/SettingsView.tsx`、`src/features/settings/ConfigForm.tsx`、`src/features/settings/config/{schema,toml,plans}.ts`、`src/features/settings/components/{StructuredField,ComplexEditors}.tsx`、`src/features/settings/sections/{DisplaySection,NotificationsSection,UpdatesSection,PlansSection}.tsx`、`src/utils/commands/config.ts`、`src-tauri/src/commands/config.rs` |
| 更改 coding plan / 供应商切换 / 额度 failover | `src/features/settings/config/plans.ts`（纯函数）、`src/features/settings/sections/PlansSection.tsx`（设置入口）、`src/features/models/ModelsView.tsx`(一键切换)、`src/stores/agent/planFailover.ts`（耗尽自动切换）、`src-tauri/src/state/{quota,reload}.rs`（tracker 构建 + 热重载） |
| 更改 OS 沙箱开关的生效口径 | `app-core/src/sandbox.rs`（唯一事实源：配置 `Option<bool>` 表态 → 有效值 → 协议策略）、`src-tauri/src/state/sandbox.rs`（env 优先解析）、`src-tauri/src/state/submit.rs`（每轮盖章 `thread_settings.sandbox_policy`）、`src-tauri/src/commands/sandbox.rs`（状态口径）、`src/features/shell/StatusBar.tsx`（徽标）。见 `docs/CAPABILITIES.md` §3.19 |
| 增删命令面板条目 | `src/features/command-palette/registry.ts`（条目表）、`src/features/command-palette/CommandPalette.tsx`（props 透传）、`src/features/shell/hooks/usePaletteActions.ts`（动作实现）、`src/features/shell/AppShell.tsx`（接线） |
| 渲染 plan 执行进度 / 插件挂载 | `src/stores/agent/reducer.ts`（`plan_step` / `plugin_loaded` 分支）、`src/stores/agent/types.ts`（`PlanStepState` / `PluginLoadedInfo`）、`src/features/plan/PlanView.tsx`、`src/features/collaboration/PluginsPanel.tsx` |
| 改动任务板 / 团队管理 | `src/features/tasks-board/{TasksBoardView,useTasksBoardController,TeamEditor}.tsx/ts`、`src/utils/commands/teams.ts`（团队 CRUD 包装 + `SystemTime` 形态） |
| 改动审批弹窗的「始终允许」 | `src/features/modals/ApprovalModal.tsx`、`src/features/modals/allowRule.ts`（规则推导，纯函数）、`src-tauri/src/commands/permissions.rs`（`reflect_add_permission_rule` → 核心用户级权限文件）、`src/stores/agent/types.ts`（`PendingApproval.args` 原始参数） |
| 更改主题 / 设计令牌 | `src/styles/tokens.css`、`src/features/design-system/DesignSystemView.tsx` |
| 添加托盘图标 / 菜单 / 快捷键 | `src-tauri/src/{tray,menu,shortcut}.rs`、`src-tauri/src/lib.rs` |
| macOS dock 徽标 | `src-tauri/src/dock.rs` |
| 记忆视图控制器 | `src/features/memory/MemoryView.tsx` + `src/features/memory/useMemoryController.ts` |
| 终端视图控制器 | `src/features/terminal/TerminalView.tsx` + `src/features/terminal/useTerminalController.ts` |
| 新增核心 crate 引用 | 根 `Cargo.toml` `[workspace.dependencies]`（path 指向 submodule）|
| 添加新测试夹具 | `src/test/setup.ts`、`vitest.config.ts` |
| **给真后端命令加能力覆盖用例** | `src-tauri/tests/ipc_<domain>.rs`（新增文件）+ `src-tauri/tests/common/mod.rs`（共享夹具）。命令注册表在 `src-tauri/src/lib.rs::configure` —— **不要**另建一份命令清单 |
| **改发布门禁** | `tests/run_all.sh`（总入口）+ `tests/lib.sh`（公共助手）+ `tests/{static,frontend,backend,artifact,e2e,live}/run.sh`（分层）+ `tests/static/analyze.mjs`（源码级交叉比对）+ `tests/static/baseline.json`（棘轮基线）|
| **改覆盖口径** | `tests/COVERAGE.md`（能力 → 套件映射 + 显式排除项与理由）|
| 更改协议类型 | `zhuye-agent/crates/protocol/zhuye-protocol/src/*.rs`（改 ZhuYe 仓库后升级 submodule）|
| 更改 agent store reducer / 动作 | `src/stores/agent/reducer.ts`（规范）。`src/stores/agentStore.ts` 是兼容 re-export —— 不要在那里添加新代码。 |

---

## 前端导航

- 组合根：`src/main.tsx`
- 路由（TanStack Router）：`src/router.tsx`
- 应用布局 shell（IDE 5 栏）：`src/features/shell/AppShell.tsx`（+ `ActivityBar/TitleBar/StatusBar/Inspector/PageShell`）
- Tauri IPC 底层桥接：`src/utils/bridge.ts`（`invoke` / `listen` + 回退）
- Tauri IPC 包装器桶文件（兼容）：`src/utils/tauri.ts`、`src/utils/commands.ts`
- Tauri IPC 包装器（规范，按域）：`src/utils/commands/{health,agent,approvals,plan,permissions,questions,config,sessions,events,workspaces,skills,memory,hooks,git,terminal,files,allowlist,updates,search}.ts`
- Agent 钩子（事件扇出 + 提交）：`src/services/agent.ts`（遗留兼容 re-export）+ `src/services/agentEventBus.ts`（引用计数总线）
- 全局 Zustand store：`src/stores/agentStore.ts`（兼容门面）→ `src/stores/agent/`（规范实现：`store.ts` + `reducer.ts` + `turns.ts` + `toast.ts` + `servers.ts` + `types.ts` + `useAgent.ts` + `selectors.ts` + `planFailover.ts` + `queue.ts` + `index.ts`）
- 主题基础设施：`src/utils/theme.ts`
- 设计令牌 / base reset：`src/styles/{tokens,base}.css` + `typography.module.css`
- i18n 运行时：`src/utils/i18n.ts`（兼容桶文件）→ `src/utils/i18n/{context.tsx,locale.ts,interpolate.ts,lookup.ts,types.ts}` + `src/utils/i18n/strings/index.ts` 合并 `src/utils/i18n/strings/` 下的域目录（about / app / apps / chat / collaboration / common / composer / debug / design / dictation / files / git / home / inspector / memory / mobile / modal / models / notifications / palette / permissionMode / plan / prompts / settings / shell / sidebar / skills / slash / terminal / threads / toast / update / workspaces）
- 共享类型：`src/types/protocol.ts`

### 功能切片

| 切片 | 文件 | 备注 |
| --- | --- | --- |
| `home` | `features/home/HomeView.tsx` | 仪表盘 / 快速操作 |
| `messages` | `features/messages/{ChatView,MessageList,ToolCells,Collapsible,Composer,Composer.module,MessageList.module,ChatView.module,ToolCells.module,Collapsible.module}.{tsx,css}` | 聊天滚动回退 + 行；Composer 现在是薄 re-export 存根 → `features/composer/Composer` |
| `composer` | `features/composer/{Composer,SlashPopup,MentionPicker,AttachmentBar}.tsx` + `slashCommands.ts` + `slashEngine.ts` + `useComposerInput.ts` + `useComposerSubmission.ts` + `useAttachments.ts` + `usePromptHistory.ts` | 自有 Composer + 斜杠引擎 |
| `shell` | `features/shell/{AppShell,ActivityBar,TitleBar,StatusBar,Inspector,PageShell,TodoPanel}.tsx` + `features/shell/RuntimeStatusSections.tsx` + `features/shell/hooks/{useCommandPaletteShortcut,usePaletteActions,useThemeCycle}.ts` | IDE 5 栏布局 + 有状态 shell 钩子；`TodoPanel` 渲染 agent 的 todo 清单（来自 `TodoWrite` 工具输出元数据） |
| `modals` | `features/modals/{ModalShell,index}.tsx` + `{ApprovalModal,QuestionModal,AskUserModal,PlanReadyModal}.tsx` | 审批 / 问题 / 计划 / AskUser |
| `sessions` | `features/sessions/{components/{Sidebar,WorkspaceGroup},hooks/useSessions}.{tsx,ts}` + `utils/{workspaceGroups,pins}.ts` + 测试 | 项目目录分组侧栏（可折叠；置顶区 + 归档区；时间分桶仍服务 HomeView / ThreadsView） |
| `settings` | `features/settings/{SettingsView,ConfigForm,configSchema}.tsx` + `features/settings/config/{schema,toml}.ts` + `features/settings/components/{StructuredField,ComplexEditors}.tsx` + `features/settings/sections/{DisplaySection,NotificationsSection,UpdatesSection,PlansSection,PermissionRulesSection,SecurityScanCard}.tsx` | 显示 / 编辑器 / 提供程序 + 结构化配置表单 + 更新检查 / 安全扫描 |
| `models` | `features/models/ModelsView.tsx` | 模型选择器 |
| `workspaces` | `features/workspaces/WorkspacesView.tsx` | 工作区选择器（M3.x） |
| `git` | `features/git/{GitView,PullRequestsView}.tsx` | Git 面板（stage/unstage/commit 操作化）+ gh PR 列表（/pulls） |
| `files` | `features/files/FilesView.tsx` | 文件树（M3.x） |
| `plan` | `features/plan/PlanView.tsx` | 计划模式 UI |
| `terminal` | `features/terminal/TerminalView.tsx` + `useTerminalController.ts` | 终端 dock + 控制器钩子 |
| `memory` | `features/memory/MemoryView.tsx` + `MemoryRow.tsx` + `MemoryAddForm.tsx` + `useMemoryController.ts` | 记忆视图 + 控制器钩子 |
| `skills` | `features/skills/SkillsView.tsx` | 技能目录（已安装 skills + 工具列表） |
| `hooks` | `features/hooks/HooksView.tsx` | Hook 运行时启停面板（/hooks） |
| `apps` | `features/apps/AppsView.tsx` | MCP 应用（M3.1+） |
| `prompts` | `features/prompts/PromptsView.tsx` | 自定义提示库 |
| `threads` | `features/threads/ThreadsView.tsx` + 测试 | 线程（M2.5 LRU） |
| `notifications` | `features/notifications/NotificationsView.tsx` | 通知中心 |
| `dictation` | `features/dictation/DictationView.tsx` | 按住说话（M3.x） |
| `mobile` | `features/mobile/MobileView.tsx` | iOS 布局 |
| `update` | `features/update/UpdateView.tsx` | 自动更新 UI |
| `debug` | `features/debug/DebugView.tsx` | 调试面板 |
| `about` | `features/about/AboutView.tsx` | 关于 / 版本 |
| `design-system` | `features/design-system/{DesignSystemView,primitives/*}.tsx` | DS 目录 + 基础组件（活体） |

### 导入别名

使用 TS/Vite 别名：

- `@/*` → `src/*`

---

## 后端导航

- 命令注册表（前端可调用的）：`src-tauri/src/lib.rs`（`tauri::generate_handler!` 枚举每个 `reflect_*` 命令）
- 命令主体（按域）：`src-tauri/src/commands/{agent,allowlist,config,export,files,git,hooks,memory,search,sessions,shell,skills,update,workspaces}.rs`；共享错误辅助位于 `src-tauri/src/commands/error.rs`（`CommandError` / `CommandResult`）
- 命令桶文件：`src-tauri/src/commands/mod.rs`（每个 `<domain>.rs` 的薄 re-export）
- 应用状态：`src-tauri/src/state.rs`（`MinimalAgent` 存根 → `reflect_core::AgentThread`）
- 状态支持模块：`src-tauri/src/{hook_store,memory_store,shell_sessions,workspace_state}.rs`
- 事件转发器：`src-tauri/src/events.rs`（`forward_agent_events`）
- 托盘 / 菜单 / 快捷键 / dock：`src-tauri/src/{tray,menu,shortcut,dock}.rs`
- MCP 运行时：`src-tauri/src/mcp.rs`
- Tauri 配置：`src-tauri/tauri.conf.json`
- Capabilities: `src-tauri/capabilities/main.json`
- Cargo workspace: `Cargo.toml` (workspace root) + `src-tauri/Cargo.toml`

### Tauri IPC 命令面

每个 `#[tauri::command]` 位于 `src-tauri/src/commands/<domain>.rs` 的领域模块中，并在 `src-tauri/src/lib.rs` 注册。完整集合覆盖：

| 领域 | 代表命令（完整集合见 `commands/<domain>.rs`）|
| --- | --- |
| `agent` | `ping`、`reflect_agent_status`、`reflect_submit`（另见：批准 / 问答 / 计划 / 努力级别 / 权限 / 压缩 / 关闭等变体）|
| `config` | `reflect_get_config`, `reflect_save_config` |
| `sessions` | `reflect_list_sessions`, `reflect_rename_session`, `reflect_delete_session`, `reflect_replay_session`, `reflect_export_session`, `reflect_export_session_markdown` |
| `workspaces` | `reflect_list_workspaces`, `reflect_set_workspace`, `reflect_current_workspace` |
| `skills` | `reflect_list_skills` |
| `memory` | `reflect_list_memory`, `reflect_add_memory`, `reflect_remove_memory` |
| `hooks` | `reflect_list_hooks`, `reflect_toggle_hook` |
| `git` | `reflect_git_status`, `reflect_git_diff`, `reflect_git_log` |
| `shell` | `reflect_run_shell`, `reflect_kill_shell`, `reflect_list_shell_sessions` |
| `files` | `reflect_list_dir`, `reflect_read_file` |
| `search` | `reflect_search_files` |
| `allowlist` | `reflect_load_allowlist`, `reflect_save_allowlist`, `reflect_check_allowlist` |
| `update` | `reflect_check_update` |
| `tools` | `reflect_list_tools`（见 `commands/agent.rs`）|
| Dock（macOS）| `reflect_set_dock_badge` |

推送事件（单一通道，按 `msg.type` 分发）：

- `reflect_event` —— 负载为 `reflect_protocol::Event`（snake_case JSON）
- `reflect_terminal_output` —— 负载为 `ReflectShellOutputChunk`（B8-01 流式 shell）

---

## 核心 Crate（submodule）

`zhuye-agent/` 是上游 `ZhuYe` 仓库 zhuye-* crate 的只读 git submodule 镜像，通过 `git submodule update --remote` 升级（完整流程见 `SUBMODULE.md`）。引用的 crate 集合由根 `Cargo.toml` 的 `[workspace.dependencies]` 声明（如 `zhuye-agent/crates/protocol/zhuye-protocol/`、`zhuye-agent/crates/runtime/zhuye-core/` 等）。

`app-core/`（与 `zhuye-agent/` 平级的本仓库 crate）承载 Tauri 命令层的 UI 无关领域服务（activity / media / tailscale / traces / discussion / pipeline / stats / sandbox；与 submodule 重叠的 actor / squad / autopilot / kms / pricing / side-channel / paths 实现已收敛到上游 crate,消费方直接 import）；GUI 渲染状态由前端 `src/stores/agent/` 负责。上游核心改动优先改 ZhuYe 仓库，再升级 submodule。

---

## 事件映射（后端 → 前端）

- 后端通过 `src-tauri/src/events.rs::forward_agent_events` 发出 → `app.emit("reflect_event", &event)`。
- 前端扇出枢纽：`src/services/agentEventBus.ts`（引用计数的单一订阅）→ `src/stores/agent/reducer.ts`。`src/services/agent.ts` 是旧版兼容再导出，转发到 store hook。
- 解析守卫：`src/utils/tauri.ts::onReflectEvent`。
- 类型契约：`zhuye-agent/crates/protocol/zhuye-protocol/src/event_msg/mod.rs`（Rust）↔ `src/types/protocol.ts`（TS）。

若事件负载格式变更，用 reflect-protocol 的模式导出重新生成 `src/types/protocol.ts`（`cargo run -p reflect-protocol --example dump_schema` → `npx json2ts`）。

---

## 类型契约文件

保持 Rust 与 TypeScript 契约同步：

- Rust 后端类型：`zhuye-agent/crates/protocol/zhuye-protocol/src/{event.rs,event_msg/mod.rs,op.rs,item.rs}`
- 前端类型：`src/types/protocol.ts`
- 设置：`src/features/settings/config/schema.ts` ↔ `src-tauri/src/commands/config.rs`

提交、事件、设置与会话负载都必须遵守。

---

## 约定

- **功能切片设计**：每个功能是 `src/features/<slice>/` 下的一个目录。组件平铺或放在 `components/`；hooks 放 `hooks/`；控制器（有状态视图编排）与视图同目录，命名 `use*Controller.ts`；测试同目录放 `*.test.ts(x)`。
- **就近放置**：测试与源码同目录（`Foo.tsx` → `Foo.test.tsx`）。
- **命名**：组件 PascalCase，hooks/工具函数 camelCase，类环境常量全大写下划线。
- **状态**：优先局部 `useState`/`useReducer`；仅当被 ≥2 个功能共享时才提升到 Zustand store。

---

## Quick Runbook

```bash
pnpm install                 # 安装 JS 依赖
pnpm tauri dev               # 开发模式（HMR）
pnpm test                    # vitest
pnpm typecheck               # tsc --noEmit
cd src-tauri && cargo check  # Rust 类型检查
pnpm tauri build             # 发布构建
bash tests/run_all.sh        # 发布门禁（静态 + 前端 + 真后端 + 产物）
```

发布门禁分层（可单跑）：

```bash
bash tests/run_all.sh static      # 静态审查：命令面一致 / 文档新鲜度 / 仓库卫生
bash tests/run_all.sh frontend    # 前端行为：typecheck + vitest 全量
bash tests/run_all.sh backend     # 真后端能力覆盖：fmt + clippy + cargo test
bash tests/run_all.sh artifact    # 发布产物审查：.app 结构 / Info.plist / 签名
bash tests/run_all.sh e2e         # 视觉回归 + 真窗口冒烟（依赖缺失时跳过）
REFLECT_LIVE=1 bash tests/run_all.sh live   # 实模型演练（真免费模型，默认跳过）
```

覆盖口径（哪个能力域由哪层验、哪些显式排除及理由）见
[`tests/COVERAGE.md`](../tests/COVERAGE.md)。

实模型演练层（真免费模型）的接法见
[`docs/FREE_MODEL_PRACTICE.md`](FREE_MODEL_PRACTICE.md)。

子模块升级：

```bash
git submodule update --remote zhuye-agent
git diff --submodule zhuye-agent
git add zhuye-agent && git commit -m "chore: bump zhuye-agent submodule"
```

安装（macOS）：

```bash
pnpm tauri build --bundles app
bash scripts/install.sh
# → /usr/local/bin/reflect-desktop + ~/Applications/ZhuYe.app
```
