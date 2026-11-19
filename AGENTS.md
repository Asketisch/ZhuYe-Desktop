# 烛夜 ZhuYe Agent 指南

所有文档必须是规范化的，不包含过时评论，仅保留当前有效状态。

## 项目概览

烛夜（ZhuYe）是烛夜 agent 引擎（上游更名自 Reflect Agent）的桌面 GUI 应用，基于 Tauri 2 + React 19 构建。

- 前端：React 19 + Vite + TanStack Router/Query（`src/`）
- 后端应用：Tauri Rust 进程（`src-tauri/src/lib.rs`）
- 子模块：`zhuye-*` 核心 crate（桌面端使用 `reflect-*` 依赖别名） 通过 git submodule 复用（见 `zhuye-agent/`），升级流程见 [`SUBMODULE.md`](SUBMODULE.md)
- 共享核心：`app-core/`（UI 无关的领域服务层：activity / media / tailscale / traces / discussion / pipeline / sandbox / stats，供 `src-tauri` 命令层复用）

## AGENTS.md 体系导航

桌面端路由页面、主壳、会话侧栏、消息流、输入框、配置健康提示与终端页已拆分为 `src/render/`、`src/logic/` 与 `src/contracts/`。少量共享子面板仍在兼容迁移中。

本体系按**渐进式披露**组织：根篇常驻上下文，目录级篇按需展开，系统级说明放 `docs/`。
**修改任何目录前，先读该目录（或其所在层）的 AGENTS.md。**

| 想了解什么 | 读哪个 AGENTS.md |
|---|---|
| 前端组合根与基础设施（路由 / 协议类型 / 样式 / 测试挂载） | [src/AGENTS.md](src/AGENTS.md) |
| 功能切片（切片布局惯例 / 新切片落点链） | [src/features/AGENTS.md](src/features/AGENTS.md) |
| 代理状态存储（reducer / turns / 兼容层） | [src/stores/AGENTS.md](src/stores/AGENTS.md) |
| IPC 封装与 i18n（领域命令文件 / bridge / 文案挂载） | [src/utils/AGENTS.md](src/utils/AGENTS.md) |
| Tauri 应用外壳（configure / 事件转发 / 托盘 / 菜单） | [src-tauri/AGENTS.md](src-tauri/AGENTS.md) |
| Tauri 命令表（领域命令文件 / 注册落点） | [src-tauri/src/commands/AGENTS.md](src-tauri/src/commands/AGENTS.md) |
| AgentThread 宿主状态（MinimalAgent / state 子模块） | [src-tauri/src/state/AGENTS.md](src-tauri/src/state/AGENTS.md) |
| UI 无关领域服务（app-core 模块 / 上游收敛） | [app-core/AGENTS.md](app-core/AGENTS.md) |
| 构建发版 / 图标 / 版本同步脚本 | [scripts/AGENTS.md](scripts/AGENTS.md) |
| 发布门禁分层与应用级测试 | [tests/AGENTS.md](tests/AGENTS.md) |
| 上游核心 crate（submodule，只读镜像，不在本仓库建篇） | 下方「上游 submodule 体系索引」 · [SUBMODULE.md](SUBMODULE.md) |
| 架构与系统文档（不建篇） | [docs/architecture.md](docs/architecture.md) · [docs/codebase-map.md](docs/codebase-map.md) · [docs/capabilities.md](docs/capabilities.md) · [docs/protocol-bridge.md](docs/protocol-bridge.md) · [docs/changelog.md](docs/changelog.md) · [docs/user-guide.md](docs/user-guide.md)（外链） |
| 三大功能规划（应用自更新 / 内置浏览器 / SSH 远程） | [docs/plans/hot-update.md](docs/plans/hot-update.md) · [docs/plans/browser-control.md](docs/plans/browser-control.md) · [docs/plans/ssh-remote.md](docs/plans/ssh-remote.md) |

### 上游 submodule 体系索引（`zhuye-agent/`，只读）

上游同样采用渐进式分层 AGENTS.md（18 篇 = 根篇 + 6 层篇 + 8 crate 篇 + 3 顶层篇）。本表只索引其**层篇与顶层篇**；crate 级篇目（zhuye-protocol / zhuye-tools / zhuye-llm / zhuye-hooks / zhuye-plugin / zhuye-core / zhuye-exec / zhuye-cli）不在此复录，完整导航见 [zhuye-agent/AGENTS.md](zhuye-agent/AGENTS.md) 的「AGENTS.md 体系导航」，升级流程见 [SUBMODULE.md](SUBMODULE.md)。

