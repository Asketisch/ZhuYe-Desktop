# app-core/ —— UI 无关领域服务层

> **何时读我**：新增或修改 UI 无关领域服务（media / pipeline / traces / stats / tailscale / discussion）前读我；「重叠实现是否收敛上游」的判定流程只在本篇。

## 层定位

`app-core`（crate `zhuye-app-core`，lib 名 `zhuye_app_core`）是 UI 无关的领域服务层，供 `src-tauri` 命令层复用；渲染状态由前端 TS 负责，本 crate 与 GUI 框架零耦合。关键约束见 `src/lib.rs` 头文档：不依赖 ratatui / crossterm / tauri / iced，且 `#![deny(missing_docs)]`。

## 子区速览

| 模块（`src/`） | 一句话职责 | 备注 |
|---|---|---|
| `config_health.rs` | 配置健康问题代码与级别（模型组口径：没有活跃组 / 活跃组无凭据 → `no-provider`） | 供配置状态命令返回 |
| `media.rs` | Media Studio / Computer Use 的 trait + enum 抽象层 | 真实实现落 `src-tauri/src/media_backend.rs` |
| `pipeline.rs` | DAG 流水线（GUI 对应 CLI `zhuye pipeline`） | |
| `traces.rs` | LLM 调用记录只读查询（数据源 telemetry model-io JSONL） | |
| `stats.rs` | 会话统计只读查询（数据源 rollout JSONL） | |
| `discussion.rs`（+ `discussion_events.rs`，pub(crate)） | 多 agent 讨论编排（GUI 对应 CLI `zhuye discussion`） | |
| `tailscale.rs` | Tailscale 检测与远程主机建议 | |
| `sandbox.rs` | OS 沙箱桌面侧胶水（解析已收编上游 `zhuye_sandbox`） | |
| `prompt_env.rs` | 内置上下文注入 hooks：`AgentsMdHook`（AGENTS.md 项目指令，复刻 `zhuye-exec::builtin_hooks` 同名实现）+ `EnvContextHook`（环境上下文块：工作目录/平台/OS 版本/日期/shell）；`thread_factory` 注册 | 上游 exec crate 拖 clap/opentelemetry 不适合 GUI 依赖，**上游收敛候选**（把 hooks 下沉出 exec 后桌面改用上游版）。AGENTS.md 上限由桌面偏好 `agents_md_max_bytes` 注入（`None` = 不截断，缺省；有值按字符边界截断 + 可见提示） |
| `worktree.rs` | git worktree 域服务：`worktree_list/add/remove/prune` + `WorktreeInfo`（UI 无关），判脏复用 `zhuye_tools::worktree::worktree_dirty` | GUI 用户操作面而非 agent 能力，不上游化；`commands/git.rs` 薄封装 |
| `git_branch.rs` | git 本地分支域服务：`branch_list`（`git for-each-ref refs/heads` 解析）+ `branch_checkout`（分支名校验防选项注入）+ `BranchInfo`（UI 无关） | GUI 用户操作面而非 agent 能力，不上游化；`commands/git.rs` 薄封装，脏树「提交后重试」编排在前端 |
| `activity.rs` | activity 审计：实现已收编上游 `zhuye_telemetry`，本地仅留共享句柄与再导出 | |

## 层内依赖约定

- 只依赖 submodule 的 zhuye-* path 别名 crate 与通用库；`zhuye-agent/` 不入 workspace members（根 `Cargo.toml`，Cargo 不支持嵌套 workspace）。
- 消费方在 `src-tauri/`（15 处，以 `grep zhuye_app_core` 为准）：`state.rs`、`state/{activity,agent,sandbox,submit}.rs`、`media_backend.rs` 及 `commands/{activity,config,discussion,media,pipeline,remote,sandbox,stats,traces}.rs`。
- 依赖清单保持最小化：`Cargo.toml` 只保留模块实际使用的 crate，新增依赖须注明消费方模块。

## 跨层边界

- 不引入任何 UI 框架依赖（ratatui / crossterm / tauri / iced）；渲染状态由前端 TS 负责。
- 不直接修改 `zhuye-agent/`（升级走 [../SUBMODULE.md](../SUBMODULE.md)）；上游能力缺口先补 ZhuYe 仓库再升 submodule，不在本 crate 造平行实现。
- 不把 Tauri 编排逻辑（emit / AppHandle / manage）复制进来——那是 `src-tauri` 适配层的事（见 [../src-tauri/AGENTS.md](../src-tauri/AGENTS.md)）。

## 层通用规则

1. 重叠收敛判定（本篇独有）：动笔前先查上游是否已有同类能力——v0.2 已收敛的对应关系为 actor/squad → `zhuye-task`、autopilot → `zhuye-stream`、kms → `zhuye-kms`、pricing → `zhuye-llm`、activity 实体 → `zhuye-telemetry`、side-channel → `zhuye-core`、paths → `zhuye-config::paths`、sandbox 解析 → `zhuye-sandbox`（清单见 `src/lib.rs` 头文档）。上游已有的，本 crate 只保留桌面装配胶水，不复制实现。
2. 新增领域服务三段落点：模块落 `app-core/src/<domain>.rs` → 命令层 `src-tauri/src/commands/<domain>.rs`（落点清单见 [../src-tauri/src/commands/AGENTS.md](../src-tauri/src/commands/AGENTS.md)）→ 前端 `src/utils/commands/<domain>.ts`；完整同步链按根 [AGENTS.md](../AGENTS.md)「开发流程检查表」执行。
3. 公开项必须有 doc 注释（`deny(missing_docs)`）；模块职责与 GUI/CLI 对应关系写在模块头文档。
4. 上游能力缺口先补 ZhuYe 仓库再升 submodule，不在本 crate 造平行实现。
5. 数据目录路径只经 `zhuye_config::paths`（归档目录从 `zhuye_rollout::path::default_base()` 派生），不自拼目录名（根 AGENTS.md「关键不变量」）。

## 深入阅读

- `src/lib.rs` 头文档 — UI 无关约束与 v0.2 收敛清单
- 根 [AGENTS.md](../AGENTS.md) — 架构 / 开发流程检查表
- [../SUBMODULE.md](../SUBMODULE.md) — submodule 升级流程
- [../docs/codebase-map.md](../docs/codebase-map.md) — 面向任务的代码地图
