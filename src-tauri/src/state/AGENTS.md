# src-tauri/src/state/ —— AgentThread 宿主

> **何时读我**：动 `MinimalAgent` / AgentThread 宿主行为（安装、提交、换绑、热重载、插件接线）前读我。

## 模块概述

`state.rs` 是 facade：只暴露 `MinimalAgent` 顶壳与 thin 委托方法，真实现按职责拆在同目录子模块（顶层 21 个 `.rs` + `reload/tests.rs` 就位测试）。协议面不变：`commands/` 与 `lib.rs` 只消费 `MinimalAgent` 公开 API，Submission / Event 形态不随内部重构变化。

## 核心文件导航

| 文件 / 分组 | 一句话职责 |
|---|---|
| `state.rs` | facade：`MinimalAgent` 顶壳、子模块布线、thin 委托 |
| `agent.rs` | `MinimalAgentInner` 共享内部状态（含后台线程表、**已应答 plan gate 注册表 `resolved_plan_gates`** —— 引擎上游 `Op::PlanApproval` 只摘 waiter 不清挂起注册表，桌面端在 `zhuye_plan_approval` 登记 plan_id、`zhuye_bind_session` 返回快照前滤除，防已确认弹窗随换绑复活） + `new_empty` + 状态诊断快照；初始 workspace = cwd，cwd 解析失败回退 `$HOME`（不落占位 `.`，与 `workspace_state::restore_last_used` 同口径） |
| `model_spec.rs` | model spec 解析专题：降级原因 / 显式解析兜底（模型组 `[[model_group]]` 按组 id 查组内凭据）/ 动态清单发现（消费方 install / reload） |
| `install.rs` / `thread_factory.rs` | 二段构造第二阶段 `install_agent_thread` / install 与 rebind 共享的线程构造路径；子代理继承父线程配置与工作区，治理配置随线程快照；内置工具注册带 bundled 插件门（`register_builtin_tools_with_gates`；web_search 额外按 API key 门控，见 `web_search.rs`）与 verify-hooks 门控注入（启用即注入 verification / test_runner hook，判定源 `zhuye_plugin::bundled_plugin_enabled`）；线程构造注入 `with_tool_env`（web_search 的 BRAVE_API_KEY，主线程与侧通道线程同源） |
| `submit.rs` / `session.rs` | per-turn 提交流水（submit / submit_op / interrupt）/ session broadcast 入口 |
| `rebind.rs`（+ `rebind/tests.rs`） / `reload.rs`（+ `reload/tests.rs`） | 会话换绑（后台持续运行：demote/promote/后台表） / provider 栈热重载（plugins 段变更含门控工具差量同步），测试走 `#[cfg(test)] mod tests;` 目录形式 |
| `plugins.rs` / `plugin_hooks.rs` / `plugin_status.rs` / `web_search.rs` | 插件运行时接线（含 `apply_bundled_tool_gates`：web_search / notebook_edit 门随配置差量 register/unregister 共享工具表；web_search 门 = 插件开关 **且** API key 已配置）/ 插件事件桥 / 加载快照 / web_search key 判定与 `tool_env` 构造（`[web_search].api_key` 或 `BRAVE_API_KEY` 任一非空） |
| `autopilot.rs` / `quota.rs` / `remote_config.rs` | Autopilot 装配 / coding plan 配额接线 / 远端连接配置 |
| `agent.rs` 内 `browser` 字段 | 受控浏览器管理器（`src-tauri/src/browser_backend.rs`）：启动/attach + screencast 帧流；tokio Mutex（命令体持锁跨 await） |
| `remote.rs` | SSH 远程会话管理器：host 注册表（`$ZHUYE_HOME/remote-hosts.json`）+ serve 子进程传输（远端命令经 `sh -lc` 登录 shell）+ 事件泵（前台进 `session_tx`、后台进 `background_tx`）+ 远端 bootstrap 安装脚本；`foreground_remote` 插槽驱动 submit/submit_op 整条路由远端 stdin |
| `permissions.rs` / `sandbox.rs` / `sandbox_writable.rs` / `recorder_guard.rs` / `side_channel_forwarder.rs` / `subagents.rs` / `task_hooks.rs` / `activity.rs` / `discussion.rs` | 权限层装配 / OS 沙箱落点 / GUI 附加可写目录并入纯函数（自 `thread_factory.rs` 拆出，单测绑定合并语义）/ 会话写入协调 / 终态事件补发 / 子代理工具注册 / 任务生命周期转发 / activity 订阅 / 讨论运行态 |

## 本地契约与同步点

