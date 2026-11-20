# 烛夜 ZhuYe —— 用户指南

> **本文覆盖**：烛夜桌面端的安装、启动、日常使用与故障排查。
> **面向**：终端用户；开发者相关内容见根 [AGENTS.md](../AGENTS.md) 与 [architecture.md](architecture.md)。

烛夜（ZhuYe）桌面端，适用于 macOS / Linux / Windows（Tauri 2 + React 19）。

## 1. 安装

### 预构建（macOS arm64）

```bash
bash scripts/install.sh
# 安装到：
#   /usr/local/bin/zhuye-desktop           （二进制文件）
#   ~/Applications/ZhuYe.app                 （可启动包）
```

### 从源码

```bash
git clone --recursive https://github.com/Asketisch/ZhuYe-Desktop.git
cd ZhuYe-Desktop
pnpm install
pnpm tauri build --bundles app
bash scripts/install.sh
```

## 2. 启动

- 在 macOS 上点击 `~/Applications/ZhuYe.app`
- 或：从任意终端运行 `zhuye-desktop`（PATH 安装）
- 开发模式：`pnpm tauri dev`（HMR，开发工具）

## 3. 功能总览

GUI 采用 feature-sliced 布局，功能切片的完整清单与落点链见
`src/features/AGENTS.md` 的切片速览表（不在此写死清单，避免漂移）。

核心功能面：

| 功能区 | 说明 |
|---|---|
| 聊天 | 流式 / Markdown / 工具行渲染；斜杠命令、附件、提示词历史与选择预览 |
| 会话 | 时间分桶列表（现在 / 今天 / 昨天 / 本周 / 更早）、回放水合、导出（JSON / Markdown） |
| 工作台 | 记忆、技能、Hooks、提示词、模型（含免费模型发现）、插件与 MCP 管理、协作（讨论 / 流水线 / 安全扫描） |
| 编排 | 子代理、任务板 / 团队、Squad、Autopilot、目标模式、流水线 |
| 观测 | Inspector（token / 凭证池 / 计划 / todo / side-channel）、Traces（model-io + Span 树）、会话统计 |
| 终端 | 常驻 shell 会话、Git 工作台（含 worktree 状态）、文件编辑与诊断（LSP Problems） |
| 安全 | 权限规则、审批弹窗（含「始终允许」写进核心权限层）、OS 沙箱开关、提示注入防护 |

各能力的接线状态（✅ / 🟡 / ⛔）见 [capabilities.md](capabilities.md)。

## 4. 引擎与 IPC

GUI 通过本地进程内 `zhuye-core::AgentThread` 消耗烛夜 agent 引擎（`zhuye-agent` submodule），由 `zhuye_*` Tauri 命令暴露。线协议为 `zhuye-protocol::Event` / `Submission`（通过 Tauri 的 JSON 序列化器零拷贝）。

```text
React 19 + Vite
   |  （Tauri 命令 + 事件）
   v
src-tauri/        （Rust 适配层）
   |  （进程内 Arc + mpsc）
   v
zhuye-core::AgentThread（MinimalAgent 宿主封装）
```

当 agent 发布额外钩子/工具/内置功能时，同步一次：

```bash
git submodule update --remote zhuye-agent
```

## 5. 包大小

| 变体 | 大小 |
|---|---|
| `target/release/zhuye-desktop`（Mach-O） | ~7.5 MB |
| `target/release/bundle/macos/ZhuYe.app` | ~7.3 MB |
| 通过 `pnpm tauri build` 的跨平台目标 | .dmg / .msi / .deb / .AppImage |

## 6. 从烛夜 CLI 切换

上游 CLI（二进制 `zhuye`）和 `zhuye-desktop`（本仓库）共享相同的
`~/.zhuye/` 数据目录（sessions / 配置 / 记忆 / 权限），相同的模型注册表
和相同的 MCP 服务器。你可以来回切换而不丢失状态。

## 7. 跨平台状态

| 平台 | 状态 |
|---|---|
| **macOS arm64** | ✅ 构建 + 冒烟测试 |
| Linux x86_64 | ✅ 构建（e2e 真窗口走 tauri-driver） |
| Windows x86_64 | ✅ 构建 |
| Linux arm64 | 脚手架；后续 PR |

发布产物的深度校验由门禁 L4 承担（.app / .deb / .AppImage / .msi 解包校验），见 `tests/AGENTS.md`。

## 8. 故障排查

- **`binary not found: .../target/release/zhuye-desktop`** —— 先运行
  `pnpm tauri build --bundles app`。

- **`Permission denied for ~/.zhuye/sessions/`** —— `chmod 700 ~/.zhuye`。

- **Linux 上应用图标缺失** —— 安装 `libgtk-3-dev` + `libwebkit2gtk-4.1-dev`
  或遵循 Tauri 的 Linux 前置条件。

## 9. 后续方向

能力缺口的权威清单是 [capabilities.md](capabilities.md) §1（矩阵）与 §4
（剩余缺口与后续）；运行态覆盖见 `tests/RUNTIME_COVERAGE.md`。
版本历史见 [changelog.md](changelog.md)。
