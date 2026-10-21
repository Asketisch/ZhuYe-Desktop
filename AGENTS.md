# ReflectDesktop Agent 指南

所有文档必须是规范化的，不包含过时评论，仅保留当前有效状态。

## 范围

本文档是仓库的 Agent 契约，规定在本仓库中的工作方式。
详细的导航手册见：

- `docs/codebase-map.md`（面向任务的代码映射："需要改 X，编辑 Y"）
- `docs/CAPABILITIES.md`（核心能力 → GUI 覆盖矩阵：基座能力是否都能用、能看到）
- `docs/PROTOCOL_BRIDGE.md`（Tauri ↔ reflect-protocol 协议信封规范）
- `README.md`（环境设置、构建、发布和项目文档）
- `docs/CHANGELOG.md`（版本更新日志）

## 项目概况

ReflectDesktop 是 Reflect Agent 的桌面 GUI 应用，基于 Tauri 2 + React 19 构建。

- 前端：React 19 + Vite + TanStack Router/Query（`src/`）
- 后端应用：Tauri Rust 进程（`src-tauri/src/lib.rs`）
- 子模块：`reflect-*` 核心 crate 通过 git submodule 复用（见 `reflect-agent/`），升级流程见 [`SUBMODULE.md`](SUBMODULE.md)
- 共享核心：`app-core/`（UI 无关的领域服务层：activity / kms / media / squad / side-channel / tailscale / autopilot / actor / traces / discussion / pipeline / pricing / sandbox / stats，供 `src-tauri` 命令层复用）

## 不可妥协的架构规则

1. 将共享/领域后端逻辑优先放在 `app-core/` 和 `reflect-agent/crates/reflect-*` 中。
2. Tauri 应用是 `reflect_core::AgentThread` 的薄适配层。
3. TUI 和 GUI 之间不重复逻辑；两者消费同一份 `reflect-protocol` 协议信封。
4. 除非有意修改协议，否则保持 Tauri 命令名称和负载结构稳定。
5. 保持前端 IPC 协议与后端命令表一致（`src/utils/commands/` ↔ `src-tauri/src/commands/mod.rs`）。

## 后端路由规则

后端行为变更遵循以下顺序：

1. 核心 crate（`reflect-agent/crates/reflect-*`，通过 submodule）— 跨运行时逻辑的首选位置。如果变更应放在上游，修改 Reflect-Agent 仓库并升级 submodule（见 `SUBMODULE.md`）。
2. 应用适配层和 Tauri 命令表（`src-tauri/src/lib.rs` + `commands/mod.rs`）。
3. 前端 IPC 包装（`src/utils/commands/{domain}.ts`）。
4. 如果新增后端命令，需同步更新所有相关层级 + 测试 + `docs/PROTOCOL_BRIDGE.md` + `docs/CHANGELOG.md`。
5. 核心 crate 新增能力时，同步更新 `docs/CAPABILITIES.md`（基座能力 → GUI 覆盖矩阵）——「有命令但无 UI 消费面」视为半接线。

## 前端路由规则

- `src/main.tsx` 作为组合根。
- `src/router.tsx` 作为路由表。
- 有状态的编排逻辑放入 `src/features/<slice>/hooks/*` 或 `<slice>/use*Controller.ts`（与视图同目录）。
- 表现层 UI 放在功能组件中（`src/features/<slice>/<View>.tsx`）。
- Tauri 调用仅放在 `src/utils/commands/`（按领域分文件）；`src/utils/tauri.ts` 和 `src/utils/commands.ts` 为兼容桶，不要在其中新增包装。
- 事件订阅广播保持在 `src/services/agent.ts` 和 `src/services/agentEventBus.ts`。

## 导入别名

前端导入使用项目别名（在 `tsconfig.json` + `vite.config.ts` 中定义）：

- `@/*` → `src/*`

## 核心文件锚点

