# iOS + Tailscale 设置（TCP）—— ZhuYe-Desktop 远程后端

> **状态：WIP / 占位**。iOS 构建计划于 M3.x 实现。本文档记录预期的设置流程，供评审参考。

## 目标

将 iOS 版 ZhuYe-Desktop 连接到通过 Tailscale tailnet 运行的桌面守护进程，使手机能在不本地启动 `AgentThread` 的情况下驱动会话。

## 前置条件

1. 桌面和 iPhone 均安装并登录 Tailscale（同一 tailnet）。
2. 桌面端 ZhuYe-Desktop 以已知数据目录运行（`settings.json` + `workspaces.json`）。
3. iOS 端 Xcode + 命令行工具已安装；Rust iOS 目标已安装：

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
```

## 桌面端设置

1. 打开 ZhuYe-Desktop → 设置 → 服务器。
2. 设置"远程后端令牌"（随机 32 字节十六进制）。
3. 在"移动端守护进程"下点击**启动守护进程**。
4. 在 **Tailscale 辅助** → **检测 Tailscale**，记录建议的主机，例如 `your-mac.your-tailnet.ts.net:4732`。

## iOS 端设置

1. 打开 ZhuYe-Desktop（iOS）→ 设置 → 服务器。
2. 输入桌面 Tailscale 主机地址和相同令牌。
3. 点击**连接并测试**；确认成功。

## 无头守护进程控制

```bash
cd src-tauri
cargo build --bin reflect-desktop-daemon --bin reflect-desktop-daemonctl
./target/debug/reflect-desktop-daemonctl status
./target/debug/reflect-desktop-daemonctl start
./target/debug/reflect-desktop-daemonctl stop
./target/debug/reflect-desktop-daemonctl command-preview
./target/debug/reflect-desktop-daemonctl --listen 0.0.0.0:4732 --token <token> --data-dir ~/Library/Application Support/com.asketisch.reflectdesktop start
```

有用覆盖选项：

- `--data-dir <path>`：包含 `settings.json` / `workspaces.json` 的应用数据目录
- `--listen <addr>`：绑定地址覆盖
- `--token <token>`：令牌覆盖
- `--daemon-path <path>`：显式 `reflect-desktop-daemon` 二进制路径
- `--json`：机器可读输出

## iOS 模拟器

```bash
./scripts/build_run_ios.sh
# --simulator "<名称>" | --target aarch64-sim | --skip-build | --no-clean
```

## iOS USB 真机

```bash
./scripts/build_run_ios_device.sh --list-devices
./scripts/build_run_ios_device.sh --device "<设备名称或标识符>" --team <团队ID>
# --target aarch64 | --skip-build | --bundle-id <id>
```

首次设备设置：

1. iPhone 已解锁并信任此 Mac。
2. iPhone 已启用开发者模式。
3. Xcode 中至少完成过一次配对/签名。

如果签名尚未就绪：

```bash
./scripts/build_run_ios_device.sh --open-xcode
```

## TestFlight 发布

```bash
./scripts/release_testflight_ios.sh
```

自动从 `.testflight.local.env`（git 忽略）加载发布元数据。使用时先从 `.testflight.local.env.example` 复制。

## 故障排查

| 症状 | 原因 | 修复 |
|---|---|---|
| iOS 报 `connect refused` | 桌面守护进程未运行 | 在桌面启动守护进程；确认端口 4732 可达 |
| TLS 握手失败 | 令牌不匹配 | 在两端重新输入令牌 |
| 日志中出现 `Lagged(N)` | iOS 网络缓慢 | 降低会话事件频率；增大 broadcast 缓冲区 |
| 测试报 `no tailnet` | Tailscale 未连接 | 重新检查两端设备的 Tailscale 状态 |

## 注意事项

- iOS 连接期间，桌面守护进程必须持续运行。
- iOS 端终端和听写功能暂不可用（计划于 M3.x 实现）。