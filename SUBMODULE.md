# Reflect-Agent Submodule 复用指南

本仓库(烛夜桌面端 ZhuYe)通过 **git submodule** 复用烛夜上游仓库（[ZhuYe](https://github.com/Asketisch/ZhuYe)，原 Reflect-Agent）的核心 crate。本文件取代旧的 `vendor-sync.sh` 手动同步流程。

> 历史:本仓库之前用 `vendor/` 目录 + `scripts/vendor-sync.sh`(rsync 手动同步 21 个 crate)。该方式无版本指针、同步易漂移,已于本次重构迁移为 git submodule。

## 架构原理

```
ZhuYe Desktop (本仓库,workspace 消费端)
  ├─ app-core/        (Desktop 自有:UI 无关领域服务层,activity / kms / media / squad / side-channel / tailscale / autopilot)
  ├─ src-tauri/       (Tauri 后端,嵌入 reflect_core::AgentThread)
  └─ reflect-agent/   (submodule → Reflect-Agent 仓库)
       └─ crates/{protocol,abilities,resources,orchestration,integrations,runtime}/zhuye-*
```

**关键约束**:Cargo 不支持嵌套 workspace。本仓库**不**把核心 crate 列入 `workspace.members`,而是用 `path` 依赖引用(`reflect-core = { package = "zhuye-core", path = "reflect-agent/crates/runtime/zhuye-core" }`)。

⚠️ 核心 crate 用 `workspace = true` 继承依赖,会解析到**本仓库**根 `workspace.dependencies`。因此 `[workspace.dependencies]` 必须完整声明核心 crate 引用的全部 zhuye-* 与外部依赖。

桌面端用 Cargo 包别名保留 `reflect_*` Rust 导入；**数据目录以 submodule 为准**：用户级 `$ZHUYE_HOME` > `$HOME/.zhuye`，工作区级 `<workspace>/.zhuye/`。没有兼容 feature，也不改环境变量。

`app-core/src/paths.rs` 是这条解析规则的唯一入口（`user_data_dir` / `user_data_path` / `project_data_dir`）。桌面自有状态文件必须经它取路径，不要再自拼目录名，否则 GUI 与 agent 会各自读写一套数据。

一处例外：会话 rollout 树走 `reflect_rollout::path::default_base()`，它只认 `$HOME`（不读 `ZHUYE_HOME`）。因此**必须与 sessions 同树**的目录（归档 `sessions-archive`）从它的父目录派生，而不是走 `user_data_dir()`——设置了 `ZHUYE_HOME` 时两者不同根，归档会找不到会话。

## 日常操作

### 克隆(带 submodule)

```bash
git clone --recursive https://github.com/Asketisch/ReflectDesktop.git
```

### 已克隆仓库初始化

```bash
git submodule update --init --recursive
```

### 升级核心到最新

```bash
git submodule update --remote reflect-agent
git diff --submodule reflect-agent
git add reflect-agent
git commit -m "chore: bump reflect-agent submodule"
```

### 本地联调核心改动

```bash
# 改核心 → push → 本仓库 pull
cd ../Reflect-Agent
# ... 改代码 ...
git push
cd ../ReflectDesktop
git submodule update --remote reflect-agent
```

### 升级核心后的适配检查

核心升级可能引入协议/结构变更。若 `cargo check` 报错,常见适配点:

- `EventMsg` 新增 variant → `src-tauri/src/state/activity.rs` 的 match 补全
- `Op` 变体形态变更 → `src-tauri/src/commands/` 的命令封装适配
- `AgentDefinition` 字段变更 → `src-tauri/src/commands/agents.rs` 适配
- `RolloutRecord` 新增 variant / 字段 → `src-tauri/src/commands/export.rs`
  的 match 补全

> **注意**:`cargo check` 不编译 `#[cfg(test)]` 代码 —— 协议结构变更
> 可能只在 `cargo test` 时才暴露编译错误。升级核心后两个命令都要跑
> (`cargo check` + `cargo test`)。同理,前端 `pnpm typecheck` 不覆盖
> 测试文件,需补跑 `pnpm test`。

## 当前 submodule 指针

```bash
git submodule status reflect-agent
```

submodule 默认跟踪 Reflect-Agent 的 `main` 分支(`git submodule update --remote` 拉取其最新提交)。

## 旧 vendor 模式迁移记录

本次迁移(vendor → submodule)顺带修复的版本漂移:
- 移除 `reflect-async-graph` 死声明(该 crate 在 Reflect-Agent 已不存在)
- `Op::Interrupt` 升级为 struct variant `{ child_id }`
- `Op::PlanApproval` 字段 `decision` → `choice`(类型 `PlanApprovalChoice`)
- `EventMsg` 新增 `PlanStep` / `PluginLoaded` / `QuotaExhausted`
- `AgentDefinition` 移除 `max_result_chars` 字段