- 前端组合根：`src/main.tsx`
- 前端路由表：`src/router.tsx`
- IDE 应用外壳：`src/features/shell/AppShell.tsx`
- 前端 IPC 兼容桶：`src/utils/tauri.ts` / `src/utils/commands.ts`
- 前端底层桥接：`src/utils/bridge.ts`（`invoke` / `listen` 带降级）
- 前端 IPC 包装（按领域）：`src/utils/commands/{domain}.ts`（如 `agent`、`sessions`、`memory`、`terminal`、`git`、`files`、`skills`、`hooks`、`workspaces`、`config`、`permissions`、`approvals`、`questions`、`plan`、`events`、`health`、`updates`、`allowlist`、`search`）
- 前端代理存储：`src/stores/agentStore.ts`（兼容层）→ `src/stores/agent/`（实现：`store.ts`、`reducer.ts`、`turns.ts`、`toast.ts`、`servers.ts`、`types.ts`、`useAgent.ts`、`index.ts`）
- 前端代理钩子（旧版重新导出）：`src/services/agent.ts`
- 应用命令注册表：`src-tauri/src/lib.rs`
- 应用状态（AgentThread 宿主）：`src-tauri/src/state.rs`
- 应用状态支持模块（位于 `src-tauri/src/`）：`state.rs`、`dock.rs`、`events.rs`、`mcp.rs`、`menu.rs`、`tray.rs`、`shortcut.rs`，及辅助文件 `hook_store.rs`、`memory_store.rs`、`shell_sessions.rs`、`workspace_state.rs`
- Tauri 命令表：`src-tauri/src/commands/mod.rs` — 薄桶模块，重新导出 `src-tauri/src/commands/{agent,allowlist,config,export,files,git,hooks,memory,search,sessions,shell,skills,update,workspaces}.rs` 中的命令体和 `error.rs`（定义 `CommandError` / `CommandResult`）
- Cargo 工作区：`Cargo.toml`（根）+ `src-tauri/Cargo.toml`
- 子模块核心：`reflect-agent/crates/reflect-*/`（只读镜像，不要直接修改——修改 Reflect-Agent 仓库并升级 submodule）
- 发布门禁入口：`tests/run_all.sh`（分层）+ `tests/lib.sh`（公共助手）
- 门禁分层套件：`tests/static/`（静态审查）、`tests/frontend/`（前端行为）、`tests/backend/`（真后端能力覆盖）、`tests/artifact/`（发布产物）
- 真后端能力覆盖层：`src-tauri/tests/ipc_{core,workspace,domains,agent_ops}.rs` + 共享夹具 `src-tauri/tests/common/mod.rs`
- 能力 → 套件映射（发布审查口径）：`tests/COVERAGE.md`

更详细的路径映射见 `docs/codebase-map.md`。

## 协议不变量

- 线格式为 `reflect_protocol::Event` / `Submission`（snake_case JSON）
- 所有 `Op` 变体 → Tauri 命令（见 `docs/PROTOCOL_BRIDGE.md` §2）
- 所有 `EventMsg` 变体 → 单一 `reflect_event` 通道，前端通过 `msg.type` 分发
- Submission id ↔ Event id 配对用于流关联
- `EVENT_ID_NONE = ""` 用于生命周期事件（无匹配提交）

## AgentThread 宿主状态不变量

- `MinimalAgent`（M2.x）是封装器，持有 `Arc<AgentThread>` + `tokio::sync::broadcast` 用于会话事件广播
- `install_agent_thread()` 在 Tauri `setup()` 中调用（运行时初始化后），不要在 `manage()` 中调用（同步阶段）
- 慢订阅者触发 `RecvError::Lagged(n)` — 记录日志但任务继续运行
- macOS 关闭按钮 → 隐藏到托盘（不退出），通过 `on_window_event`

## 会话层级不变量

- `useSessions`（`src/features/sessions/hooks/useSessions.ts`）是会话列表的规范 hook
- 切换会话 → `reflect_replay_session(id)` 后水合本地状态
- 时间分组（`Now/今天/昨天/本周/更早`）在 hook 中，不在侧边栏组件中

## 后续行为映射

关于队列和导航后续行为，从这里开始：

- 设置模型与默认值：`src/features/settings/SettingsView.tsx`（使用 `ConfigForm` + 每节组件）
- 编辑器运行时行为：`src/features/composer/Composer.tsx`（规范位置）；`src/features/messages/Composer.tsx` 是薄重新导出层
- 发送意图路由：`src/stores/agent/index.ts::useAgentStore`（规范位置）— `src/stores/agentStore.ts` 为兼容层
- 应用布局布线：`src/features/shell/AppShell.tsx`、`src/router.tsx`

## 应用状态同步检查表

当修改同时影响后端和前端的设置/持久化时：

