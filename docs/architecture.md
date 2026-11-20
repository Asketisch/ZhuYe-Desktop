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
│ features/shell/AppShell（ActivityBar / Sidebar / Main / Inspector）│
│   ↑                                                                   │
│   │ shell/hooks/{useCommandPaletteShortcut, usePaletteActions,       │
│   │   useThemeCycle}                                                  │
│ features/messages/ChatView（MessageList + Composer 再导出）           │
│   ↑                                                                   │
│ features/composer/{Composer, SlashPopup, useComposerInput,         │
│   │   useComposerSubmission, useAttachments, usePromptHistory}       │
│ features/memory/MemoryView ← useMemoryController                     │
│ features/terminal/TerminalView ← useTerminalController               │
│ features/modals/ModalStack（Approval/Question/AskUser/PlanReady）     │
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
