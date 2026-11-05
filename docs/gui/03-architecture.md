# Tauri 2 + React 19 架构设计（设计稿）

> ⚠️ **设计稿快照（742 行）。** 当前真实架构以 [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) + [`../../codebase-map.md`](../../codebase-map.md) 为准。本文保留作为设计决策溯源 + 架构总览参考。
>
> 关键差异：设计稿中 `crates/reflect-gui/` 路径在 ReflectDesktop 项目中演化为 **根目录 `src-tauri/`** + **`app-core/`**；`reflect-*` crate 不再 fork 而是通过 `vendor/` mirror 同步。

本文档定义 ZhuYe GUI 的总体技术架构、crate 划分、目录结构与边界规约。

---

## 1. 总体分层

```
┌─────────────────────────────────────────────────────────────┐
│  前端 (React 19 + Vite + TS)                                  │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────────────┐    │
│  │  features/  │ │   widgets/   │ │    components/     │    │
│  │  (功能分层)  │ │  (共享原子)         │    │
│  └─────────────┘ └──────────────┘ └────────────────────┘    │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Zustand stores + Tauri commands 桥                    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                           │ Tauri 2 IPC (events + commands)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Tauri Backend (Rust)                                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  crates/reflect-gui/src-tauri/                        │   │
│  │   - main.rs: Tauri builder + 命令注册                  │   │
│  │   - commands/: 每个 Op 一个 #[tauri::command]         │   │
│  │   - events.rs: AgentThread → Tauri::emit              │   │
│  │   - state.rs: AppState { thread, services, watcher }  │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  crates/reflect-app-core (新建)                        │   │
│  │   - reducer.rs: 纯函数 reduce(state, event)           │   │
│  │   - state.rs: RenderState 子模块                       │   │
│  │   - event.rs: CoreEvent 抽象                           │   │
│  │   - services.rs: Services bundle                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                    │
│  ↓ 复用现有 crates ↓                                          │
├─────────────────────────────────────────────────────────────┤
│  Reflect Core (现有 19+ crate)                                │
│   - reflect-protocol (EventMsg/Op)                           │
│   - reflect-core    (AgentThread)                            │
│   - reflect-rollout (JSONL 存储)                             │
│   - reflect-config  (TOML + 通知热重载)                      │
│   - reflect-task    (TaskManager)                            │
│   - reflect-skills  (SkillsCatalog)                          │
│   - reflect-memory  (MemoryStore)                            │
│   - reflect-permissions (PermissionStore/Resolver)           │
│   - reflect-llm     (ModelRegistry)                          │
│   - reflect-tools   (ToolRegistry + 22 builtins)             │
│   - reflect-mcp     (McpConnectionManager)                   │
│   - reflect-hooks   (HookEngine)                             │
│   - reflect-tui     (run_editor_with 等可复用片段)            │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 新增 crate 划分

### 2.1 `reflect-gui` —— 顶层 Tauri 2 binary

```
crates/reflect-gui/
├── Cargo.toml
├── package.json                 # 前端 npm 配置
├── pnpm-lock.yaml
├── vite.config.ts
├── tsconfig.json
├── src/                          # React 前端
│   ├── main.tsx
│   ├── App.tsx
│   ├── features/                 # 特性分层（见 §3）
│   ├── components/
│   ├── widgets/
│   ├── stores/                   # Zustand
│   ├── types/                    # protocol.ts 等
│   └── styles/
├── src-tauri/                    # Tauri 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── commands/             # reflect_submit, reflect_*
│       ├── events.rs
│       ├── state.rs
│       └── plugins/              # 自定义 Tauri plugin（如有）
└── tests/
```

依赖（`crates/reflect-gui/src-tauri/Cargo.toml`）：

```toml
[dependencies]
tauri = { version = "2", features = ["macos-private-api", "tray-icon"] }
tauri-plugin-updater = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-opener = "2"
tauri-plugin-process = "2"
tauri-plugin-store = "2"
tauri-plugin-notification = "2"

