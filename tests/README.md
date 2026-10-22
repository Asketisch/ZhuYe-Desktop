# tests/ —— 发布门禁 + 应用级测试套件

本目录有两部分：

1. **发布门禁**（`run_all.sh` + `lib.sh` + `static/` `frontend/` `backend/`
   `artifact/`）—— 分层的**严格功能测试脚本**，发布阶段用来审查并测试
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
```

退出码 **0 = 允许发布**，非 0 = 存在阻断项。报告落在
`.test-results/release-review.md`（含逐用例明细与分层结论）。

| 层 | 套件 | 测什么 | 后端真伪 |
|---|---|---|---|
| L1 | `static/` | 源码与仓库状态：命令面四方一致、路由↔视图、版本四处一致、CHANGELOG / 能力矩阵新鲜度、仓库卫生、调试残留、生产文件大小预算棘轮 | 静态分析 |
| L2 | `frontend/` | 真实前端的行为：`tsc --noEmit` + vitest 全量 | **模拟**（`fakeBackend`） |
| L3 | `backend/` | **真后端**：`cargo fmt` / `clippy` / `cargo test --workspace --all-targets`（含能力覆盖层） | **真** |
| L4 | `artifact/` | 发布产物：`.app` 结构 / Info.plist 键与版本 / 前端资源已嵌入 / 无开发残留 / 签名 | 真产物 |

### 为什么 L2 与 L3 都要有

L2 验前端行为与线格式，但它的后端是**模拟**的
（`helpers/fakeBackend.ts` 实现了全部 IPC 命令）—— **模拟后端的 bug 会把
真后端的 bug 遮住**。L3 补上这一块：直接驱动真命令体。

> 这与 submodule `reflect-agent/tests/` 的分层同理：能力覆盖层**不经过
> 任何 SDK**（那里是 Python 打真二进制的原始 wire），因为 SDK 自身的 bug
> 会把 Rust 的 bug 遮住。这里的「SDK」就是前端那层 `invoke` 包装与
> `fakeBackend`。

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
- `HOME` / `REFLECT_HOME` / cwd 全部指向进程专属临时目录 —— 不污染
  开发者的 `~/.reflect`，也不往仓库里写 `.reflect/`。

能力覆盖层文件：

| 文件 | 覆盖域 |
|---|---|
| `src-tauri/tests/ipc_core.rs` | 探针 / agent 状态 / 配置 / 工具 / 技能 / hooks / 记忆 / 笔记 / 白名单 / 权限规则 / 活动日志 / 会话 / 统计 / agent 定义 / autopilot / traces |
| `src-tauri/tests/ipc_workspace.rs` | 工作区 / 文件树 / 读写 / 搜索 / 终端 / 媒体 / 沙箱 / Git 全流程 / 会话导出 |
| `src-tauri/tests/ipc_domains.rs` | 任务 / 团队 / squad / 定时任务 / 插件 / 子代理 spec / MCP / LSP / 提示词 / KMS / side-channel / 讨论 / 流水线 |
| `src-tauri/tests/ipc_agent_ops.rs` | 提交 / 中断 / 压缩 / 回退 / 关闭 / 工具与 Hook 审批 / plan 与 goal 模式 / effort / 权限模式 / 追问 / steer |
| `src-tauri/tests/ipc_events.rs` | **事件回传通路**：信封形状 / `msg.type` 判别子 / `EVENT_ID_NONE` 生命周期 id / Submission↔Event id 配对 / 失败也走同一通道 / 转发器在 `Lagged` 后存活 |
| `src-tauri/tests/ipc_payload_contract.rs` | **跨运行时线格式契约（真后端侧）**：`tests/contracts/payloads.json` 的 185 条参数样本逐条反序列化（业务错误可、`invalid args` 不可）+ 探测器自检 |
| `src-tauri/tests/ipc_roundtrip_contract.rs` | **持久化往返契约（真后端侧）**：`tests/contracts/roundtrips.json` 的 21 对「写 → 读」在真后端全部成立 |
| `src-tauri/tests/ipc_mock_provider.rs` | **假模型全链路**：wiremock 假 Anthropic 网关 + 真后端/真 AgentThread —— 纯文本流（delta 累积 / token_count）、bash 工具调用 + 审批门 + tool_result 第二跳、HTTP 500 错误路径、流中 interrupt（含恢复可用性） |
| `src-tauri/tests/ipc_concurrency.rs` | **并发不变量**：32 线程并行只读、16 并发 submit + 交错 interrupt、8 并发配置写（文件始终合法 TOML，不死锁；丢更新为已知口径不在此断言） |
| `src-tauri/tests/ipc_restart.rs` | **重启恢复**：子进程两阶段（阶段一写 → 进程退出 → 阶段二以同一 `~/.reflect` 全新 app 读回）—— 配置/记忆/白名单/agent 定义/squad/任务/工作区 |
| `src-tauri/tests/ipc_perf_budgets.rs` | **性能预算（后端侧）**：500 条 rollout 的会话索引 / 5k 行记录回放水合的墙钟上限（`PERF_STRICT=1` 收紧） |
| `src-tauri/tests/ipc_config_compat.rs` | **配置兼容**：4 份夹具（最小/旧版全量/未知键/当前全量）分别以独立子进程全新启动 —— 已知键生效、未知键不致命、agent 存活（`tests/fixtures/config/`） |

> **与既有两份集成测试的分工**：`src-tauri/tests/e2e_chat.rs` 与
> `protocol_bridge_e2e.rs` 早于本轮就已存在 —— 它们**绕过 Tauri IPC**，
> 直接驱动 `MinimalAgent::submit` 捕获 session broadcast，验的是
> **AgentThread / 协议桥**这一层。能力覆盖层补上的是**再往上一层的
> IPC 命令面**（GUI 真正的入口）：命令注册表、参数反序列化、返回体形状、
> 错误传播。三者叠起来才覆盖从"UI 点一下"到"agent 跑起来"的完整链路。

**覆盖口径**（哪个能力域由哪层验、哪些能力显式排除及理由）见
[`COVERAGE.md`](COVERAGE.md)。

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

当前规模：`tests/` 下 16 个测试文件 / 1371 个测试（另有 `src/` 内 99 个
组件/模块测试文件）—— 合计 115 文件全绿。另有**真后端**能力覆盖层
`src-tauri/tests/ipc_*.rs`（12 文件 / 104 个测试：179/185 条命令 + 事件
回传通路 + 跨运行时契约 + 假模型全链路 + 并发不变量 + 重启恢复 + 性能
预算 + 配置兼容）与 `menu.rs` 内嵌单测（菜单 id ↔ 分支对齐 + 事件派发）。

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
│   └── baseline.json                       # 棘轮基线
├── frontend/run.sh                         # L2 前端行为层
├── backend/run.sh                          # L3 真后端能力覆盖层
├── artifact/run.sh                         # L4 发布产物审查层
├── helpers/                                # ↓ vitest 侧（应用级套件）
│   ├── fakeBackend.ts                      # 全命令模拟后端 + ScriptedAgent 事件编排
│   ├── appHarness.tsx                      # 真实应用挂载（renderApp / renderView）
│   └── routeMatrix.ts                      # 路由矩阵共享表（行为/zh-CN/axe 三处同源）
├── contracts/                              # ↓ 跨运行时线格式契约（L1/L2/L3 三层共享）
│   ├── payloads.json                       # 185 条命令的参数样本（真后端可反序列化）
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
| `ipc.payload-contract.test.ts` | 186 | 跨运行时线格式契约（fakeBackend 侧）：`contracts/payloads.json` 全部 185 条参数样本被 fake handler 接受、调用参数完整回放、样本表 ↔ 注册表双向无差集。与 L3 `ipc_payload_contract.rs` 跑同一份样本 —— 模拟层与真后端的参数形状漂移（历史实例：allowlist `entries` vs `prefixes`）会同时被两端抓住。 |
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
