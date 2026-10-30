# 烛夜 ZhuYe —— 用户指南

> 烛夜（ZhuYe）桌面端，适用于 macOS / Linux / Windows（Tauri 2 + React 19）。

## 1. 安装

### 预构建（macOS arm64）

```bash
bash scripts/install.sh
# 安装到：
#   /usr/local/bin/reflect-desktop           （二进制文件）
#   ~/Applications/ZhuYe.app                 （可启动包）
```

### 从源码

```bash
git clone https://github.com/Asketisch/ReflectDesktop.git
cd ReflectDesktop
pnpm install
git submodule update --init --recursive
pnpm tauri build --bundles app
bash scripts/install.sh
```

## 2. 启动

- 在 macOS 上点击 `~/Applications/ZhuYe.app`
- 或：从任意终端运行 `reflect-desktop`（PATH 安装）
- 开发模式：`pnpm tauri dev`（HMR，开发工具）

## 3. M1.x 中的功能

> 烛夜桌面端采用 feature-sliced 布局，`src/features/` 下 24 个 slices：
> about / app / apps / collaboration / composer / debug / design-system
> / dictation / files / git / home / layout / messages / mobile / models
> / notifications / plan / prompts / settings / shared / skills / terminal
> / threads / update / workspaces。

在 M1.x 中，活跃的 slices 为：

| Slice | 状态（M1.x） | 路线图 |
|---|---|---|
| **layout** | 带可调整分割线的三栏 | 稳定 |
| **messages** | 7 种行类型 + Markdown + prismjs 语法高亮 | M2.x 加 Streamdown 打字机 |
| **composer** | IME 安全文本框 + 斜杠弹窗（47 条命令）+ 9 个 Tier A 工具栏按钮 | M2.x 加文件引用 + 图片附件 |
| **modals** | 外壳 + 4 个存根变体（审批 / 问题 / 询问用户 / 计划就绪） | M2.x 活动事件驱动渲染 |
| **statusbar / settings** | 顶部 + 底部栏，显示模型 / 主题 / vim 标志；显示 / 编辑器 / 提供程序设置 | M2.x 加记忆 / 技能 / 权限部分 |
| **sessions** | 时间分桶列表（现在 / 今天 / 昨天 / 本周 / 更早） | M2.x 加分叉 + 归档 + LRU |
| 其他 18 个 slices | 空 README 占位符 | B1–B10 逐波 |

## 4. IPC 契约

GUI 通过本地进程内 `reflect-core::AgentThread` 消耗烛夜（ZhuYe）agent，由 `reflect_*` Tauri 命令暴露。线协议为 `reflect-protocol::Event` / `Submission`（通过 Tauri 的 JSON 序列化器零拷贝）。

```text
React 19 + Vite
   |  （Tauri 命令 + 事件）
   v
src-tauri/        （Rust 适配层）
   |  （进程内 Arc + mpsc）
   v
reflect-core::AgentThread（M1.x：MinimalAgent 存根；M2.x：真实）
```

当 agent 发布额外钩子/工具/内置功能时，同步一次：

```bash
git submodule update --remote reflect-agent
```

## 5. 包大小

| 变体 | 大小 |
|---|---|
| `target/release/reflect-desktop`（Mach-O） | 7.5 MB |
| `target/release/bundle/macos/ZhuYe.app`（debug + bundle） | 7.3 MB |
| 通过 `pnpm tauri build` 的跨平台目标 | .dmg / .msi / .deb / .AppImage |

## 6. 从烛夜 CLI 切换

上游 CLI（二进制已更名 `zhuye`；TUI 由独立的 Reflect-TUI 项目提供）和
`reflect-desktop`（本仓库）共享相同的 `~/.zhuye/sessions/` JSONL 存储、
相同的模型注册表和相同的 MCP 服务器。你可以来回切换
而不丢失状态。

## 7. 跨平台状态

| 平台 | 状态（M1.x） |
|---|---|
| **macOS arm64** | ✅ 构建 + 冒烟测试 |
| Linux x86_64 | ✅ 构建（未冒烟测试） |
| Windows x86_64 | ✅ 构建 |
| Linux arm64 | 脚手架；后续 PR |

## 8. 故障排查

- **`binary not found: .../target/release/reflect-desktop`** —— 先运行
  `pnpm tauri build --bundles app`。

- **`Permission denied for ~/.zhuye/sessions/`** —— `chmod 700 ~/.zhuye`。

- **Linux 上应用图标缺失** —— 安装 `libgtk-3-dev` + `libwebkit2gtk-4.1-dev`
  或遵循 Tauri 的 Linux 前置条件。

## 9. 路线图

查看 `docs/ARCHITECTURE.md` 了解技术布局，查看 `docs/PRODUCT_LINKAGES.md`
了解 M2.x 板上剩余的四个产品级集成：

1. 原生托盘（显示/隐藏 / 新对话 / 退出）
2. 全局热键（Cmd+. → reflect_interrupt）
3. macOS dock 可见性 + 徽标计数
4. 跨平台打包矩阵（.dmg / .msi / .AppImage / .deb）
