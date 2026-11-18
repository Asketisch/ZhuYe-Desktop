# 无头守护进程管理

> **状态：计划于 M3.x 实现**。ZhuYe-Desktop 将提供一个可选的守护进程二进制文件，以无头方式运行 `reflect_core::AgentThread`，接受来自 Tauri 适配层（以及通过 Tailscale 连接的 iOS 客户端）的 JSON-RPC 连接。
>
> 本文档记录预期的接口，以便贡献者了解构建目标。

## 为什么需要守护进程

对于远程/iOS 场景，在不同于 UI 的主机上运行 `AgentThread` 需要：

1. 持有该线程的长生命周期进程。
2. JSON-RPC 传输（通过 stdio 或 TLS）。
3. 不依赖 Tauri 窗口的生命周期控制。

守护进程是宿主；选择远程模式时，Tauri 应用变为轻量级 RPC 客户端。

## 二进制文件

两个二进制文件，均从 `src-tauri/` 构建：

```bash
cd src-tauri
cargo build --bin reflect-desktop-daemon
cargo build --bin reflect-desktop-daemonctl
```

- `reflect-desktop-daemon` — 无头服务器。从应用数据目录读取 `settings.json` 和 `workspaces.json`；通过 stdio（本地）或 TLS（远程）提供 JSON-RPC。
- `reflect-desktop-daemonctl` — 生命周期 CLI：`status` / `start` / `stop` / `command-preview`。

## 守护进程生命周期

```bash
# 显示当前守护进程状态
./target/debug/reflect-desktop-daemonctl status

# 使用 settings.json 中的 host/token 启动守护进程
./target/debug/reflect-desktop-daemonctl start

# 停止守护进程
./target/debug/reflect-desktop-daemonctl stop

# 打印等效的守护进程启动命令（用于 systemd / launchd）
./target/debug/reflect-desktop-daemonctl command-preview

# 机器可读输出
./target/debug/reflect-desktop-daemonctl --json status
```

## 有用覆盖选项

| 参数 | 用途 |
|---|---|
| `--data-dir <path>` | 包含 `settings.json` / `workspaces.json` 的应用数据目录 |
| `--listen <addr>` | 绑定地址覆盖（默认：`127.0.0.1:4732`） |
| `--token <token>` | Token 覆盖（否则从 `settings.json` 读取） |
| `--daemon-path <path>` | 显式守护进程二进制路径 |
| `--json` | 机器可读输出 |

## JSON-RPC 接口（计划中）

方法名镜像 `src-tauri/src/lib.rs` 中的 Tauri 命令（如 `reflect_submit`、`reflect_list_sessions`）。域处理器位于 `src-tauri/src/bin/reflect-desktop-daemon/rpc/*`，镜像 Tauri 命令文件。

完整计划接口，参见 [`codebase-map.md` 守护进程导航](codebase-map.md#backend-navigation)（守护进程落地时添加）。

## settings.json 键（计划中）

```jsonc
{
  "remote": {
    "enabled": false,            // 本地 vs 远程模式（按工作区设置）
    "host": "your-mac.tail.ts.net",
    "port": 4732,
    "token": "..."               // 32 字节十六进制
  }
}
```

## 启动（macOS 用 launchd，Linux 用 systemd）

守护进程 intended 由操作系统服务管理器管理。`command-preview` 打印所需的确切命令：

```bash
./target/debug/reflect-desktop-daemonctl command-preview
# reflect-desktop-daemon \
#   --data-dir ~/Library/Application Support/com.asketisch.reflectdesktop \
#   --listen 0.0.0.0:4732 \
#   --token $(cat ~/Library/Application Support/com.asketisch.reflectdesktop/remote.token)
```

## 参见

- iOS + Tailscale 蓝图：[`mobile-ios-tailscale-blueprint.md`](mobile-ios-tailscale-blueprint.md)
- 协议信封：[`protocol-bridge.md`](protocol-bridge.md)
- 架构：[`architecture.md`](architecture.md)