# Reflect crates
reflect-app-core = { path = "../reflect-app-core" }
reflect-protocol = { path = "../reflect-protocol" }
reflect-core = { path = "../reflect-core" }
reflect-config = { path = "../reflect-config" }
reflect-rollout = { path = "../reflect-rollout" }
reflect-task = { path = "../reflect-task" }
reflect-skills = { path = "../reflect-skills" }
reflect-memory = { path = "../reflect-memory" }
reflect-permissions = { path = "../reflect-permissions" }
reflect-llm = { path = "../reflect-llm" }
reflect-tools = { path = "../reflect-tools" }
reflect-mcp = { path = "../reflect-mcp" }
reflect-hooks = { path = "../reflect-hooks" }
reflect-tui = { path = "../reflect-tui" }   # run_editor_with

# 通用
tokio = { version = "1", features = ["full"] }
anyhow = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

### 2.2 `reflect-app-core` —— 共享 reducer + state

```
crates/reflect-app-core/
├── Cargo.toml
└── src/
    ├── lib.rs
    ├── state/
    │   ├── mod.rs                # RenderState 顶层
    │   ├── history.rs            # HistoryState (message list)
    │   ├── scroll.rs             # ScrollState
    │   ├── input.rs              # InputState
    │   ├── approval.rs           # PendingApproval/Question/AskUser (从 reflect-tui 移过来)
    │   ├── task_panel.rs         # TaskListPanelState
    │   ├── plan.rs               # PlanModeState
    │   ├── permission.rs         # PermissionModeState
    │   ├── theme.rs              # ThemeState
    │   ├── vim.rs                # VimState
    │   ├── status.rs             # StatusFlags
    │   └── meta.rs               # MetaState
    ├── event/
    │   ├── mod.rs                # CoreEvent
    │   ├── key.rs                # KeyEvent 抽象（解耦 crossterm）
    │   └── agent.rs              # AgentEvent 包装
    ├── reducer/
    │   ├── mod.rs                # reduce(state, event)
    │   ├── key.rs                # apply_key
    │   ├── agent.rs              # apply_agent_event
    │   ├── slash.rs              # apply_slash
    │   └── lifecycle.rs          # setup/shutdown
    ├── services.rs               # Services bundle
    ├── slash.rs                  # 从 reflect-tui 移过来
    └── external_editor.rs        # run_editor_with（移到此处共享）
```

依赖（`crates/reflect-app-core/Cargo.toml`）：

```toml
[dependencies]
# Reflect crates
reflect-protocol = { path = "../reflect-protocol" }
reflect-core = { path = "../reflect-core" }
reflect-task = { path = "../reflect-task" }
reflect-skills = { path = "../reflect-skills" }
reflect-memory = { path = "../reflect-memory" }
reflect-permissions = { path = "../reflect-permissions" }
reflect-tools = { path = "../reflect-tools" }
reflect-llm = { path = "../reflect-llm" }
reflect-hooks = { path = "../reflect-hooks" }

# 通用
tokio = { version = "1", features = ["sync", "rt", "macros"] }
parking_lot = "0.12"
anyhow = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tempfile = "3"          # external_editor
```

**关键约束**：

- `reflect-app-core` **不依赖** `ratatui` / `crossterm` / `tauri` / `iced`
- 仅依赖 `reflect-protocol` 的 `KeyEvent` 抽象（需要新建，不依赖 crossterm）
- 编译时间应保持 ≤5s（参考 `cargo check -p reflect-app-core`）

### 2.3 不需要新增的 crate

- ❌ 不新建 `reflect-ipc`：直接用 Tauri command/event，每个 command 是一个 `async fn` 包装 `AgentThread::submit`
- ❌ 不新建 `reflect-state`：状态留在 `reflect-app-core`
- ❌ 不新建独立 `reflect-events`：事件已经分布在 `reflect-protocol` + `reflect-app-core`

---

## 3. 前端目录结构

