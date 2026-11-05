# ZhuYe GUI 规划总览（已归档）

> ⚠️ **本文档为 M1 阶段设计稿快照。** 实施蓝图与决策已迁移：
>
> - 任务规格 → `docs/todo/21-gui/`（按里程碑组织）
> - 当前实现 → [`../../codebase-map.md`](../../codebase-map.md) + [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)
> - 协议面 → [`../../PROTOCOL_BRIDGE.md`](../../PROTOCOL_BRIDGE.md)
> - 实施进度 → [`../../CHANGELOG.md`](../../CHANGELOG.md)
>
> 此处文件保留作为「决策溯源 + TUI 复用思路」参考。新读者请从仓库根的 `README.md` + `docs/codebase-map.md` 进入。

---

## 1. 历史背景

M1 启动时（2026-06）ZhuYe 已稳定 v1.0.0-rc1，TUI 成熟（~18k LoC ratatui+crossterm、47 slash 命令、22 段状态栏）但 GUI 缺位。本目录沉淀 Reflect GUI 方案蓝图，为后续 `crates/reflect-gui/` 实施提供设计依据。

终端形态天然局限：

| 局限 | 影响 |
|---|---|
| 无原生富文本渲染 | Markdown / 代码高亮 / 工具结果内嵌图像只能 ASCII 近似 |
| 单 viewport | 任务面板与 chat 共享屏幕，不能同时阅读历史 + 待办 |
| 鼠标支持弱 | Copy Mode 是 workaround，原生体验差 |
| 无桌面通知 | 后台 turn 完成用户感知不到 |
| 图像/语音附件受限 | `ImageViewTool` 只能提示存在，无法预览 |
| 移动端/网页远程访问 | 完全无 |

引入 GUI 前端的目的：**补足桌面体验、扩展分发渠道**，不替换 TUI。

---

## 2. 已落地的关键技术选型

| 维度 | 选型 | 主要依据 |
|---|---|---|
| **桌面框架** | **Tauri 2** | 与 Rust reflect-* crate 同生态；体积 < 15MB（vs Electron >100MB）；复用 `reflect-protocol` EventMsg/Op 作为 IPC payload 零序列化 |
| **前端** | React 19 + Vite + TypeScript | 社区验证 |
| **状态管理** | Zustand | 轻量；TS 友好（实施中，部分 feature 仍 local state） |
| **样式** | Tailwind + Radix UI | 待落地（当前直接 CSS） |
| **Markdown** | react-markdown + Shiki | 实施中 |
| **代码高亮** | Shiki | VSCode 同款；多语言；按需加载 grammar |
| **虚拟列表** | @tanstack/react-virtual | 已装，待启用 |
| **Tauri 插件** | `tauri-plugin-global-shortcut` 已启用；其余（`updater` / `dialog` / `fs` / `opener` / `process` / `store` / `notification`）按需添加 | |

---

## 3. 接入核心思想（4 个一句话总结）

1. **协议即 IPC**：`reflect-protocol` 的 `EventMsg` + `Op` 已经是稳定、serde 友好、additive 演化的消息总线 —— 直接拿来做 Tauri commands/events 的载荷，零序列化成本、零侵入。详见 [`../../PROTOCOL_BRIDGE.md`](../../PROTOCOL_BRIDGE.md)。
2. **后端单例化**：`reflect-core::AgentThread` 通过 `Arc` 共享，TUI 已经这么用 —— GUI 后端也是同一份（当前 M2.x stub，M3.x 真后端）。
3. **Services bundle 共享**：TUI 已有的 `Services { skills_catalog, task_manager, memory_store, ... }` 可以原封不动注入到 GUI 的 `AgentThread`。
4. **状态机直接复用**：`PendingApproval` / `PendingQuestion` / `PlanModeState` 等 TUI 内部 Rust 类型本身就是 UI-agnostic，**GUI 直接持有同一份类型**。

---

## 4. 文档地图（本目录）

| 文件 | 内容 | 状态 |
|---|---|---|
| [`00-index.md`](00-index.md) | 本文件 | 入口 + 决策溯源 |
| [`02-integration.md`](02-integration.md) | 历史协议接入方案（918 行设计稿） | **归档参考** —— 实施以 [`../../PROTOCOL_BRIDGE.md`](../../PROTOCOL_BRIDGE.md) 为准 |
| [`03-architecture.md`](03-architecture.md) | 架构设计 + crate 划分 | 设计稿保留 |
| [`04-roadmap.md`](04-roadmap.md) | 三阶段路线图 + ADR | 设计稿保留 |
| [`05-decision.md`](05-decision.md) | 决策记录（活态） | 维护中 |
| [`USER_GUIDE.md`](USER_GUIDE.md) | GUI 用户手册 | 维护中 |

---

## 5. 后续动作（按当前实施进度）

实施时按以下顺序推进（**截至 M2.x 末**）：

1. ✅ **M1.1–M1.8**：scaffold + protocol bridge + 三栏 + composer + modal + statusbar → 已完成
2. ✅ **M2.x**：真后端（`reflect_core::AgentThread` + stub model + `EchoTool`）+ 4 product linkages（tray/menu/shortcut/dock）+ macOS close-to-tray
3. 🔧 **M3.x**：接 22 builtin tools + 真 model registry + Streamdown 流式 + 多 session LRU + cost ring
4. 📅 **C4 阶段**：独立 `reflect-agent-gui` binary + dual-binary install

每阶段产物落地后，更新 [`../../CHANGELOG.md`](../../CHANGELOG.md)。