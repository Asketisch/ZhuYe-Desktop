# Reflect GUI 用户指南

> ZhuYe 桌面 GUI（Tauri 2 + React 19）—— M1 MVP（2026-07+）

## 1. 安装

### macOS

```bash
# 一次性安装依赖 (rustup, pnpm, cargo-tauri CLI)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
npm install -g pnpm
cargo install tauri-cli --version "^2"

# 在仓库根
cd crates/reflect-gui
pnpm install
pnpm tauri build         # 生产构建
pnpm tauri dev           # 开发模式（热重载）
```

产物位置：

- macOS: `src-tauri/target/release/bundle/macos/Reflect.app` + `…/dmg/Reflect_0.1.0_aarch64.dmg`
- Linux: `src-tauri/target/release/bundle/appimage/reflect_0.1.0_amd64.AppImage`
- Windows: `src-tauri/target/release/bundle/msi/Reflect_0.1.0_x64_en-US.msi`

### Linux / Windows

依赖清单与排错见 [`docs/gui/03-architecture.md` §6](../../docs/gui/03-architecture.md#6-跨平台注意点)。

## 2. 启动

首次启动：

1. Reflect 拉起 macOS 窗口（标题栏融入系统 vibrancy / overlay）
2. 默认 session 显示 `(waiting...)` —— 第一次输入 prompt 时会发出 `SessionConfigured` 事件
3. 输入框位于主区域底部，按 `Cmd+Enter` 或 `Ctrl+Enter` 提交

## 3. 键盘快捷键

| 快捷键 | 行为 |
|---|---|
| `Cmd+Enter` / `Ctrl+Enter` | 提交 composer 输入 |
| `Cmd+.` / `Ctrl+.` | 中断当前 turn（占位） |
| `Esc` | 关闭 modal；退出 slash popup |
| `/` | 在 composer 中触发 Slash 命令 popup |
| `↑` / `↓` | 在 slash popup 中切换选中 |

完整 47 slash 命令参见 [docs/gui/04-roadmap.md §M1.5](../../docs/gui/04-roadmap.md#25-m1.4)。

## 4. 三栏布局

```
+--------+--------------------+----------+
| session|       chat         |   right  |
|  list  |       (flex)       |   panel  |
| (260px)|                    |  (340px) |
+--------+--------------------+----------+
|             status bar / footer           |
+--------------------------------------------+
```

- **左 sidebar**：时间分桶 Session 列表（Now / Today / Yesterday / This week / Older）。点击切换 session。
- **中部**：chat 主区域 + composer。流式回复带 `▍` 光标。
- **右 panel**：M2.5+ 将挂 task / tool inspector / cost tracker。M1 留空，可通过 `Hide right panel` 按钮关闭。
- **顶 / 底栏**：当前 session model / provider + 主题 / vim / 权限模式 tag。

## 5. 设置

右上 `Settings` 按钮打开：

- Display：theme (light / dark / system)
- Editor：vim 开关（占位）
- Provider：default provider 切换

修改即时落 `~/.zhuye/config.toml` 并触发 `ConfigWatcher`（M2.x）。

## 6. 与 TUI 的差异

| 维度 | TUI | GUI |
|---|---|---|
| Markdown 渲染 | ratatui 自绘（Syntect） | react-markdown + prismjs |
| 会话切换 | `/session` + 快捷键 | sidebar 点击切换 |
| 多窗口 | 单 viewport | 三栏 + M2.5 多 session LRU |
| Settings | 通过 slash | 独立视图 |
| 部署 | 终端二进制 | macOS .app / Linux AppImage / Windows .msi |

TUI 与 GUI 共用同一份 Rust 后端（`reflect-protocol` / `reflect-core` / `reflect-rollout`），状态隔离 —— 同时跑两者互不影响。

## 7. 故障排查

| 现象 | 可能原因 | 解决 |
|---|---|---|
| 启动窗口全黑 | vite 构建产物 `dist/` 未生成 | `pnpm build` 然后再 `pnpm tauri dev` |
| `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS` | 缺 esbuild post-install 权限 | `pnpm approve-builds esbuild` 后重试 |
| `cargo build` 报 `OUT_DIR not set` | Cargo 没识别 src-tauri 的 build.rs | 在 `src-tauri/Cargo.toml` 显式声明 `build = "build.rs"` |
| icon 是占位纯色 | 走默认 fallback | 自行替换 `src-tauri/icons/*.png` |

## 8. 反馈

- 任务规格：`docs/todo/21-gui/`
- 决策记录：`docs/gui/05-decision.md`
- 下一阶段（M2）预告：流式 Markdown 打字机、Context Ring、Recipe、Cron UI
