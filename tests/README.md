# tests/ —— 发布门禁 + 应用级测试套件

本目录有两部分：

1. **发布门禁**（`run_all.sh` + `lib.sh` + `static/` `frontend/` `backend/`
   `artifact/` `e2e/`）—— 分层的**严格功能测试脚本**，发布阶段用来审查并测试
   全部功能。
2. **应用级测试套件**（`*.test.tsx` / `*.test.ts` + `helpers/`）—— 驱动
   **真实前端**走完完整功能路径的 vitest 用例。

两层合起来才覆盖完整功能面，理由见 §1。

---

## 1. 发布门禁（分层模型）

```bash
# 全部分层（发布前的标准入口）
bash tests/run_all.sh

# 单层
bash tests/run_all.sh static      # L1 静态审查
bash tests/run_all.sh frontend    # L2 前端行为
bash tests/run_all.sh backend     # L3 真后端能力覆盖
bash tests/run_all.sh artifact    # L4 发布产物审查
bash tests/run_all.sh e2e         # L5 视觉回归 + 真窗口冒烟（依赖缺失时跳过）
REFLECT_LIVE=1 bash tests/run_all.sh live   # L6 真免费模型演练（默认跳过）
```

退出码 **0 = 所选套件没有阻断项**，非 0 = 存在阻断项。部分运行或存在跳过
不能证明完整门禁通过。发布流水线对静态、前端、后端和 E2E 启用
`GATE_STRICT=1`，构建后分别强制审查各平台产物；L6 为可选演练。
报告落在 `.test-results/release-review.md`（含实际范围、跳过项与逐用例明细）。
报告同时记录运行前后的工作区状态和子模块状态；有本地变更时，提交号
仅表示 HEAD，不能代表实际测试的全部代码。
门禁总入口独占 `RESULT_DIR`；并行运行请为每次运行指定不同目录。
若进程被强制终止而残留 `.release-gate.lock`，确认没有对应门禁运行后可移除空锁目录。
后端的 `cargo-llvm-cov` 是可选报告，未安装或设置 `BACKEND_COVERAGE=0`
时记录 INFO，不计作检查跳过；报告未生成不能视为已有覆盖率证据。
发布流水线将矩阵的产物类型传给 `ARTIFACT_EXPECTED`，每种类型必须在当前
目标目录恰有一份，审查无跳过后才暂存这些安装包。
暂存由 `tests/artifact/stage.sh` 完成，只从指定目标目录取安装包；
非空暂存目录、缺失或重复产物都会失败。
后端层将 Rust 测试运行中的忽略项写入报告；除明确列出的实模型与上游外网
演练入口外，其余忽略项按 SKIP 处理，严格模式会因此失败。例外按测试
二进制和名称共同识别；忽略项的逐条记录与 libtest 汇总不一致时判失败。
后端层还核对 `src-tauri/tests/*.rs` 与 Cargo 实际启动的集成测试目标；
任一目标未被发现即判失败，避免测试文件因命名或编译配置问题静默漏跑。

| 层 | 套件 | 测什么 | 后端真伪 |
|---|---|---|---|
| L1 | `static/` | 源码与仓库状态：命令面四方一致、路由↔视图、版本四处一致、CHANGELOG / 能力矩阵新鲜度、仓库卫生、调试残留、生产文件大小预算棘轮 | 静态分析 |
| L2 | `frontend/` | 真实前端的行为：`tsc --noEmit` + vitest 全量 | **模拟**（`fakeBackend`） |
| L3 | `backend/` | **真后端**：`cargo fmt` / `clippy` / `cargo test --workspace --all-targets`（含能力覆盖层） | **真**（模型是假的） |
| L4 | `artifact/` | 发布产物：`.app` 结构 / Info.plist 键与版本 / 前端资源已嵌入 / 无开发残留 / 签名 | 真产物 |
| L5 | `e2e/` | 视觉回归（全路由 × dark/light 截图基线）+ 真窗口冒烟（Linux/Windows WebDriver、macOS CoreGraphics）。`E2E_REQUIRED=1` 强制 | 模拟（视觉）/ 真（窗口） |
| L6 | `live/` | **真免费模型**演练：真实 provider + 真实 SSE + 真实限流。默认跳过，`REFLECT_LIVE=1` 开启 | **真**（模型也是真的） |

### L5 视觉回归与真窗口冒烟

```bash
bash tests/run_all.sh e2e
E2E_REQUIRED=1 bash tests/run_all.sh e2e     # 依赖缺失判失败（CI release 用）
VISUAL_UPDATE=1 bash tests/run_all.sh e2e    # 视觉基线全部重生成（人工审查 diff 后入库）
E2E_SKIP_WINDOW=1 bash tests/run_all.sh e2e  # 强制跳过窗口冒烟
```

