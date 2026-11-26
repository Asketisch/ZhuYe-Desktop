# 烛夜 ZhuYe —— 架构文档

<p align="center">
  <b>中文</b> · <a href="architecture.en.md">English</a>
</p>

> **本文覆盖**：桌面应用的系统级架构——顶层布局、IPC 契约、构建流水线、状态流转与 submodule 组织。
> **面向**：需要理解内部实现或做二次开发的读者；日常改动的「需要改 X，编辑 Y」见 [codebase-map.md](codebase-map.md)。
> **分工**：[README.md](../README.md) 讲安装与用法；根 [AGENTS.md](../AGENTS.md) 承载开发契约与分层导航；[protocol-bridge.md](protocol-bridge.md) 是协议线格式权威规范。

## 1. 顶层布局

```
ZhuYe-Desktop/
├── zhuye-agent/            # git submodule：烛夜 agent 引擎（zhuye-* crate，只读镜像；见 SUBMODULE.md）
├── app-core/               # UI 无关领域服务层（app-core/AGENTS.md）
├── src/                    # React 19 + Vite 前端（src/AGENTS.md）
│   ├── features/           # 功能切片：视图 + 控制器/hook + 就近测试（切片速览见 src/features/AGENTS.md）
│   ├── stores/             # Zustand 状态层（src/stores/AGENTS.md）
│   ├── utils/              # IPC 包装（commands/ 按领域）、i18n 运行时、桥接降级（src/utils/AGENTS.md）
│   ├── services/           # agentEventBus（唯一 zhuye_event 订阅点）+ agent.ts 兼容层
│   ├── types/              # 手写分域协议类型；dump-ts-types.sh 生成物不常驻工作树
│   ├── styles/             # tokens.css 设计标记单一事实来源
│   └── components/         # 跨切片通用组件
├── src-tauri/              # Rust 后端（Tauri 2；src-tauri/AGENTS.md）
│   └── src/
│       ├── main.rs         # 二进制入口
│       ├── lib.rs          # Tauri builder + setup + invoke_handler!（命令注册表）
│       ├── state.rs        # AgentThread 宿主（MinimalAgent 封装器；state/ 子模块见 src-tauri/src/state/AGENTS.md）
│       ├── events.rs       # 单一事件通道转发器
│       ├── commands/       # 领域命令文件 + error.rs（src-tauri/src/commands/AGENTS.md）
│       ├── tray.rs / menu.rs / shortcut.rs / dock.rs
│       └── {hook_store,memory_store,shell_sessions,workspace_state}.rs   # 私有状态辅助模块
├── docs/                   # 本目录：架构 / 协议 / 能力矩阵 / 用户指南 / 更新日志 / gui/（归档设计稿）
├── tests/                  # 分层发布门禁 + 应用级用例（tests/AGENTS.md）
├── scripts/                # 构建 / 发布 / 图标脚本（scripts/AGENTS.md）
├── Cargo.toml              # workspace 根
└── package.json            # 前端清单（vite + tauri）
```

切片与文件的完整映射不在本文维护（可变集合写死必漂移）：功能切片清单以 `src/features/AGENTS.md` 速览表为准，文件级路径映射见 [codebase-map.md](codebase-map.md)。

## 2. IPC 契约

线格式与 `zhuye-protocol::Event` / `Submission`（snake_case JSON）完全一致，不自建序列化器。信封结构、`Op` → Tauri 命令映射、事件表见 [protocol-bridge.md](protocol-bridge.md)。

命令面（`#[tauri::command]`）在 `src-tauri/src/lib.rs::invoke_handler` 注册，按领域定义于 `src-tauri/src/commands/<domain>.rs`；薄桶模块 `commands/mod.rs` 再导出各领域模块与共享 `error` 类型（`CommandError` / `CommandResult`）。事件侧单一推送通道 `zhuye_event` 由 `events::forward_agent_events` 发出；终端输出走独立通道 `zhuye_terminal_output`。

