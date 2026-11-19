# 规划：SSH 远程开发（桌面端 agent 远程驱动项目）

<p align="center">
  <b>中文</b> · <a href="ssh-remote.en.md">English</a>
</p>

> **状态**：规划定稿，分阶段实施中。
> **目标**：桌面端 SSH 到某台机器，agent 会话在远程机器上跑（远端 cwd、远端工具执行、远端 rollout 落盘），桌面 UI 无差别消费事件流。
> **关联**：[../headless-daemon.md](../headless-daemon.md)（同构形态，TCP 版后续项）；[../capabilities.md](../capabilities.md) §2「有意不接线」的 serve/远程工具协议；[../protocol-bridge.md](../protocol-bridge.md)。

## 1. 接缝决策

**会话层接缝**：远端跑 `zhuye serve`（常驻 stdio JSONL 服务，一进程一 AgentThread），桌面以 SSH 子进程为传输成为协议客户端。

对比另外两条接缝（不采用）：

- 工具层（BashTool/文件工具走 SSH 通道）：27 个内置工具全是本机 fs/进程操作，沙箱是内核级（Seatbelt/Landlock）无法跨机施加，需虚拟化整个 ToolContext——改动面最大且无预留。
- 宿主层（workspace 指 `ssh://` URL）：`WorkspaceState`/`AgentConfig.workspace`/`ToolContext.workspace` 全是 `PathBuf` 类型链，属上游大手术。

会话层的天然优势：协议信封四方共用（传输无关）、serve IO 已参数化、**上游 v1 零引擎改动**（serve 本就是 stdio 协议面）、沙箱/权限/rollout/记忆全部在远端本地闭环（语义与本地完全一致）。

## 2. 现状地基

- 上游：`zhuye serve` stdin 收 `Submission`、stdout 写 `Event`，主动发 `session_configured` 握手；`Op::RegisterTools`/`ToolExecutionResponse` + `EventMsg::ToolExecutionRequest`（`ToolSource::Remote`/`RemoteBridge`）反向工具通道已预留——桌面 `docs/capabilities.md` §2 明确记录这 2 个 Op「有意不接线」，本功能点亮消费面。
- 桌面：`reflect_run_shell` 的 `sshHost` 参数（`ssh -o BatchMode=yes -o ConnectTimeout=10` argv 模式）可复用为传输形态；`RemoteConfig` 进程内存占位、`/remote` 路由已有（Tailscale 探测 + 状态服务器）；`app-core/tailscale.rs` 产出 `suggested_remote_host`。
- 事件路由：前台 `session_tx`（`reflect_event` 单通道）已按 sid 处理前台/后台双源，远程会话事件注入同一总线即可被 reducer 消费。
- 远端前置：已装 `zhuye` CLI（连接时版本探测，失败给安装引导文案）。

## 3. 后端改动（src-tauri/）

1. **新 `src/state/remote.rs`**：`RemoteSessionManager`
   - host 注册表持久化 `~/.zhuye/config.toml` `[remote_hosts]`（name/host/port/user）
   - 传输：`ssh -o BatchMode=yes -o ConnectTimeout=10 <host> -- zhuye serve --cwd <path>` 子进程 stdin/stdout duplex（无新 SSH 库，密钥认证）
   - `session_configured` 握手确认、stderr 捕获为诊断日志、存活监测（进程退出 → 会话标记断开）
   - 事件注入既有 `session_tx`（按 sid）
2. **命令面**（`src/commands/remote.rs` 扩展，替换 not-implemented 占位）：
   - `reflect_remote_hosts`（CRUD + 连通性测试）、`reflect_remote_connect/disconnect`
   - `state/submit.rs` 按 workspace 类型分流：本地 AgentThread / 远程 `RemoteAgentClient`（实现与本地相同的 submit/interrupt 命令面）；`ensure_workspace_matches` 扩展远端标识 `ssh://host/path`；协议 `SessionMeta.workspace` 是 String，v0 冻结不受影响
3. **会话生命周期**：切走 = 断开 serve 子进程（远端 rollout 已落盘，符合「切走必降级」）；切回 = serve resume 路径恢复；远端会话在侧栏独立「远程」分组

## 4. 前端改动

- `src/features/remote/` + `src/logic/remote/useRemoteController.ts` 扩展：host CRUD 卡片、连接状态、远端 zhuye 缺失时的 bootstrap 引导
- 工作区切换器加「远程工作区」入口；会话侧栏「远程」分组
- v1 有意降级（诚实边界）：文件浏览器/编辑器/git 面板对远端工作区显示「远端工作区暂不支持」空态

## 5. 后续项（不进 v1）

- 反向 RemoteTool 注册（`Op::RegisterTools`）：远程 agent 驱动桌面终端/文件预览——点亮 capabilities.md 记录的远程工具协议消费面
- 远端文件面板/编辑器/git 面板远端化
- TCP/TLS daemon（`headless-daemon.md` 形态），替代 SSH 子进程传输

## 6. 门禁与文档

- L3 `ipc_remote.rs`：stub serve 进程测握手/分帧/错误路径（沙箱 HOME/cwd 同既有夹具）
- L2 `useRemoteController` 扩展测试；`tests/contracts/` 同步（若有协议面新增）
- `tests/COVERAGE.md` + `tests/RUNTIME_COVERAGE.md` 补行
- `docs/protocol-bridge.md`（远程会话路由）、`docs/changelog.md`、`docs/capabilities.md`（serve 接线状态更新）

## 7. 风险

- SSH 密钥认证是硬前置（BatchMode 不支持密码交互）；认证失败报错需引导配 key。
- 每个远程会话一个 serve 子进程，与「后台线程表」模型同构，但进程边界在远端——网络中断的语义（会话标记断开 + 可 resume 恢复）要在 UI 明示。
- 远端 zhuye 版本与桌面引擎版本需兼容（连接时探测，主版本不匹配给警告）。