```
crates/reflect-gui/src/
├── main.tsx                    # ReactDOM 入口
├── App.tsx                     # 顶层 Tauri Provider + Router
├── features/                   # 自治特性
│   ├── app/                    # 顶层 shell（布局、顶栏、底栏）
│   │   ├── components/
│   │   ├── hooks/
│   │   └── AppLayout.tsx       # 三栏布局主入口
│   ├── sessions/               # 会话列表 + sidebar
│   │   ├── components/
│   │   │   ├── SessionList.tsx
│   │   │   ├── SessionItem.tsx
│   │   │   ├── SessionActions.tsx
│   │   │   └── TimeBucketGroup.tsx
│   │   ├── hooks/
│   │   │   └── useSessions.ts  # Tauri invoke('list_sessions')
│   │   └── stores/
│   │       └── sessionStore.ts # Zustand
│   ├── messages/               # chat 渲染
│   │   ├── components/
│   │   │   ├── MessageList.tsx
│   │   │   ├── rows/
│   │   │   │   ├── MessageRow.tsx
│   │   │   │   ├── ThinkingRow.tsx
│   │   │   │   ├── ToolRow.tsx
│   │   │   │   ├── ToolGroup.tsx
│   │   │   │   ├── ApprovalRow.tsx
│   │   │   │   ├── PlanRow.tsx
│   │   │   │   ├── ErrorRow.tsx
│   │   │   │   └── WorkingIndicator.tsx
│   │   │   ├── Markdown.tsx
│   │   │   └── StreamdownAssistant.tsx
│   │   └── hooks/
│   │       └── useMessageStream.ts
│   ├── composer/               # 输入区
│   │   ├── components/
│   │   │   ├── Composer.tsx
│   │   │   ├── ComposerInput.tsx
│   │   │   ├── ComposerMetaBar.tsx
│   │   │   ├── FileMention.tsx
│   │   │   ├── ImageAttach.tsx
│   │   │   └── SlashPopup.tsx
│   │   └── hooks/
│   │       └── useComposerState.ts
│   ├── modals/                 # 全局 modal（覆盖全屏）
│   │   ├── ApprovalModal.tsx
│   │   ├── QuestionModal.tsx
│   │   ├── AskUserModal.tsx
│   │   ├── PlanReadyModal.tsx
│   │   └── ErrorModal.tsx
│   ├── settings/               # Settings 视图
│   │   ├── SettingsView.tsx
│   │   ├── sections/
│   │   │   ├── DisplaySection.tsx
│   │   │   ├── EditorSection.tsx
│   │   │   ├── ProviderSection.tsx
│   │   │   ├── SkillsSection.tsx
│   │   │   ├── MemorySection.tsx
│   │   │   ├── PermissionsSection.tsx
│   │   │   ├── TasksSection.tsx
│   │   │   └── ShortcutsSection.tsx
│   │   └── stores/
│   │       └── settingsStore.ts
│   ├── files/                  # 文件树
│   │   ├── FileTreePanel.tsx
│   │   └── FilePreviewPopover.tsx
│   ├── tools/                  # 工具浏览器 + 调用历史
│   │   ├── ToolInspector.tsx
│   │   └── ToolCallHistory.tsx
│   ├── tasks/                  # Task 面板
│   │   └── TaskPanel.tsx
│   ├── memory/                 # Memory 浏览
│   │   └── MemoryInspector.tsx
│   ├── mcp/                    # MCP server 管理
│   │   └── McpInspector.tsx
│   ├── schedule/               # Cron 调度
│   │   └── ScheduleView.tsx
│   └── recipes/                # Recipe 库
│       └── RecipesView.tsx
├── components/                 # 跨特性原子组件
│   ├── Button.tsx
│   ├── Dialog.tsx
│   ├── Tooltip.tsx
│   ├── Toast.tsx
│   ├── ContextRing.tsx
│   ├── StatusBar.tsx
│   └── KeyHint.tsx
├── widgets/                    # 复合 widget
│   ├── Sidebar.tsx
│   ├── Topbar.tsx
│   ├── BottomBar.tsx
│   └── RightPanel.tsx
├── stores/                     # 全局 Zustand stores
│   ├── threadStore.ts          # 当前 active thread
│   ├── agentStore.ts           # agent 状态聚合
│   ├── uiStore.ts              # theme, vim, mode
│   └── tauriStore.ts           # Tauri commands 桥
├── types/                      # TypeScript 类型
│   ├── protocol.ts             # mirror reflect-protocol
│   ├── tauri.ts                # Tauri command 类型
│   └── config.ts
├── styles/
│   ├── tokens.css              # design tokens
│   ├── themes.css
│   ├── themes.dark.css
│   ├── themes.light.css
│   └── globals.css
└── utils/
    ├── tauri.ts                # invoke/listen 包装
    ├── markdown.ts
    ├── debounce.ts
    └── i18n.ts
```