- **视觉回归**（`visual/`）：`vite build --config vite.config.visual.ts`
  构建浏览器态前端 —— `vite.config.visual.ts` 用 `resolve.alias` 把
  `@tauri-apps/api/{core,event}` 与 `@/test/setup` 指到 `tests/visual/shims/`
  （复刻 `setup.tsx` 的 mockInvoke 注册表语义，fakeBackend 在浏览器闭环，
  生产代码零改动）。Playwright 对 38 条路由 × dark/light 截图，与
  `tests/visual/__baselines__/` 的解码像素逐个比对，零容差。确定性由三件套保证：
  `addInitScript` 冻结 `Date`（fakeBackend 时间戳相对 `Date.now` 播种）、
  `reducedMotion: 'reduce'` + 注入 CSS 关闭动画/过渡/光标、
  `document.fonts.ready` 等待字体。本地缺基线时可生成，门禁标记为跳过；
  严格环境缺基线判失败。显式重生成也不算完成基线比对。
- **真窗口冒烟**（`window.smoke.test.ts` + `macos_window_smoke.sh`）：Linux
  用 `tauri-driver` + `webkit2gtk-driver`（`xvfb-run` 下），Windows 用
  `tauri-driver` + `msedgedriver`；macOS 无 WKWebView WebDriver，改用
  CoreGraphics 验证真实进程的 1280×800 在屏主窗口并截图。Linux 测试使用
  隔离 HOME 和本机 SSE 模型替身验证用户输入 → 真实 IPC → AgentThread →
  事件 → 界面回复、工具审批、批准后沙箱写盘、终端、文件编辑、Git、记忆、
  任务、会话切换、流中中断、Goal 控制器和压缩请求回执。截图留存
  `.test-results/e2e-window.png` / `.test-results/e2e-window-macos.png`。
- 窗口测试由 `tests/e2e/window-client.sh` 固定连接本次启动的本机
  `127.0.0.1:4444`，不会继承外部 `TAURI_DRIVER_URL`。
- 本地首跑需 `pnpm install`（playwright-core）+ 系统内已有 Playwright
  chromium（`pnpm exec playwright-core install chromium-headless-shell`
  或已装 chromium）。

### L6 实模型演练层（真免费模型）

```bash
REFLECT_LIVE=1 bash tests/run_all.sh live    # 真跑
bash tests/run_all.sh live                    # 默认跳过（不发起任何网络请求）
```

L6 由**两个**测试二进制组成：

| 二进制 | 覆盖 |
|---|---|
| `src-tauri/tests/ipc_live_free_model.rs` | **主回合**：真模型 → 正文 → token → 终态 |
| `src-tauri/tests/ipc_live_capabilities.rs` | **能力域矩阵**（15 个场景）：工具调用 / 工具审批 / 中断 / 压缩 / 回退 / plan 模式 / goal 模式 / 会话标题 / 任务工具 / 子代理 / 追问 / 讨论 / 流水线 / 团队流水线 |

能力域矩阵的纪律：**模型不配合 ≠ 产品缺陷** —— 模型没发起工具调用 /
没提问 / 没进 plan，判**跳过**（附理由）而不是失败；这一层测的是
**产品对模型输出的处理**，不是模型听不听话。上游限流 / 地区门 / 配额
耗尽同样判跳过。
使用 `REFLECT_LIVE_SCENARIOS` 筛选场景时，报告会记录未选择的场景，
严格模式不会将筛选结果当作完整矩阵。
配额耗尽时剩余场景也逐项记录为跳过；矩阵初始化成功后，每个场景必须
恰好产生一条结果，缺失或重复都会使演练失败。

**跑完整矩阵建议用本地模型**：匿名免费池（Kilo / dsh）的额度是**全局共享**
的，跑满若干轮就 `429 PROMOTION_MODEL_LIMIT_REACHED`；本地模型零成本、无限次、
离线可重复：

```bash
ollama pull qwen2.5:7b
REFLECT_LIVE=1 \
REFLECT_LIVE_PROVIDER=ollama \
REFLECT_LIVE_BASE_URL=http://127.0.0.1:11434 \
REFLECT_LIVE_MODELS=qwen2.5:7b \
bash tests/run_all.sh live
```

各车道与环境变量见 [`docs/FREE_MODEL_PRACTICE.md`](../docs/FREE_MODEL_PRACTICE.md)。

L3 的后端是真的，但**模型是假的**（wiremock / 本地 mock LLM）。假模型永远
测不到：真实 HTTP 往返、真实 SSE 帧形状、真实模型的思考过程、真实限流
（429）、真实截断续作、真实 provider 的工具调用质量。L6 把**免费模型池**
接进同一条真链路：

```
reflect_submit → AgentThread → HTTP → SSE 解析 → reflect_event 通道
```

与 GUI 点一次「发送」是**同一条链**（同一个 `generate_handler!` 注册表、
同一个 AgentThread、同一个事件通道）。实现见
`src-tauri/tests/ipc_live_free_model.rs`。

- **模型不写死**：配置写 `model = "free"`，运行时从 provider 清单**实时
  发现**（免费集合由上游决定，写死必然腐烂）。
- **只断言协议形状**：model spec 解析成真实 id、turn 有终态、usage 字段
  齐全、工具调用成对。**不断言回答文本** —— 真实模型输出不确定，逐字
  断言只会制造假失败。
- **429 判为跳过**而非失败 —— 测的是代码，不是配额。
- **只用合成 prompt**，不喂真实仓库内容 / 凭据（免费池的模型卡明示
  prompt 可能被上游记录）。