| 上游想了解什么 | 读哪个 AGENTS.md |
|---|---|
| 协议契约：Op / EventMsg / Item / Submission | [crates/protocol/](zhuye-agent/crates/protocol/AGENTS.md) |
| 能力原语：模型 / 工具 / hook / 提示词 / 检索 | [crates/abilities/](zhuye-agent/crates/abilities/AGENTS.md) |
| 资源层：配置 / 权限 / 插件 / 持久化 / 文件 | [crates/resources/](zhuye-agent/crates/resources/AGENTS.md) |
| 多 agent 编排：子代理 / 讨论 / 任务 / 流水线 / 目标 | [crates/orchestration/](zhuye-agent/crates/orchestration/AGENTS.md) |
| 外部集成：MCP / LSP / 会话导入 / computer-use / shell / git | [crates/integrations/](zhuye-agent/crates/integrations/AGENTS.md) |
| 运行时与入口：StateGraph / headless / CLI / facade / PyO3 | [crates/runtime/](zhuye-agent/crates/runtime/AGENTS.md) |
| 上游构建 · 发布 · 冒烟 · 插件打包脚本 | [scripts/](zhuye-agent/scripts/AGENTS.md) |
| 双 SDK：Python / TypeScript | [sdks/](zhuye-agent/sdks/AGENTS.md) |
| 上游测试分层与覆盖矩阵 | [tests/](zhuye-agent/tests/AGENTS.md) |

## 常用命令

```bash
# 开发与验证（日常）
pnpm install
pnpm tauri dev                # 开发模式（HMR）
pnpm test                     # vitest
pnpm typecheck                # tsc --noEmit
cd src-tauri && cargo check   # Rust 类型检查

# 发布门禁（分层，见下方「验证矩阵」）
bash tests/run_all.sh         # 静态 + 前端 + 真后端 + 产物

# 发布构建
pnpm tauri build              # 全平台构建
pnpm tauri build --bundles app  # 仅 macOS .app
bash scripts/install.sh       # → /usr/local/bin/reflect-desktop + ~/Applications/ZhuYe.app

# 图标再生成（默认源图恒为仓库根 logo.png，与调用目录无关；产物 = src-tauri/icons/ + favicon）
pnpm icons                    # 等价于 bash scripts/gen-icons.sh
pnpm icons:check              # 只校验：齐全 / 尺寸 / 托盘透明底 / 是否比源图旧

# submodule 升级（当烛夜发布新版本时，详见 SUBMODULE.md）
git submodule update --remote zhuye-agent
git diff --submodule zhuye-agent
git add zhuye-agent && git commit -m "chore: bump zhuye-agent submodule"

# 定向测试（迭代时用定向测试，而不是全量）
pnpm test -- src/features/settings/SettingsView.test.tsx
```

脚本契约（打包前图标检查、版本四处同步等）见 [scripts/AGENTS.md](scripts/AGENTS.md)。

> 历史：本仓库曾用 `vendor/` + `scripts/vendor-sync.sh`（rsync 手动同步）复用核心 crate，已迁移为 git submodule。旧的 vendor 运行手册不再适用。

## 架构

### 分层（依赖方向自上而下）

| 层 | 位置 | 职责 |
|---|---|---|
| 前端 | `src/` | React 19 视图切片 + Zustand 状态 + IPC 包装（组合根 `main.tsx`、路由表 `router.tsx`）。v3 起壳层为 harness 设计（`render/styles/harness.css` + `stores/shellUi.ts`）：标题条 / 侧栏 / 右 dock（检查器·浏览器·文件·子代理·用量五档）/ 底部 PTY 终端面板 / 任务中心 / 命令面板 / 设置弹窗；旧路由页全部保留（侧栏「更多」菜单可达） |
| 命令层 | `src-tauri/` | Tauri 2 适配层：命令表（`commands/<domain>.rs`）+ AgentThread 宿主（`state.rs` + `state/` 子模块）+ OS 集成，不承载领域逻辑 |
| 领域服务 | `app-core/` | UI 无关领域服务层，供命令层复用；渲染状态由前端 TS 负责 |
| 引擎 | `zhuye-agent/` | submodule 只读镜像：烛夜 agent 引擎 zhuye-* crate（协议 / 能力 / 资源 / 编排 / 集成 / 运行时） |