---

## 4. Tauri 配置文件关键字段

```jsonc
// crates/reflect-gui/src-tauri/tauri.conf.json
{
  "productName": "Reflect",
  "version": "0.1.0",
  "identifier": "com.asketisch.reflectdesktop",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "app": {
    "macOSPrivateApi": true,
    "titleBarStyle": "Overlay",
    "transparent": true,
    "dragDropEnabled": true,
    "windows": [
      {
        "label": "main",
        "title": "Reflect",
        "width": 1280,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "decorations": true,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' data: asset: https://asset.localhost; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost"
    },
    "trayIcon": {
      "iconPath": "icons/icon.png",
      "iconAsTemplate": true,
      "menuOnLeftClick": false
    }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg", "msi", "deb", "appimage"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns", "icons/icon.ico"],
    "category": "DeveloperTool",
    "shortDescription": "AI coding agent GUI",
    "longDescription": "Reflect GUI for ZhuYe",
    "publisher": "Asketisch",
    "homepage": "https://github.com/Asketisch/ReflectDesktop"
  },
  "plugins": {
    "updater": {
      "endpoints": ["https://releases.cnb.com/reflect/{{target}}/{{arch}}/{{current_version}}"],
      "pubkey": "...",
      "windows": { "installMode": "passive" }
    },
    "fs": {
      "scope": [
        "$APPDATA/reflect/**",
        "$HOME/.zhuye/**",
        "$WORKSPACE/**"
      ]
    },
    "dialog": {},
    "opener": {
      "reveal": true
    },
    "notification": {
      "all": true
    },
    "process": {
      "all": false
    },
    "store": {}
  }
}
```

### 4.1 Capabilities（`src-tauri/capabilities/main.json`）

```jsonc
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Main window capabilities",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-focus",
    "core:event:default",
    "core:path:default",
    "dialog:default",
    "fs:default",
    "fs:allow-read-file",
    "fs:allow-write-file",
    "fs:scope-appdata-recursive",
    "notification:default",
    "opener:default",
    "opener:allow-reveal-item-in-dir",
    "store:default",
    "updater:default"
  ]
}
```

### 4.2 Cargo.toml features（`src-tauri/Cargo.toml`）

```toml
[dependencies]
tauri = { version = "2", features = ["macos-private-api", "tray-icon", "image-png"] }
tauri-plugin-updater = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-opener = "2"
tauri-plugin-process = "2"
tauri-plugin-store = "2"
tauri-plugin-notification = "2"
```

---

## 5. IPC 桥设计

### 5.1 后端：Tauri 命令骨架

```rust
// crates/reflect-gui/src-tauri/src/state.rs
use std::sync::Arc;
use parking_lot::Mutex;
use reflect_app_core::state::RenderState;
use reflect_app_core::services::Services;
use reflect_core::AgentThread;
use reflect_config::ConfigWatcher;
use reflect_protocol::Event;

pub struct AppState {
    pub thread: Arc<AgentThread>,
    pub render_state: Arc<Mutex<RenderState>>,
    pub services: Services,
    pub config_watcher: Arc<ConfigWatcher>,
}

impl AppState {
    pub async fn build() -> anyhow::Result<Self> {
        // 1. 加载 config
        let cfg = reflect_config::load_default()?;
        // 2. 构造 ModelRegistry
        let model_registry = Arc::new(ModelRegistry::default());
        cfg.apply_to_registry(&model_registry);
        // 3. 构造 ToolRegistry（22 builtins + TaskManager 注册）
        let mut tools = ToolRegistry::new();
        register_builtin_tools(&mut tools);
        let task_manager = Arc::new(TaskManager::new(...));
        reflect_task::register_task_tools(&tools, task_manager.clone());
        // 4. 构造 AgentThread
        let thread = Arc::new(AgentThread::new(agent_cfg, tools, ...));
        // 5. 启动 config watcher
        let watcher = ConfigWatcher::spawn(&config_path, cfg.clone());
        // 6. 构造 Services
        let services = Services { skills_catalog, task_manager: Some(task_manager), memory_store, ... };
        // 7. 构造 RenderState
        let mut render_state = RenderState::default();
        render_state.services = services.clone();
        Ok(Self {
            thread,
            render_state: Arc::new(Mutex::new(render_state)),
            services,
            config_watcher: Arc::new(watcher),
        })
    }
}
```