- 宿主状态不变量（`install_agent_thread` 时机、Lagged 容忍、close-to-tray）只认根 [AGENTS.md](../../../AGENTS.md)「关键不变量」，本篇不复述。
- 与 app-core 的消费关系：本目录经 `state.rs`、`activity.rs`、`agent.rs`、`sandbox.rs`、`submit.rs` 消费 `zhuye_app_core`，完整消费方地图与收敛判定见 [../../../app-core/AGENTS.md](../../../app-core/AGENTS.md)。
- 改 `reload.rs` 行为时同步补 `reload/tests.rs`（`#[cfg(test)] mod tests;` 目录形式，与 `memory_store/tests.rs`、`commands/config/tests.rs` 同一模式）。
- **模型接入栈热重载的 diff 段**（`provider_stack_changed`）：`active` / **`model_group`（模型组 `[[model_group]]`，组 id 注册为池名）** / `routing` / `model_discovery` 任一变化即重建 registry —— 上游已删除固定的 `[anthropic]` / `[openai]` / `[ollama]` 段（读入时迁移成等价模型组），新增模型接入相关配置段时**必须**把对应字段加进该比对列表，否则改配置不触发热重载。
- **后台会话线程表（v1.x 后台持续运行）**：`inner.background`（`Vec<(ThreadId, Arc<AgentThread>)>`，上限 `MAX_BACKGROUND_THREADS`）+ `background_tx`（`zhuye_session_event` 通道）+ `background_running`（forwarder 按 turn 生命周期维护）。不变量：跨会话换绑**不得 cancel** 旧线程（会话级令牌 = `Op::Shutdown`，「切走即停」的根因）；**同一 session 不允许两个 live 线程**——原地重建（forced 热重载 / pending error 重试）与超限驱逐仍走 cancel；forced 换绑清空后台表（provider 栈已重建，旧线程攥旧 registry）。`session.rs::route_event` 按 ptr_eq 分流前台/后台；`submit.rs` 的 per-turn forwarder 带提交时 bound sid（流式 delta 只走 per-turn 通道，降级后的 turn 靠它路由到后台通道）。
- **rebind 代数信号**：`inner.rebind_generation`（watch）在每次成功换绑时自增；`submit` 里挂在插件挂载等待上的提交据此快速失败（旧实现靠 cancel 旧线程间接解挂，后台化后线程不再被取消）。
- **一个线程一个 forwarder**：`AgentThread::subscribe_session()` 是**追加订阅者**语义（每次调用新建一条 mpsc 通道挂进 `session_subs`），同一线程挂两个 forwarder 会让每条事件被**双发**到前台通道（delta 文本翻倍）。线程的会话 id 终身不变，其 forwarder 自首次绑定起一直存活 —— promote（bind 回后台会话）**不得**再起 forwarder（`rebind.rs` 的 `promoted` 标记）。`inner.forwarder_count` 供回归断言（`rebind/tests.rs::promote_does_not_start_second_forwarder`）。
- **沙箱配置进线程快照（workspace-write）**：`thread_factory.rs` 主线程与侧通道线程都带 `with_sandbox_writable`（`[sandbox].writable_dirs` ∪ GUI 附加目录）与 `with_sandbox_network`（`[sandbox].allow_network`，此前只写盘不被消费）。配置在 bind 时快照 → `[sandbox]` 段变更经 `reload.rs` 强制重绑对当前会话生效（`os_level` 例外：submit 每轮盖章，无需重绑）。审批「完全访问」**不改**沙箱 —— 它跳过审批弹窗，并经上游 `HookContext.approval_policy` 让 `PlanModeGate` 在计划模式下放开全部 bash（write/edit 仍受 `.zhuye/plan` 白名单约束）。

- 恢复历史会话时，仅为新建线程注入未结清工具执行记录；后台线程 promote 不重复注入。治理配置变更需重绑线程。

## 禁止事项

- 不要在 Tauri `manage()` 同步阶段做运行时初始化——`install_agent_thread` 属 setup 阶段（见根篇不变量）。
- 不要绕过 facade 把 `MinimalAgentInner` 内部字段直接暴露给命令层。
- 新增子模块必须同步更新本篇导航表与 `state.rs` 的 `mod` 布线，两处缺一即导航失真。
- 不要在本目录复制 app-core 或上游 crate 已有的领域实现——先过 app-core 篇的收敛判定。

## 注意事项

- `agent.rs`、`plugins.rs` 已逼近 500 行生产文件预算，再增长优先按职责拆子模块并更新本表（例外条款见根 AGENTS.md「约定」）。
- `shell_sessions.rs`（本目录之外的同名顶层文件）仅剩类型锚点，实现已收编上游 `zhuye_shell`——别往里回填逻辑。

## 深入阅读

- 根 [AGENTS.md](../../../AGENTS.md) — 架构「关键不变量」
- [../../AGENTS.md](../../AGENTS.md) — Tauri 适配层层篇
- [../../../app-core/AGENTS.md](../../../app-core/AGENTS.md) — 领域服务层与收敛判定
- [../../../docs/architecture.md](../../../docs/architecture.md) — 系统架构
