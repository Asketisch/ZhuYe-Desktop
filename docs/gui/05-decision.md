# GUI 实施决策摘要（Decision Record）

> ⚠️ **归档快照**。本目录（`docs/gui/`）已沉淀 GUI 选型与蓝图（`00-index.md` ~ `99-references.md`）；现行实施状态见 [`../../changelog.md`](../../changelog.md) 与 [`../codebase-map.md`](../codebase-map.md)。
>
> 文中引用的 `docs/todo/21-gui/` 目录已不存在（任务规格并入 changelog 版本条目），相关链接视为历史标记不再有效。

---

## 1. 决策

| 项 | 选型 | 备选 | 决策日 |
|---|---|---|---|
| 桌面框架 | **Tauri 2** | Electron / 原生 wry+tao | 2026-07-07 |
| 前端栈 | React 19 + Vite + TypeScript | Vue / Svelte / Solid | 2026-07-07 |
| 状态管理 | Zustand | Redux Toolkit / Jotai / 内置 useReducer | 2026-07-07 |
| 样式 | Tailwind + Radix UI | CSS Modules / styled-components | 2026-07-07 |
| Markdown | **M1** react-markdown + Shiki；**M2** 升 Streamdown | 都自研 | 2026-07-07 |
| 后端共享 | 复用 `reflect-core::AgentThread`(直接 in-process) | 单写 GUI 后端 | 2026-07-07 |
| 进程拓扑 | **单进程 Tauri shim**（无 daemon child process） | spawn `reflect-agent-daemon` over NDJSON | 2026-07-07 ✓ |
| 二进制 | 最终 dual binary： `reflect`(CLI/TUI) + `reflect-agent-gui`(Tauri 桌面);独立安装；C4 阶段实现 | 单 binary dispatch | 2026-07-07 |
| MVP 范围 | 完整 M1.1–M1.8（~4 周单人） | 砍模态/砍 sidebar/砍 modal | 2026-07-07 |

**依据**：
- Tauri 2 + React 19 + Vite + TS 已验证路径可行（macOS / Linux / Windows / iOS）
- Tauri 与 Reflect Rust 后端同语言，可直接以 `reflect-protocol::EventMsg`/`Submission` 作为 Tauri command/event 载荷（**零序列化**）
- Electron 代价：binary > 100MB、需额外 Node ↔ Rust 进程边界 stdio NDJSON 通信
- 详细架构见 `03-architecture.md`；蓝图见 `04-roadmap.md`；特性清单见 `01-features.md`；接入方案见 `02-integration.md`

**进程拓扑决策反思（2026-07-07 晚）**：

独立 daemon 进程(=独立 binary + NDJSON over stdio)与行业现有远程 daemon 形态一致，但当前 Rust 端 `reflect-core`/`reflect-*` 仍在快速迭代，**协议层 & state shape 还会变**。当前强行做 daemon 会陷入 envelope 与 in-process state shape 双重维护。因此：

- 现在：GUI 直接 in-process 持有 `AgentThread`（M1.x 的 MinimalAgent stub 后续 PR 替换为真实 `reflect_core::AgentThread::new` + 22 builtin tools + ConfigWatcher + 完整 bootstrap 链）
- 后续（reflect-core 冻结后）：抽 `reflect-runtime` crate → spawn `reflect-agent-daemon` → Tauri shim 变 thin RPC client。状态机本身未改，仅位置换了。

详见 [`../todo/21-gui/10-strategy.md`](../todo/21-gui/10-strategy.md)（策略调整背景）。

---

## 2. 任务入口

| M | spec | 工期 | 状态 |
|---|---|---|---|
| M1.1 | [→](../todo/21-gui/01-mvp-scaffold.md) | 5 天 | ✅ 已完成（脚手架 + ReflectAgentApp 占位 + 5 icon） |
| M1.2 | [→](../todo/21-gui/02-protocol-bridge.md) | 4 天 | ✅ 已完成（Tauri commands + Event 转发 + 4/4 E2E） |
| M1.3 | [→](../todo/21-gui/03-three-pane-layout.md) | 3 天 | ✅ 已完成（三栏 + Session 列表占位） |
| M1.4 | [→](../todo/21-gui/04-chat-render.md) | 5 天 | 🔧 在编（B3 features/messages 深化） |
| M1.5 | [→](../todo/21-gui/05-composer-slash.md) | 4 天 | 🔧 在编（B4 features/composer 深化） |
| M1.6 | [→](../todo/21-gui/06-modals.md) | 4 天 | 🔧 在编（B5 features/modals 深化） |
| M1.7 | [→](../todo/21-gui/07-statusbar-settings.md) | 3 天 | 🔧 在编（B6 features/statusbar + settings 深化） |
| M1.8 | [→](../todo/21-gui/08-mvp-polish.md) | 2 天 | ✅ macOS 体验部分 + USER_GUIDE |

第二批（M2.1–M2.11）+ 第三批（M3.1–M3.10）暂不写 spec，按需在 M1 通过后再补。

---

## 3. 与现有管道的关系

| 目录 | 是否修改 |
|---|---|
| `docs/user-guide.md` | M1.8 阶段追加 GUI 使用章节（不改原内容） |
| `docs/TODO.md` | 功能规划 |
| `docs/tui/` | 不改；TUI 保留 |
| `docs/done/16-ui/` | 不改；GUI 工作流不进 done 管道 |
| `docs/todo/` ← 21-gui 子目录 | 新增入口 |
| 根 `Cargo.toml` | 新增 workspace members `reflect-gui` + `reflect-app-core` |

---

## 4. 一句话总结

**Tauri 2 + React 19 + Vite + TS + 在编 in-process `reflect-core::AgentThread` 已确定。沿用 `04-roadmap.md` M1.1–M1.8，按 docs/todo/21-gui/ 顺序推进。**
