# 烛夜 ZhuYe —— 架构文档

> 烛夜（ZhuYe）agent 的 Tauri 2 + React 19 桌面 GUI。本文档
> 取代旧的 `ZhuYe/docs/gui/03-architecture.md`。

## 1. 顶层布局

```
ReflectDesktop/
├── zhuye-agent/           # git submodule：ZhuYe 仓库的 reflect-* crate
│                            # 只读镜像，不要直接修改（见 SUBMODULE.md）
├── app-core/                # Tauri 命令层的共享领域服务（UI 无关）
├── src/                     # React 19 + Vite + 功能切片
│   ├── features/
│   │   ├── shell/           # IDE 五窗格布局（AppShell、ActivityBar、
│   │   │                    #   TitleBar、StatusBar、Inspector、PageShell）+
│   │   │                    #   hooks/（useCommandPaletteShortcut、
│   │   │                    #   usePaletteActions、useThemeCycle）
│   │   ├── messages/        # ChatView、MessageList、ToolCells、Collapsible
│   │   │                    # （Composer 是薄再导出层 →
│   │   │                    #   features/composer/Composer）
│   │   ├── composer/        # Composer、SlashPopup、MentionPicker、AttachmentBar
│   │   │                    #   + slashCommands / slashEngine / useComposerInput
│   │   │                    #   / useComposerSubmission / useAttachments /
│   │   │                    #   usePromptHistory
│   │   ├── sessions/        # Sidebar、BucketGroup、SessionItem、useSessions
│   │   ├── modals/          # ModalShell + Approval/Question/AskUser/PlanReady
│   │   │                    #   + ApprovalHistory（各自独立 .tsx）
│   │   ├── terminal/        # TerminalView + useTerminalController
│   │   ├── memory/          # MemoryView + MemoryRow + MemoryAddForm +
│   │   │                    #   useMemoryController
│   │   ├── design-system/   # 基础组件（Button、Icon、Input、Card 等）+
│   │   │                    #   DesignSystemView 目录
│   │   ├── settings/        # SettingsView + ConfigForm + sections/
│   │   │                    #   （DisplaySection / NotificationsSection /
│   │   │                    #   UpdatesSection）+ components/（StructuredField /
│   │   │                    #   ComplexEditors）+ config/（schema、toml）
│   │   └── {about,collaboration,debug,dictation,files,git,home,mobile,
│   │            models,notifications,plan,prompts,skills,threads,update,workspaces}/
│   ├── components/          # 跨切片原子组件（如 Markdown）
│   ├── stores/
│   │   ├── agent/           # 规范实现：store.ts、reducer.ts、turns.ts、
│   │   │                    #   toast.ts、servers.ts、types.ts、useAgent.ts、
│   │   │                    #   index.ts（再导出）
│   │   └── agentStore.ts    # 兼容层 → ./agent
│   ├── services/            # agent.ts（兼容再导出）+ agentEventBus.ts
│   ├── styles/              # tokens.css + base.css + typography.module.css
│   ├── utils/
│   │   ├── bridge.ts        # 底层 invoke / listen + 降级
│   │   ├── tauri.ts         # 兼容桶
│   │   ├── commands.ts      # 兼容桶
│   │   ├── commands/        # 按领域拆分的 IPC 包装
│   │   ├── i18n.ts          # 兼容桶
│   │   ├── i18n/            # 运行时拆分（context.tsx、locale.ts、
│   │   │                    #   interpolate.ts、lookup.ts、types.ts）
│   │   └── i18n/strings/    # 按领域目录合并成 STRINGS
│   └── types/               # 从 reflect-protocol 模式导出生成
├── src-tauri/               # Rust 后端（Tauri 2）
│   ├── Cargo.toml           # 二进制名：reflect-desktop
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/main.json
│   ├── icons/               # 32/128/256/512 PNG + Windows .ico
│   └── src/
│       ├── main.rs          # 二进制入口
│       ├── lib.rs           # Tauri builder + setup + invoke_handler!
│       ├── state.rs         # MinimalAgent（M1.x 存根）→ reflect-core::AgentThread（M2.x）
│       ├── events.rs        # AgentThread → Tauri emit("reflect_event")
│       ├── mcp.rs           # MCP / LSP 运行时（M3.x 连接管理器）
│       ├── commands/
│       │   ├── mod.rs       # 薄桶模块，再导出各 <domain>.rs
│       │   ├── error.rs     # CommandError / CommandResult
│       │   └── {agent,allowlist,config,export,files,git,hooks,memory,
│       │         search,sessions,shell,skills,update,workspaces}.rs
│       ├── {hook_store,memory_store,shell_sessions,workspace_state}.rs
│       │                    # 私有状态辅助模块
│       ├── tray.rs          # M1.x 存根；M2.x 真实实现
│       ├── menu.rs          # M1.x 存根；M2.x 真实实现
│       ├── shortcut.rs      # M1.x 存根；M2.x 真实实现
│       └── dock.rs          # M1.x 存根；M2.x 真实实现
├── Cargo.toml               # workspace 根
├── package.json             # 前端清单（vite + tauri）
├── tsconfig.json / tsconfig.node.json
├── vite.config.ts           # @/ → src/ 别名；开发服务器 :5173
├── index.html               # SPA 入口
├── docs/                    # USER_GUIDE + ARCHITECTURE + codebase-map +
│                              #   PROTOCOL_BRIDGE + CHANGELOG + gui/（历史）
└── scripts/
    ├── install.sh           # 双二进制安装（脚本 + .app）
    ├── dump-ts-types.sh     # 从 reflect-protocol 重新生成 TS 协议类型
    └── build.sh             # 跨平台打包（app、dmg、deb、appimage、msi）
```