1. 后端（`src-tauri/src/state.rs` + `commands/<domain>.rs` / `commands/mod.rs`）已更新
2. 前端 IPC（`src/utils/commands/{domain}.ts`）已更新
3. 功能设置 UI（`src/features/settings/SettingsView.tsx`、`ConfigForm.tsx`、`sections/DisplaySection.tsx`、`sections/NotificationsSection.tsx`、`sections/UpdatesSection.tsx`、`sections/PlansSection.tsx`、`sections/PermissionRulesSection.tsx`、`sections/SecurityScanCard.tsx`、`components/StructuredField.tsx`、`components/ComplexEditors.tsx`、`config/schema.ts`）已更新
4. 测试覆盖率已补充
5. `docs/PROTOCOL_BRIDGE.md` 已更新（如果线格式有变更）
6. `docs/CHANGELOG.md` 已添加条目

## 设计系统规则（高层）

使用现有的设计标记（`src/styles/tokens.css`，暗色优先，支持亮色/系统主题）和基础组件（`src/features/design-system/primitives/*`）构建共享壳层。不要在功能 CSS 中重复定义已存在的弹窗/提示/面板/浮层样式。所有视图通过 CSS Modules 消费 `token`（内联样式不硬编码颜色值）。

详见现有设计系统文件和 `DesignSystemView` 目录。

## 安全与 Git 行为

- 优先使用安全的 git 操作（`status`、`diff`、`log`）
- 不要重置或撤销无关的用户变更
- 如果存在无关变更，继续专注自有文件，除非这些变更影响正确性
- 如果冲突影响正确性，指出问题并选择最安全的路径
- 修复根本原因，不要打补丁
- **子模块核心**：不要直接修改 `reflect-agent/crates/reflect-*`；修改 Reflect-Agent 仓库后用 `git submodule update --remote` 升级（详见 `SUBMODULE.md`）

## 验证矩阵

根据触碰的范围运行验证：

- 始终运行：`pnpm typecheck`
- 前端行为/状态/hooks/组件：`pnpm test`
- Rust 后端变更：`cd src-tauri && cargo check`
- 迭代时使用定向测试，而不是全量测试
- **发布前**：`bash tests/run_all.sh`（分层发布门禁，见 `tests/README.md`）

## 发布门禁（分层）

`tests/run_all.sh` 是发布阶段的**唯一**功能审查入口。退出码 0 = 允许发布。
四层各自独立可跑：

| 层 | 命令 | 测什么 | 后端真伪 |
|---|---|---|---|
| L1 静态审查 | `bash tests/run_all.sh static` | 命令面四方一致、路由↔视图、版本四处一致、文档新鲜度、仓库卫生、文件大小预算棘轮 | 静态 |
| L2 前端行为 | `bash tests/run_all.sh frontend` | `tsc --noEmit` + vitest 全量 | **模拟**（`fakeBackend`） |
| L3 真后端能力覆盖 | `bash tests/run_all.sh backend` | `cargo fmt` / `clippy` / `cargo test`（含能力覆盖层） | **真** |
| L4 发布产物 | `bash tests/run_all.sh artifact` | `.app` 结构 / Info.plist / 资源已嵌入 / 签名 / 无开发残留 | 真产物 |

- **L2 与 L3 都要有**：L2 的后端是模拟的 —— 模拟后端的 bug 会把真后端的
  bug 遮住。L3 用 `tauri::test` mock runtime 驱动**生产同一份**
  `generate_handler!` 注册表（`reflect_desktop_lib::configure`）里的**真实
  命令体**，不经前端 `invoke` 包装、不经 `fakeBackend`。
- 能力覆盖层在 `src-tauri/tests/ipc_*.rs`，共享夹具
  `src-tauri/tests/common/mod.rs`（HOME / REFLECT_HOME / cwd 全部沙箱化）。
- 覆盖口径（哪个能力域由哪层验、哪些显式排除及理由）见
  [`tests/COVERAGE.md`](tests/COVERAGE.md)。
- 报告落在 `.test-results/release-review.md`。

## 快速运行手册

核心本地命令（日常使用）：

```bash
pnpm install
pnpm tauri dev                # 开发模式（HMR）
pnpm test                     # vitest
pnpm typecheck                # tsc --noEmit
cd src-tauri && cargo check   # Rust 类型检查
bash tests/run_all.sh         # 发布门禁（静态 + 前端 + 真后端 + 产物）
```

发布构建：

```bash
pnpm tauri build              # 全平台构建
pnpm tauri build --bundles app  # 仅 macOS .app
bash scripts/install.sh       # → /usr/local/bin/reflect-desktop + ~/Applications/ReflectDesktop.app
```