具体命令清单不在本文登记：权威口径由四方一致门禁守护——后端注册表 ↔ 前端 `src/utils/commands/` 包装 ↔ `fakeBackend` 实现 ↔ [protocol-bridge.md](protocol-bridge.md) 覆盖率（`tests/static/analyze.mjs` 棘轮下限 + `src-tauri/tests/ipc_*.rs` 真后端契约）。

## 3. 构建流水线

```text
                pnpm tauri dev/build
                       │
        ┌──────────────┴──────────────┐
        ▼                              ▼
   前端                            src-tauri/
   (Vite + tsc)                   (Tauri 2 + cargo build)
        │                              │
        │  打包进 dist/                 │  产出二进制 + .app/.msi/.deb
        └──────────────┬───────────────┘
                       ▼
            target/release/...
            ├── zhuye-desktop (Mach-O)
            ├── bundle/macos/ZhuYe.app
            └── bundle/{dmg,msi,deb,appimage}/...
```

`scripts/install.sh` 消费二进制 + 安装包。核心 crate 通过 git submodule
（`zhuye-agent/`）引用，用 `git submodule update --remote` 升级
（完整流程见 `SUBMODULE.md`）。两者相互独立 —— 构建期不存在依赖关系。

## 4. 状态流转

```text
┌───────────────── React 19（单一 Zustand store）─────────────────┐
│ features/harness/shell/AppShell（ActivityBar / Sidebar / Main / Inspector）│
│   ↑                                                                   │
│   │ shell/hooks/{useCommandPaletteShortcut, usePaletteActions,       │
│   │   useThemeCycle}                                                  │
│ features/conversation/messages/ChatView（MessageList + Composer 再导出）           │
│   ↑                                                                   │
│ features/input/composer/{Composer, SlashPopup, useComposerInput,         │
│   │   useComposerSubmission, useAttachments, usePromptHistory}       │
│ features/knowledge/memory/MemoryView ← useMemoryController                     │
│ features/workbench/terminal/TerminalView ← useTerminalController               │
│ features/harness/modals/ModalStack（Approval/Question/AskUser/PlanReady）     │
│   ↑                                                                   │
│   │ useAgentStore（stores/agent/store.ts）—— 单一事实来源              │
│   │   分发器：stores/agent/reducer.ts                                 │
│   │ useAgent（services/agent.ts）—— 兼容再导出                         │
│   │ 事件扇出：services/agentEventBus.ts（引用计数）                     │
│   ▼                                                                   │
│ onZhuyeEvent → agentEventBus → reducer（agent/reducer.ts）          │
└─────────────────────────┬─────────────────────────────────────────┘
                          │ Tauri 2 IPC（invoke / listen）
┌─────────────────────────▼─────────────────────────────────────────┐
│ src-tauri/                                                          │
│   桥接：src/utils/bridge.ts（invoke/listen + 降级）                    │
│   命令桶：src-tauri/src/commands/mod.rs                              │
│     └─ 各领域命令体位于 src-tauri/src/commands/<domain>.rs            │
│   state::MinimalAgent                                                │
│     ├─ mpsc Sender<Submission>                                       │
│     ├─ broadcast Receiver<Event> 扇出                                │
│     ├─ shell_sessions / hook_store / memory_store / workspace_state │
│     └─ MinimalAgentInner                                            │
│                                                                       │
│      ↔ zhuye_core::AgentThread                                     │
│     + 上游共享内置工具表（Bash/Read/Write/问答/AST/...）               │
│     + ModelRegistry                                                  │
│     + ConfigWatcher                                                  │
│     + zhuye-rollout::JsonlRolloutWriter                            │
└────────────────────────────────────────────────────────────────────┘
```

## 5. 核心子模块

`zhuye-agent/` 是烛夜 agent 引擎 zhuye-* crate 的 **只读**
git submodule 镜像（桌面端以 `zhuye-*` 依赖别名引用）。submodule 模式让 GUI 保持自己的发布节奏，
不依赖 agent 仓库的 CI，同时仍能获得 zhuye-protocol /
zhuye-core 等的 bug 修复。

升级方式：