- 默认**不发任何网络请求**：测试带 `#[ignore]`，运行期还要 `REFLECT_LIVE=1`
  才放行（双保险）。

可用车道见 [`docs/FREE_MODEL_PRACTICE.md`](../docs/FREE_MODEL_PRACTICE.md)
（Kilo 免费池免 Key 直连 / dsh 本地网关转 OpenCode 车道）。

### 为什么 L2、L3 与 L6 都要有

L2 验前端行为与线格式，但它的后端是**模拟**的
（`helpers/fakeBackend.ts` 实现了全部 IPC 命令）—— **模拟后端的 bug 会把
真后端的 bug 遮住**。L3 补上这一块：直接驱动真命令体。L6 再补一格：
真命令体 + **真模型**。

> 这与 submodule `zhuye-agent/tests/` 的分层同理：能力覆盖层**不经过
> 任何 SDK**（那里是 Python 打真二进制的原始 wire），因为 SDK 自身的 bug
> 会把 Rust 的 bug 遮住。这里的「SDK」就是前端那层 `invoke` 包装与
> `fakeBackend`。submodule 侧另有 `tests/live/`（实模型层），桌面端的
> L6 与它同口径。

### L3 能力覆盖层怎么做到「真」

`src-tauri/tests/common/mod.rs` 用 `tauri::test::mock_builder()` 建 app，
再挂上**生产同一份**命令注册表 —— `reflect_desktop_lib::configure()`，
与 `run()` 共用同一个 `generate_handler!`（见 `src-tauri/src/lib.rs`）——
然后以 `InvokeRequest` 注入 JSON 负载驱动**真实命令体**。

```rust
// src-tauri/tests/ipc_core.rs（节选）
let v = invoke_ok("reflect_list_tools", json!({}));
assert!(v.as_array().unwrap().iter().any(|t| t["name"] == "bash"));
```

- 没有前端 `invoke` 包装；
- 没有 `fakeBackend`；
- 没有 SDK 中间层；
- `HOME` 与 cwd 指向独立的临时目录，数据根随之为 `$HOME/.zhuye`。macOS 的
  后端门禁把临时 HOME 放在已忽略的 `.test-results/backend-homes/`，以便
  沙箱测试区分它和系统临时目录；退出时清理，不使用开发者的数据目录。
- 清除人工输入、回滚和配额路径覆盖，以及宿主模型凭证；独立子进程自测
  确认这些覆盖不会让测试写入外部目录。
- npm 使用隔离缓存和离线模式，阻止上游插件测试夹具通过 `npx` 拉取远程包。

能力覆盖层文件：