## 2. IPC 契约

请求信封与事件格式见 `docs/PROTOCOL_BRIDGE.md`。线格式与
`reflect-protocol::Event` / `Submission`（snake_case JSON）完全一致，
避免自定义序列化器。

完整的 `#[tauri::command]` 命令面在 `src-tauri/src/lib.rs::invoke_handler` 注册，按领域定义在 `src-tauri/src/commands/<domain>.rs`。薄桶模块 `src-tauri/src/commands/mod.rs` 再导出各领域模块及共享的 `error` 辅助类型（`CommandError` / `CommandResult`）。单一推送事件（`reflect_event`）由 `events::forward_agent_events` 发出；终端输出事件（`reflect_terminal_output`）由 `shell` 命令体发出。

- 健康检查：`ping`
- 提交（Op 分发）：`reflect_submit`、`reflect_interrupt`、`reflect_compact`、`reflect_rewind`、`reflect_shutdown`、`reflect_tool_approval`、`reflect_hook_approval`、`reflect_plan_approval`、`reflect_enter_plan_mode`、`reflect_exit_plan_mode`、`reflect_set_effort`、`reflect_set_permission_mode`、`reflect_cycle_permission_mode`、`reflect_ask_user_question_response`、`reflect_ask_user_input_response`
- 会话 / 导出：`reflect_list_sessions`、`reflect_rename_session`、`reflect_delete_session`、`reflect_replay_session`、`reflect_export_session`、`reflect_export_session_markdown`
- 诊断 / 配置 / 工具：`reflect_agent_status`、`reflect_get_config`、`reflect_save_config`、`reflect_list_tools`
- 领域管理：`reflect_list_workspaces`、`reflect_set_workspace`、`reflect_current_workspace`、`reflect_list_skills`、`reflect_list_memory`、`reflect_add_memory`、`reflect_remove_memory`、`reflect_list_hooks`、`reflect_toggle_hook`
- Git / shell / 文件 / 搜索 / 允许列表 / 更新：`reflect_git_status`、`reflect_git_diff`、`reflect_git_log`、`reflect_run_shell`、`reflect_kill_shell`、`reflect_list_shell_sessions`、`reflect_list_dir`、`reflect_read_file`、`reflect_search_files`、`reflect_load_allowlist`、`reflect_save_allowlist`、`reflect_check_allowlist`、`reflect_check_update`
- Dock（macOS）：`reflect_set_dock_badge`

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
            ├── reflect-desktop (Mach-O)
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
│ onReflectEvent → agentEventBus → reducer（agent/reducer.ts）          │
└─────────────────────────┬─────────────────────────────────────────┘
                          │ Tauri 2 IPC（invoke / listen）
┌─────────────────────────▼─────────────────────────────────────────┐
│ src-tauri/                                                          │
│   桥接：src/utils/bridge.ts（invoke/listen + 降级）                    │
│   命令桶：src-tauri/src/commands/mod.rs                              │
│     └─ 各领域命令体位于 src-tauri/src/commands/<domain>.rs            │
│   state::MinimalAgent（M2.x）                                        │
│     ├─ mpsc Sender<Submission>                                       │
│     ├─ broadcast Receiver<Event> 扇出                                │
│     ├─ shell_sessions / hook_store / memory_store / workspace_state │
│     └─ MinimalAgentInner                                            │
│                                                                       │
│      ↔ reflect_core::AgentThread                                     │
│     + 上游共享内置工具表（Bash/Read/Write/问答/AST/...）               │
│     + ModelRegistry                                                  │
│     + ConfigWatcher                                                  │
│     + reflect-rollout::JsonlRolloutWriter                            │
└────────────────────────────────────────────────────────────────────┘
```

## 5. 核心子模块

`zhuye-agent/` 是 ZhuYe 仓库 reflect-* crate 的 **只读**
git submodule 镜像。submodule 模式让 GUI 保持自己的发布节奏，
不依赖 agent 仓库的 CI，同时仍能获得 reflect-protocol /
reflect-core 等的 bug 修复。

升级方式：

```bash
# 从 ZhuYe 仓库拉取最新核心
git submodule update --remote zhuye-agent
git diff --submodule zhuye-agent   # 审查
git add zhuye-agent
git commit -m "chore: bump zhuye-agent submodule"
```

子模块有意排除 GUI 不依赖的部分（如 `reflect` 顶层二进制等 TUI/CLI
专用产物）。保持同步的完整 crate 集合见根 `Cargo.toml` 的
`[workspace.dependencies]` 与 `SUBMODULE.md`。
