# 烛夜 ZhuYe

[简体中文](README.md) | [English](README.en.md)

[![CI](https://github.com/Asketisch/ReflectDesktop/actions/workflows/ci.yml/badge.svg)](https://github.com/Asketisch/ReflectDesktop/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Asketisch/ReflectDesktop)](https://github.com/Asketisch/ReflectDesktop/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-orange)]()
[![React 19](https://img.shields.io/badge/React-19-149eca)]()
[![English](https://img.shields.io/badge/README-English-blue.svg)](README.en.md)

> 烛夜（ZhuYe）独立桌面应用：Tauri 2 + React 19，通过 `reflect-protocol` 协议桥接烛夜 agent 核心。

---

## 项目说明

烛夜的无头执行模式 (`zhuye exec "..."`) 与 SDK 共用同一个 `reflect-core::AgentThread`（上游 crate 已更名 `zhuye-core`，本仓库以 `reflect-core` 别名引用）。桌面 GUI 需要在 Tauri 窗口中运行相同的线程，但不希望将 Tauri 2 构建产物耦合到无头代理工具中。因此烛夜桌面端将全部 GUI 代码放在本仓库，仅通过 `reflect-agent/` git submodule 消费代理核心。

---

## 功能特性

### 会话与工作区

- 时间分组会话侧边栏：**当前 / 今天 / 昨天 / 本周 / 更早** (`useSessions`)
- 恢复、回放 (`reflect_replay_session`)、重命名、归档、删除
- 每个线程独立的持久化编辑器草稿

### 编辑器与代理控制

- 自动增长文本框，安全支持输入法
- `/` 斜杠命令弹窗，由 `src/features/composer/slashCommands.ts` 驱动（与终端模式斜杠命令一致）
- `@` 文件引用，拖拽/粘贴图片
- 发送：`Cmd+Enter`（macOS）/ `Ctrl+Enter`（Linux/Windows）
- 中断：`Cmd+.` / `Ctrl+.` → `reflect_interrupt`
- 模型选择器、努力级别切换、权限模式切换、批准规则
- 编辑器归属于 `src/features/composer/`；`src/features/messages/Composer.tsx` 为薄重新导出层

### 聊天渲染

- `react-markdown` + Shiki 代码块高亮
- 通过 `AgentMessageDelta` 事件流式传输（单一 `reflect_event` 通道）
- 工具行折叠连续调用；`McpToolInvoked` 添加 `(via <server>)` 徽标
- 可折叠的思考块 (`ThinkingDelta`)

### 批准与用户问答弹窗

- **批准弹窗**: 工具 / 钩子 / 计划 — 允许一次 / 始终允许 / 拒绝
- **问答弹窗**: 多问题、多选、"其他" 自定义文本
- **用户问答弹窗**: 自由文本回复
- **计划就绪弹窗**: 接受 / 提交更改，附带计划 Markdown 审阅

### macOS 原生适配

- 覆盖式标题栏（`macOSPrivateApi: true`，`titleBarStyle: "Overlay"`）
- Dock 徽标（通过 `objc2`）
- 关闭到系统托盘（关闭窗口时隐藏）
- 全局快捷键（`tauri-plugin-global-shortcut`）

### 后端集成

- **进程内** `Arc<AgentThread>`（无守护进程），与终端模式共用同一协议信封
- Tauri 命令按领域拆分在 `src-tauri/src/commands/<domain>.rs`，由 `src-tauri/src/commands/mod.rs` 重新导出
- 命令体封装 `reflect_protocol::Op` 及诊断 / 配置 / 工具 / 会话 / 文件 / Git / Shell / 允许列表 / 工作区 / 技能 / 记忆 / 钩子 / 搜索命令
- 单一推送事件通道 `reflect_event`（负载 = `reflect_protocol::Event`）
- `tokio::sync::broadcast` 支持多订阅者会话事件广播

### 设置

- 显示（主题：亮色 / 暗色 / 系统跟随、强调色、透明度、壁纸）
- 编辑器（Vim 模式 / 输出样式切换）
- 提供商（默认提供商 + API 密钥占位符）
- `ConfigForm` 覆盖 `reflect-agent/crates/resources/zhuye-config/src/schema/` 中的每个部分；高级原始 TOML 编辑器保留为出口

### Coding Plan 与额度自动切换

- 多计划配置：每个供应商可挂多条 `[[<provider>.credentials]]` 计划（label / api_key / base_url / model / 配额窗口声明），在 设置 → 编码计划 或 Models 页增删改
- 默认供应商一键切换（`[active].provider`）：保存后热重建凭证池并强制重绑当前会话，上下文保留、无需重启
- 同供应商池内 401 / 429 / 5xx / 网络错误由凭证池自动轮转，`routing` 事件在状态栏可见切换过程
- 额度耗尽自动跨供应商切换：监听 `quota_exhausted` 与耗尽特征错误 → 自动切到下一个有可用计划的供应商并 toast 告知（设置中可关闭，60s 防抖）
- 配额查询支持官方用量 API：zhipu / kimi / minimax / zenmux；其余供应商退化为本地 token 统计

---

## 环境要求

- Node.js ≥ 20 + pnpm
- Rust 工具链（stable）
- macOS：Xcode 命令行工具
- Linux：`webkit2gtk-4.1`、`libayatana-appindicator3-dev`、`librsvg2-dev`
- Windows：WebView2（Windows 10+ 自带）、Microsoft C++ 构建工具

---

## 快速开始

### 安装预编译版本（macOS arm64）

```bash
bash scripts/install.sh
# 安装：
#   /usr/local/bin/reflect-desktop           （二进制）
#   ~/Applications/ZhuYe.app                 （可启动包）
```

> **DMG 打不开提示「已损坏」？** 发布包为 ad-hoc 签名（无 Apple 开发者证书、
> 未公证）。macOS 会对一切下载的 app 打隔离标记，Gatekeeper 对没有开发者
> 身份的包统一报「已损坏，无法打开」——这是系统策略，不是包真的坏了。执行：
>
> ```bash
> xattr -cr /Applications/ZhuYe.app   # 或实际的安装路径
> ```
>
> 之后即可正常打开。应用内功能不受影响。

### 从源码构建

```bash
git clone --recursive https://github.com/Asketisch/ReflectDesktop.git
cd ReflectDesktop
pnpm install
git submodule update --init --recursive
bash scripts/build.sh        # 自动检测操作系统，输出原生安装包
bash scripts/install.sh      # macOS: 安装 .app + 二进制
```

`scripts/build.sh` 检测当前操作系统并发出正确的安装包类型：

| 操作系统   | 默认安装包      | 输出路径                                |
|----------|-------------|---------------------------------------|
| macOS    | `app,dmg`   | `target/release/bundle/macos/`        |
| Linux    | `deb,appimage` | `target/release/bundle/{deb,appimage}/` |
| Windows  | `msi`       | `target/release/bundle/msi/`          |

常用参数：
```bash
bash scripts/build.sh --fast          # release-fast 配置文件（无 LTO，快约 2 倍）
bash scripts/build.sh --universal     # macOS 通用 arm64+x86_64 二进制
bash scripts/build.sh --bundles=app   # 覆盖安装包列表
bash scripts/build.sh --dry-run       # 打印命令不执行
bash scripts/build.sh --help
```

等价的 npm 脚本：`pnpm build:native`、`pnpm build:universal`、`pnpm build:fast`。

### 开发模式

```bash
pnpm tauri dev
# 前端 HMR 监听 :5173，Tauri 窗口打开
```

### 运行验证套件

```bash
pnpm typecheck
pnpm test
cd src-tauri && cargo check
```

---

## 目录结构

```
ReflectDesktop/
├── reflect-agent/   # Reflect-Agent 仓库的 git submodule（reflect-* 核心 crate）
│                    # 只读镜像，通过 git submodule update --remote 升级
├── app-core/       # 共享的 UI 无关 reducer 与状态模块
├── src/            # React 19 + Vite + 功能切片组件
│   ├── features/   # 按功能切分的目录（shell/messages/composer/...）
│   ├── stores/     # 代理状态存储（Zustand），拆分为 agent/ 子模块
│   ├── services/   # 代理钩子 + 事件总线（兼容 + 引用计数广播）
│   ├── utils/      # bridge.ts（底层 invoke/listen）+ commands/<domain>.ts
│   │                # + tauri.ts / commands.ts 兼容桶 + i18n/<domain>/
│   ├── styles/     # tokens.css + base.css + typography.module.css
│   └── types/      # 从 reflect-protocol 模式导出生成
├── src-tauri/      # Tauri 2 Rust 后端（二进制名：reflect-desktop）
│   └── src/
│       ├── state.rs / events.rs / dock.rs / menu.rs / shortcut.rs
│       │         / tray.rs / mcp.rs        # 顶层集成模块
│       ├── commands/mod.rs + commands/<domain>.rs + commands/error.rs
│       └── hook_store.rs / memory_store.rs / shell_sessions.rs
│                     / workspace_state.rs   # 私有状态辅助模块
├── Cargo.toml      # workspace 根（app-core + src-tauri，path 引用 submodule crate）
├── docs/           # 更新日志 · 协议桥 · 代码地图 · 架构文档 · 用户指南 · 运行手册
└── scripts/        # install.sh · dump-ts-types.sh · build.sh
```

---

## Tauri IPC 命令表

命令按领域定义在 `src-tauri/src/commands/<domain>.rs`，通过 `src-tauri/src/commands/mod.rs` 重新导出，在 `src-tauri/src/lib.rs` 中通过 `tauri::generate_handler!` 注册。命令覆盖 `reflect_*` 系列，包含 `Op` 提交、会话 I/O、配置持久化、工具/技能/记忆/钩子列表、文件 + Git + Shell + 工作区 + 允许列表 + 搜索，以及 `ping` 和 `reflect_set_dock_badge`。

前端包装器位于 `src/utils/commands/<domain>.ts`（新代码），`src/utils/tauri.ts` 和 `src/utils/commands.ts` 保留为兼容桶。底层 `invoke` / `listen` 基元位于 `src/utils/bridge.ts`。

推送事件：单一通道 `reflect_event`，携带 `reflect_protocol::Event`（snake_case JSON 判别符覆盖 `EventMsg` 各变体）。

完整规范：[`docs/PROTOCOL_BRIDGE.md`](docs/PROTOCOL_BRIDGE.md)。

---

## 路线图

| 阶段 | 功能切片 | 状态 |
|---|---|---|
| **M1.x** | 骨架 + 协议桥 + 三窗格布局 + 编辑器 + 弹窗 + 状态栏 | ✅ 完成（commit `2c73335` … `76d7717`） |
| **M2.x** | 真实 AgentThread 后端 + 4 项产品联动（托盘/菜单/快捷键/Dock）+ macOS 关闭到托盘 | ✅ 完成（commit `65bff4b`） |
| **M3.x** | 22 个内置工具 + Streamdown + 上下文环 + 多会话 LRU + 配方 + 定时任务 + 深度链接 | 🔧 进行中 |
| **C1..C4** | 托盘完善、全局热键、Dock + 徽标、双二进制安装 | ✅ 部分完成 |
| **D1..D3** | 远程守护进程 + iOS 应用 + IM 桥 + 工作流画布 | 📅 已规划 |

完整历史：[`docs/CHANGELOG.md`](docs/CHANGELOG.md)。

---

## 升级代理核心（submodule）

当烛夜上游仓库（submodule `reflect-agent`，GitHub：Asketisch/ZhuYe）发布新版本时：

```bash
git submodule update --remote reflect-agent
git diff --submodule reflect-agent
git add reflect-agent && git commit -m "chore: bump reflect-agent submodule"
```

`reflect-agent/` 是只读镜像，不要直接编辑；改动请提交到烛夜上游仓库（ZhuYe）后升级 submodule（完整流程见 [`SUBMODULE.md`](SUBMODULE.md)）。

完整运行手册：[`docs/multi-agent-sync-runbook.md`](docs/multi-agent-sync-runbook.md)。

---

## 文档导航

| 文档 | 用途 |
|---|---|
| [`docs/codebase-map.md`](docs/codebase-map.md) | 面向任务的"需要改 X，编辑 Y"映射 |
| [`docs/PROTOCOL_BRIDGE.md`](docs/PROTOCOL_BRIDGE.md) | Tauri ↔ reflect-protocol 协议信封规范 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 顶层布局 + 状态流转 |
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | 终端用户手册 |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | 版本更新日志 |
| [`docs/gui/`](docs/gui/) | 历史设计文档（M1 快照） |
| [`docs/multi-agent-sync-runbook.md`](docs/multi-agent-sync-runbook.md) | 核心子模块升级检查表 |
| [`docs/mobile-ios-tailscale-blueprint.md`](docs/mobile-ios-tailscale-blueprint.md) | iOS + Tailscale 设置（已规划） |
| [`docs/headless-daemon.md`](docs/headless-daemon.md) | 守护进程生命周期 CLI（已规划） |
| [`AGENTS.md`](AGENTS.md) | 仓库 Agent 契约 |
| [`docs/index.html`](docs/index.html) | 渲染后的文档站点（浏览器打开） |

---

## 许可证

[Apache-2.0](LICENSE) — 安全漏洞请勿公开提交,流程见 [`SECURITY.md`](SECURITY.md)。