| 文件 | 覆盖域 |
|---|---|
| `src-tauri/tests/ipc_core.rs` | 探针 / agent 状态 / 配置 / 工具 / 技能 / hooks / 记忆 / 笔记 / 白名单 / 权限规则 / 活动日志 / 会话 / 统计 / agent 定义 / autopilot / traces |
| `src-tauri/tests/ipc_workspace.rs` | 工作区 / 文件树 / 读写 / 搜索 / 终端 / 媒体 / 沙箱 / Git 全流程 / 会话导出 |
| `src-tauri/tests/ipc_domains.rs` | 任务 / 团队 / squad / 定时任务 / 插件 / 子代理 spec / MCP / LSP / 提示词 / KMS / side-channel / 讨论 / 流水线 |
| `src-tauri/tests/ipc_agent_ops.rs` | 提交 / 中断 / 压缩 / 回退 / 关闭 / 工具与 Hook 审批 / plan 与 goal 模式 / effort / 权限模式 / 追问 / steer |
| `src-tauri/tests/ipc_events.rs` | **事件回传通路**：信封形状 / `msg.type` 判别子 / `EVENT_ID_NONE` 生命周期 id / Submission↔Event id 配对 / 失败也走同一通道 / 转发器在 `Lagged` 后存活 |
| `src-tauri/tests/ipc_payload_contract.rs` | **跨运行时线格式契约（真后端侧）**：对样本表中非排除命令逐条检查反序列化（业务错误可、`invalid args` 不可）+ 探测器自检 |
| `src-tauri/tests/ipc_extensions.rs` | 绑定会话后重扫新增和删除的技能，验证事件与提交 ID 配对 |
| `src-tauri/tests/ipc_mcp_lifecycle.rs` | 本地 stdio MCP 服务的添加、工具调用、事件、重配和注销，以及启动失败事件；需要 PATH 中有 Node.js |
| `src-tauri/tests/ipc_lsp_agent.rs` | 本地模型请求 LSP hover，经审批后执行真实 stdio 服务并将结果返回模型 |
| `src-tauri/tests/ipc_lsp_disconnect.rs` | 本地 LSP 意外退出时发出失败事件、移除状态，关闭并重启后可继续预热 |
| `src-tauri/tests/ipc_mcp_agent.rs` | 本地模型发起 MCP 工具调用，经真实 AgentThread 审批和服务执行后把结果送回模型；需要 PATH 中有 Node.js |
| `src-tauri/tests/ipc_lsp_runtime.rs` | 本地 stdio LSP 服务启动、文件预热、诊断、hover 查询、关闭及重启；需要 PATH 中有 Node.js |
| `src-tauri/tests/ipc_lsp_startup_cancel.rs` | LSP 握手期间关闭或重开，以及并发启用时的服务和事件一致性；需要 PATH 中有 Node.js |
| `src-tauri/tests/ipc_schedule_runtime.rs` | 真定时 driver 在会话重绑定后触发本地模型，验证禁用任务不执行；等待下一个分钟边界 |
| `src-tauri/tests/ipc_question_runtime.rs` | 本地模型发起结构化问题，验证非法回执拒绝、选择和自定义文本返回模型 |
| `src-tauri/tests/ipc_input_runtime.rs` | 本地模型发起敏感自由文本询问及持久化人工输入，验证 IPC 回执、外部答案文件和结果返回模型 |
| `src-tauri/tests/ipc_env_isolation.rs` | 子进程继承外部数据路径和凭证时，验证测试夹具清除覆盖项且不触碰哨兵目录 |
| `src-tauri/tests/ipc_roundtrip_contract.rs` | **持久化往返契约（真后端侧）**：`tests/contracts/roundtrips.json` 的 21 对「写 → 读」在真后端全部成立 |
| `src-tauri/tests/ipc_mock_provider.rs` | **假模型全链路**：wiremock 假 Anthropic 网关 + 真后端/真 AgentThread —— 纯文本流（delta 累积 / token_count）、bash 工具调用 + 审批门 + tool_result 第二跳、旁路代理完成与取消、HTTP 500 错误路径、流中 interrupt（含恢复可用性） |
| `src-tauri/tests/ipc_concurrency.rs` | **并发不变量**：32 线程并行只读、16 并发 submit + 交错 interrupt、8 并发配置写（文件始终合法 TOML，不死锁；丢更新为已知口径不在此断言） |
| `src-tauri/tests/ipc_restart.rs` | **重启恢复**：子进程两阶段（阶段一写 → 进程退出 → 阶段二以同一 `~/.zhuye` 全新 app 读回）—— 配置/记忆/白名单/agent 定义/squad/任务/定时任务/工作区 |
| `src-tauri/tests/ipc_perf_budgets.rs` | **性能预算（后端侧）**：500 条 rollout 的会话索引 / 5k 行记录回放水合的墙钟上限（`PERF_STRICT=1` 收紧） |
| `src-tauri/tests/ipc_config_compat.rs` | **配置兼容**：4 份夹具（最小/旧版全量/未知键/当前全量）分别以独立子进程全新启动 —— 已知键生效、未知键不致命、agent 存活（`tests/fixtures/config/`） |
| `src-tauri/tests/ipc_goal.rs` | **目标模式状态快照（v1.7）**：stub provider 配置下断言 `reflect_goal_snapshot` 全周期 —— 未进入返回 null / 挂载后暴露 GoalState（goal 文本 / status / turn_count）/ 重进覆盖 verify_command 与 token_budget / 退出后回 null |
| `src-tauri/tests/ipc_goal_runtime.rs` | Unix 上以本地模型验证真实 goal 回合：模型判定与验证命令同时成功才退出 |
| `src-tauri/tests/ipc_plan_runtime.rs` | 本地模型验证进入计划、生成计划、读取计划文件和审批选择的真实状态流转 |
| `src-tauri/tests/ipc_rewind_runtime.rs` | 本地模型完成两轮后回退第一轮，验证事件、截断数量与回放共同收缩；32 轮后手动压缩，验证下一条模型请求的上下文收缩 |
| `src-tauri/tests/ipc_discussion_runtime.rs` / `ipc_discussion_no_model.rs` | 本地模型驱动顺序与并发讨论并验证角色身份、实时事件与会话 transcript 持久化；无 provider 时显式返回空跑结果 |
| `src-tauri/tests/ipc_discussion_live.rs` / `ipc_discussion_failure.rs` / `ipc_discussion_cancel.rs` / `ipc_discussion_history.rs` | 分别锁定运行中消息、失败终态、运行中取消（cancelled 终态）与无筛选历史排除普通会话 |
| `src-tauri/tests/ipc_pipeline_runtime.rs` / `ipc_pipeline_input_probe.rs` | shell 节点真实执行、失败传播与自定义输入模板 |
| `src-tauri/tests/ipc_team_pipeline_runtime.rs` | 本地模型驱动团队流水线的四阶段节点，验证报告、节点顺序、产出和四次模型请求 |
| `src-tauri/tests/ipc_subagent_runtime.rs` / `ipc_subagent_nested.rs` / `ipc_subagent_cancel.rs` | 本地模型委派子代理、嵌套父→子→孙代理及两次结果回传、状态查询、会话隔离与经 `reflect_interrupt` 的定向取消 |
| `src-tauri/tests/ipc_task_note_runtime.rs` | 本地模型调用任务与会话笔记工具，验证可见性、持久化、错误处理、下一回合注入和会话隔离 |
| `src-tauri/tests/ipc_autopilot_runtime.rs` / `ipc_autopilot_agent.rs` | 1 秒 tick 的 Autopilot 到期提交本地模型、成功回填历史，验证禁用后不再触发、重绑定会话继续触发，模型失败与用户中断分别回填 `failed`；指定 agent 经 side-channel 执行，验证普通回合及两个自动任务交错时各自回填 |
| `src-tauri/tests/ipc_autopilot_limit.rs` | 本地模型循环调用工具，真实线程触达配置的迭代上限并回填失败历史 |
| `src-tauri/tests/ipc_autopilot_budget.rs` | 绑定会话后热更新 token 预算，真实模型请求触发预算耗尽并回填失败历史；移除预算后同一会话可继续请求模型 |
| `src-tauri/tests/ipc_autopilot_startup_budget.rs` | 安装线程前配置 token 预算，真实模型请求触发预算耗尽并回填失败历史 |
| `src-tauri/tests/ipc_op_contract.rs` | 26 个提交操作样本经真实协议 serde 往返，并探测未知变体、缺失字段和被静默忽略的字段 |

