# 参考开源项目特性调研 —— ReflectDesktop 多 Agent 桌面端演进蓝本

> **文档目的**:整理 6 个开源桌面 AI agent 项目的全部特性(含参考代码路径),作为 ReflectDesktop 走向「手动协调多 agent 工作台」的目标演进参考。
>
> **目标产品形态**:类似 multica 的多 agent 协调平台,但合并 CodexMonitor / Reasonix / goose / Kun / thClaws 五个项目的桌面端能力。
>
> **数据截止**:2026-07-27(基于本地 checkout 实测,非记忆/猜测)。所有代码路径均为相对各项目仓库根目录的真实路径。

---

## 目录

1. [项目速览矩阵](#1-项目速览矩阵)
2. [multica-main —— 多 agent 协调平台(核心蓝本)](#2-multica-main--多-agent-协调平台核心蓝本)
3. [CodexMonitor-main —— Codex 监控桌面端(架构近亲)](#3-codexmonitor-main--codex-监控桌面端架构近亲)
4. [DeepSeek-Reasonix —— 推理引擎 + 多前端](#4-deepseek-reasonix--推理引擎--多前端)
5. [goose-main —— Rust agent + MCP + Schedule](#5-goose-main--rust-agent--mcp--schedule)
6. [Kun-master —— Electron 需求先行工作台](#6-kun-master--electron-需求先行工作台)
7. [thClaws-main —— 单 Rust 二进制 + 三层编排](#7-thclaws-main--单-rust-二进制--三层编排)
8. [ReflectDesktop 现状与缺口](#8-reflectdesktop-现状与缺口)
9. [能力清单(横向汇总,供后续开发)](#9-能力清单横向汇总供后续开发)
10. [演进路线建议](#10-演进路线建议)

---

## 1. 项目速览矩阵

| 项目 | 技术栈 | 桌面端 | 多 agent 模型 | 定位 |
|---|---|---|---|---|
| **multica-main** | Go 后端 + Next.js Web + **Electron 桌面** + RN 移动 | Electron(`apps/desktop`) | **Server 调度 + 本地 daemon 执行**(20+ CLI agent) | 人 + AI 协作的任务管理平台,agent 是一等公民 |
| **CodexMonitor-main** | **Tauri 2 + React 19**(与 ReflectDesktop 同构) | Tauri | 每 workspace 一个 `codex app-server` 子进程 | Codex 多 workspace 编排,Read elation ReflectDesktop 的近亲 |
| **DeepSeek-Reasonix-main-v2** | Go 内核 + **Wails 桌面** + bubbletea TUI + VS Code 扩展 | Wails(WebKit) | 单进程内 **fleet / coordinator**(2–64 并发子 agent) | DeepSeek-native 推理引擎,cache-first |
| **goose-main** | **Rust crates** + **Electron 桌面**(`ui/desktop`) + CLI | Electron | subagent + schedule(cron recipe) | AAIF/Linux 基金会通用 agent,15+ provider |
| **Kun-master** | **Electron 34 + React 19** + 本地 `kun` 运行时(HTTP/SSE) | Electron | runtime 内 subagent + workflow + schedule | 需求先行 Code/Design/Write 三模式 |
| **thClaws-main** | **单 Rust crate**(`crates/core`)+ React 前端(`frontend/`,wry 内嵌) | wry(Tao 窗口) | **三层:subagent / side-channel / 多进程 Team** | 泰国团队开源,与 ReflectDesktop 架构最接近 |

> **架构亲缘关系**:ReflectDesktop(Tauri+React+Rust vendor 镜像)最接近 **CodexMonitor**(同构)+ **thClaws**(单 Rust 引擎 + React 前端)。multica 是协调平台层面的产品蓝本,goose/Kun/Reasonix 是单项能力参照。

---

## 2. multica-main —— 多 agent 协调平台(核心蓝本)

> 仓库路径:`~/Code/Github/AgentGUI/multica-main`
> 一句话:**Go 后端做调度,Electron 桌面做 UI,本地 daemon 跑 agent CLI**。agent 是 workspace 内的一等公民,有 profile、可被 assign、能评论、能创建 issue。

### 2.1 技术栈与目录结构

- **后端**:Go(Chi router + sqlc + gorilla/websocket + Postgres + Redis + cron v3)— `server/`
- **前端 monorepo**:pnpm workspaces + Turborepo
  - `apps/web/` — Next.js(App Router)
  - `apps/desktop/` — **Electron**(electron-vite + React Router + shadcn)
  - `apps/mobile/` — React Native
  - `packages/core/` — headless 业务逻辑(Zustand stores + React Query hooks + API client)
  - `packages/ui/` — 原子组件(shadcn/Base UI,零业务逻辑)
  - `packages/views/` — 跨端共享业务页面
- **关键文档**:`docs/product-overview.md`(功能事实汇总)、`docs/design.md`(设计系统)、`AGENTS.md`→`CLAUDE.md`(agent 工作契约)

### 2.2 多 agent 协调能力(核心)

#### 2.2.1 Agent 抽象 —— 统一 20+ 种 coding CLI

- **统一 Backend 接口**:每个 agent CLI(claude/codex/cursor/copilot/grok/hermes/kimi/kiro/qoder/trae/qwen/antigravity/codebuddy/deveco/opencode/openclaw/pi)实现同一个 `agent.Backend`,屏蔽差异。
- 代码:`server/pkg/agent/agent.go`(`Backend` trait)、`server/pkg/agent/{claude,codex,cursor,copilot,grok,hermes,kimi,kiro,qoder,traecli,qwen,antigravity,codebuddy,deveco,opencode,openclaw,pi}.go`(每个 CLI 一个文件)
- 关键字段(`agent.ExecOptions`):`Cwd / Model / SystemPrompt / ThreadName / MaxTurns / Timeout / IdleWatchdogTimeout / HandshakeTimeout / ResumeSessionID / ResumeExpected / ExtraArgs / CustomArgs / McpConfig / ThinkingLevel / ServiceTier / OpenclawMode`

#### 2.2.2 Daemon —— 本地 agent 执行器

> **核心设计**:agent 不在 server 上跑,而在用户机器上跑。daemon 探测本地 CLI、注册 runtime、轮询 server 认领任务、spawn agent、回流事件。

- `server/internal/daemon/daemon.go` — daemon 主循环
- `server/internal/daemon/client.go` — daemon ↔ server 的认领/心跳/上报协议(`client_batch_claim_test.go` = 批量认领)
- `server/internal/daemon/runtime_probe_*.go` — 探测 `$PATH` 上已装的 CLI
- `server/internal/daemon/runtime_mcp.go` — 把 agent 的 MCP 配置注入 CLI
- `server/internal/daemon/local_skills.go` — 把挂载的 skill 注入工作目录
- `server/internal/daemon/reconcile.go` — runtime 状态对账
- `server/internal/daemon/wakeup.go` — 任务唤醒
- `server/internal/daemon/health.go` — `/health` 健康端点
- 桌面端管理:`apps/desktop/src/main/daemon-manager.ts`(spawn/stop/poll CLI 二进制,健康轮询 5s,start timeout 60s 覆盖 CLI 45s 冷启动)

#### 2.2.3 Dispatch —— 执行准入决策

- `server/internal/dispatch/reason.go` — `ReasonCode` 枚举(queued/coalesced/deferred/invocation_not_allowed/target_unavailable/runtime_offline/attribution_blocked/already_active/self_trigger_suppressed/internal_error),跨 service/handler 共享,客户端可本地化

#### 2.2.4 Scheduler + Autopilot —— 定时/事件驱动

- `server/internal/scheduler/manager.go` — `Manager`(基于 Postgres `sys_cron_executions` 表,TickInterval 默认 30s,RunnerID 标识进程,多副本用 `concurrent_claim` 防重复认领)
- `server/internal/scheduler/spec.go` — `JobSpec` 注册规范
- `server/internal/scheduler/jobs_autopilot.go` — autopilot 作业(到点创建 issue + 路由给 agent)
- `server/internal/scheduler/jobs_task_usage.go` — 用量统计作业
- Autopilot 前端:`packages/core/autopilots/{mutations,queries,webhook}.ts`、`packages/views/autopilots/components/schedule-editor/`(cron 编辑器)、`packages/views/autopilots/components/pickers/`

#### 2.2.5 Squads —— agent 小组(leader 委派)

- 把多个 agent + 人组在一个 squad 下,指派给 squad 后由 leader agent 决定谁接;`@FrontendTeam` 而非 `@alice-or-bob`。
- `packages/core/squads/{index.ts,stores/view-store.ts}`
- `packages/views/...`(squad 视图)

#### 2.2.6 Realtime —— WebSocket 事件流

- `server/internal/realtime/{hub,broadcaster,redis_relay,sharded_stream_relay,relay_lifecycle}.go` — 多副本下用 Redis 分片 relay,单进程用内存 hub;事件按 workspace/session 分流
- 前端:`packages/core/realtime/{provider.tsx,use-realtime-sync.ts,hooks.ts}` — WS 事件 → React Query 变更,单一 responder/self-event guard 防 echo

#### 2.2.7 Polymorphic Actor —— agent 与人同构

- 几乎所有「谁做了什么」字段都是 `actor_type`(`member`/`agent`) + `actor_id`。这就是 agent 能创建 issue、发评论、被订阅的根因。贯穿所有 DB 表。

#### 2.2.8 Session Resumption

- 同一对 `(agent, issue)` 的下一次任务自动复用上次的 `session_id` + `work_dir`(Claude Code 的 session 恢复),上下文/文件状态保留。`agent_task_queue.session_id`、`.work_dir`。

### 2.3 桌面端能力(Electron)

- `apps/desktop/src/main/index.ts` — 主进程入口
- `apps/desktop/src/main/daemon-manager.ts` — 管理 `multica daemon`(spawn/stop/health poll/log tail/auth probe)
- `apps/desktop/src/main/cli-bootstrap.ts` + `cli-release-asset.ts` — 自动下载/更新内置 CLI 二进制
- `apps/desktop/src/main/updater.ts` + `updater-preferences.ts` — `electron-updater` 自动更新
- `apps/desktop/src/main/keyboard-shortcuts.ts` — `before-input-event` 拦截 zoom/reload/close-tab(跨键盘布局可靠)
- `apps/desktop/src/main/window-state.ts` — 窗口几何持久化(`window-state.json`)
- `apps/desktop/src/main/auth-session-coordinator.ts` — OAuth 会话协调
- `apps/desktop/src/main/context-menu.ts` — 右键菜单
- `apps/desktop/src/main/notification-gate.ts` — 通知节流
- `apps/desktop/src/main/renderer-recovery.ts` — renderer 崩溃恢复
- `apps/desktop/src/main/navigation-guard.ts` + `navigation-gestures.ts` — 路由守卫 + 手势导航
- `apps/desktop/src/main/freeze-breadcrumb.ts` — 面包屑冻结(防止异步跳变)
- `apps/desktop/src/main/local-directory.ts` — 本地目录操作
- `apps/desktop/src/main/runtime-config-loader.ts` — 运行时配置加载
- `apps/desktop/src/preload/index.ts` + `index.d.ts` — contextBridge 类型化暴露
- `apps/desktop/src/shared/daemon-types.ts` — daemon 协议类型(桌面与 daemon 共享)
- `apps/desktop/src/shared/main-renderer-messages.ts` — main↔renderer IPC 消息
- `apps/desktop/src/shared/runtime-config.ts` — 运行时配置(端口、profile)
- `apps/desktop/src/shared/issue-window.ts` — issue 多窗口
- 设计系统:`packages/ui/styles/tokens.css`(OKLCh + surface 四层:`app-shell` / `page-canvas` / `surface` / `surface-raised`)、`docs/design.md`(克制即高级 / 层次靠灰度 / 一致性大于个性)

### 2.4 其他值得借鉴的特性

- **Skill 系统**:workspace 级可复用说明文档,开跑时注入工作目录(`packages/core/skills/{index.ts,frontmatter.ts}`、`server/internal/skill/{frontmatter.go,reserved.go}`、`server/internal/daemon/local_skills.go`、`server/pkg/skillbundle`)
- **agent 模板**:`server/internal/agenttmpl/{loader.go,types.go,templates/}` — 预置 agent 定义
- **Issue 看板**:List / Board(Kanban 拖拽) / My Issues 三视图(`packages/views/my-issues/`)
- **Chat**:`packages/core/chat/`、`packages/views/chat/` — 不依附于 issue 的持久多轮对话
- **Inbox**:`packages/core/inbox/` — 通知中心(@、assign、订阅更新)
- **GitHub 集成**:`packages/core/github/`、`server/internal/integrations/`
- **Slack / Lark 集成**:`packages/core/{slack,lark}/`
- **权限/属性归属**:`packages/core/permissions/`、`server/internal/attribution/`(fail-closed workspace 必须能解析到负责人)
- **i18n**:`packages/views/locales/{en,zh-Hans,ja,ko}/`、`I18N.md`
- **分析**:`packages/core/analytics`、`server/internal/analytics/`、PostHog
- **Feature flags**:`packages/core/feature-flags/`、`server/internal/featureflags/`、`docs/feature-flags.md`

---

## 3. CodexMonitor-main —— Codex 监控桌面端(架构近亲)

> 仓库路径:`~/Code/Github/AgentGUI/CodexMonitor-main`
> 一句话:**Tauri 2 + React 19**(与 ReflectDesktop 几乎同构),每 workspace spawn 一个 `codex app-server` 子进程,通过 stdio JSON-RPC 通信。

### 3.1 技术栈与目录结构

- **前端**:React 19 + Vite + TanStack Query/Virtual + Tiptap + xterm + react-markdown + PrismJS + material-icons(`src/`)
- **后端**:Tauri 2(`src-tauri/`,Rust),关键依赖:`tokio-tungstenite`(WS)、`git2`(原生 git)、`whisper-rs`(本地 STT)、`portable-pty`(终端)、`tauri-plugin-{liquid-glass,notification,opener,process,updater,window-state,dialog}`
- **feature 目录**:`src/features/{about,apps,collaboration,composer,debug,design-system,dictation,files,git,home,layout,messages,mobile,models,plan,prompts,sessions,settings,shared,skills,terminal,threads,update,workspaces}` —— **与 ReflectDesktop 几乎逐项一致**(ReflectDesktop 的 feature 切分很可能借鉴自此处)
- **macOS 原生**:`objc2` + `objc2-app-kit` + `objc2-av-foundation`(vibrancy / 摄像头 / NSAppearance)、`titleBarStyle: Overlay` + `transparent: true` + `trafficLightPosition`

### 3.2 Codex agent 监控/管理能力(核心)

#### 3.2.1 app-server 协议适配

- `src-tauri/src/backend/app_server.rs` — 每个 workspace spawn 一个 `codex app-server` 子进程,持有 `Child / ChildStdin`,通过 JSON-RPC over stdio 通信;`extract_thread_id` / `extract_related_thread_ids` 从 method/result 解析 thread 关系
- `src-tauri/src/backend/events.rs` — `AppServerEvent` / `TerminalOutput` / `TerminalExit` + `EventSink` trait(抽象 emit,便于 daemon 复用)
- `src-tauri/src/backend/mod.rs`
- `src-tauri/src/codex/{mod,args,config,home}.rs` — Codex CLI 参数解析 / 配置 / home 探测

#### 3.2.2 多 workspace / 多线程

- `src-tauri/src/shared/workspaces_core/{io,connect,worktree,crud_persistence,git_orchestration,runtime_codex_args,helpers}.rs` — workspace CRUD / 连接 / worktree 隔离 / git 编排
- `src-tauri/src/workspaces/{commands,files,git,macos,settings,tests,worktree,mod}.rs` — Tauri 命令
- **worktree 隔离**:每个 agent 一个 git worktree,放在 app data 目录(`.codex-worktrees` legacy 兼容)

#### 3.2.3 远程 daemon(iOS / Tailscale)

- `src-tauri/src/bin/codex_monitor_daemon.rs` + `codex_monitor_daemonctl.rs` — 独立 daemon 二进制(line-delimited JSON-RPC over TCP,token 鉴权)
- `src-tauri/src/bin/codex_monitor_daemon/{transport,rpc/{dispatcher,codex,git,workspace,prompts,daemon}}.rs` — RPC 方法集
- `src-tauri/src/remote_backend/{mod,protocol,tcp_transport,transport}.rs` — 桌面端作为远程客户端
- `src-tauri/src/tailscale/{core,mod,daemon_commands,rpc_client}.rs` — Tailscale 自动探测/host bootstrap
- 协议清单见 `REMOTE_BACKEND_POC.md`(ping/list_workspaces/add_worktree/connect_workspace/start_thread/resume_thread/list_threads/send_user_message/turn_interrupt/start_review/model_list/account_rate_limits/skills_list/respond_to_server_request ...)
- iOS 蓝本:`docs/mobile-ios-tailscale-blueprint.md`(ReflectDesktop 有同名文件,印证借鉴关系)

### 3.3 桌面端能力

- `src-tauri/src/tray.rs` — macOS 托盘(recent threads / workspaces / usage 三段菜单,`TRAY_OPEN_THREAD_EVENT`)
- `src-tauri/src/menu.rs` / `menu_mobile.rs` — 菜单(桌面/移动分裂编译)
- `src-tauri/src/window.rs` — `apply_macos_window_appearance`(NSAppearance 原生切主题,支持 light/dark/dim/system)
- `src-tauri/src/notifications.rs` + `src/utils/notificationSounds.ts` — 系统 + 声音通知
- `src-tauri/src/local_usage.rs` + `src/shared/local_usage_core.rs` — 账户 rate limit / credits 读取
- `src-tauri/src/dictation/{mod,real,stub}.rs` — Whisper 本地听写(`cpal` 采集 + `whisper-rs` 推理,hold-to-talk + 实时波形,iOS/Android stub)
- `src-tauri/src/terminal.rs` / `terminal_mobile.rs` — xterm 终端 dock(portable-pty,多 tab)
- `src-tauri/src/files/{mod,io,ops,policy}.rs` — 文件树 + 搜索 + Reveal in Finder
- `src-tauri/src/git_utils.rs` + `src-tauri/src/shared/git_{core,rpc,ui_core}.rs` + `shared/git_ui_core/{log,commands,github,diff,context,tests}.rs` — git diff/log/stage/revert + GitHub Issues/PR(经 `gh`)
- `src-tauri/src/rules.rs` / `prompts.rs` — 全局/workspace prompt 库
- `src/utils/{shortcuts,keys,uiScale,fonts,platformPaths}.ts` — 快捷键 / UI 缩放 / 字体 / 平台路径
- `src/utils/{codexArgsInput,threadItems,threadStatus,chatScrollback,appServerEvents,commitMessage,pullRequestPrompt,pullRequestReviewPrompt}.ts` — Codex 参数 / thread 项渲染 / PR 上下文构造
- macOS 液态玻璃:`tauri-plugin-liquid-glass`

### 3.4 Composer & Agent Controls(与 ReflectDesktop 对齐)

- 自动补全:`$` skills / `/prompts:` prompts / `/review` / `@` 文件路径
- 跟进行为(Queue vs Steer):运行中发消息可选排队或转向;`Shift+Cmd+Enter` / `Shift+Ctrl+Enter` 发反向动作 —— **与 ReflectDesktop 的 Follow-up Behavior Map 完全一致**
- Model picker / collaboration modes / reasoning effort / access mode / context usage ring
- 渲染 reasoning / tool / diff,处理 approval 提示

### 3.5 对 ReflectDesktop 的借鉴价值

> **极高**。CodexMonitor 是 ReflectDesktop 的「架构近亲」,feature 模块几乎一一对应。差异:
> - CodexMonitor 直接 spawn `codex app-server`;ReflectDesktop 嵌入 `reflect_core::AgentThread`(更内聚)。
> - CodexMonitor 已落地 **iOS + Tailscale 远程 daemon**;ReflectDesktop 有同名 blueprint 文档但未落地。
> - CodexMonitor 的 **dictation / liquid-glass / terminal dock / GitHub 集成** 都是 ReflectDesktop 可直接对照的实现参考。

---

## 4. DeepSeek-Reasonix —— 推理引擎 + 多前端

> 仓库路径:`~/Code/Github/AgentGUI/DeepSeek-Reasonix-main-v2`
> 一句话:**Go 单二进制**内核(`internal/`),三种前端共享同一 `control.Controller`:bubbletea TUI、Wails 桌面、VS Code 扩展。cache-first(系统 prompt prefix 字节稳定以命中 DeepSeek 前缀缓存)。

### 4.1 技术栈与目录结构

- **内核**:Go(`internal/`,CGO_ENABLED=0 单静态二进制,交叉编译 6 目标)
- **桌面**:`desktop/`(嵌套 module `reasonix/desktop`,Wails v2 + WebKit,不污染 CLI 的 CGO 保证)
- **TUI**:`cmd/reasonix/` + `internal/`(bubbletea v2 + lipgloss v2 + bubbles v2 + chroma 语法高亮 + tree-sitter)
- **VS Code**:`reasonix acp` 后端 + 独立扩展仓库
- **配置**:`reasonix.example.toml`(provider/agent/tools/plugins/notifications/desktop 全声明式)
- **关键设计**(REASONIX.md):「一个 transport-agnostic `control.Controller` 坐在所有前端后面;加行为加到 controller,不加到 frontend,三种前端自动继承」

### 4.2 agent 推理/执行能力(核心)

#### 4.2.1 Control Controller —— 跨前端业务核心

- `internal/control/controller.go` — 单一控制器,所有前端共用
- `internal/control/{approval,attachments,auto_plan,branches,capability,checkpoint,errmsg}.go` — 审批 / 附件 / 自动 plan / 分支 / 能力门 / checkpoint / 错误
- 事件出口:`eventChannel = "agent:event"`(Wails runtime event,前端订阅,`kind` 字段判别)

#### 4.2.2 Fleet —— 并行子 agent 调度(关键)

- `internal/agent/fleet.go` — `FleetTool`:2–64 个 profile-aware 子 agent 并行,session scheduler 下调度;**多写者必须预声明非重叠 `write_paths`**,preflight 失败则不启动;支持 background 模式返回 job id,`wait` 收集
- `internal/agent/coordinator.go` — `Runner` 接口(`Agent` 单模型与 `Coordinator` 双模型都满足);**双模型协作**(executor + planner,planner 只读工具,产出 executor-ready 计划);`PlannerPlanApprover` / `PlannerUserDecisionAsker` 让 host 绑定原生 UI
- `internal/agent/{agent,compact,delivery_scope,interrupted_recovery,goal_display}.go` — agent 主循环 / 上下文压缩 / 交付范围 / 中断恢复 / 目标展示
- `internal/agent/{capability_gate,cache_shape,guards}.go` — 能力门 / cache 形状保持 / 守卫

#### 4.2.3 Jobs —— 后台作业系统

- `internal/jobs/{jobs,artifacts}.go` — 后台 job + 产物;`concurrency_stress_test.go` 压测并发
- 与 fleet 的 `run_in_background` 配合

#### 4.2.4 Planmode + Skill + ACP

- `internal/planmode/{context,policy}.go` — Plan 模式策略 / 标记
- `internal/skill/{skill,builtins,index,profile,tools,builtin_embed}.go` + `internal/skill/builtincontent/` — skill 系统(内嵌 + 用户 + 索引 + profile)
- `internal/acp/{server,client,dispatch,protocol,service}.go` — **Agent Client Protocol**(server + client 双向,ACP 让 Reasonix 既能当 ACP server 给 VS Code 用,也能当 client 接 Claude Code/Codex 等 ACP backend)

#### 4.2.5 Cache-first 上下文维护

- 启动注入稳定环境摘要;陈旧工具输出在压缩前 snip/prune;`soft_compact_ratio` / `compact_ratio` / `compact_force_ratio` / `tool_result_snip_ratio` 四档阈值(`reasonix.example.toml` `[agent]` 段)
- `internal/agent/cache_shape.go` + `cache_diagnostics_test.go` + `cachehit_e2e_test.go`

#### 4.2.6 子模型与多 provider

- `[[providers]]` TOML 段:每个 provider 一个 base_url + key + 多 model;`reasoning_protocol` / `effort` / `prices` / `context_window` / `model_overrides`
- 预置 Kimi / MiMo / MiniMax / GLM / Qwen / StepFun / NovitaAI / Ollama Cloud 等 editable presets
- `internal/provider/`(anthropic / openai 子目录)

### 4.3 桌面端能力(Wails)

- `desktop/main.go` — Wails shell,绑定 `control.Controller` 直接给 UI(无 HTTP 跳),嵌套 module 隔离 CGO/WebKit 依赖
- `desktop/app.go` — App 主体(import 全部 internal/* 内核包:agent/control/event/jobs/skill/memory/plugin/provider/tool/...)
- `desktop/tray.go` — `fyne.io/systray` 系统托盘
- `desktop/sessions.go` + `desktop/session_{prompt,errors}.go` — 会话管理
- `desktop/remote_{app,askpass,hosts,markdown_image,prefs,ssh_path,ssh_process_unix,ssh_process_windows,ssh_transport}.go` — **远程 SSH** 桌面端连接远端 Reasonix
- `desktop/{bot_bridge,bot_bridge_app,bot_connection_app,bot_event_sink,bot_runtime_app}.go` — bot 桥接(Lark/IM)
- `desktop/{hang_watchdog,heartbeat,single_instance,startup_recovery,recovery_gc}.go` — 看门狗 / 心跳 / 单实例 / 启动恢复 / GC
- `desktop/{devinfo,external_opener,menu,memory_suggestions,metrics_app,plugin_packages_app,settings_app,hooks_settings_app}.go` — 设备信息 / 外部打开 / 菜单 / 记忆建议 / 指标 / 插件包 / 设置 / hooks
- `desktop/{updater_mac,updater_windows,tabs,workspace_changes,workbench_runtime_adapter,deferred_rebuild,theme_assets,encoded_file,delivery_worktree,shared_host,crash_app,crash_pending}.go` — 更新器(平台分裂)/ tabs / 工作区变更 / workbench 适配 / 延迟重建 / 主题资产 / 编码文件 / 交付 worktree / 共享 host / 崩溃处理
- `desktop/nvidia_wayland_linux.go` — Linux Wayland + NVIDIA 兼容
- `desktop/cmd/{sign,update-helper,windows-resource}` — 签名 / 更新助手 / Windows 资源

### 4.4 其他值得借鉴的特性

- **Hierarchical memory**:`REASONIX.md`(committed) + `REASONIX.local.md`(gitignored) + `~/.config/reasonix/REASONIX.md`(全局) + 祖先目录 `REASONIX.md`;`@path` 导入文件;`#<note>` 速记;`remember` 工具写持久记忆
- **Subagent / planner_model / subagent_models**:`[agent]` 段配置子 agent 模型 + 每技能覆盖 + `max_subagent_concurrency` + `max_parallel_writers`
- **Output styles**:`explanatory | learning | concise` + 自定义 `.reasonix/output-styles/<name>.md`
- **Doctor / capdiag / mcpdiag / repair**:`internal/{doctor,capdiag,mcpdiag,repair}/` — 诊断子系统
- **Sandbox / permission / guardian / recovery**:`internal/{sandbox,permission,guardian,recovery}/`
- **Hooks / secrets / keyring**:`internal/{hook,secrets}/` + `zalando/go-keyring`
- **Tree-sitter 代码理解**:`go-tree-sitter` + js/python/rust/typescript 语法
- **i18n**:`internal/i18n/` + `[ui] language`
- **benchmarks / e2ebench**:`benchmarks/` + `cmd/e2ebench/`

### 4.5 对 ReflectDesktop 的借鉴价值

- **control.Controller 抽象**:ReflectDesktop 已有 `AgentThread`(reflect-core),但缺少「跨前端单一控制器」的明确契约。Reasonix 的做法值得对照。
- **Fleet 并行 + write_paths 预声明**:与 ReflectDesktop `vendor/reflect-task` 的 `MAX_CLAIMED_TASKS_PER_WORKER` + `claimed_by` 思路一致,但 Reasonix 的 `write_paths` glob 隔离更细粒度。
- **ACP 双向**:ReflectDesktop 目前是自包含 agent;若要编排外部 ACP backend(Claude Code/Codex),Reasonix 的 `internal/acp/` 是直接参考。
- **cache-first**:ReflectDesktop 已有 `reflect-compact`(smart_prune),但 Reasonix 的「prefix 字节稳定」+ 四档压缩阈值是更系统的工程实践。

---

## 5. goose-main —— Rust agent + MCP + Schedule

> 仓库路径:`~/Code/Github/AgentGUI/goose-main`
> 一句话:**Rust workspace**(crates/*)+ **Electron 桌面**(ui/desktop)+ CLI + Server。AAIF/Linux 基金会项目,15+ provider,70+ MCP 扩展。

### 5.1 技术栈与目录结构

- **Rust crates**:`crates/{goose, goose-cli, goose-server, goose-mcp, goose-providers, goose-provider-types, goose-sdk, goose-sdk-types, goose-acp-macros, goose-download-manager, goose-local-inference, goose-test, goose-test-support}`
- **桌面**:`ui/desktop/`(Electron Forge + Vite + React + TypeScript,多 vite config:`vite.{main,preload,renderer}.config.mts`)
- **关键依赖**:`rmcp`(MCP Rust SDK)、`agent-client-protocol`(ACP)、`tokio-cron-scheduler`、`keyring`、`arboard`(剪贴板)、`candle-{core,nn}`(本地推理)
- **构建**:`Justfile`、`bin/activate-hermit`、`flake.nix`

### 5.2 agent 执行能力(核心)

#### 5.2.1 goose core —— 引擎

- `crates/goose/src/agents/{agent,extension,extension_manager,mcp_client,platform_extensions,platform_tools,prompt_manager,schedule_tool,subagent_execution_tool,subagent_handler,reply_parts,retry,large_response_handler,final_output_tool,container,execute_commands,extension_malware_check}.rs` — agent 主循环 + 扩展管理 + subagent 工具 + 调度工具
- `crates/goose/src/agents/subagent_execution_tool/` — subagent 执行工具(目录)
- `crates/goose/src/agents/schedule_tool.rs` — 调度工具(agent 可创建定时任务)
- `crates/goose/src/agents/moim.rs` — "moim"(多 agent 协作)

#### 5.2.2 Scheduler —— cron recipe 调度

- `crates/goose/src/scheduler.rs` — `JobScheduler`(`tokio_cron_scheduler`),`ScheduledJob` + `JobsMap` + `RunningTasksMap`(CancellationToken 取消);持久化到 `Paths::data_dir()/schedule.json`;recipe 存 `scheduled_recipes/`
- `crates/goose/src/scheduler_trait.rs` — `SchedulerTrait` 抽象
- `crates/goose/src/recipe/{build_recipe,local_recipes,manifest,template_recipe,recipe_extension_adapter,validate_recipe,yaml_format_utils,read_recipe_file_content}.rs` — recipe(可复用 prompt + 扩展组合,可被 schedule 调度)
- 桌面 UI:`ui/desktop/src/components/schedule/`

#### 5.2.3 Session + Session Manager

- `crates/goose/src/session/{mod,session_manager,session_naming,chat_history_search,diagnostics,extension_data,import_formats,last_message_snippet,legacy,nostr_share}.rs`
- `SessionType` 区分不同会话形态
- `chat_history_search.rs` — 跨会话搜索

#### 5.2.4 Providers —— 15+ provider

- `crates/goose/src/providers/{anthropic_def,azure,bedrock,gcpvertexai,google,huggingface,githubcopilot,databricks_{v2}_def,custom_provider_config,init,base,acp_tooling}.rs` + `{amp_acp,claude_acp,codex_acp,copilot_acp}.rs`(ACP 接入)+ `{claude_code,codex,cursor_agent,gemini_cli,chatgpt_codex}.rs`(本地 CLI 接入)+ `{azureauth,gcpauth,gemini_oauth,huggingface_auth}.rs`(OAuth)
- `crates/goose/src/providers/formats/` — 各 provider 消息格式

#### 5.2.5 Permission —— 工具审批

- `crates/goose/src/permission/{mod,permission_inspector,permission_judge,permission_store}.rs` — inspector + judge + store 三层

#### 5.2.6 MCP —— 70+ 扩展

- `crates/goose-mcp/src/{lib,mcp_server_runner,subprocess}.rs` + `crates/goose-mcp/src/{computercontroller,memory,peekaboo,autovisualiser,tutorial}/` — 内置扩展(计算机控制 / 记忆 / 屏幕取色 / 自动可视化 / 教程)
- `crates/goose-mcp/src/computercontroller/{mod,docx_tool,pdf_tool,xlsx_tool,platform/}` — DOCX/PDF/XLSX 文档工具 + 平台能力
- `crates/goose-mcp/README.md` + `examples/`

#### 5.2.7 其他核心模块

- `crates/goose/src/{config,context_mgmt,dictation,elicitation,execution,gateway,goose_apps,hooks,oauth,otel,permission,plugins,posthog,prompts,recipe,security,skills,slash_commands,token_counter,tool_inspection,tool_monitor,tracing}.rs` + `crates/goose/src/{acp,checks,prompts,providers,recipe,skills,subprocess}.rs`(目录)
- `elicitation.rs` — MCP elicitation(向用户要结构化输入)
- `dictation/{mod,providers,whisper,whisper_data}.rs` — Whisper 听写
- `context_mgmt/` — 上下文管理
- `execution/` — 执行器
- `gateway/` — 网关
- `hooks/mod.rs` — hooks
- `skills/{mod,client,arguments,builtin,builtins}.rs` — skill 系统

### 5.3 桌面端能力(Electron)

- `ui/desktop/forge.config.ts` — Electron Forge 配置(`goose://` 协议注册、macOS dock 拖拽文件夹、TCC usage description、Windows 代码签名、Linux Vulkan 变体)
- `ui/desktop/src/components/{GooseSidebar,sessions,recipes,schedule,skills,extensions,McpApps,context_management,parameter,onboarding,conversation,bottom_menu,apps,alerts,settings,Layout,common,icons,ui}/` — 完整桌面 UI
- `ui/desktop/src/{platform/windows,utils,hooks,i18n/messages,theme,stores,contexts,types,bin}/` — 平台层 / hooks / i18n / 主题
- `ui/desktop/src/recipe/` — recipe 客户端
- `ui/desktop/playwright.config.ts` + `tests/` — Playwright E2E

### 5.4 goose-server —— HTTP API

- `crates/goose-server/src/{auth,configuration,routes,commands,session_event_bus,state,tls,openapi,error,logging}.rs` — HTTP server(auth/TLS/OpenAPI)
- `crates/goose-server/src/routes/{schedule,reply,recipe,recipe_utils,session_events,mod}.rs` — schedule / reply / recipe / session_events 路由
- `crates/goose-server/src/commands/agent.rs` — agent 命令
- `crates/goose-server/ALLOWLIST.md` — 权限白名单
- `crates/goose-server/ui/` — 内嵌 UI 资源

### 5.5 其他值得借鉴的特性

- **Custom Distros**(`CUSTOM_DISTROS.md`):构建预配置 provider/扩展/品牌的 goose 发行版 —— ReflectDesktop 可借鉴做「ReflectDesktop for Team X」定制包
- **Goose Apps**(`crates/goose/src/goose_apps.rs`):打包的 agent 应用
- **Plugin 恶意检查**:`crates/goose/src/agents/extension_malware_check.rs` — 加载扩展前扫描
- **ACP 双向**:`crates/goose/src/providers/*_acp.rs` — goose 既能接 ACP backend,也能作为 ACP server
- **本地推理**:`crates/goose-local-inference/`(candle) — 离线模型
- **Download Manager**:`crates/goose-download-manager/` — 模型/扩展下载
- **SDK**:`crates/goose-sdk/`(uniffi 跨语言)+ `goose-sdk-types/` —— 嵌入到其他应用
- **i18n**(`I18N.md`):`ui/desktop/src/i18n/messages/`
- **Token counter / cost**:`crates/goose/src/token_counter.rs`

### 5.6 对 ReflectDesktop 的借鉴价值

- **scheduler_trait + tokio-cron-scheduler**:ReflectDesktop 已有 `vendor/reflect-stream/cron.rs`(自实现 5 字段 cron),但 goose 的 `SchedulerTrait` 抽象 + recipe 组合是更高层的封装。
- **recipe 系统**:把「prompt + 扩展组合」打包成可调度单元 —— ReflectDesktop 的 skill 偏静态说明,recipe 偏可执行工作流,二者可融合。
- **permission 三层**(inspector/judge/store):ReflectDesktop 有 `reflect-permissions`,但 inspector/judge 分离值得对照。
- **elicitation**:MCP elicitation 是 ReflectDesktop 缺失的(目前只有 ask_user_question)。

---

## 6. Kun-master —— Electron 需求先行工作台

> 仓库路径:`~/Code/Github/AgentGUI/Kun-master`
> 一句话:**Electron 34 + React 19** 桌面壳 + 本地 `kun` 运行时(独立 Node/TS 项目,`kun/`,HTTP/SSE 通信)。需求先行:Code / Design / Write 三模式。

### 6.1 技术栈与目录结构

- **桌面壳**:`src/{main,renderer,preload,shared}`(Electron,electron-vite + electron-builder)
- **运行时**:`kun/`(独立 `package.json`,Node + TypeScript,`kun/src/`)
- **关键依赖**:`@computer-use/nut-js`(桌面控制)、`node-pty`(终端)、`better-sqlite3`、`@xyflow/react`(节点式工作流画布)、`@tiptap/*`(富文本)、`@codemirror/*`(代码编辑 + merge diff)、`@xterm/xterm`、`pdfjs-dist`、`html-to-docx`、`jimp`、`@larksuiteoapi/node-sdk`(飞书)、`@tencent-weixin/openclaw-weixin`(微信)、`@modelcontextprotocol/sdk`、`openclaw`(file:vendor shim)
- **设计 token**:`DESIGN.md`(YAML frontmatter 机器可读,light/dark/system 完整 palette)

### 6.2 agent 执行能力

#### 6.2.1 kun 运行时 + SSE IPC

- `src/main/kun-process.ts` — spawn/管理 `kun` 子进程,`sanitizeKunConfigSections` 注入运行时配置
- `src/main/kun-runtime-supervisor.ts` — 运行时监督(崩溃重启)
- `src/main/kun-health.ts` + `kun-base-url.ts` + `resolve-kun-binary.ts` — 健康/base url/二进制定位
- `src/main/runtime-sse-ipc.ts` — **SSE IPC**(renderer 订阅 kun 的 SSE 事件流)
- `src/main/runtime/{kun-adapter,managed-runtime-idle}.ts` — 运行时适配 + 空闲管理
- `src/main/runtime-settings-apply-mode.ts` — 设置应用模式

#### 6.2.2 Claw(OpenClaw)运行时集成

- `src/main/{claw-runtime,claw-runtime-helpers,claw-platform-install,claw-schedule-mcp-config,claw-schedule-mcp-server,claw-schedule-mcp-node-entry,claw-scheduled-task-detector}.ts` — OpenClaw 运行时 + schedule MCP 服务器 + 任务探测
- `src/main/codex-auth.ts` + `claude-subscription-{auth,models}.ts` — Codex / Claude 订阅鉴权

#### 6.2.3 Workflow —— 可视化节点编排

- `src/main/workflow-runtime.ts` + `workflow-runtime.{nodes,run}.test.ts` — 多步 agent 流程编排(可画可跑)
- 渲染端:`src/renderer/src/design/graph/`(`@xyflow/react` 节点画布)

#### 6.2.4 Schedule —— 定时任务

- `src/main/schedule-runtime.ts` + `schedule-runtime-helpers.ts` — 定时任务运行时
- `src/shared/app-settings-schedule.ts` — schedule 设置
- 一次性 + 周期性 + webhook(relay)

#### 6.2.5 IM Streamer —— 飞书/微信/Telegram

- `src/main/{feishu-streamer,weixin-bridge-runtime,telegram-runtime}.ts` — 三平台消息流,离开电脑也能触发任务

#### 6.2.6 Computer Use

- `src/main/services/computer-use-permissions.ts` — 桌面控制权限
- `@computer-use/nut-js` 依赖 —— 屏幕截图 + 输入模拟

### 6.3 三模式(需求先行 coding 范式)

#### 6.3.1 Code 模式

- 围绕真实代码库:读项目上下文 / 执行 shell / 改文件 / 变更审查
- 工具审批 + 文件系统权限模式 + 内联 diff + 变更审查面板 + `/review`
- `src/renderer/src/components/` + `src/renderer/src/agent/` + `src/renderer/src/stores/`

#### 6.3.2 Design 模式(DESIGN_MODE_PLAN.md)

- 左:DesignSidebar(生成的 HTML/SVG artifact + 版本快照)
- 中:DesignCanvas(webview 实时渲染,viewport 切 mobile/tablet/desktop,Preview/Code 切换)
- 右:DesignAgentPanel(design agent chat + brandColor/tone/design-system 表单)
- Loop:描述 → agent 写单文件 HTML → webview 实时刷新 → 迭代 → 版本累积
- 节点式画布:`src/renderer/src/design/{graph,canvas,prototype-player,prototype-flow,design-system,design-tools,design-pages-run,design-contract,design-mode,design-workspace-store,agent-manager,agent-actions,agent-notes,directions,operation-journal,references,interop,html-quality,code-binding,generator-lane,tool-protocol,assets,design-turn-prompt}.ts(x)`
- HTML 原型授权:`src/main/services/prototype-embed-registry.ts` + `src/renderer/src/write/html-embed-dom.ts`(`authorizeWritePrototype` + `will-attach-webview` 守卫,`partition="kun-proto"` + `contextIsolation / sandbox`)

#### 6.3.3 Write 模式

- Markdown 文件树 + Live/Source/Split/Preview + 多格式导出(html-to-docx / pdfjs)
- 选区 inline agent
- `src/renderer/src/write/{tiptap,inline-completion}/`

### 6.4 桌面端能力(Electron)

- `src/main/{index,desktop-behavior,app-command-line,app-icon,app-identity,logger,main-paths,proxy-fetch,renderer-csp,gui-updater,ci-release-version,legacy-data-migration,packaging-config,upstream-models,provider-connection,settings-store,skill-bundled,ui-plugin-bundled,agent-sdk-installer,tray-session-menu}.ts` — 主进程核心
- `src/main/services/{git-service,git-discovery,git-checkpoint-service,local-whisper-service,memory-export-service,prototype-embed-registry,skill-service,skill-save-service,github-skill-import-service,legacy-session-import-service,computer-use-permissions}.ts` — 服务层(git / whisper / 记忆导出 / 原型注册 / skill)
- `src/main/terminal/terminal-pty-ipc.ts` — node-pty 终端
- `src/main/ipc/{app-ipc-schemas,register-app-ipc-handlers}.ts` — Zod schema + IPC handler 注册
- `src/preload/index.ts` — contextBridge
- 自动更新:`electron-updater` + `src/main/gui-updater.ts` + `verify-apple-signing.cjs`
- 签名:`APPLE_TEAM_ID` / `WINDOWS_CERTIFICATE_FILE` / `MAC_SIGN`

### 6.5 其他值得借鉴的特性

- **SDD(Specification-Driven Development)**:`.kunsdd/{draft,plan}/` 结构化需求 + 验收标准 + 需求历史
- **设计系统共享**:`DESIGN_SYSTEM.md`(Design 模式产出,Code 模式消费)
- **Provider 预设**:DeepSeek / Xiaomi MiMo / MiniMax 三家中国高性价比模型为默认
- **Schedule MCP Server**:`claw-schedule-mcp-server.ts` —— 把 schedule 暴露为 MCP 工具
- **多 IM 桥接**:飞书 / 微信 / Telegram 三平台
- **Memory export**:`memory-export-service.ts` —— 导出记忆为可分享格式

### 6.6 对 ReflectDesktop 的借鉴价值

- **三模式架构**:ReflectDesktop 当前是单 chat 视图;Kun 的 Code/Design/Write 分裂是工作台形态的重要参考。
- **HTML 原型 webview 隔离**:`partition + contextIsolation + sandbox + path 白名单` 是安全渲染 agent 生成 HTML 的范本。
- **SSE IPC**:ReflectDesktop 用 Tauri event;Kun 用 SSE —— ReflectDesktop 若要做远程 daemon,CodexMonitor 的 TCP JSON-RPC + Kun 的 SSE 都可参考。
- **节点式 workflow 画布**(`@xyflow/react`):可视化编排多 agent 流程,是 multica 看板之外的另一种协调 UI 范式。
- **DESIGN.md 机器可读 token**:ReflectDesktop 的 `tokens.css` 可补充 YAML frontmatter 版本供 design agent 消费。

---

## 7. thClaws-main —— 单 Rust 二进制 + 三层编排

> 仓库路径:`~/Code/Github/AgentGUI/thClaws-main`
> 一句话:**单 Rust crate**(`crates/core`)+ **React 前端**(`frontend/`,wry 内嵌,`include_str!` 编译期嵌入)。**与 ReflectDesktop 架构最接近**(都是 Rust 引擎 + React 前端 + IPC)。三层 agent 编排:模型驱动 subagent / 用户驱动 side-channel / 多进程 Team。

### 7.1 技术栈与目录结构

- **单 crate**:`crates/core/`(所有逻辑集中,`src/` 下 80+ 顶层 .rs 文件 + 21 个子目录)
- **前端**:`frontend/`(React 19 + Vite + CodeMirror + Tiptap + xterm + marked,`vite-plugin-singlefile` 打包成单 HTML 嵌入)
- **GUI**:`wry`(WebViewBuilder)+ `tao`(窗口)+ `thclaws://` 自定义协议(避免 WebView2 `NavigateToString` 2MB 限制)
- **桌面入口**:`crates/core/src/gui.rs`(`#-[cfg(feature = "gui")]`)
- **四种 surface,同一引擎**:Desktop GUI / CLI REPL(`--cli`)/ 非交互(`-p`)/ Webapp(`--serve`)
- **paperclip-adapter**:OpenAPI 适配(`paperclip-adapter/`)

### 7.2 三层 agent 编排(核心,最重要)

#### 7.2.1 第一层:模型驱动 subagent(Task 工具)

- `crates/core/src/subagent.rs` — `Task` 工具:模型调用,阻塞主 turn;多级递归(默认 `max_depth = 3`);命名 agent 定义(`~/.config/thclaws/agents.json`);**`PathScopedWriteTool` 用 glob allow-list 包裹写工具**,agent def 的 `write_paths` 之外的写操作被机械拒绝
- 写工具清单:`Write / Edit / DocxCreate / DocxEdit / PptxCreate / PptxEdit / XlsxCreate / XlsxEdit / PdfCreate / EpubCreate / NotebookEdit`
- 路径键:`path / file_path / notebook_path / out / output_path`

#### 7.2.2 第二层:用户驱动 side-channel(`/agent` 命令)

- `crates/core/src/side_channel.rs`(`#![cfg(feature = "gui")]`)— `/agent <name> <prompt>`:用户触发,与主 agent **并发**运行,独立 CancelToken(主 Cmd-C 不杀它),不进主 history,`chat_side_channel_*` 事件流
- 对比表(代码注释里):
  | | side-channel | subagent(Task) |
  |---|---|---|
  | 触发 | 用户 `/agent name prompt` | 模型调 Task |
  | 并发 | 与主 agent 并发 | 阻塞主 turn |
  | 主 history | 不影响 | tool result 进主 history |
  | 取消 | 独立 token | 继承父 token |
  | UI | chat_side_channel_* 事件 | 单 Task 工具指示器 |
- `SideChannelRegistry`:进程级 Mutex<HashMap<id, Handle>>,`/agents` 列表、`/agent cancel <id>` 取消

#### 7.2.3 第三层:多进程 Agent Teams(文件系统协调)

- `crates/core/src/team.rs` — **filesystem-based coordination**,布局:
  ```
  .thclaws/team/config.json          — team config(members, lead)
  .thclaws/team/inboxes/{name}.json  — 每 agent 收件箱(JSON 数组,read tracking)
  .thclaws/team/tasks/{id}.json      — 每 task 一个文件
  .thclaws/team/tasks/_hwm           — task ID 高水位
  .thclaws/team/agents/{name}/status.json  — 心跳
  .thclaws/team/agents/{name}/output.log   — 输出(GUI 捕获)
  ```
- `fs2::FileExt` 文件锁;1s 轮询消息投递;`STALE_SECS = 10` 判定崩溃 teammate;`is_valid_agent_name` 防 path traversal(`../../sessions/...`);`IS_TEAM_LEAD` static + `LEAD_TEAM_DIR` 让 `kill_my_teammates()` 用 `pkill -f <lead team_dir pattern>` 只杀本 lead 的 teammate
- 协议消息:typed(idle_notification / shutdown 等)
- 共享 mailbox + task queue(claim/complete/dependency tracking)

### 7.3 其他核心能力

#### 7.3.1 Schedule + Loop + Goal

- `crates/core/src/schedule.rs` — `~/.config/thclaws/schedules.json`,每 job 独立 cwd/prompt/model/cron;`run_once` spawn `thclaws --print "<prompt>"`;结果自动存 `<cwd>/.thclaws/schedule/<id>/<ts>.md`,stderr 存 `~/.local/share/thclaws/logs/<id>/<ts>.log`;in-process tick(Step 2)+ 原生 daemon(launchd / systemd-user,Step 3,survives-reboot)
- `crates/core/src/schedule_presets.rs` — 预置 schedule
- `crates/core/src/goal_state.rs` — `/goal start` + audit-driven completion;`GoalStatus`(Active/Complete/Abandoned/Blocked);三个生命周期工具(`RecordGoalProgress` / `MarkGoalComplete` / `MarkGoalBlocked`);`/goal continue` 构造 audit prompt;`--auto` = Ralph 式隔夜构建器
- `/loop` 固定间隔迭代;`/schedule add` cron / 固定间隔 / **文件系统变更**(`watchWorkspace`)

#### 7.3.2 KMS(Knowledge Management System)+ /dream

- `crates/core/src/kms.rs` + `kms_search_index.rs` — per-project / per-user wiki(`.thclaws/kms/<name>/pages/`,`index.md` 索引);**grep + read,无 embedding**(Karpathy LLM-wiki 模式)
- `/dream` 后台挖掘近期会话,写带日期的 audit-trail 页,`git diff` review

#### 7.3.3 Plan Mode

- `crates/core/src/policy/` + plan 相关 —— `EnterPlanMode` 提议有序步骤(Approve / Cancel / Skip / Retry);GUI sidebar + `/plan` slash 同 UX

#### 7.3.4 Skills / Plugins / Hooks / MCP

- `crates/core/src/{skills,skills_state,plugins,hooks,mcp,sdk_mcp}.rs` — skill 文件夹(`SKILL.md` + YAML frontmatter);plugin 打包 skill+command+agent def+MCP server;MCP over stdio 或 HTTP-Streamable + OAuth 2.1+PKCE;hooks 在 `pre_tool_use / permission_denied / session_start` 等生命周期跑 shell

#### 7.3.5 Messenger 桥(多平台 IM)

- `crates/core/src/messenger/{mod,bootstrap,client,config,filter,headless,approver,protocol,session}.rs` — Telegram / LINE / Messenger 已发布,Discord / Slack / WhatsApp 开发中
- `crates/core/src/{telegram,thai}/` — 平台特定

#### 7.3.6 Media Studio(图片/视频生成)

- `crates/core/src/media/` — Text→Image / Image Edit / Text→Video / Image→Video(Google Gemini / OpenAI gpt-image-2 / Alibaba Qwen / Veo / DashScope HappyHorse);`TextToImage / ImageToImage / TextToVideo / ImageToVideo / MediaJobStatus` 工具,agent 可从 chat 调

#### 7.3.7 文档工作流

- PDF / DOCX / PPTX / XLSX 原生读写编辑创建 + 图片渲染;50 页 PDF 摄入 → KMS 摘要 → 跟进 deck

#### 7.3.8 Memory + AGENTS.md

- `crates/core/src/memory.rs` — `AGENTS.md`(或 `CLAUDE.md`)从 cwd 向上走注入 system prompt;持久记忆分类 `user / feedback / project / reference`,存 markdown
- `crates/core/src/instructions.rs` — 指令加载

#### 7.3.9 配置 / 密钥

- `crates/core/src/{config,secrets,dotenv}.rs` — `.thclaws/settings.json`(project)或 `~/.config/thclaws/settings.json`(user);API key 默认进 OS keychain(macOS Keychain / Windows Credential Manager / Linux Secret Service),`.env` fallback(CI)

#### 7.3.10 Session resume + JSONL

- `crates/core/src/session.rs` — `thclaws --resume last` 或 `<id>`;session 存 JSONL(`.thclaws/sessions/`),git-friendly / grep-friendly

### 7.4 桌面端能力(wry + React)

- `crates/core/src/gui.rs` — wry + tao 窗口;Linux 用 `default_vbox()` + `build_gtk`(WebKit2GTK 必须 GTK 容器);`rfd::FileDialog` 跨平台文件/目录选择;Windows `native_dialog` 确认框
- `crates/core/src/gui_shell/{mod,manifest,registry,router,serve,shell_cli,shell_preview,storage,tokens}.rs` — GUI shell 子系统(命令路由 / 预览 / 存储 / token)
- `crates/core/src/ipc.rs` — IPC 协议
- `crates/core/src/event_render.rs` — 事件渲染(chat dispatch / terminal ansi / terminal history replaced)
- 多 tab:Files(codemirror + tiptap)/ Terminal(REPL + slash + ANSI)/ Chat(markdown + tool indicators)/ 可选 Team tab
- `crates/core/src/{browser_cdp,external_url,branding,theme}.rs` — 浏览器 CDP / 外链 / 品牌 / 主题

### 7.5 多 provider

- `crates/core/src/providers/` — Anthropic(native + Claude Agent SDK via Claude Code auth)/ OpenAI(Chat Completions + Responses/Codex)/ Google Gemini & Gemma / Alibaba DashScope(Qwen)/ DeepSeek / Z.ai(GLM Coding Plan)/ NVIDIA NIM / NSTDA Thai LLM(OpenThaiGPT / Typhoon / Pathumma / THaLLE)/ OpenRouter / Agentic Press / Azure AI Foundry / Ollama(local + Anthropic-compatible + Cloud)/ LMStudio / 通用 `oai/*`(LiteLLM / Portkey / Helicone / vLLM / 内部代理)
- **OpenRouter Fusion**:`openrouter/fusion` fan-out 到最多 8 模型并行,judge 综合 —— 单 model id 包装多模型审议

### 7.6 其他值得借鉴的特性

- **auto_learn.rs**:自动学习
- **compaction.rs**:上下文压缩(对应 reflect-compact)
- **confine.rs**:沙箱限制
- **cost_bridge.rs / tokens.rs / usage.rs**:成本 / token / 用量
- **multi_tenant/** + **cloud/** + **sso/**:多租户 / 云 / SSO
- **marketplace.rs**:skill/plugin 市场
- **remote_agent.rs**:远程 agent
- **deploy_client.rs**:部署客户端
- **filmscript/**:film script 领域(垂直示例)
- **research/**:研究子系统
- **line/**:line 协议
- **phone_home/**:遥测

### 7.7 对 ReflectDesktop 的借鉴价值

> **最高**。thClaws 与 ReflectDesktop 架构同构(单 Rust 引擎 + React 前端 + IPC),且已完成 multica 式的多 agent 协调:
> - **Team(文件系统协调)** 直接对应 multica 的 daemon 编排,但更轻(无 server)。
> - **side-channel** 是 multaca 没有的「用户并发驱动多 agent」范式,非常匹配「手动协调」目标。
> - **schedule / loop / goal** 三件套是 ReflectDesktop `vendor/reflect-stream/cron.rs` 的产品化参照。
> - **KMS(grep-based wiki)** 是 ReflectDesktop `reflect-memory` / `reflect-notes` 的另一种实现思路。
> - **messenger bridge** 是 ReflectDesktop 移动端/远程触发的参照。

---

## 8. ReflectDesktop 现状与缺口

> 基于本地仓库实测(`~/Code/CNB/ReflectDesktop`)。

### 8.1 已具备的能力(底层已落地)

| 能力 | 位置 | 状态 |
|---|---|---|
| **AgentThread 内核** | `vendor/reflect-core/src/{agent_thread,submission_loop,turn,steering_queue,background_tasks}.rs` | ✅ 嵌入式 agent loop,支持 submit/subscribe/session sender |
| **SubAgent factory** | `vendor/reflect-subagent/src/{factory,spec,data_transfer,session_fork,worker_registry}.rs` | ✅ 深度计数(`MAX_DEPTH`)+ 默认模型热更新 + worker 工具白名单 |
| **Task 系统(Task*)** | `vendor/reflect-task/src/{model,store,manager,tools/{task_claim,task_create,task_get,task_list,task_output,task_release,task_stop,task_update,todo_write}}.rs` | ✅ 4 态状态机 + `blocks/blockedBy` 双向依赖 + 原子认领(`claimed_by`)+ output_path |
| **Team 系统** | `vendor/reflect-task/src/{team,team_store,tools/{team_create,team_delete}}.rs` | ✅ `team-lead@<team>` 约定 + `sync_team_specs` 桥接 SubAgentFactory |
| **Coordinator 模式** | `vendor/reflect-task/src/coordinator.rs` + `coordinator/coordinator_prompt.md` | ✅ `REFLECT_COORDINATOR_MODE` env / config.toml;`build_worker_tool_registry` 排除 internal tools;scratchpad;`DEFAULT_MAX_WORKERS = 4` / `MAX_WORKERS_CAP = 32` / `MAX_CLAIMED_TASKS_PER_WORKER = 1` |
| **Cron 调度** | `vendor/reflect-stream/src/cron.rs` | ✅ 自实现 5 字段 cron(无外部 crate),`CronTool` 注册 `CronJobSpec`,driver 到期注入 `Submission::user_input`;`submission_sender()` 暴露给工具 |
| **多 provider** | `vendor/reflect-llm/` | ✅ 含 policy / ollama 等 |
| **Compact / 恢复** | `vendor/reflect-{compact,recovery,rollout}/` | ✅ smart_prune + subagent registry + rollout 记录 |
| **MCP / Skills / Hooks / Permissions** | `vendor/reflect-{mcp,skills,hooks,permissions}/` | ✅ |
| **Plan mode** | `vendor/reflect-core/src/` + `src/features/plan/` | ✅ |
| **app-core 共享状态** | `app-core/src/{state,reducer}/` | ❌ 已移除(2026-08-31):Rust 镜像从未接线,渲染主线确定为 TS + Tauri |

### 8.2 关键缺口(Tauri 命令层 + 前端 UI 未暴露)

> **核心问题**:后端 vendor 已有 team/coordinator/cron/subagent 能力,但 **Tauri 命令层完全没有暴露**,前端也没有对应 IPC wrapper。

| 缺口 | 现状 | 参考来源 |
|---|---|---|
| **Team/Task/Coordinator 命令** | ✅ **Phase 1 已落地**:`commands/tasks.rs` 暴露 10 个命令(Task×6 + Team×4),`TaskManager` 注入到 `MinimalAgentInner`,复用 vendor 默认 home。详见 `docs/CHANGELOG.md` Unreleased 段。剩余:Coordinator 模式开关命令(`is_coordinator_enabled` 已存在,「启用+重启 agent」待后续)。 | thClaws `team.rs` / multica daemon / Reasonix fleet |
| **前端 IPC wrapper** | ✅ **Phase 1 已落地**:`src/utils/commands/{tasks,teams}.ts` 封装全部 10 个命令 + 类型(Task/Team/TaskPatch/TaskUpdateResult 等),`index.ts` re-export 已补,8 个转发测试锁定 cmd-name + 参数 key 不变量。剩余:`schedule`/`coordinator`/`subagent` wrapper(Schedule 是 Phase 1 第 2 项,Coordinator 开关待后续)。 | ReflectDesktop 现有 `commands/{domain}.ts` 模式 |
| **多 agent UI** | ✅ **Phase 1 已落地(双视图 + agent profile)**:`src/features/tasks-board/` 提供 List/Board 双视图任务看板(create/claim/advance/delete);`src/features/agents/` 提供 agent 定义管理(列表/创建/编辑/删除,带 frontmatter round-trip 校验)。剩余:多 team 切换面板、Inbox 通知中心 —— 属 Phase 3 协调平台化范围。 | multica `packages/views/{agents,my-issues,chat,inbox}/` |
| **Schedule UI** | ✅ **Phase 1 第 2 项已落地**:`src/features/schedule/` 提供 cron job 列表(create/toggle/remove)+ 状态徽标,`/schedule` 路由 + ActivityBar 入口已接。剩余:`run_now` 命令(需 vendor 加公开 accessor)、持久化、tick 间隔配置、一次性 `run_at`。 | goose `ui/desktop/src/components/schedule/` / thClaws `/schedule` |
| **Side-channel UI** | ✅ **Phase 2 第 1 项已落地(registry + UI + start/cancel)**:`app-core/src/side_channel.rs` 提供 `SideChannelRegistry`(独立 CancelToken + 事件 broadcast),`src/features/side-channel/` 提供 SideChannelView(列表 + start 表单 + cancel 按钮),`/side-channels` 路由 + ActivityBar 入口已接。**剩余**:运行时 driver(把 prompt 作 `Submission::user_input` 注入 agent loop 并 finish 注册表条目)未实现,view 暂只展示 registry 状态。 | thClaws `side_channel.rs` + `chat_side_channel_*` 事件 |
| **远程 daemon(iOS/Tailscale)** | ✅ **Phase 2 第 2 项已落地(Tailscale 探测 + 桌面配置 UI)**:`app-core/src/tailscale.rs` 提供 `TailscaleStatus`+`detect()`(shell `tailscale status --json=true`),`src-tauri/src/state/remote_config.rs` 提供 `RemoteConfig` 状态,`src-tauri/src/commands/remote.rs` 暴露 8 个命令(get/update remote config, tailscale status/daemon preview/start/stop/status),`src/features/remote/` 提供 iOS 配置表单 + Tailscale 状态 + Daemon 提示 UI。剩余:实际 TCP JSON-RPC daemon 二进制(`reflect_daemon`)未实现,需独立 workspace + cross-compile。 | CodexMonitor `src-tauri/src/bin/codex_monitor_daemon*.rs` + `tailscale/` |
| **Dictation(Whisper)** | ✅ **Phase 2 第 6 项已落地**:Web Speech API (webkitSpeechRecognition) UI + ActivityBar 入口 + i18n。使用浏览器原生 ASR,无需外部依赖。 | CodexMonitor `dictation/{real,stub}.rs` + goose `dictation/whisper.rs` |
| **Desktop computer use** | 无 | Kun `@computer-use/nut-js` + goose `computercontroller` |
| **Media Studio(图/视频)** | 无 | thClaws `media/` |
| **IM 桥接(飞书/微信/TG)** | ⏸️ 跳过(需第三方 API/SDK,依赖外部服务) | Kun `feishu-streamer / weixin-bridge / telegram-runtime` + thClaws `messenger/` |
| **多 agent 看板(List/Board)** | 无 | multica `packages/views/{my-issues,projects}/` |
| **Inbox / Activity / Mentions** | ✅ **Phase 3 第 9 项已落地**:`NotificationsView` 加 Activity + Mentions 双 tab,`ActivityLogger` tap session broadcast,`@<query>` 搜索。 | multica `packages/core/{inbox,activity_log}/` |
| **Squad + leader 委派** | ✅ **Phase 3 第 11 项已落地**:`SquadManager` 复用 `TaskManager::claim_next_available` + `assign_task` 写 `metadata.actor`。 | multica `packages/core/squads/` |
| **Polymorphic actor** | ✅ **Phase 3 第 8 项已落地(语义层)**:`Actor { actor_type, actor_id, kind }` + `Task.metadata.actor`。 | multica 贯穿 DB schema |
| **Media / Computer Use** | ⚠️ **Phase 3 第 13 项已落地 scaffold**:trait + metadata-only / unavailable backends;真实 `image` / `xcap` / `enigo` 待接入。 | thClaws `media/` + Kun `nut-js` |
| **KMS / 知识库** | ✅ **Phase 3 第 12 项已落地** | thClaws `kms.rs`(grep-based) |

### 8.3 ReflectDesktop 当前命令面(已暴露的)

来自 `src-tauri/src/lib.rs` `invoke_handler`:
```
reflect_submit / interrupt / compact / rewind / shutdown
reflect_tool_approval / hook_approval
reflect_enter_plan_mode / exit_plan_mode / plan_approval
reflect_set_effort / ask_user_question_response / ask_user_input_response
reflect_set_permission_mode / cycle_permission_mode
reflect_list_sessions / rename_session / delete_session / replay_session / export_session(_markdown)
reflect_agent_status / get_config / save_config / list_tools
reflect_list_workspaces / set_workspace / current_workspace
reflect_list_skills / list_memory / add_memory / remove_memory
reflect_list_hooks / toggle_hook
reflect_git_status / git_diff / git_log
reflect_run_shell / kill_shell / list_shell_sessions
reflect_list_dir / read_file
reflect_load_allowlist / save_allowlist / check_allowlist
reflect_search_files / set_dock_badge
```

---

## 9. 能力清单(横向汇总,供后续开发)

> 每行:`能力 | 已有(RD=ReflectDesktop) | 最佳参考 | 实现要点`

### 9.1 多 Agent 协调(核心)

| 能力 | RD 现状 | 最佳参考 | 参考路径 | 实现要点 |
|---|---|---|---|---|
| 统一 agent 抽象(多 CLI) | ❌(仅 reflect 内核) | multica | `server/pkg/agent/{agent.go,claude.go,codex.go,...}` | `Backend` trait + 每 CLI 一文件;若接外部 CLI 用 ACP |
| 模型驱动 subagent(阻塞) | ✅ vendor | thClaws | `crates/core/src/subagent.rs` | `Task` 工具 + `max_depth` + `PathScopedWriteTool` glob |
| 用户驱动 side-channel(并发) | ✅ **Phase 2 第 1 项已落地(registry + UI + start/cancel)**:`app-core/src/side_channel::SideChannelRegistry` 提供独立 CancelToken + 事件 broadcast。运行时 driver(把 prompt 作 `Submission::user_input` 注入 agent loop)未实现,留作后续。 | thClaws | `crates/core/src/side_channel.rs` | 独立 CancelToken + `chat_side_channel_*` 事件 + registry |
| 多进程 Team(文件系统) | ✅ vendor(task) | thClaws | `crates/core/src/team.rs` | mailbox + task queue + 文件锁 + 心跳 + path 校验 |
| Coordinator(派工中枢) | ✅ vendor | Reasonix | `internal/agent/{fleet,coordinator}.go` | `REFLECT_COORDINATOR_MODE` + worker 白名单 + scratchpad |
| Fleet(2–64 并行) | ⚠️(vendor 有 task,无 fleet 语义) | Reasonix | `internal/agent/fleet.go` | `write_paths` glob 隔离 + background job + `wait` |
| Squad(leader 委派) | ✅ **Phase 3 第 11 项已落地** | multica | `app-core/src/squad.rs` + `commands/squad.rs` + `features/squad/` | 复用 `TaskManager::claim_next_available` 原子认领 + `owner` + `metadata.actor` 语义层 |
| Dispatch 准入决策 | ❌ | multica | `server/internal/dispatch/reason.go` | `ReasonCode` 枚举跨层共享 |
| Polymorphic actor(agent=人) | ✅ **Phase 3 第 8 项已落地** | multica | `app-core/src/actor.rs` + `Task.metadata.actor` | 语义层 actor(不改 vendor `Task` schema);`Actor::user / system / agent(team, role)` + `from_agent_id` + `encode/decode_metadata` |

### 9.2 任务/计划/调度

| 能力 | RD 现状 | 最佳参考 | 参考路径 | 实现要点 |
|---|---|---|---|---|
| Task CRUD + 依赖 | ✅ vendor | thClaws / RD-task | `vendor/reflect-task/src/` | 4 态 + blocks/blockedBy + claimed_by |
| TodoWrite | ✅ vendor | Reasonix | `vendor/reflect-task/src/tools/todo_write.rs` | metadata.todos + 单行渲染 |
| Plan mode | ✅ | 所有项目 | `vendor/reflect-core/` + `src/features/plan/` | EnterPlanMode + Approve/Cancel/Skip/Retry |
| Cron 调度 | ✅ **Phase 1 全链路** | thClaws / goose | `vendor/reflect-stream/src/cron.rs` + `commands/schedule.rs` + `commands/schedule.ts` + `features/schedule/` | 5 字段;`install_agent_thread` 注入真 sender + 30s driver;`run_now`/持久化待后续 |
| Autopilot(cron→issue→agent) | ❌ | multica | `server/internal/scheduler/jobs_autopilot.go` | 到点创建任务 + 路由 |
| Loop(固定间隔) | ❌ | thClaws | `crates/core/src/`(`/loop`) | 固定间隔迭代 |
| Goal(audit-driven 完成) | ❌ | thClaws | `crates/core/src/goal_state.rs` | `--auto` 隔夜构建 + 三工具 |
| 文件系统触发(watchWorkspace) | ❌ | thClaws | `crates/core/src/schedule.rs` | fs 变更触发 |
| Recipe(prompt+扩展组合) | ❌ | goose | `crates/goose/src/recipe/` | 可复用工作流单元 |

### 9.3 桌面端集成

| 能力 | RD 现状 | 最佳参考 | 参考路径 | 实现要点 |
|---|---|---|---|---|
| 系统托盘 | ✅ | CodexMonitor | `src-tauri/src/tray.rs` | recent/workspaces/usage 三段菜单 |
| 全局/窗口快捷键 | ✅ | CodexMonitor / multica | `src-tauri/src/shortcut.rs` + multica `keyboard-shortcuts.ts` | `before-input-event` 拦截 |
| 窗口几何持久化 | ✅ | multica | `apps/desktop/src/main/window-state.ts` | `window-state.json` |
| macOS vibrancy/liquid glass | ⚠️ | CodexMonitor | `tauri-plugin-liquid-glass` + objc2 | NSAppearance + 透明 titlebar |
| 自动更新 | ✅ | CodexMonitor / Kun | `tauri-plugin-updater` | toast 下载安装 |
| Dictation(Whisper) | ⏳ 待实施 | CodexMonitor / goose | `src-tauri/src/dictation/` | cpal + whisper-rs + hold-to-talk + 波形 (纯本地) |
| 终端 dock(多 tab) | ✅ | CodexMonitor / Kun | `src/features/terminal/` | portable-pty / node-pty + xterm |
| Computer use(屏幕控制) | ❌ | Kun / goose | `@computer-use/nut-js` + goose `computercontroller` | 截图 + 输入模拟 |
| 多窗口(issue window) | ❌ | multica | `apps/desktop/src/shared/issue-window.ts` | 每 issue 独立窗口 |
| 浮动/快捷面板 | ❌ | (Raycast 式) | — | ReflectDesktop 暂无参考 |

### 9.4 协作/通信

| 能力 | RD 现状 | 最佳参考 | 参考路径 | 实现要点 |
|---|---|---|---|---|
| Inbox 通知中心 | ✅ **Phase 3 第 9 项已落地** | multica | `app-core/src/activity.rs` + `features/notifications/NotificationsView.tsx`(Inbox tab) | Inbox / Activity / Mentions 三 tab,`@<id>` mention 搜索 |
| Activity timeline | ✅ **Phase 3 第 9 项已落地** | multica | `app-core/src/activity.rs` + `state/activity.rs::subscribe_activity_logger` | ring buffer (cap 500) + JSONL rotate + ts 过滤 |
| @mention 触发任务 | ⚠️ **部分落地(纯本地)** | multica | `commands/activity.ts::extractMentions` + Mentions tab | 当前暴露 search;`/agent <id>` UX 留作后续 |
| IM 桥接(飞书/微信/TG/Slack/Discord) | ⏸️ 跳过(需第三方 API/SDK,依赖云服务) | Kun / thClaws | Kun `feishu-streamer*` + thClaws `messenger/` | 离开电脑也能触发 |
| 远程 daemon(Tailscale/iOS) | ✅ Tailscale 探测 + 桌面配置 UI | CodexMonitor | `app-core/src/tailscale.rs` + `commands/remote.rs` + `features/remote/` | TCP JSON-RPC daemon 二进制待后续 |
| Realtime WS 事件流 | ✅(reflect_event) | multica | `server/internal/realtime/` | hub + redis relay 分片 |

### 9.5 知识/记忆/技能

| 能力 | RD 现状 | 最佳参考 | 参考路径 | 实现要点 |
|---|---|---|---|---|
| 持久记忆分类 | ✅ reflect-memory | thClaws | `crates/core/src/memory.rs` | user/feedback/project/reference |
| AGENTS.md 注入 | ✅ | thClaws / 所有 | `crates/core/src/instructions.rs` | 从 cwd 向上走 |
| Hierarchical memory(全局/项目/本地) | ⚠️ | Reasonix | REASONIX.md 体系 | global/project/local + `@path` 导入 |
| KMS(grep-based wiki) | ✅ Phase 3 第 12 项已落地 | thClaws | `app-core/src/kms.rs` + `commands/kms.rs` + `features/kms/` | `~/.zhuye/kms/<name>/pages/*.md` + 搜索 + /dream |
| /dream(会话挖掘) | ✅ Phase 3 第 12 项已落地 | thClaws | `app-core/src/kms.rs::dream()` + `commands/kms.rs::reflect_dream` | 后台挖近期会话写 audit-trail |
| Skill(SKILL.md frontmatter) | ✅ | thClaws / goose | `vendor/reflect-skills/` + goose `skills/` | 文件夹 + YAML |
| Plugin(打包 skill+cmd+agent+mcp) | ❌ | thClaws | `crates/core/src/plugins.rs` | 单 manifest |
| Skill 市场 | ❌ | thClaws / multica | `marketplace.rs` + `server/pkg/skillbundle` | 下载/安装/更新 |
| Output style | ❌ | Reasonix | `.reasonix/output-styles/<name>.md` | persona/tone |

### 9.6 文档/媒体

| 能力 | RD 现状 | 最佳参考 | 参考路径 | 实现要点 |
|---|---|---|---|---|
| Diff 渲染 + 审查 | ✅ | CodexMonitor / Kun | `@codemirror/merge` + `@pierre/diffs` | 内联 diff + stage/revert |
| GitHub Issues/PR | ⚠️ | CodexMonitor | `shared/git_ui_core/github.rs` | 经 `gh` |
| PDF/DOCX/PPTX/XLSX 读写 | ❌ | thClaws / goose | thClaws tools + goose `computercontroller/{docx,pdf,xlsx}_tool.rs` | 原生工具 |
| Media Studio(图/视频生成) | ✅ **Phase 3 第 13 项已落地** | thClaws | `app-core/src/media.rs` + `src-tauri/src/media_backend.rs::RealImageBackend`(`image` crate) | 完整 ImageAsset 扫描 + decode / resize / format 转码(PNG / JPEG / GIF / WebP / BMP);5 个 Tauri 命令 + MediaView Studio tab |
| Computer use(屏幕控制) | ✅ **Phase 3 第 13 项已落地** | Kun / goose | `src-tauri/src/media_backend.rs::RealComputerBackend`(`xcap` + `enigo` 0.6) | 6 种动作(截屏 / 鼠标移动 / 鼠标点击 / 键盘输入 / 组合键 / 滚轮)真实执行;macOS 首次调用触发权限弹窗 |
| 富文本编辑(Tiptap) | ⚠️ | multica / Kun | Tiptap | 评论 + Write 模式 |
| 代码编辑(CodeMirror) | ⚠️ | thClaws / Kun | `@codemirror/*` | Files tab |
| Markdown 渲染 | ✅ | 所有 | react-markdown + remark-gfm + PrismJS | |

### 9.7 安全/权限

| 能力 | RD 现状 | 最佳参考 | 参考路径 | 实现要点 |
|---|---|---|---|---|
| Permission mode | ✅ | thClaws | `vendor/reflect-permissions/` | plan/accept/auto 等 |
| 工具审批 | ✅ | 所有 | `reflect_tool_approval` | |
| write_paths glob 隔离 | ⚠️(vendor coordinator) | thClaws / Reasonix | `subagent.rs::PathScopedWriteTool` | per-subagent 写路径白名单 |
| Sandbox | ✅ reflect-sandbox | Reasonix | `internal/sandbox/` | |
| 插件恶意检查 | ❌ | goose | `crates/goose/src/agents/extension_malware_check.rs` | 加载前扫描 |
| Elicitation(结构化要输入) | ⚠️(有 ask_user) | goose | `crates/goose/src/elicitation.rs` | MCP elicitation |
| OS keychain 存密钥 | ⚠️ | thClaws / goose | `keyring` crate | macOS Keychain / Win Credential / Linux Secret |

### 9.8 工程/运维

| 能力 | RD 现状 | 最佳参考 | 参考路径 | 实现要点 |
|---|---|---|---|---|
| 自动更新 | ✅ | CodexMonitor / Kun | `tauri-plugin-updater` | |
| Doctor(诊断) | ❌ | CodexMonitor / Reasonix | `npm run doctor` + `internal/doctor/` | 环境检查 |
| 崩溃恢复 | ⚠️ | Reasonix / thClaws | `desktop/{hang_watchdog,startup_recovery,recovery_gc,crash_app}.rs` | 看门狗 + 启动恢复 |
| 单实例 | ❌ | Reasonix / Kun | `desktop/single_instance.go` | 二次启动路由到已运行实例 |
| 遥测/PostHog | ❌ | multica / goose | `posthog-js` + `server/internal/analytics/` | |
| Feature flags | ❌ | multica | `packages/core/feature-flags/` | |
| i18n | ✅基础 | multica / Kun | `packages/views/locales/` | en/zh/ja/ko |
| Custom Distros | ❌ | goose | `CUSTOM_DISTROS.md` | 预配置发行版 |

---

## 10. 演进路线建议

> 基于缺口分析,建议分三阶段。每阶段都先打通「后端 vendor → Tauri 命令 → 前端 IPC → feature UI」四层(遵循 AGENTS.md 的 App State Sync Checklist)。

### Phase 1:暴露已有底层能力(1–2 周,高 ROI)

> 后端 vendor 已就绪,只缺命令层 + UI。这是「让多 agent 在桌面端可见」的最短路径。

1. **Team/Task/Coordinator 命令面**(对应 §8.2 缺口)
   - 在 `src-tauri/src/commands/` 新增 `tasks.rs` / `teams.rs` / `coordinator.rs`,薄包装 `vendor/reflect-task`
   - 命令:`reflect_list_tasks / create_task / update_task / claim_task / release_task / stop_task / list_teams / create_team / delete_team / coordinator_status`
   - 参考:thClaws `team.rs` 的命令暴露方式 + multica daemon RPC 方法清单
   - 前端:`src/utils/commands/{tasks,teams,coordinator}.ts` + `src/features/tasks/` + `src/features/teams/`
   - **状态**:✅ 后端(tasks.rs)+ 前端 wrapper(tasks.ts/teams.ts)+ feature UI(tasks-board/,含 List/Board 双视图)+ agent profile(agents/) + Schedule(schedule/) 均已落地。

2. **Schedule 命令面**
   - `src-tauri/src/commands/schedule.rs` 包装 `vendor/reflect-stream/cron.rs`
   - 命令:`reflect_list_schedules / add_schedule / remove_schedule / run_schedule_now`
   - 前端:`src/utils/commands/schedule.ts` + `src/features/schedule/`(参考 goose `ui/desktop/src/components/schedule/`)

3. **多 agent 看板 UI**(参考 multica `packages/views/my-issues/`)
   - 在 `src/features/` 新增 `agents/`(agent profile 管理)+ `tasks-board/`(List/Board 视图)
   - 复用现有 `design-system` primitives

### Phase 2:补齐桌面端能力(2–4 周)

4. **Side-channel**(参考 thClaws `side_channel.rs`)
   - ✅ **Phase 2 第 1 项已落地**:registry + UI + start/cancel
   - `app-core/src/side_channel.rs`:`SideChannelRegistry` + 事件 broadcast
   - `src-tauri/src/commands/side_channel.rs`:`reflect_start_side_channel / cancel_side_channel / list_side_channels / get_side_channel`
   - `src/features/side-channel/`:SideChannelView + ActivityBar entry
   - **剩余**:运行时 driver(把 prompt 作 `Submission::user_input` 注入 agent loop)未实现

5. **远程 daemon + Tailscale**(参考 CodexMonitor)
   - ✅ **Phase 2 第 2 项已落地**(Tailscale 探测 + 桌面配置 UI + iOS config 入口)
   - `app-core/src/tailscale.rs`:`TailscaleStatus`+`detect()`
   - `src-tauri/src/commands/remote.rs`:8 个远程配置命令
   - `src/features/remote/`:iOS 配置表单 + Tailscale 状态 + Daemon hint
   - **剩余**:`src-tauri/src/bin/reflect_daemon.rs` 独立二进制(TCP JSON-RPC daemon)未实现,需独立 workspace crate

6. **Dictation**(参考 CodexMonitor `dictation/`)
   - ✅ **Phase 2 第 6 项已落地**:Web Speech API (webkitSpeechRecognition)
   - `src/features/dictation/`:DictationView + useDictation hook + ActivityBar entry
   - 无需 cpal/whisper-rs,使用浏览器原生 ASR,纯本地

7. **IM 桥接**(参考 Kun + thClaws)
   - ⏸️ 跳过 — 依赖第三方 API/SDK(飞书开放平台/微信/Telegram Bot API),不符合纯本地原则

### Phase 3:协调平台化(4–8 周,对齐 multica)

8. **Polymorphic actor 重构**(参考 multica) — ✅ **Phase 3 第 8 项已落地(语义层)**
   - ✅ `app-core/src/actor.rs`:`Actor { actor_type, actor_id, kind, display_name, team_name }` + `from_agent_id` 解析 + `encode/decode_metadata`。
   - ✅ 通过 `Task.metadata.actor` 透明序列化到 vendor `Task`;不动 vendor schema。
   - ✅ 与 Squad/Activity 联动:每条 Activity / SquadSpec 都带 actor;leader 委派走 `metadata.actor`。
   - **未实现**(留给后续):agent 与人同构的评论/订阅 channel(vendor reflect-task 的 `subscriptions` 字段已留位)。

9. **Inbox + Activity timeline + @mention 触发**(参考 multica `packages/core/{inbox,github}/`) — ✅ **Phase 3 第 9 项已落地**
   - ✅ `app-core/src/activity.rs`:`ActivityLogger` ring buffer (cap 500) + JSONL 1MB rotate 到 `~/.zhuye/activity/`。
   - ✅ `src-tauri/src/state/activity.rs`:独立 broadcast subscriber 把每个 `Event` 映射成 `ActivityEvent`(filter 掉高频 delta/routing,只留有信息量的事件)。
   - ✅ `src-tauri/src/commands/activity.rs`:4 个命令(`reflect_list_activity` / `reflect_search_activity` / `reflect_clear_activity` / `reflect_activity_count`)。
   - ✅ `src/features/notifications/NotificationsView.tsx`:三 tab —— **Inbox**(现有 store 派生 pending) / **Activity**(level 过滤 + clear buffer) / **Mentions**(`@<query>` 输入 + 搜索)。
   - ✅ `utils/commands/activity.ts::extractMentions(text)` 提供 `@<id>` 解析 helper。

10. **Autopilot**(参考 multica `server/internal/scheduler/jobs_autopilot.go`) — ✅ **Phase 3 第 10 项已落地**
    - ✅ `app-core/src/autopilot.rs`:`AutopilotManager` + config 持久化 + run history
    - ✅ `src-tauri/src/commands/autopilot.rs`:3 个命令(config get/update + history)
    - ✅ `src/features/autopilot/`:AutopilotView 配置表单 + 运行历史
    - cron/手动 → 创建 task → 路由给 agent

11. **Squad + leader 委派**(参考 multica `packages/core/squads/`) — ✅ **Phase 3 第 11 项已落地**
    - ✅ `app-core/src/squad.rs`:`SquadSpec`/`SquadMember` + `SquadManager` 复用 `TaskManager` TeamFile 存储,提供 `create / list / get / delete / delegate_next / assign_task`。
    - ✅ `src-tauri/src/commands/squad.rs`:6 个命令(`reflect_list_squads` / `reflect_create_squad` / `reflect_get_squad` / `reflect_delete_squad` / `reflect_delegate_next` / `reflect_assign_squad_task`)。
    - ✅ `src/features/squad/`:master-detail UI(squad 列表 + 成员列表 + 任务分配下拉 + leader 委派按钮)。
    - leader 委派用 vendor `TaskManager::claim_next_available` 原子认领 + `assign_task` 写 `owner` + `Task.metadata.actor`。

12. **KMS + /dream**(参考 thClaws `kms.rs`) — ✅ **Phase 3 第 12 项已落地**
    - ✅ `app-core/src/kms.rs`:`KnowledgeManager` grep-based wiki + /dream
    - ✅ `src-tauri/src/commands/kms.rs`:8 个命令(list/create/delete/save/get/search/dream)
    - ✅ `src/features/kms/`:KmsView wiki 选择器 + 页面编辑 + 全局搜索
    - 在 `reflect-notes` / `reflect-memory` 之上加 grep-based wiki + 会话挖掘

13. **Media Studio**(参考 thClaws `media/`)+ **Computer Use**(参考 Kun `nut-js`) — ⚠️ **Phase 3 第 13 项已落地 scaffold(metadata-only)**
    - ✅ `app-core/src/media.rs`:`MediaAsset` + `ImageProcessSpec/Result` + `ImageFormat` + `ComputerUseAction`(tag-serialized 6 种动作)+ `ImageBackend` / `ComputerBackend` trait + `scan_dir_for_assets`(stdlib,无外部依赖)。
    - ✅ `src-tauri/src/commands/media.rs`:5 个命令(`reflect_list_media` / `reflect_image_process` / `reflect_screenshot` / `reflect_computer_use` / `reflect_media_capabilities`)。
    - ✅ `src/features/media/`:`MediaView` 双 tab —— **Studio**(目录扫描资产列表) / **Computer Use**(截屏 + 鼠标 / 键盘 / 滚轮控制面板 + 错误诊断)。
    - 当前 backend:`MetadataOnlyBackend`(读文件元数据)+ `UnavailableComputerBackend`(返回 `MediaError::Unavailable` 提示缺 native bindings)。**真实 `image` / `xcap` / `enigo` 集成留给后续** — trait 接口稳定,默认 backend 换成真实现是局部替换。
    - 不动 vendor `reflect-tools`;不注入 agent tool registry。

14. **多租户 / SSO / 云**(参考 thClaws `multi_tenant/` + `sso/` + `cloud/`) — ⏸️ 跳过,依赖云服务
    - 若要做 SaaS 形态,需额外云服务基础设施

---

## 附录:文档维护

- 本文档为**事实汇总**,不含过时评论。能力变化时直接更新对应表格 + Phase。
- 新增参考项目时,复制 §2-§7 任一节结构,填实测路径。
- 与 `docs/ARCHITECTURE.md`(ReflectDesktop 自身架构)、`docs/PROTOCOL_BRIDGE.md`(IPC 协议)、`docs/codebase-map.md`(任务导向文件地图)互补,不重复。
- 后续开发每落地一个 Phase 项,在该行末尾补 `✅(commit <hash>)` 标记,并把对应能力从「缺口」移到「已具备」。