```rust
// crates/reflect-gui/src-tauri/src/commands/mod.rs
use reflect_protocol::{Op, Submission, Event};
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn reflect_submit(
    state: State<'_, AppState>,
    submission: Submission,
) -> Result<String, String> {
    state.thread.submit(submission).await.map_err(|e| e.to_string())?;
    Ok(submission.id)
}

#[tauri::command]
pub async fn reflect_interrupt(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.thread.cancel_token().cancel();
    Ok(())
}

#[tauri::command]
pub async fn reflect_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<SessionInfo>, String> {
    let home = dirs::home_dir().ok_or("no home")?;
    let base = home.join(".zhuye/sessions");
    Ok(reflect_rollout::index::list_sessions(&base))
}

#[tauri::command]
pub async fn reflect_rename_session(
    state: State<'_, AppState>,
    id: ThreadId,
    new_name: String,
) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("no home")?;
    let base = home.join(".zhuye/sessions");
    reflect_rollout::index::rename_session(&base, &id, &new_name)
        .map_err(|e| e.to_string())
}

// ... 14 个 Op + 5 个 Session + 3 个 Config + 1 个 Editor = 23 个 command
```

### 5.2 后端：Event 转发

```rust
// crates/reflect-gui/src-tauri/src/events.rs
use tauri::{AppHandle, Manager};
use reflect_protocol::Event;

pub async fn forward_agent_events(
    app: AppHandle,
    mut rx: tokio::sync::mpsc::Receiver<Event>,
) {
    while let Some(event) = rx.recv().await {
        if let Err(e) = app.emit("reflect_event", &event) {
            tracing::error!("emit reflect_event failed: {e}");
        }
    }
}
```

### 5.3 前端：Tauri 桥

```ts
// crates/reflect-gui/src/utils/tauri.ts
import { invoke } from '@tauri-apps/api/core';
import { listen, Event as TauriEvent } from '@tauri-apps/api/event';
import type { Event, Submission, SessionInfo, ... } from '@/types/protocol';

export async function submit(submission: Submission): Promise<string> {
    return await invoke<string>('reflect_submit', { submission });
}

export async function interrupt(): Promise<void> {
    return await invoke('reflect_interrupt');
}

export async function listSessions(): Promise<SessionInfo[]> {
    return await invoke('reflect_list_sessions');
}

// 单 event name；前端用 msg.type 分派
export async function onReflectEvent(handler: (event: Event) => void) {
    return await listen<Event>('reflect_event', (e: TauriEvent<Event>) => {
        handler(e.payload);
    });
}
```

### 5.4 前端：协议类型生成

```bash
# 在 reflect-protocol 加 example
cargo run -p reflect-protocol --example dump_schema > /tmp/reflect-schema.json

# 前端用 json2ts 转 TS
npx json2ts /tmp/reflect-schema.json -o src/types/protocol.ts
```

`dump_schema.rs` 实现：

```rust
// crates/reflect-protocol/examples/dump_schema.rs
use schemars::schema_for;
use reflect_protocol::{EventMsg, Submission, Op};

fn main() {
    let event_schema = schema_for!(EventMsg);
    let submission_schema = schema_for!(Submission);
    let op_schema = schema_for!(Op);
    let combined = serde_json::json!({
        "EventMsg": event_schema,
        "Submission": submission_schema,
        "Op": op_schema,
    });
    println!("{}", serde_json::to_string_pretty(&combined).unwrap());
}
```

需要在 `reflect-protocol/Cargo.toml` 加 `schemars = "0.8"` dev-dep。

---

## 6. 跨平台注意点

### 6.1 macOS

- `macOSPrivateApi: true` —— vibrancy / overlay
- `titleBarStyle: "Overlay"` —— 自定义标题栏
- `transparent: true` —— 透明背景 + vibrancy 效果
- 路径：`~/Library/Application Support/com.asketisch.reflectdesktop/`
- dock icon + tray 都启用

