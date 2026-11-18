# app-core/ —— UI 无关领域服务层

> **何时读我**：新增或修改 UI 无关领域服务（media / pipeline / traces / stats / tailscale / discussion）前读我；「重叠实现是否收敛上游」的判定流程只在本篇。

## 层定位

`app-core`（crate `reflect-app-core`，lib 名 `reflect_app_core`）是 UI 无关的领域服务层，供 `src-tauri` 命令层复用；渲染状态由前端 TS 负责，本 crate 与 GUI 框架零耦合。关键约束见 `src/lib.rs` 头文档：不依赖 ratatui / crossterm / tauri / iced，且 `#![deny(missing_docs)]`。

## 子区速览

| 模块（`src/`） | 一句话职责 | 备注 |
|---|---|---|
| `media.rs` | Media Studio / Computer Use 的 trait + enum 抽象层 | 真实实现落 `src-tauri/src/media_backend.rs` |
| `pipeline.rs` | DAG 流水线（GUI 对应 CLI `reflect pipeline`） | |
| `traces.rs` | LLM 调用记录只读查询（数据源 telemetry model-io JSONL） | |
| `stats.rs` | 会话统计只读查询（数据源 rollout JSONL） | |
| `discussion.rs`（+ `discussion_events.rs`，pub(crate)） | 多 agent 讨论编排（GUI 对应 CLI `reflect discussion`） | |
| `tailscale.rs` | Tailscale 检测与远程主机建议 | |
| `sandbox.rs` | OS 沙箱桌面侧胶水（解析已收编上游 `reflect_sandbox`） | |
| `activity.rs` | activity 审计：实现已收编上游 `reflect_telemetry`，本地仅留共享句柄与再导出 | |

## 层内依赖约定

- 只依赖 submodule 的 reflect-* path 别名 crate 与通用库；`zhuye-agent/` 不入 workspace members（根 `Cargo.toml`，Cargo 不支持嵌套 workspace）。
- 消费方在 `src-tauri/`（15 处，以 `grep reflect_app_core` 为准）：`state.rs`、`state/{activity,agent,sandbox,submit}.rs`、`media_backend.rs` 及 `commands/{activity,config,discussion,media,pipeline,remote,sandbox,stats,traces}.rs`。
- 依赖清单保持最小化：`Cargo.toml` 只保留模块实际使用的 crate，新增依赖须注明消费方模块。

## 跨层边界

- 不引入任何 UI 框架依赖（ratatui / crossterm / tauri / iced）；渲染状态由前端 TS 负责。
- 不直接修改 `zhuye-agent/`（升级走 [../SUBMODULE.md](../SUBMODULE.md)）；上游能力缺口先补 ZhuYe 仓库再升 submodule，不在本 crate 造平行实现。
- 不把 Tauri 编排逻辑（emit / AppHandle / manage）复制进来——那是 `src-tauri` 适配层的事（见 [../src-tauri/AGENTS.md](../src-tauri/AGENTS.md)）。

## 层通用规则

1. 重叠收敛判定（本篇独有）：动笔前先查上游是否已有同类能力——v0.2 已收敛的对应关系为 actor/squad → `reflect-task`、autopilot → `reflect-stream`、kms → `reflect-kms`、pricing → `reflect-llm`、activity 实体 → `reflect-telemetry`、side-channel → `reflect-core`、paths → `reflect-config::paths`、sandbox 解析 → `reflect-sandbox`（清单见 `src/lib.rs` 头文档）。上游已有的，本 crate 只保留桌面装配胶水，不复制实现。
2. 新增领域服务三段落点：模块落 `app-core/src/<domain>.rs` → 命令层 `src-tauri/src/commands/<domain>.rs`（落点清单见 [../src-tauri/src/commands/AGENTS.md](../src-tauri/src/commands/AGENTS.md)）→ 前端 `src/utils/commands/<domain>.ts`；完整同步链按根 [AGENTS.md](../AGENTS.md)「开发流程检查表」执行。
3. 公开项必须有 doc 注释（`deny(missing_docs)`）；模块职责与 GUI/CLI 对应关系写在模块头文档。
4. 上游能力缺口先补 ZhuYe 仓库再升 submodule，不在本 crate 造平行实现。
5. 数据目录路径只经 `reflect_config::paths`（归档目录从 `reflect_rollout::path::default_base()` 派生），不自拼目录名（根 AGENTS.md「关键不变量」）。

## 深入阅读

- `src/lib.rs` 头文档 — UI 无关约束与 v0.2 收敛清单
- 根 [AGENTS.md](../AGENTS.md) — 架构 / 开发流程检查表
- [../SUBMODULE.md](../SUBMODULE.md) — submodule 升级流程
- [../docs/codebase-map.md](../docs/codebase-map.md) — 面向任务的代码地图