> **与既有两份集成测试的分工**：`src-tauri/tests/e2e_chat.rs` 与
> `protocol_bridge_e2e.rs` 早于本轮就已存在 —— 它们**绕过 Tauri IPC**，
> 直接驱动 `MinimalAgent::submit` 捕获 session broadcast，验的是
> **AgentThread / 协议桥**这一层。能力覆盖层补上的是**再往上一层的
> IPC 命令面**（GUI 真正的入口）：命令注册表、参数反序列化、返回体形状、
> 错误传播。三者叠起来才覆盖从"UI 点一下"到"agent 跑起来"的完整链路。
> 这两份集成测试使用隔离 HOME 与工作目录；真实模型演练统一由 L6 显式开启。

**覆盖口径**（哪个能力域由哪层验、哪些能力显式排除及理由）见
[`COVERAGE.md`](COVERAGE.md)。
各功能的前端替身、真实后端和真窗口证据，以及尚未验证的运行态场景，见
[`RUNTIME_COVERAGE.md`](RUNTIME_COVERAGE.md)。

### 公共设施：`tests/lib.sh`

所有门禁脚本都 source 它，获得：

- 仓库根 / 产物定位（`ROOT` / `DIST_DIR` / `RESULT_DIR`）；
- 隔离环境（`make_isolated_env` —— mktemp HOME + 独立 cwd）；
- 便携超时（`run_with_timeout` —— macOS 无 coreutils `timeout`，用后台
  pid + kill 模拟）；
- 断言助手（`assert_contains` / `assert_eq` / `assert_json` …）；
- 用例统计与失败汇总（`tcase` / `tskip` / `tcase_log` / `tfinish`）；
- 逐套件结果落盘（`$RESULT_DIR/<suite>.status` / `.cases`）——
  `run_all.sh` 据此拼发布审查报告。

### 棘轮（ratchet）项

某些指标当前存量不达标（历史债），直接当门禁会永久变红。这类检查与
`tests/static/baseline.json` 比对 —— **新增**违规立即失败，存量逐步偿还：

- `PROTOCOL_BRIDGE.md` 命令覆盖率下限；
- 生产文件 ≤ 500 行的超限文件清单。

基线重生成：`node tests/static/analyze.mjs --write-baseline`。

---

## 2. 应用级测试套件（vitest）

通过一个实现**全部 IPC 命令**的状态化模拟后端，驱动**真实前端**
（React 应用完整挂载、真实 reducer、真实 React Query、真实路由）走完完整
功能路径，并对线协议（wire shape）、UI 行为与失败韧性做断言。

测试集包括前端组件、应用级行为及真后端能力覆盖层
`src-tauri/tests/ipc_*.rs`，后者覆盖事件回传、跨运行时契约、假模型全链路、
并发、重启恢复、性能预算和配置兼容；`menu.rs` 另有菜单事件单测。
具体测试数量以本次运行结果为准。

### 运行

```bash
# 全量（含 src/ 与 tests/）
pnpm test

# 仅本目录
pnpm vitest run tests/

# 单个文件（定向迭代）
pnpm vitest run tests/chat.full-flow.test.tsx
```

Vitest 收集范围已在 `vitest.config.ts` 中扩展为 `src/**` + `tests/**`，
环境（jsdom、`src/test/setup.tsx` 的 Tauri mock）与 `src/` 测试完全复用。

### 目录结构