子模块升级（当 Reflect-Agent 发布新版本时，详见 [`SUBMODULE.md`](SUBMODULE.md)）：

```bash
git submodule update --remote reflect-agent
git diff --submodule reflect-agent
git add reflect-agent && git commit -m "chore: bump reflect-agent submodule"
```

> 历史：本仓库曾用 `vendor/` + `scripts/vendor-sync.sh`（rsync 手动同步）复用核心 crate，
> 已迁移为 git submodule。旧的 vendor 运行手册不再适用。

定向测试运行：

```bash
pnpm test -- src/features/settings/SettingsView.test.tsx
```

## 高频变更文件

以下文件变更频繁或复杂度高，需格外注意：

- `src-tauri/src/lib.rs` — Tauri 构建器 + 命令处理器注册（`invoke_handler` 列出 `src-tauri/src/commands/mod.rs` 导出的所有 `reflect_*` 命令）
- `src-tauri/src/state.rs` — AgentThread 宿主；安装时机很重要

## 大文件例外说明（≥500 行理由）

结构重构目标是：自有生产文件 `≤ 500 行`。当前代码库中没有生产入口文件超过此阈值。

结构拆分的子模块有意允许较小规模，此处不加例外条款；大小约束的主要单元是每领域的公共入口（`commands/<domain>.rs`、`stores/agent/index.ts` 等）。

如果未来某个生产入口需要超过 500 行，需在此文档说明理由，并优先将领域逻辑拆到 `app-core/` 独立模块、宿主编排逻辑拆到 `src-tauri/src/state/` 子模块，而非在同一文件内进行机械切片。

- `src-tauri/src/commands/mod.rs` — 薄桶模块，重新导出各领域命令体（`commands/{agent,allowlist,config,export,files,git,hooks,memory,search,sessions,shell,skills,update,workspaces}.rs`，实际命令体在这些文件中，子 `mod.rs` 仅保留模块布线）
- `src-tauri/src/events.rs` — 事件转发器，单一通道
- `src/stores/agent/store.ts` — 活跃的 Zustand 存储；`src/stores/agent/index.ts` 重新导出 `useAgentStore` / `reduceEvent` / `useAgent` 和类型联合；面向用户的兼容入口是 `src/stores/agentStore.ts`，从 `./agent` 重新导出
- `src/features/shell/AppShell.tsx` — IDE 五窗格布局；侧边栏/检查器切换，会话路由。有状态的壳交互提取到 `src/features/shell/hooks/useCommandPaletteShortcut.ts`、`usePaletteActions.ts`、`useThemeCycle.ts`
- `src/features/messages/MessageList.tsx` — 聊天渲染 + 可折叠项（Composer 现已移至 `src/features/composer/Composer.tsx`；`src/features/messages/Composer.tsx` 是薄重新导出层）
- `src/utils/bridge.ts` — 底层 `invoke` / `listen` 带降级；`src/utils/tauri.ts` 和 `src/utils/commands.ts` 是兼容桶；新包装写入 `src/utils/commands/{domain}.ts`
- `src/utils/i18n.ts` — 兼容桶；运行时拆分为 `src/utils/i18n/{context.tsx,locale.ts,interpolate.ts,lookup.ts,types.ts}` 和 `src/utils/i18n/strings/index.ts`，合并领域目录下的字符串文件
- `src/router.tsx` — TanStack Router 路由表
- `src/styles/tokens.css` — 设计标记；暗色/亮色/系统主题——单一事实来源
- `scripts/vendor-sync.sh` — **已移除**（vendor 模式已迁移为 submodule）。核心升级见 `SUBMODULE.md`
- 视图/控制器拆分：`src/features/terminal/TerminalView.tsx` 读取 `src/features/terminal/useTerminalController.ts`；`src/features/memory/MemoryView.tsx` 读取 `src/features/memory/useMemoryController.ts`；`src/features/modals/index.tsx` 编排 `ApprovalModal` / `QuestionModal` / `AskUserModal` / `PlanReadyModal`，实现位于同目录

## 规范引用

- 面向任务的代码地图：`docs/codebase-map.md`
- 协议信封：`docs/PROTOCOL_BRIDGE.md`
- 架构文档：`docs/ARCHITECTURE.md`
- 构建/发布/测试命令：`README.md`
- 更新日志：`docs/CHANGELOG.md`
- GUI 设计历史：`docs/gui/00-index.md`