与 submodule 重叠的实现已收敛到上游：actor / squad → `reflect-task`，autopilot → `reflect-stream`，kms → `reflect-kms`，pricing → `reflect-llm`，activity 实体 → `reflect-telemetry`，side-channel → `reflect-core`，paths → `reflect-config::paths`（收敛判定见 [app-core/AGENTS.md](app-core/AGENTS.md)）。

### 核心数据流

- `AgentThread`（submodule）消费 `Submission`，事件经 `src-tauri/src/events.rs` 转发到单一 `reflect_event` 通道。
- 前端唯一订阅点 `services/agentEventBus.ts` 扇出 → `stores/agent/reducer.ts` 的 `reduceEvent` 产出 patch → Zustand store 应用。
- 发送意图经 `stores/agent/index.ts::useAgentStore` 构造 `Op` → `reflect_submit` 命令 → 宿主 `state/submit.rs` 提交。
- 文件/会话路径一律经后端命令往返，前端不自拼数据目录路径。

### 关键不变量

**架构红线（不可妥协）**：

1. 将共享/领域后端逻辑优先放在 `app-core/` 和 `zhuye-agent/crates/**/zhuye-*` 中。
2. Tauri 应用是 `reflect_core::AgentThread` 的薄适配层。
3. TUI 和 GUI 之间不重复逻辑；两者消费同一份 `reflect-protocol` 协议信封。
4. 除非有意修改协议，否则保持 Tauri 命令名称和负载结构稳定。
5. 保持前端 IPC 协议与后端命令表一致（`src/utils/commands/` ↔ `src-tauri/src/commands/mod.rs`）。
6. 数据目录以 submodule 为准（用户级 `$ZHUYE_HOME` > `$HOME/.zhuye`，工作区级 `<workspace>/.zhuye/`）。路径只经 `reflect_config::paths` 取，不在功能代码里自拼目录名；与 sessions 树必须同级的目录（归档）从 `reflect_rollout::path::default_base()` 派生。

**协议不变量**：

- 线格式为 `reflect_protocol::Event` / `Submission`（snake_case JSON）
- 所有 `Op` 变体 → Tauri 命令（见 `docs/protocol-bridge.md` §2）
- 所有 `EventMsg` 变体 → 单一 `reflect_event` 通道，前端通过 `msg.type` 分发
- Submission id ↔ Event id 配对用于流关联
- `EVENT_ID_NONE = ""` 用于生命周期事件（无匹配提交）

**AgentThread 宿主状态不变量**：

- `MinimalAgent` 是封装器，持有 `Arc<AgentThread>` + `tokio::sync::broadcast` 用于会话事件广播
- `install_agent_thread()` 在 Tauri `setup()` 中调用（运行时初始化后），不要在 `manage()` 中调用（同步阶段）
- 慢订阅者触发 `RecvError::Lagged(n)` — 记录日志但任务继续运行
- macOS 关闭按钮 → 隐藏到托盘（不退出），通过 `on_window_event`；点击 Dock 图标 → `RunEvent::Reopen` 唤回主窗口（无可见窗口时），在 `run()` 的 run 回调中处理

**会话层级不变量**：

- `useSessions`（`src/logic/sessions/useSessions.ts`）是会话列表的规范 hook，旧切片路径提供兼容导出
- 切换会话 → `reflect_replay_session(id)` 后水合本地状态
- 时间分组（`Now/今天/昨天/本周/更早`）在 hook 中，不在侧边栏组件中
- **切走必降级、切回必恢复**：assistant 内容按步骤增量落盘，但正在流出的
  半截文本、运行态，以及审批 / 提问 / plan 这些 gate 请求仍不在 rollout 里。
  切走时旧会话若有在飞 turn 或待确认交互，必须把前台实时投影播种进后台注册表
  （`useBackgroundSessions.demote`），切回时由 `mergePendingInto` 整体
  注回。否则最新增量丢失、运行态退化成「已结束」（停止按钮消失）、审批框
  永久丢失、回合永远挂着

## 开发流程检查表（改任何代码前必读）

提交前逐条走完：