```bash
# 从烛夜仓库拉取最新核心
git submodule update --remote zhuye-agent
git diff --submodule zhuye-agent   # 审查
git add zhuye-agent
git commit -m "chore: bump zhuye-agent submodule"
```

子模块有意排除 GUI 不依赖的部分（如 `zhuye` 顶层二进制等 TUI/CLI
专用产物）。保持同步的完整 crate 集合见根 `Cargo.toml` 的
`[workspace.dependencies]` 与 `SUBMODULE.md`。


## 6. 运行时与会话不变量

以下三段从根 AGENTS.md 下沉（根篇保留链接与一句定性）；改动运行时/会话逻辑前必读。

**协议不变量**：

- 线格式为 `zhuye_protocol::Event` / `Submission`（snake_case JSON）
- 所有 `Op` 变体 → Tauri 命令（见 `docs/protocol-bridge.md` §2）
- 所有 `EventMsg` 变体 → 单一 `zhuye_event` 通道，前端通过 `msg.type` 分发
- Submission id ↔ Event id 配对用于流关联
- `EVENT_ID_NONE = ""` 用于生命周期事件（无匹配提交）

**AgentThread 宿主状态不变量**：

- `MinimalAgent` 是封装器，持有 `Arc<AgentThread>` + `tokio::sync::broadcast` 用于会话事件广播
- `install_agent_thread()` 在 Tauri `setup()` 中调用（运行时初始化后），不要在 `manage()` 中调用（同步阶段）
- 慢订阅者触发 `RecvError::Lagged(n)` — 记录日志但任务继续运行
- macOS 关闭按钮 → 隐藏到托盘（不退出），通过 `on_window_event`；点击 Dock 图标 → `RunEvent::Reopen` 唤回主窗口（无可见窗口时），在 `run()` 的 run 回调中处理

**会话层级不变量**：

- `useSessions`（`src/logic/conversation/sessions/useSessions.ts`）是会话列表的规范 hook，旧切片路径提供兼容导出
- 切换会话 → `zhuye_replay_session(id)` 后水合本地状态
- 时间分组（`Now/今天/昨天/本周/更早`）在 hook 中，不在侧边栏组件中
- **切走必降级、切回必恢复**：assistant 内容按步骤增量落盘，但正在流出的
  半截文本、运行态，以及审批 / 提问 / plan 这些 gate 请求仍不在 rollout 里。
  切走时旧会话若有在飞 turn 或待确认交互，必须把前台实时投影播种进后台注册表
  （`useBackgroundSessions.demote`），切回时由 `mergePendingInto` 整体
  注回。否则最新增量丢失、运行态退化成「已结束」（停止按钮消失）、审批框
  永久丢失、回合永远挂着

## 7. 场景命令（非常用，根篇只留日常 4 条）

```bash
# 发布构建
pnpm tauri build              # 全平台构建
pnpm tauri build --bundles app  # 仅 macOS .app
bash scripts/install.sh       # → /usr/local/bin/zhuye-desktop + ~/Applications/ZhuYe.app

# 图标再生成（图标源恒为 zhuye-agent/res/logo.png、托盘源恒为 zhuye-agent/res/clear-logo.png，均在 submodule 内只读；产物 = src-tauri/icons/ + favicon + 侧栏品牌位 brand-mark.png）
pnpm icons                    # 等价于 bash scripts/gen-icons.sh
pnpm icons:check              # 只校验：齐全 / 尺寸 / 托盘透明底 / 品牌位存在 / 是否比源图旧

# submodule 升级（当烛夜发布新版本时，详见 SUBMODULE.md）
git submodule update --remote zhuye-agent
git diff --submodule zhuye-agent
git add zhuye-agent && git commit -m "chore: bump zhuye-agent submodule"

# 磁盘治理（cargo 不自动 GC incremental / 覆盖率重建树）
bash scripts/gc.sh            # 清 target/**/incremental + llvm-cov-target + examples，保留 .rlib
bash scripts/gc.sh gc-deep    # 再清 target/debug/deps（下次构建 ≈ 冷构建，仅磁盘告急时用）
```

图标/gc/版本同步契约见 [scripts/AGENTS.md](../scripts/AGENTS.md)。