```
tests/
├── run_all.sh                              # 发布门禁总入口
├── lib.sh                                  # 门禁公共助手
├── COVERAGE.md                             # 能力 → 套件映射（发布审查口径）
├── static/                                 # L1 静态审查层
│   ├── run.sh
│   ├── analyze.mjs                         # 源码级交叉比对（命令面 / 路由 / 命名空间 …）
│   ├── manifest-parity.mjs                 # submodule 清单奇偶校验（继承键缺一即断）
│   ├── manifest-parity.test.sh             # 自测（正向 / 缺键点名 / 多键容忍 / 空段失败）
│   ├── submodule-status.test.sh            # submodule 指针检查的自测
│   ├── analyzer-status.test.sh             # 分析器状态的自测
│   └── baseline.json                       # 棘轮基线
├── frontend/run.sh                         # L2 前端行为层
├── backend/run.sh                          # L3 真后端能力覆盖层
├── artifact/                               # L4 发布产物审查层
│   ├── run.sh
│   ├── lib.sh                              # 共享断言（codesign 授权嵌入检查）
│   └── codesign-entitlements.test.sh       # 上一行的自测（PATH 垫片伪造 codesign 四形态）
#
# 自测执行入口:static/ 的三个 *.test.sh 由 L1「门禁自测脚本」用例统一
# 执行;codesign 自测由 L4 自身编排（static 扫不到 artifact/ 目录）。
# 递归护栏:自测内部再跑 run.sh 时置 RUN_SELFTESTS=0,子进程跳过自测
# 用例 —— 否则 run.sh → 自测 → run.sh 无限递归。
├── e2e/                                    # L5 视觉回归 + 真窗口冒烟
│   ├── run.sh
│   ├── window.smoke.test.ts                # tauri-driver 真窗口冒烟（Linux/Windows）
│   └── macos_window_smoke.sh               # macOS CoreGraphics 原生窗口探针
├── live/                                   # L6 实模型演练层（真免费模型）
│   └── run.sh                              # REFLECT_LIVE=1 才真跑（默认跳过）
├── visual/                                 # 视觉回归（L5 的视觉半边）
│   ├── run.sh 所用的 spec：visual.spec.ts / vitest.config.ts
│   ├── main.tsx / index.html               # 浏览器态入口（生产 main.tsx + visual globals）
│   ├── shims/                              # alias shim：@tauri-apps/api + @/test/setup 浏览器替身
│   └── __baselines__/                      # 截图基线（38 路由 × dark/light，人工审查入库）
├── helpers/                                # ↓ vitest 侧（应用级套件）
│   ├── fakeBackend.ts                      # 全命令模拟后端 + ScriptedAgent 事件编排
│   ├── appHarness.tsx                      # 真实应用挂载（renderApp / renderView）
│   └── routeMatrix.ts                      # 路由矩阵共享表（行为/zh-CN/axe 三处同源）
├── contracts/                              # ↓ 跨运行时线格式契约（L1/L2/L3 三层共享）
│   ├── payloads.json                       # 命令参数样本及真后端排除清单
│   └── roundtrips.json                     # 21 对「写 → 读」持久化往返
├── a11y.route-matrix.test.tsx             # 34 路由 axe 审计（serious/critical = 0）
├── a11y.keyboard.test.tsx                 # 模态 Tab 焦点陷阱 + Escape 线上回执
├── perf.budgets.test.tsx                  # 性能预算：reducer/分桶/长会话水合
├── errors.boundary.test.tsx               # 视图渲染错误边界（真实视图崩溃路径）
├── ipc.command-contract.test.ts            # IPC 契约与四方对齐
├── ipc.payload-contract.test.ts            # 线格式契约（fakeBackend 侧）：接受真后端形状的参数样本
├── ipc.roundtrip-contract.test.ts          # 往返契约（fakeBackend 侧）：与真后端同表跑「写 → 读」
├── agent.protocol-events.test.ts           # 协议事件全矩阵
├── chat.full-flow.test.tsx                 # 聊天端到端主流程
├── flows.chat-plan-goal-edit.test.tsx      # chat→plan→edit 全链路 + goal 多轮续作
├── modals.approvals-questions.test.tsx     # 审批/提问/计划模态
├── sessions.lifecycle.test.tsx             # 会话列表/分桶/重放/切换
├── composer.slash-history-attachments.test.tsx  # 输入框：斜杠命令/历史/附件
├── settings.config.test.tsx                # 设置页配置读写
├── views.route-matrix.test.tsx             # 34 条路由的视图矩阵
├── views.untested-slices.test.tsx          # 九个零测试视图的交互与数据投影
├── ipc.event-contract.test.ts              # 事件面契约(fakeBackend 侧):50 变体不落 unknown
└── errors.resilience.test.tsx              # 错误与韧性
```

### 事件链路（被测路径 = 生产路径）

```
fakeBackend（ScriptedAgent 按脚本 emit 事件）
  → vi.mock 的 @tauri-apps/api/event listen('reflect_event')
    → agentEventBus（引用计数扇出）
      → agentStore.subscribe()（AppProviders 中建立，与生产一致）
        → reduceEvent → React 视图
```

`reflect_event` 信封保持线上格式 `{ id: string; msg: ReflectEventMsg }`，
`id === ''`（`EVENT_ID_NONE`）表示生命周期事件。用户输入经真实 Composer
（textarea + Enter）进入 `useComposerSubmission` → `reflect_submit`，
由 fakeBackend 捕获 `Submission` 信封并触发脚本化回复。

### 基础设施

#### `helpers/fakeBackend.ts` — `installFakeBackend()`

- 实现 `src-tauri/src/lib.rs` `generate_handler!` 中注册的**全部** `reflect_*` 命令
  及 `ping`，返回带状态的单例句柄 `FakeBackend`：
  - `calls` / `callsOf(cmd)` / `lastArgsOf(cmd)` — 调用日志，用于断言精确的线格式
    参数（如 `reflect_rewind { toTurnId }`、`reflect_rename_session { id, newName }`）。
  - `state.*` — 可读写的内存后端状态（sessions、rollouts、config、tasks、git 等），
    测试可直接改写后触发 refetch 观察 UI 变化；所有派生返回值经 `wire()`（JSON
    round-trip）返回，模拟真实 IPC 序列化，避免 React Query 结构共享跳过更新。
  - `state.failures[cmd] = Error` — 指定命令抛错，模拟后端故障。
  - `agent.*` — 交互回执捕获：`submissions`、`toolApprovals`、`hookApprovals`、
    `planChoices`、`questionResponses`、`inputResponses`。
  - `override(cmd, handler)` — 覆盖单条命令返回值。
  - `registeredCommands` — 完整性校验用（见契约测试）。
