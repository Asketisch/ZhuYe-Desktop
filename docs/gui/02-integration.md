# Reflect → GUI 接入方案（设计稿 · 已归档）

> ⚠️ **本文档为 M1 设计稿快照**（918 行）。完整权威文档已迁移到 [`../../protocol-bridge.md`](../../protocol-bridge.md)（32 events + 15 ops + id pairing + version compat）。本文保留作为决策溯源 + TUI 复用思路参考。
>
> **新增/修改请改 `../../protocol-bridge.md`，本文不再维护。**

---

## 1. 设计原则（仍有效）

`reflect-protocol` 的 `EventMsg`（32 variant）+ `Submission`（含 14 种 `Op`）已经是稳定、serde 友好、additive 演化的消息总线。直接拿来做 Tauri commands/events 的载荷，**零序列化成本、零侵入**。权威映射表见 [`../../protocol-bridge.md`](../../protocol-bridge.md)。

---

## 2. 设计稿期间讨论过的接入方案（保留）

> 这些是 M1 设计时的方案考量，最终实施按 `protocol-bridge.md`。保留供回溯。

### 2.1 后端单例化（采用）

- `reflect-core::AgentThread` 通过 `Arc` 共享（`vendor/reflect-core/src/agent_thread.rs`）
- TUI 已这么用；GUI 后端也是同一份
- **当前状态（M2.x）**：`src-tauri/src/state.rs::MinimalAgent` 持有 `Arc<AgentThread>` + `tokio::sync::broadcast` 多订阅 fan-out

### 2.2 Services bundle 共享（采用）

TUI 已有的 `Services { skills_catalog, task_manager, memory_store, permission_store, permission_resolver, model_fallback }` 可以原封不动注入到 GUI 的 `AgentThread`。**实施节奏**：M3.x 接入完整 services；当前 M2.x 仅 stub。

### 2.3 状态机直接复用（部分采用）

- `PendingApproval` / `PendingQuestion` / `PendingAskUser` / `ForkSelectState` / `PlanModeState` 等 TUI 内部 Rust 类型本身就是 UI-agnostic
- **当前状态**：M1.x 仅前端 modal 壳子（`features/modals/`），未复用 Rust 状态机
- **M3.x 计划**：reducer 抽取 + 共享 crate（见 [`03-architecture.md`](03-architecture.md) §2.2 `reflect-app-core`）

### 2.4 reducer 抽取建议（设计稿 · 部分超期）

设计稿原计划把 `crates/reflect-tui/src/app.rs`（9692 行）的 reducer 抽成纯函数 `(state, event) → state'`。**实际项目结构已变化**：

- ReflectDesktop 通过 `vendor/reflect-*` mirror 工作
- `app-core/` 已落地（独立 crate，不再 fork TUI）
- 当前实施：**前端** reducer (`useAgent` + `handle_event` in `services/agent.ts`) + **后端** Rust reducer (`reflect_core::AgentThread` 内置)

原 11.1–11.6 reducer 抽取章节（文件级拆分步骤）已与现状脱节，仅作历史参考保留。具体见 [`03-architecture.md`](03-architecture.md) §2。

---

## 3. 决策溯源：被否定的方案

| 方案 | 否定理由 |
|---|---|
| ❌ 新建 `reflect-ipc` crate | 直接用 Tauri command/event 即可，每个 command 是一个 `async fn` 包装 `AgentThread::submit`，加 IPC 抽象层是冗余 |
| ❌ spawn `reflect-agent-daemon` over NDJSON（独立子进程） | 当前 Rust 端 `reflect-core`/`reflect-*` 仍在快速迭代，协议层 & state shape 还会变；强行做 daemon 会陷入 envelope 与 in-process state shape 双重维护。**策略**：先 in-process 持有 `AgentThread`（M2.x 已实现）；reflect-core 冻结后再抽 `reflect-runtime` crate → spawn daemon。详见 [`05-decision.md`](05-decision.md) §1 |
| ❌ 前端自研 markdown 渲染器 | 引入 `streamdown`（M2.1 升级）+ `react-markdown` + Shiki 足够 |
| ❌ 单 binary dispatch（GUI/TUI 同 binary） | 最终 dual binary: `reflect`（CLI/TUI）+ `reflect-agent-gui`（Tauri 桌面），独立安装，C4 阶段实现 |

---

## 4. 一句话总结（不变）

**复用 `reflect-protocol::Event` / `Submission` 作为 IPC 载荷，Tauri shim 是薄薄一层；GUI 与 TUI 共享 `reflect-core::AgentThread` + Services bundle，不重复实现业务层。**

详见：

- 当前实施 → [`../../codebase-map.md`](../../codebase-map.md)
- 协议面 → [`../../protocol-bridge.md`](../../protocol-bridge.md)
- 架构 → [`../../architecture.md`](../../architecture.md)
- 路线图 → [`04-roadmap.md`](04-roadmap.md)
- 决策记录 → [`05-decision.md`](05-decision.md)