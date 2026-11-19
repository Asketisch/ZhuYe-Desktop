# src-tauri/src/commands/ —— Tauri 命令表

> **何时读我**：新增或修改任何 `reflect_*` Tauri 命令前读我；命令落点清单与 mod.rs 桶结构只在本篇。

## 模块概述

Tauri 命令表全集，按领域一域一文件（领域文件数以目录与 `mod.rs` 声明清单为准，命令总量以 `grep '#\[tauri::command\]'` 结果为准——注意文档注释也会命中，如 `error.rs` 首部注释）。`mod.rs` 是薄桶：46 个领域子模块声明 + `pub use *` 再导出，`sessions` 声明为 `pub(crate)`。

## 核心文件导航

| 文件 | 一句话职责 |
|---|---|
| `mod.rs` | 薄桶：领域子模块声明与再导出（含 `error::{CommandError, CommandResult}`） |
| `error.rs` | `CommandError` / `CommandResult` 统一返回包装 + 各上游错误 `From` impl，无命令体 |
| `agent.rs` | 会话核心：submit / interrupt / compact / rewind / 审批 / plan / goal 模式等 |
| `sessions.rs` | 会话管理：创建 / 重放 / 改名 / 归档 / 导出（最大领域文件，嵌套 `sessions/{name,sidecar,title_commit}.rs`） |
| `tasks.rs` | 任务域命令（创建 / 领取 / 更新 / 输出） |
| `models.rs` | 模型域命令：拉 provider 清单 / 测连通 |
| `model_catalog.rs` | 纯逻辑无命令体：provider `/models` 响应解析 + 免费判定（与 `models.rs` 的命令分工） |

其余领域文件按域分组：代理与团队（`agents` / `subagents` / `squad`）、工具接入（`mcp` / `lsp` / `skills` / `plugins` / `hooks`）、文件与终端（`files`（嵌套 `files/image.rs` 图片附件读取、`files/upload.rs` 上传落盘——webview 字节流文件转工作区 `.zhuye/uploads/` 真实路径）/ `git`（嵌套 `git/status.rs`）/ `shell` / `pty`）、配置与安全（`config`（嵌套 `config/tests.rs`）/ `permissions` / `security` / `kms` / `allowlist`）、观测与后台（`traces` / `stats` / `activity` / `schedule` / `runtime_status`）、媒体与远程（`media` / `remote` / `side_channel` / `autopilot`）。附件选择器（单选 `reflect_pick_file` / 多选 `reflect_pick_files`）在 `workspaces.rs`（tauri-plugin-dialog Rust 侧，不经 JS IPC）。

## 本地契约与同步点

新命令文件级落点（本篇独有，四步缺一即「命令已写但没接线」）：

1. `commands/<domain>.rs` 写命令体（`#[tauri::command]`，返回 `CommandResult`）；
2. `commands/mod.rs` 加 `mod <domain>;` + `pub use <domain>::*;`；
3. `src/lib.rs` 顶部 `use commands::{...}` 导入命令名；
4. `src/lib.rs` `configure()` 的 `generate_handler![...]` 注册。

完整同步链（前端 `src/utils/commands/{domain}.ts`、`docs/protocol-bridge.md`、`docs/changelog.md`、`docs/capabilities.md`、`src-tauri/tests/ipc_*.rs` 测试）按根 [AGENTS.md](../../../AGENTS.md)「开发流程检查表」第 4 条执行，本篇不复述。`configure()` 与测试共注册表的契约见 [../../AGENTS.md](../../AGENTS.md)。

## 禁止事项

- 不要在 `mod.rs` 写命令体——保持声明 + 再导出的薄桶形态。
- 不要绕过 `CommandError` / `CommandResult` 自造错误类型或裸返回 `Result<_, String>` 之外的约定。
- 不要在命令体里写领域逻辑——判定落点（app-core / 上游 crate / 适配层）见根 AGENTS.md「开发流程检查表」。
- 不要跳过 `lib.rs` 的 `use` 导入与 `generate_handler!` 注册任一步。

## 注意事项

- `sessions` 为 `pub(crate)` 模块，外部只经 `lib.rs` 注册表触达，不要再放宽可见性。
- 大领域文件（如 `sessions.rs`）逼近行数预算时按嵌套子模块拆（参照 `sessions/`、`git/status.rs`），不要机械切片（见根 AGENTS.md「约定」）。

## 深入阅读

- 根 [AGENTS.md](../../../AGENTS.md) — 开发流程检查表
- [../../AGENTS.md](../../AGENTS.md) — Tauri 适配层层篇（configure/run 与测试契约）
- [../../../docs/protocol-bridge.md](../../../docs/protocol-bridge.md) — 命令 ↔ Op 映射
- [../../../docs/capabilities.md](../../../docs/capabilities.md) — 基座能力 → GUI 覆盖矩阵