- **ScriptedAgent**：`backend.agent.script: ScriptStep[]` 驱动 `reflect_submit`
  的回复编排：
  - `{ emit: msg | msg[] }` — 发出一个或多个 `ReflectEventMsg`；
  - `{ gate: 'tool_approval' | 'hook_approval' | 'plan_approval' | 'question' | 'input' }`
    — 挂起，轮询等待对应回执后才继续，复刻真实 agent 的审批停顿。
  - 新提交会抢占旧脚本（`turnToken`），与真实中断语义一致。
  - **脚本只绑定 `reflect_submit`**（用户文本提交）。Op 驱动的流
    （`/plan` → `reflect_enter_plan_mode`、`/goal` →
    `reflect_enter_goal_mode` 等）不经过 submit，测试中以 `emitEvent(
    返回的 submission id, msg)` 手动回放 agent 侧事件——与真实语义一致
    （Op 命令返回 submission id，agent 在同一 id 下继续产出事件）。
- goal 模式状态（`state.goal`）镜像 core 侧 `cfg.goal` 的 GoalController
  生命周期：enter 写入目标/校验命令/预算，exit 清空。
- 会话/时间/任务等 fixture 覆盖全部时间分桶（Now/今天/昨天/本周/更早）与典型字段。

#### `helpers/appHarness.tsx`

- `renderApp()` — 挂载**完整应用**（`RouterProvider` + I18nProvider + 每挂载一个全新
  QueryClient + `agentStore.subscribe()`），返回 `{ navigate, pathname }`。
  不复用 `router.tsx` 里的模块级单例 QueryClient，保证测试间隔离。
- `renderView(ui)` — 仅挂载 provider 包裹的片段（如 `<ModalStack/>`）。
- `resetAppAfterEach()` — `afterEach` 中重置 store 并回到 `/`。

### 覆盖映射

| 文件 | 测试数 | 覆盖内容 |
| --- | --- | --- |
| `ipc.command-contract.test.ts` | 29 | 四方对齐：后端 `pub async fn reflect_*` ↔ 前端 `src/utils/commands/` 包装 ↔ `lib.rs` 注册表 ↔ fakeBackend 实现；逐域线格式参数往返（审批三种决定形态、会话改名、数字任务 id、计划、goal 模式可选字段两形态、定时、边车、工作区、白名单等）；失败传播。`PROTOCOL_BRIDGE.md` 覆盖率断言（≥0.85）。 |
| `agent.protocol-events.test.ts` | 38 | 全部 `EventMsg` 变体经真实 bus → store 的完整矩阵：生命周期、turn、delta、工具调用对、审批（含 plan 绕过）、协作/MCP/LSP、计划事件、配额耗尽 toast（含数字与时间窗）、未知类型运行安全。 |
| `chat.full-flow.test.tsx` | 4 | 真实挂载 + 键入发送：thinking → delta → 工具调用 → 审批门 → 完成；提交信封、转录文本、模态标题、审批回执、token 统计、完成标志；中断；旧脚本抢占；turn 级错误项。 |
| `flows.chat-plan-goal-edit.test.tsx` | 8 | **旗舰回路**：chat → plan 草稿多次更新 → `plan_ready` → 用户三选择（auto_mode / manual_approve / revise，含事件驱动关闭）→ 编辑工具（`write_file` 逐工具审批）→ 完成，断言完整 IPC 时序；`/plan` 斜杠 Op 入口 + `/exit-plan`；**goal 模式**：`/goal <text>` 线格式、agent 零提交自动多轮续作（多 turn 累积/done/转录）、`/goal clear` 退出、裸 `/goal` reject 引导。 |
| `modals.approvals-questions.test.tsx` | 14 | 三个模态全路径：工具/hook 审批的全部决定形态、多模态排队、问题单选/多选索引组装、追问文本输入与关闭语义、计划审批三选项 + 事件驱动关闭、四模态共存。 |
| `sessions.lifecycle.test.tsx` | 11 | 五桶时间分组与 i18n 标签、空态、失败态与 Refresh 恢复、重放水合（turns/工具项/loadedSessionId）、重放失败重试、会话切换再水合、`/chat` 清空、侧栏点击导航与 aria-pressed、`/rename` 斜杠改名 + 失效重取、首条消息失效会话查询。 |
| `composer.slash-history-attachments.test.tsx` | 14 | `/compact` `/plan` `/effort` `/mode` `/interrupt` 全命令、未知命令与无效值拒绝、`/model` 引导 toast、斜杠弹层（listbox + Escape）、↑/↓ 历史召回与编辑重置、文本+图片合并信封、Shift+Enter 换行、空输入不提交、提交后清空。 |
| `settings.config.test.tsx` | 8 | ready/degraded 状态徽标、配置加载失败时壳层保持可用、权限快捷按钮（4 常用 + 7 模式全量）、raw TOML 编辑保存（精确 `{toml}` 参数 + Saved 反馈）、保存失败无反馈、语言切换（`document.documentElement.lang`）。 |
| `views.route-matrix.test.tsx` | 35 | 34 条路由逐一：主内容非空、触发对应领域命令、fixture 文本可见；外加路由树完整性对照 `router.routeTree`。 |
| `errors.boundary.test.tsx` | 3 | 视图渲染错误边界：真实视图崩溃路径（KMS `tags:null`）→ 回退 + 壳层存活 / Retry 恢复 / 切路由复位（`ViewErrorBoundary` 包 `<Outlet />`，此前任一视图 render 抛错 = 整树白屏）。 |
| `a11y.route-matrix.test.tsx` | 38 | 34 条路由逐挂 axe-core：serious/critical 违规为零（jsdom 无布局，`color-contrast` 关闭留给视觉层）。与路由矩阵共享 `helpers/routeMatrix.ts`。 |
| `a11y.keyboard.test.tsx` | 3 | 模态键盘可达性：Tab 焦点陷阱（连按不逃出 dialog）；Escape 的**线上回执**（审批 → `deny{dismissed}`、plan → `revise`）；堆叠模态只有栈顶响应。 |
| `perf.budgets.test.tsx` | 3 | 性能预算（冒烟级，`PERF_STRICT=1` 收紧）：reduceEvent 1 万 delta / bucketSessions 5k 会话 / 2k 记录会话水合渲染。 |
| `errors.resilience.test.tsx` | 7 | `stream_error` 追加错误项且 turn 仍完成、会话级错误只置 lastError、配额 toast、会话列表失败 + Refresh 恢复、`reflect_submit` 失败 toast、审批 IPC 失败模态仍乐观清除（不卡死 UI）、中断后新 turn。 |
| `ipc.payload-contract.test.ts` | 随契约表变化 | 跨运行时线格式契约（fakeBackend 侧）：参数样本被 fake handler 接受、调用参数完整回放、样本表 ↔ 注册表双向无差集。真后端对非排除命令消费同一份样本。 |
| `ipc.roundtrip-contract.test.ts` | 21 | 持久化往返契约（fakeBackend 侧）：`contracts/roundtrips.json` 的 21 对「写 → 读」与真后端（`ipc_roundtrip_contract.rs`）同表执行 —— 无状态桩（写不进 / 读固定值）会立刻露馅。 |

