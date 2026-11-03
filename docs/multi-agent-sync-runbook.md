# 多 Agent / 核心子模块升级运行手册

> 升级 `zhuye-agent/` submodule 到上游 `Reflect-Agent` 新版本的权威清单。
> （历史说明：本仓库曾用 `vendor/` + `scripts/vendor-sync.sh` 同步核心 crate，
> 已迁移为 git submodule，旧 vendor 流程不再适用。）

## 何时升级

- Reflect-Agent 发布新版本（标签 `v*`）。
- `reflect-protocol` / `reflect-core` / `reflect-rollout` 等落地了影响 GUI 行为的修复。
- 新增了 `Op` / `EventMsg` 变体（前端类型需要重新生成）。

## 预检

1. 确认上游提交在我们想要跟踪的分支上（默认 `main`）。
2. 升级前运行本地测试套件，记录基线：

   ```bash
   pnpm test
   cd src-tauri && cargo test --workspace
   ```

## 升级流程

```bash
# 1. 拉取最新核心（submodule 跟踪 Reflect-Agent 默认分支）
git submodule update --remote zhuye-agent

# 2. 审查差异
git diff --submodule zhuye-agent
git diff zhuye-agent/crates/protocol/zhuye-protocol/src/

# 3. 如果 reflect-protocol 有变更，重新生成前端类型
bash scripts/dump-ts-types.sh

# 4. 重建验证
pnpm install
cd src-tauri && cargo check
pnpm test
pnpm typecheck
pnpm tauri build --bundles app

# 5. 提交
git add zhuye-agent src/types/protocol.ts
git commit -m "chore: bump zhuye-agent submodule (<原因>)"
```

## 冲突策略

- **zhuye-agent/**：submodule 只读镜像，绝不直接编辑。如果需要热修复，
  先在 Reflect-Agent 仓库打补丁，再 `git submodule update --remote` 升级。
- **src/types/protocol.ts**：从 schema 重新生成；除非绝对必要否则不手工编辑。
- **app-core/**：GUI 和 Tauri 适配层共享；如有变更需与上游协调。

## 什么可能出问题

| 症状 | 原因 | 修复 |
|---|---|---|
| `cargo check` 报 match 不穷尽 | `reflect-protocol` 新增 `EventMsg` / `RolloutRecord` 变体 | 在 `src-tauri/src/state/activity.rs` 补全 match 分支 |
| 前端丢弃事件 | 前端 reducer 缺少新变体 | 运行 `bash scripts/dump-ts-types.sh` 后在 reducer 补全 |
| `invoke('reflect_submit')` 报错 | Tauri 命令签名漂移 | 将 `src-tauri/src/commands/` 与新 `Op` 变体同步 |

## 回滚

如果升级破坏了 GUI：

```bash
git revert <升级提交-sha>
pnpm install
cd src-tauri && cargo check
```

然后在上游提交 issue 描述问题。

## 相关文档

- submodule 复用指南（克隆/初始化/本地联调）：[`../SUBMODULE.md`](../SUBMODULE.md)
- 架构（submodule 原理）：[`ARCHITECTURE.md`](ARCHITECTURE.md)
- 代码库地图（路径）：[`codebase-map.md`](codebase-map.md)
- 协议信封：[`PROTOCOL_BRIDGE.md`](PROTOCOL_BRIDGE.md)