1. **AGENTS.md 分层索引同步（强制）** —— 修改或新增代码时，对应目录的 AGENTS.md 必须同步更新——契约 / 同步点 / 禁止事项变化即改对应篇，目录或篇目增删即改「体系导航」表。按下表定位：

   | 代码改动 | 同步更新 |
   |---|---|
   | 新增/移除切片或路由 | `src/features/` + `src/`（路由链）+ 根导航表 |
   | 事件消化 / reducer / 兼容层变更 | `src/stores/` |
   | IPC 领域包装增删 | `src/utils/`（+ 对侧 `src-tauri/src/commands/`） |
   | Tauri 命令增删 | `src-tauri/src/commands/` + `src-tauri/`（注册表）+ 对侧 `src/utils/` |
   | 宿主状态 / state 子模块增删 | `src-tauri/src/state/` |
   | app-core 模块增删 | `app-core/` |
   | 脚本新增/移除/行为变更 | `scripts/` 速览表 |
   | 门禁分层 / 覆盖矩阵结构变更 | `tests/`（+ `tests/COVERAGE.md`） |
   | 升级 zhuye-agent submodule | 校验「上游 submodule 体系索引」各链接仍存在；上游篇目增删即同步本表 |
   | 新增/移除目录或篇目 | 根导航表 + 本映射表 |

   拿不准改哪篇时，至少更新改动所在层篇与根导航表，确保索引不失真。

2. **后端行为变更** —— 遵循以下顺序：
   1. 核心 crate（`zhuye-agent/crates/**/zhuye-*`，通过 submodule）— 跨运行时逻辑的首选位置。如果变更应放在上游，修改 ZhuYe 仓库并升级 submodule（见 `SUBMODULE.md`）。
   2. 应用适配层和 Tauri 命令表（`src-tauri/src/lib.rs` + `commands/mod.rs`）。
   3. 前端 IPC 包装（`src/utils/commands/{domain}.ts`）。
   4. 如果新增后端命令，需同步更新所有相关层级 + 测试 + `docs/protocol-bridge.md` + `docs/changelog.md`。
   5. 核心 crate 新增能力时，同步更新 `docs/capabilities.md`（基座能力 → GUI 覆盖矩阵）——「有命令但无 UI 消费面」视为半接线。

3. **前端行为变更** —— `src/main.tsx` 作为组合根；`src/router.tsx` 作为路由表；有状态的编排逻辑放入 `src/features/<slice>/hooks/*` 或 `<slice>/use*Controller.ts`；表现层 UI 放在功能组件中；Tauri 调用仅放在 `src/utils/commands/`（按领域分文件），`src/utils/tauri.ts` 和 `src/utils/commands.ts` 为兼容桶，不要新增包装；事件订阅广播保持在 `src/services/agent.ts` 和 `src/services/agentEventBus.ts`。

4. **应用状态同步检查表** —— 当修改同时影响后端和前端的设置/持久化时：
   1. 后端（`src-tauri/src/state.rs` + `commands/<domain>.rs` / `commands/mod.rs`）已更新
   2. 前端 IPC（`src/utils/commands/{domain}.ts`）已更新
   3. 功能设置 UI（`src/features/settings/` 下 `SettingsView.tsx`、`ConfigForm.tsx`、`sections/`、`components/`、`config/schema.ts`）已更新
   4. 测试覆盖率已补充
   5. `docs/protocol-bridge.md` 已更新（如果线格式有变更）
   6. `docs/changelog.md` 已添加条目

5. **设计系统规则** —— 使用现有的设计标记（`src/render/styles/tokens.css`，暗色优先，支持亮色/系统主题）和基础组件（`src/features/design-system/primitives/*`）构建共享壳层；不要在功能 CSS 中重复定义已存在的弹窗/提示/面板/浮层样式；所有视图通过 CSS Modules 消费 token（内联样式不硬编码颜色值）。

6. **验证** —— 按下方「验证矩阵」跑对应命令，全绿再提交。

7. **注释与提交信息** —— 注释一律中文；commit 用 `type(scope): 描述` conventional 风格。

## 验证矩阵（按改动范围选跑）

| 改动范围 | 必跑命令 |
|---|---|
| 任何改动 | `pnpm typecheck` |
| 前端行为 / 状态 / hooks / 组件 | `pnpm test`（迭代用定向测试，不全量） |
| Rust 后端 | `cd src-tauri && cargo check`（后端行为变更加 `cargo test`） |
| 文档 / 注释 | 无需跑测试，自查链接与命令是否仍有效 |
| 发布前 | `bash tests/run_all.sh`（分层门禁） |