### 断言约定

- i18n 默认 locale 为 `en`；按**渲染后的英文文案**断言（如分桶标签 `This Week`/`Older`）。
- 视图组件使用 CSS Modules，类名会被 mangle —— 一律按 role / 文案 / aria-label 定位，
  不依赖类名。
- 计划就绪模态的关闭是**事件驱动**的：`approvePlan` 发 IPC 后需等
  `plan_approved` / `plan_rejected` 事件才清除 `pendingPlan`。
- 模态按钮 onClick 为 fire-and-forget；测试中如需触发预期失败，直接调用
  store action 并 `.catch()`，避免 unhandled rejection。
- 折叠项（`Collapsible` 默认收起）内容不在 DOM 中 —— 相关断言走 store 状态。

### 与生产代码的关系

- 不修改任何 `src/` 生产代码来迁就测试；`src/test/setup.tsx` 的 Tauri mock 被
  fakeBackend 完整接管（`resetMockInvoke` 后重新注册）。
- 线协议以 `docs/PROTOCOL_BRIDGE.md` 为契约，契约测试对文档覆盖率设下限，
  新增后端命令时若文档未更新会失败。

## 统一测试调度器(PLAN.md §1.4 接口)

`runner.py` 是跨平台(Python 3.10+,仅标准库)任务调度入口,把 PLAN.md
第 4 章任务 ID(`desktop.*`)映射到本仓既有六层(static / frontend / backend /
artifact / e2e / live):

```bash
python3 tests/runner.py list                     # 任务 / 选集 / 用例索引
python3 tests/runner.py run --suite pr           # PR 门禁选集
python3 tests/runner.py run --case D-E05         # 按 PLAN 用例 ID 定向
python3 tests/runner.py run --suite release --artifact <安装包路径>
```

- 结果语义:`pass / fail / skip / infra_error / timeout / pending(未覆盖)`;
  统一 runner 会为 E2E 注入 `E2E_REQUIRED=1`,依赖缺失判失败;
  Linux/Windows 走 WebDriver,macOS 走 CoreGraphics 原生窗口探针。后端
  Rust 测试已跨三平台执行,两者不可互相替代。签名、安装升级与产物启动
  由 L4 强制审查;真机输入法专项保持显式登记,不假绿。
- 报告:`.test-runner/report.json` + `junit.xml` + 人类摘要;记录 HEAD、
  工作树状态与子模块指针(两个客户端固定不同 Runtime 版本,见 PLAN §1.3)。
- 任务注册表见 `test_registry.py`。

L1 还会机械核对每条已注册命令是否有 IPC/命令体单测引用。确需依赖宿主机或
网络的命令必须写入 `tests/command-test-exclusions.json` 并给出原因;排除项
指向不存在命令或原因为空同样失败。