### 6.2 Windows

- 不要设 `transparent`（Win10 不支持）
- 标题栏用 `decorations: true`
- 文件锁注意 `LockFileEx` 需要 `.read(true)`。

### 6.3 Linux

- WebKitGTK 版本要求（参考 Tauri 2 文档）
- AppImage 打包
- X11 / Wayland clipboard 兼容性

---

## 7. 性能预算

| 指标 | 目标 | 测量方式 |
|---|---|---|
| 启动到首屏 | < 1.5s | `tauri::async_runtime::spawn` 完成 + DOM ready |
| 空闲 CPU | < 2% | 30Hz tick 在 toggle 时才跑 |
| 内存 | < 200MB | `ps -o rss` 测稳态 |
| Binary 大小 | < 15MB | `cargo build --release` |
| 流式延迟 | < 50ms | Event emit → React render |

---

## 8. 测试策略

### 8.1 单元测试

- `reflect-app-core::reducer`：纯函数 → insta snapshot
- `reflect-app-core::slash::dispatch`：覆盖所有 47 命令
- `reflect-app-core::state`：字段 mutation 正确性

### 8.2 集成测试

- Tauri command 单元测试（mock AgentThread）
- Event 转发 → emit 校验（mock AppHandle）

### 8.3 E2E

- WebDriver / Tauri WebDriver
- Playwright（前端）
- 主要 flow：新建会话 → 输入 → 看 streaming → approval → compact → 切换会话

---

## 9. 部署与发布

### 9.1 构建命令

```bash
# 开发
cd crates/reflect-gui
pnpm install
pnpm tauri dev

# 发布
cd crates/reflect-gui
pnpm tauri build

# 产物位置
src-tauri/target/release/bundle/
├── macos/Reflect.app
├── dmg/Reflect_0.1.0_aarch64.dmg
├── msi/Reflect_0.1.0_x64_en-US.msi
└── appimage/reflect_0.1.0_amd64.AppImage
```

### 9.2 CI/CD

GitHub Actions workflow：

- `cargo check -p reflect-gui`
- `cargo test -p reflect-app-core`
- `pnpm lint` + `pnpm type-check`
- `pnpm tauri build`（仅 release tag）
- 自动 upload 到 release page

### 9.3 Auto-update

`tauri-plugin-updater` 配置发布 endpoint；GUI 内检测版本 → 弹更新 dialog → 下载 → 重启。

---

## 10. 兼容性矩阵

| Reflect 版本 | GUI 版本 | 状态 |
|---|---|---|
| v1.0.0-rc1 (2026-06-24) | 0.1.0 | MVP 第一批 |
| v1.1.0 | 0.2.0 | 第二批增强 |
| v1.2.0 | 0.3.0 | 第三批差异化 |

GUI 跟随 Reflect 主版本号；每 minor 不强求同步升级（protocol additive 兼容）。

---

## 11. 与现有 TUI 的关系

- **不替换 TUI**：TUI 仍是核心，GUI 是补充
- **共享后端**：`reflect-protocol`/`reflect-core`/`reflect-rollout`/`reflect-config` 完全共享
- **GUI 优先于 TUI**：未来新功能可优先在 GUI 实现，再 backport 到 TUI（或反之）
- **共享测试**：snapshot 测试可在 `reflect-app-core::reducer` 一处覆盖 TUI + GUI

---

## 12. 迁移指引（设计稿 → 当前实施）

| 设计稿路径 | 当前实际路径 | 备注 |
|---|---|---|
| `crates/reflect-gui/src-tauri/` | 仓库根 `src-tauri/` | 已迁出 `crates/` |
| `crates/reflect-app-core/` | 仓库根 `app-core/` | 独立 crate 保留 |
| `crates/reflect-protocol/` 等 | `vendor/reflect-protocol/` 等 | 通过 `scripts/vendor-sync.sh` mirror |
| `crates/reflect-gui/src/features/` | 仓库根 `src/features/` | 路径前缀变化 |
| Tauri config | `src-tauri/tauri.conf.json` | 同名，路径变化 |
| 前端 Vite config | 仓库根 `vite.config.ts` | 路径变化 |

权威路径表见 [`../../codebase-map.md`](../../codebase-map.md)。