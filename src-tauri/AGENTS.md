# src-tauri/ —— Tauri 应用外壳与命令层

> **何时读我**：改 Tauri 后端前读我：动命令表进 [src/commands/AGENTS.md](src/commands/AGENTS.md)，动 AgentThread 宿主进 [src/state/AGENTS.md](src/state/AGENTS.md)，动 UI 无关领域服务进 [../app-core/AGENTS.md](../app-core/AGENTS.md)。

## 层定位

本目录是 Tauri 2 适配层：`zhuye_core::AgentThread` 的薄宿主 + IPC 命令表 + OS 集成，不承载领域逻辑（架构红线见根 [AGENTS.md](../AGENTS.md)「架构」）。crate `zhuye-desktop`、lib 名 `zhuye_desktop_lib`、bin `zhuye-desktop`（见 `Cargo.toml`）；`src/main.rs` 仅调 `zhuye_desktop_lib::run()`。

## 子区速览

| 子区 | 职责 | 进它读哪篇 |
|---|---|---|
| `src/commands/` | 全部 `zhuye_*` 命令体 + `CommandError`，按领域拆文件 | [src/commands/AGENTS.md](src/commands/AGENTS.md) |
| `src/state/` | `MinimalAgent` facade：宿主/安装/提交/换绑/热重载 | [src/state/AGENTS.md](src/state/AGENTS.md) |
| `src/lib.rs` | `run()`（菜单/setup/事件循环）；`configure()` 经 `pub use commands_registry::configure` 透出 | 本篇「层通用规则」 |
| `src/commands_registry.rs` | 共享命令注册表本体：`use commands::{…}` 全量导入 + `invoke_handler!` 注册表 + 插件/托管状态/窗口事件（生产与测试共用，命令面只增一次） | 本篇「层通用规则」 |
| `tests/` | 能力覆盖层 `ipc_*.rs` + 共享夹具 `tests/common/mod.rs` | [../tests/COVERAGE.md](../tests/COVERAGE.md) |
| `../app-core/` | UI 无关领域服务（本层消费，不放本层） | [../app-core/AGENTS.md](../app-core/AGENTS.md) |

### 顶层支撑文件速览

| 文件 | 一句话职责 |
|---|---|
| `src/browser_backend.rs` + `src/browser_backend/` | 浏览器进程与页面会话：CDP 帧流确认、最近帧重放、导航、持久连接上的设备尺寸与输入注入；输入字段使用 camelCase，重新挂载面板需先订阅再调用幂等启动以重放最近帧 |
| `src/events.rs` | 事件转发器：前台 `zhuye_event` + 后台 `zhuye_session_event` 两通道；Lagged 缺口另发 `zhuye_event_gap` 合成通知（v1.12，前端触发重放收敛） |
| `src/agent_state.rs` | 活跃 agent 定义选择（当前生效的 agent def） |
| `src/mcp.rs` | MCP/LSP 运行时接入 |
| `src/menu.rs` | 应用菜单 + macOS close-to-tray 处理 |
| `src/tray.rs` | macOS 托盘（icon32.png 模板图） |
| `src/shortcut.rs` | 全局快捷键 |
| `src/dock.rs` | macOS dock 徽标 |
| `src/media_backend.rs` | 真实 Media/Computer Use 后端（xcap/enigo，实现 app-core media trait） |
| `src/hook_store.rs` | hook 启停偏好持久化 |
| `src/memory_store.rs` | Memory ↔ MEMORY.md（`memory_store/tests.rs` 就位测试） |
| `src/shell_sessions.rs` | 仅类型锚点，实现已收编上游 `zhuye_shell` |
| `src/workspace_state.rs` | 全局工作区路径覆盖（`Lazy` 单例）+ 启动恢复上次工作区（`restore_last_used`，setup 首行调用） |
| `src/persistence.rs` | 桌面状态文件完整写入/替换 |
| `src/status_server.rs` | Tailscale 远程状态 HTTP 端点 |

## 层内依赖约定

- 依赖 submodule 核心 crate（`zhuye-*` path 依赖别名；`zhuye-agent/` 不入 workspace members，见根 `Cargo.toml`）与 `app-core`。

## 跨层边界

- 领域逻辑不写入本层，下沉 `app-core/` 或上游 crate（判定与升级流程见 [../SUBMODULE.md](../SUBMODULE.md)）。
- 事件只经 `src/events.rs` 转发到单一 `zhuye_event` 通道，禁止在命令体或支撑文件里自建 `app.emit`（协议不变量见根 AGENTS.md「关键不变量」）。

## 层通用规则

1. `configure()`（`src/commands_registry.rs`，经 lib.rs 透出）只装命令面 + `.manage(MinimalAgent::new_empty())` + 插件 + close-to-tray 窗口事件；`run()` 在其上追加菜单与 setup（托盘/全局快捷键/dock 徽标/`install_agent_thread`/`forward_agent_events`）与 run 事件循环回调（macOS 点击 Dock 图标 → `RunEvent::Reopen` → `reopen_main_window` 唤回主窗口；变体仅 macOS 编译，须 cfg 守卫）。
2. 测试驱动契约（本篇独有）：能力覆盖层夹具 `tests/common/mod.rs::harness()` 必须以 `zhuye_desktop_lib::configure(tauri::test::mock_builder())` 为底座——invoke key 必须匹配，自建 `Builder::new()` 会让命令静默不执行。
3. 应用菜单与 setup 钩子不进共享装配（mock runtime 建 NSMenu / OS 级副作用只在真实事件循环跑）——新增 OS 集成放 `run()`，不要挪进 `configure()`。
4. 新增命令按 [src/commands/AGENTS.md](src/commands/AGENTS.md) 的落点清单走，命令体不写在 `lib.rs`。
5. `install_agent_thread` 时机、broadcast Lagged 容忍等见根 AGENTS.md「关键不变量」。

## 深入阅读

- 根 [AGENTS.md](../AGENTS.md) — 架构 / 开发流程检查表 / 协议不变量
- [../docs/protocol-bridge.md](../docs/protocol-bridge.md) — Tauri ↔ zhuye-protocol 协议信封
- [../tests/COVERAGE.md](../tests/COVERAGE.md) — 能力 → 套件映射（含 `ipc_*.rs` 覆盖口径）
- [../docs/architecture.md](../docs/architecture.md) — 系统架构