### 发布门禁（分层）

`tests/run_all.sh` 是发布阶段的**唯一**功能审查入口。退出码 0 表示所选套件没有阻断项；部分运行或存在跳过时，不能单凭退出码认定完整门禁通过。

| 层 | 命令 | 测什么 | 后端真伪 |
|---|---|---|---|
| L1 静态审查 | `bash tests/run_all.sh static` | 命令面四方一致、路由↔视图、版本四处一致、文档新鲜度、仓库卫生、文件大小预算棘轮 | 静态 |
| L2 前端行为 | `bash tests/run_all.sh frontend` | `tsc --noEmit` + vitest 全量 | **模拟**（`fakeBackend`） |
| L3 真后端能力覆盖 | `bash tests/run_all.sh backend` | `cargo fmt` / `clippy` / `cargo test`（含能力覆盖层） | **真**（模型是假的） |
| L4 发布产物 | `bash tests/run_all.sh artifact` | `.app` 结构 / Info.plist / 资源已嵌入 / 签名 / 无开发残留 / .deb・.AppImage・.msi 解包深度校验 / 启动冒烟（CI 门控） | 真产物 |
| L5 e2e | `bash tests/run_all.sh e2e` | 视觉回归（路由 × dark/light 截图基线，`tests/visual/`）+ WebDriver 真窗口冒烟（仅 Linux，`tauri-driver`）。依赖缺失默认跳过，`E2E_REQUIRED=1` 强制 | 模拟（视觉）/ 真（窗口） |
| L6 实模型演练 | `REFLECT_LIVE=1 bash tests/run_all.sh live` | 真 provider（免费模型池）+ 真 SSE 的完整一轮；模型从清单**实时发现**（`model = "free"`）。默认跳过，不发起任何网络请求 | **真**（模型也是真的） |

- **L2 与 L3 都要有**：L2 的后端是模拟的 —— 模拟后端的 bug 会把真后端的 bug 遮住。L3 用 `tauri::test` mock runtime 驱动**生产同一份** `generate_handler!` 注册表里的**真实命令体**，不经前端 `invoke` 包装、不经 `fakeBackend`。
- 能力覆盖层在 `src-tauri/tests/ipc_*.rs`，共享夹具 `src-tauri/tests/common/mod.rs`（HOME 与 cwd 全部沙箱化）。各层职责与口径的权威说明见 [tests/AGENTS.md](tests/AGENTS.md)；能力 → 套件映射见 [`tests/COVERAGE.md`](tests/COVERAGE.md)；报告落在 `.test-results/release-review.md`。
- L6 接法见 [`docs/free-model-practice.md`](docs/free-model-practice.md)。

## 约定

- **注释与提交一律中文** —— 行注释、doc-comment、测试说明等必须用中文书写；commit message 亦用中文，遵循 `type(scope): 描述` conventional 风格。
- **导入别名** —— 前端导入使用项目别名 `@/*` → `src/*`（在 `tsconfig.json` + `vite.config.ts` 中定义）。
- **文档双语** —— `docs/` 中文主篇命名用小写 kebab-case；英文对译以 `X.en.md` 同目录配对，顶部挂居中语言切换器（`<p align="center">` 换行缩进的 `<b>中文</b> · <a href="X.en.md">English</a>`，与上游 README 同款）；英文版不参与门禁，协议/能力变更后人工同步翻译；切换器仅在英文版产出后挂载。
- **大文件预算** —— 自有生产文件 ≤ 500 行；入口文件需超限时优先将领域逻辑拆到 `app-core/` 独立模块、宿主编排逻辑拆到 `src-tauri/src/state/` 子模块，并在本节说明理由（当前无超限文件）。
- **安全与 Git 行为** —— 优先使用安全的 git 操作（`status`、`diff`、`log`）；不要重置或撤销无关的用户变更；修复根本原因，不打补丁；冲突影响正确性时指出问题并选择最安全的路径。
- **submodule 只读** —— 不要直接修改 `zhuye-agent/crates/**/zhuye-*`；修改 ZhuYe 仓库后用 `git submodule update --remote` 升级（详见 `SUBMODULE.md`）。
