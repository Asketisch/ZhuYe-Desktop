# 核心能力 → GUI 覆盖矩阵

> 本文档是烛夜 ZhuYe（GUI）与烛夜 agent 基座（submodule，上游更名 ZhuYe）之间的
> **能力对照表**。它回答两个问题：
> 1. 基座提供了哪些能力，GUI 是否能用、能看到？
> 2. 还没接的能力有哪些、为什么、后续怎么接？
>
> 审计范围：`zhuye-agent/crates/**`（submodule 只读镜像）对照
> `src-tauri/src/**`（命令层）+ `src/**`（前端）。
> 历史各轮审计流水见文末「[历史审计记录](#历史审计记录)」。

> 最近审计：submodule `8b16ebd`（上一审计 `e52bfda`，更早 `c19211b`）。本批为引擎修复批（`ca7cc68` + 文档同步 `8b16ebd`）：safe_write 对系统管理 xattr（`com.apple.provenance`）与属组保留失败降级 —— write/edit 对带 provenance 属性文件不再误报 `Operation not permitted`；write/edit/delete_file/notebook_edit 对 workspace 写根之外改走 `ask_tool_forced` 强制审批（协议面新增的是**既有** `approval_request` 的新触发路径，命令面、配置面与工具集合零变化）；工具执行失败 metadata 新增结构化 `error: {type: ToolError::kind(), message}`（§3.3 `tool_call_end` 行已登记）；桌面配套 GUI 启动 PATH 补全（`shell_env.rs`，桌面自有模块非引擎能力）。此前一轮为全仓统一更名（纯改名批次）。
>
> 上一轮审计：submodule `ea7039d`（上一审计 `502a620`）：范围 502a620b..ea7039db（2 提交）—— `8a52b295` 托盘透明图标修复（纯资源，零代码）；`ea7039db` 桌面授权的 submodule 直改（已直推上游 main）：zhuye-subagent 两条事件转发白名单放行 `EventMsg::InteractionResolved`，子代理挂起交互的了结广播（§3.34 `interaction_resolved`）得以进入父会话事件流 —— **事件变体已存在，协议 / 命令面 / 配置零变化**，仅转发路径补全；桌面配套接线（reducer 移除连坐清理 + 提交门控）见 changelog「多 agent 同回合提问不再提前放行提交」条。
>
> 上一轮审计：submodule `545fe21`（上一审计 `6a4e773`）：范围 6a4e773e..545fe218（1 提交，桌面授权的 submodule 直改落 main）—— **zhuye-kms Windows 编译修复**：`platform/windows/browse.rs:121` 裸引用 `page::pinned_modified`，但该文件只命名导入 `{PinnedDir, pin_child, pin_root, read_file_at}`，Windows 平台编译 `zhuye-kms` 直接 E0433（0.1.17 平台目录重组 `5c96b391`/`abdb3ad8` 的残留；上游跨平台 CI 未跑此 crate，桌面端 native e2e windows 在 `cargo build -p zhuye-desktop` 处暴露）。修法按同目录 `admin.rs` 命名导入惯例补 `pinned_modified` 并改直接调用；host 侧 `cargo check -p zhuye-kms` 复验通过。**协议 / 命令面 / 配置零变化**，桌面零适配（仅 rustfmt 顺带重排 `commands/lsp.rs` 的 let-else）。
>
> 上一轮审计：submodule `6a4e773`（上一审计 `9e96988`）：范围 9e969884..991ab86b（上游 main 37 提交，v0.1.17）—— **引擎目录大重组 + 大输出头尾回执 + 压缩熔断修复**。①**目录重组（本轮 37 提交中的 30 个）**：上游把 45 个 crate 的内部实现按职责分入子目录（`zhuye-llm/billing`、`zhuye-memory/{insight,lifecycle,retrieval,storage}`、`zhuye-tools/{builtins,guards,checkpoint,interaction,execution,fs,web,human,plan,exec,meta}`、`zhuye-mcp/{protocol,protocol_ext,client,tools,catalog}`、`zhuye-lsp/{protocol,session}`、`zhuye-task/task`、`zhuye-cli/commands`、`zhuye-kms/platform`、`zhuye-exec/tools`、`zhuye-skills/market`、`zhuye-config/model_discovery`），并同步上游 18 篇 AGENTS.md。**协议 crate 零变更**（`crates/protocol/` diff 为空），`Op` / `EventMsg` / `Submission` 线格式不变。桌面适配 4 处模块路径（均为「模块搬家、根级 re-export 未覆盖」）：`zhuye_tools::worktree::worktree_dirty` → `zhuye_tools::worktree_dirty`（根级 re-export）、`zhuye_lsp::matching` → `zhuye_lsp::session::matching`、`zhuye_mcp::registry` → `zhuye_mcp::catalog::registry`、`zhuye_config::discovery` → `zhuye_config::model_discovery`（`discovery` 改名消解同名歧义）。②**大输出回执改头尾预览**（`056f13a5`）：工具输出模型预算从「只留开头 8 KiB」改为头尾各半，回执标注引擎收到文本总字节数与头尾 UTF-8 偏移；bash 新增 `stdout_truncated` / `stderr_truncated`（100 KiB 捕获上限后是否真丢弃），落盘文案由「完整输出」改「已捕获输出」；`read` 分页指引保留 `next_byte_offset`。桌面零适配（回执是工具文本内容，`ToolOutput.metadata` 为 `unknown` 透传）。③**压缩管线四缺陷修复**（`53909596`）：单行超长内容绕过字符预算 → 按字符截断；快速回填守卫上膛条件误用 `below_trigger` → 拆独立判据；手动强制压缩静默失效；`Skip` 不推进窗口锚点。桌面零适配（`ContextCompacted` 事件形状未变）。④其余：`c80b6e26` 项目描述进默认提示词、`991ab86b` README 整理、`55ea2966` 版本对齐 0.1.17。**产品命令 / 配置 schema / SDK 公开面零变化**，前端零改动。
>
> 上一轮审计：submodule `9e96988`（上一审计 `a7e5858`）：范围 a7e5858a..9e969884（上游 main 前移 + 桌面授权的 submodule 直改落 main）—— **Windows 沙箱敏感路径结论如实分平台 + 上游 mock 冒烟数据目录隔离**。①`zhuye-sandbox`：`path_protection_report()` 的判定按后端分述 —— 「可写根外的写被默认拒绝」（`EnforcedByDefault`）只在沙箱**真的接管了命令执行**时成立（macOS Seatbelt / Linux Landlock 会包裹命令）；Windows 的 Job Object 后端（F24）**已实现但未接入 bash spawn 路径**（`tools/builtins/bash.rs` 只对 Seatbelt / Landlock 包裹命令），Windows 上命令透传执行、写权并未被撤销，此时报「已强制只读」是对宿主撒谎，故结论为 `Unsupported`（附「未接入 bash spawn 路径」原因），`strict_paths=true` 时失败关闭。修正前该结论被写死成 `EnforcedByDefault`，在桌面端 CI 的 Windows runner 上判红（上游跨平台 CI 不跑本 crate，未暴露）。②新增跨平台回归用例（显式构造 `backend=WindowsJobObject` 跑同一份断言），避免「只在 Windows runner 才红」的盲区。③上游 `scripts/`：mock 冒烟（`e2e.sh` / `sdk_smoke.sh` / `full_link.sh`）统一把 `ZHUYE_HOME` 指向一次性临时目录，引擎进程不再写真实 `~/.zhuye`（避免 mock 会话在桌面端会话列表留下空壳条目）；`discussion_smoke.sh` 因走真实 provider 鉴权保持不隔离。**产品命令 / Op / EventMsg / 配置与 SDK 公开面零变化**，桌面端零代码适配。
>
> 上一轮审计：submodule `a7e5858`（上一审计 `ef27752`）：范围 ef27752fa..a7e5858a（6 提交，`feat/async-subagent-suspend-turn` 合入 main）—— **子代理异步派发 + 回合挂起激活**：`call_<role>` 新增可选 `mode` 参数（缺省 / 非法值回落 `sync` = 旧行为，退化方向安全）；`async` 立即返回占位回执（`tool_call_end` 的 `output.metadata` 带 `async` / `pending` / `child_id`），子代理由后台任务接管继续跑，父回合在 `check_stop` 收尾前查 `PendingSubagentRegistry`（每线程一份：工具侧 `ToolContext.pending_subagents` 写、引擎侧 `NodeContext.pending_subagents` 读；等待与取走按**派发回合令牌**筛选，避免 A 回合的结果注入 B 回合）挂起等待；结果作为 user `<system-reminder>` 注入当前回合并落盘后**同轮续跑**（仍只有一次 `turn_complete`）。四条级联保障：①后台任务同时监听放弃句柄与父回合令牌（异步后台任务不随工具 future 析构，「打断父回合 ⇒ 级联取消在途子代理」须显式接线）；②`abandon_turn` 在回合任务收尾清掉来不及等待的条目（打断 / 出错 / 触顶收尾时子代理不再跑完后污染后续回合）；③`PendingCompletionGuard` 兜底后台任务意外中止（条目永不滞留「在飞」，否则此后每回合收尾都为它挂起）；④终态首个为准、迟到补写忽略。配套：`7ef666a0` 修 main 既有 CI 红（clippy / 编译 / 溢出预算 / 审批弹窗用例）；`a7e5858a` 能力覆盖矩阵计数同步至 401（异步子代理 +3 用例）。**协议面零变化**（`zhuye-protocol` crate 未动，`Op` / `EventMsg` 无新增；`mode` 是工具入参非 wire 协议）。桌面接线：**零代码适配**（`AgentConfig::new` 自动建表；占位回执照常走 tool_call_end 进消息流，子代理进度事件照常进 dock feed，挂起期表现为回合持续运行）+ **lock 配套**：tokio-util 0.7.18 → 0.7.20（`PartialEq/Eq for CancellationToken` 为 0.7.20 新增，登记表按令牌匹配依赖该 impl；上游 lock 一直在 0.7.20，桌面 lock 滞留旧版致新 tip E0369 编译失败）。GUI 可选增强（未做，不阻断）：dock feed / 检查器可用占位 metadata 标注「后台运行中」。
>
> 上一轮审计：submodule `ef27752`（上一审计 `ff32c15`）：范围 6b1031aa..ef27752f（1 提交，桌面授权的 submodule 直改落 main）—— **计划审批呈递修复**（会话 889c3bd0 实证：模型写完 plan 后被引擎注入的模式无关 `runtime.nudge-final` 诱导纯文本收尾，从未调 `ExitPlanMode` → 无 `plan_ready` → 前端拿不到 pendingPlan）。①`maybe_inject_progress_nudge_with_set` 增加 `mode` 参数，Plan 模式预算收尾改 `runtime.nudge-final-plan`（明确「写好 plan 就立即调用 ExitPlanMode，不要用 FINAL ANSWER」）、web nudge 追加 `runtime.nudge-plan-tail`；②`PlanWrite` 输出末尾提示下一步调 `ExitPlanMode`；③`system.plan-mode` / `runtime.active-mode` 提示词把「PlanWrite 成功后必须以 ExitPlanMode 结束本轮」写成硬约束（builder 内嵌默认同步）；④`AgentState` 新增 `plan_draft_written` / `plan_ready_dispatched` / `plan_stop_guard_attempts`，`check_stop` 在 Plan 模式「已写 plan 却未派发 PlanReady」时否决收尾并注入 `runtime.nudge-plan-submit`（上限 2 次）；⑤强制收尾轮 Plan 模式保留全量工具且工具调用真正走 `ToolExec`（此前直接 `CheckStop`，导致「保留 ExitPlanMode」是死功能）；⑥`Op::ExitPlanMode` 先读最新 `.zhuye/plan/*.md`，读不到才用占位回退 —— 桌面「提交并执行」兜底提交真实计划。**Op / EventMsg / 命令面零变化**，桌面配套见 changelog「右侧栏对齐 ZCode + 计划自动展开 / 可滚动 / 可执行」。
>
> 上一轮审计：submodule `ff32c15`（上一审计 `fbee643`）：范围 edd749c5..fbee6433（1 提交，桌面授权的 submodule 直改落 main）—— **询问档只读语义 + full_access 放行 plan bash + /compact 附加指示**（桌面权限三档与 `/` 命令对齐 ZCode 的引擎侧配套）：①`HookContext` 增加 `approval_policy`（serde default，additive；来自 `zhuye-tools` 审批门的回合策略快照）；`PlanModeGate` 在 Plan 模式 + FullAccess 下放行任意 bash（write/edit 仍受 `.zhuye/plan` 白名单约束）；`dispatch_plan_request(_blocking)` 在会话已处于 Plan 模式时跳过 `PlanRequest`（桌面选计划后模型不再弹确认框）。②新增 `builtins::ask_mode`（`classify_ask_mode_tool`：只读工具与 Safe bash → Allow，写类工具与 Risky/Dangerous bash → Deny，其余 FallThrough；复用 PlanModeGate 只读白名单与 bash 分级），`zhuye-tools` 审批门 Prompt 臂据此放行/拒绝/落 modal —— **Prompt 档从逐工具弹窗升级为只读探索 + 危险拦截**；`pre_loop` 的 write/edit 工具裁剪同步扩展到 Prompt 模式。③`Op::Compact` 增加可选 `instructions`（serde default，wire 兼容），经 `AgentConfig::compact_focus` 槽在手动压缩轮注入摘要 prompt（`Summarizer::summarize_*_with_focus`，默认实现回落旧方法，旧 summarizer 实现零适配）。桌面配套见 changelog；上游 `docs/tools-and-hooks.md` 与 zhuye-hooks AGENTS 同步。后续追加（`ff32c15`）：**计划/询问档 ask 工具可见性修复**——`ask_user_question` / `ask_user` / `request_human_input` 纳入 zhuye-skills `ALWAYS_ON_TOOLS`（修复「工具受限无法弹窗」：三工具被 curated 过滤隐藏，模型在计划/询问档退化纯文本提问，实测 session 7bf1393b）；PlanModeGate 放行只读发现面 `tool_search`；询问档新增 `runtime.active-mode-ask` 模式告知段；ask_mode 拒绝文案收窄边界（提示提问不受影响）。—— **压缩水位按同一次模型上报校准**：本地估算偏低时 microcompact 会在真实上下文仍超阈时提前返回，rapid-refill 守卫把这次弱压缩登记成成功，后续更强阶段被熔断拦住。现用「本次上报值 / 本地估算」计算 1–3 倍缩放（无上报 / 上报为 0 / 手动压缩哨兵时比例为 1），microcompact 与 smart_prune 都按缩放水位决定是否继续升级；`CompactionOutcome` 新增 `below_trigger`，只有校准后低于触发阈值才登记快速回填锚点，仍超阈的有效裁剪照常回写、发事件、记快照，但不挡下一次更强压缩。压缩决策日志提升到 info（阶段 / 本地值 / 缩放值 / 上报值 / 阈值 / 停止原因，不记消息正文）。**Op / EventMsg / 命令面零变化**，桌面零代码适配。
>
> 上一轮审计：submodule `edd749c`（上一审计 `407c6fb`）：范围 407c6fbb..edd749c5（2 提交，`calibrated-compact` 分支合入）：范围 df99688f..407c6fbb（9 提交）—— **CLI 端到端场景套件**：仅上游 `tests/live/` 变更（单流程脚本扩成 31 场景的套件：共享库 + 单场景执行器 + 场景模块 + 套件入口 + 配置模板补全；真模型不配合时判跳过而非失败，转向/续作断言改用 rollout 观测口，并新增 guard 组：沙箱越界拦截 / read_before_edit hook / 回合级审批策略），引擎 crate / 协议 / 命令面 / 事件面零变化，桌面零代码适配。
>
> 上一轮审计：submodule `98072c5`（上一审计 `d5e2912`）：范围 d5e29122..98072c5e（3 提交）—— ①**沙箱顶层 `.git` 归属改会话快照 + 空仓库归 agent**（16ccf1f5 + a6bd50c1，后者取代前者）：两轮真实模型演练（桌面 sess_99d9bf0a）实证的保护口径缺陷。第一轮：`DEFAULT_PROTECTED_ENTRIES` 对每个可写根无条件 deny 顶层 `.git` 写入，非仓库 workspace 的 `git init` 直接 EPERM（mkdir/touch .git 全拒）。第二轮（「存在才 deny」）：profile 每条命令重建，「存在性」逐命令重判 —— agent 同一条命令里 `git init` + `git add` 成功，下一条命令起整个 `.git` 变只读，commit 永远拿不到 index.lock。定案（a6bd50c1）：`GitProtectionSnapshot`（会话级归属快照）—— 只读保护**会话开始前已有提交历史的用户仓库**（改 hook 即提权面）；agent `git init` 的空仓库（unborn HEAD）归 agent、全程可写；提交历史一经产生，下个会话起恢复保护；判定失败（worktree 指针 / 读不到 HEAD）fail-closed 视为用户资产；`.agents` / `.aws` / `.zhuye` 恒保护。机制：`AgentConfig::new` 创建 → `tool_context()` 透传 `ToolContext.git_protection` → 前台 BashTool 与后台 bash（`BackgroundBashSandbox` 同源）应用，子代理工厂显式继承父判定；无快照的直连调用方保持恒保护历史口径。真机回归 `agent_can_init_add_and_commit_across_commands`（反向验证变异回逐命令语义即红，精确复现 index.lock EPERM）。②**compact 阈值按当前模型重算**（98072c5e）：启动时冻结的阈值在模型热切后失配；「只截断、无移除」的真实压缩被当成空操作。现每次压缩决策按当前模型窗口重算阈值，实际改动写入 `RolloutRecord::Compaction.context_snapshot`（可选字段，serde default 容忍旧记录）供 resume 恢复，上下文超限且无法压缩时返回可诊断错误。**Op / EventMsg / 命令面零变化**（RolloutRecord additive 可选字段）；桌面零代码适配。桌面配套：CLI 真模型端到端演练脚本落地上游 `tests/live/cli_e2e.sh`（本地专用，配置模板 `cli_e2e.example.toml` 入库、真实 toml gitignore），桌面仓库不保留副本。
 **沙箱顶层 `.git` 归属改会话快照 + 空仓库归 agent**（16ccf1f5 + a6bd50c1，后者取代前者）：两轮真实模型演练（桌面 sess_99d9bf0a）实证的保护口径缺陷。第一轮：`DEFAULT_PROTECTED_ENTRIES` 对每个可写根无条件 deny 顶层 `.git` 写入，非仓库 workspace 的 `git init` 直接 EPERM（mkdir/touch .git 全拒）。第二轮（「存在才 deny」）：profile 每条命令重建，「存在性」逐命令重判 —— agent 同一条命令里 `git init` + `git add` 成功，下一条命令起整个 `.git` 变只读，commit 永远拿不到 index.lock。定案（a6bd50c1）：`GitProtectionSnapshot`（会话级归属快照）—— 只读保护**会话开始前已有提交历史的用户仓库**（改 hook 即提权面）；agent `git init` 的空仓库（unborn HEAD）归 agent、全程可写；提交历史一经产生，下个会话起恢复保护；判定失败（worktree 指针 / 读不到 HEAD）fail-closed 视为用户资产；`.agents` / `.aws` / `.zhuye` 恒保护。机制：`AgentConfig::new` 创建 → `tool_context()` 透传 `ToolContext.git_protection` → 前台 BashTool 与后台 bash（`BackgroundBashSandbox` 同源）应用，子代理工厂显式继承父判定；无快照的直连调用方保持恒保护历史口径。真机回归 `agent_can_init_add_and_commit_across_commands`（反向验证变异回逐命令语义即红，精确复现 index.lock EPERM）。**协议 / 命令 / 事件面零变化**；桌面接线零代码（`AgentConfig::new` 自动生效）。桌面配套：`tests/live/cli_e2e.sh` + `cli_e2e_driver.py` —— CLI 真模型端到端演练脚本（plan → 确认 → 开发 → git commit 全流程自动化，隔离假 HOME，端点不可达判 SKIP），本批沙箱 / 压缩修复的真实模型回归载体。
> 上一轮审计：submodule `d5e2912`（main tip；上一审计 `e246299`）：范围 e246299e..d5e29122（2 提交）—— ①**幽灵压缩修复**（87f18aeb）：压缩器三级（microcompact 提前退出 / smart_prune 未越阈 / 摘要不可用）全部空转时，消息列表原样却被包装成 `SmartPrune(removed=0)` 返回，pre_loop 只看策略名就给 rapid-refill 守卫登记锚点，上下文没变小 → 后续每步越阈被判 refill、3 连击 Abort 误杀健康 turn（实证：MiniMax-M3.1-Flash（1M 窗口）的 12K token plan-mode 会话被 `compact_rapid_refill` 熔断，本地估算 chars/3.5 对中文偏低是幽灵的主通道）。修复：提前返回与尾部兜底在 removed=0 且 truncated=0 时一律降级 `Noop`（不回写、不广播、不上膛）；pre_loop 上膛与 wire 事件口径收紧为「有效压缩」（removed>0 或有摘要，与落盘空压守卫同齐）。②**触发阈值按模型窗口推导**（d5e29122）：`触发点 = 模型上下文窗口 × [compact].trigger_ratio（默认 0.85）`，窗口解析顺序 显式配置（`[context_windows]` / `[model].context_window`）→ 静态表 → models.dev → 128K 兜底，取代一刀切 10K（1M 窗口模型在 12K token 就触发压缩判定）；配置面新增 `[compact].trigger_ratio`（`Option<f32>`，>1 钳 1、≤0/非有限回落默认）与 CLI `config set compact.trigger_ratio` 键，`trigger_tokens` 保留为显式绝对值逃生舱；exec 与库 facade（`build_default_m4`）两条装配路径统一走 `compactor_config_with_window`（此前 facade 只认 env/TOML 显式值、窗口联动静默失效）。桌面接线：零代码，facade 路径升级即受益；GUI autoCompact 控制器的组级 `auto_compact`（默认 0.85）与引擎新阈值口径天然对齐。Op / EventMsg / 命令面零变化。
> 上一轮审计：submodule `e246299`（main tip；跟踪分支自 develop 切回 main；上一审计 `28c0b9a`）：范围 28c0b9a8..e246299e（5 提交）—— ①**协议面增量**：`Op` 27→28（新增元组形式 `McpElicitationResponse(McpElicitationResponse)`，回执按 request_id 解锁阻塞中的 rmcp 请求）+ `EventMsg` 59→60（`McpElicitation`，MCP server 的人机交互请求：form 收集字段 / link 引导 url）；`McpLifecycleEvent` 宿主互操作通道新增 `Elicitation`（带 oneshot 回执）与 `ToolsChanged`（服务端 `notifications/tools/list_changed` 后的完整工具清单，按注册表现状求差集）两变体。②**执行边界加固**：`tool_exec` 节点承接工具结果预算（原 `AgentThread` 构造期 `with_result_budget` 接线移除，`AgentConfig.result_budget` 字段保留，模型上下文在发送宿主事件后应用）；`background_tasks` 宿主互操作扩容。③**权限求值安全加固**：带 `shell_pattern` 的 Allow 规则命中含未解析 shell 语法（`$` / 反引号 / 重定向 / `{}` / `()` 等）的命令时，glob 命中也降级 `Ask`（glob 不理解 shell 展开，命中 ≠ 已授权）。④**facade 修复**：`build_default_m4` 透传 `[compact].trigger_tokens`（桌面路径阈值配置此前失效）；gated-bundled-plugins 分支合入 main；清除其它产品品牌名 + 下线外部 harness 导入能力。桌面接线：lifecycle 转发器对齐 exec bootstrap 处理两新变体（elicitation 先登记 waiter 再推事件、ToolsChanged 按 `McpTools` 所有权增量同步注册表）、`zhuye_mcp_elicitation_response` 命令 + 前端四层契约（op/event 类型 + ops/events/payloads 样本 + fakeBackend handler）+ IPC 测试（§3.12）；permissions 测试按新契约改写（`escaped_literal_shell_pattern` Allow→Ask + 无特殊字符正向对照）；`op-parity` 门禁变体正则补元组形式。GUI elicitation 弹窗待接（引擎 TTL 以 `cancel` 兜底）。
> 上一轮审计：submodule `28c0b9a`（fix/effort-xhigh-ladder tip；基于 develop `70291c4`；上一审计 `73f61e5`）：模型组新增 `auto_compact` 字段（`ModelGroupSection.auto_compact: Option<f64>`，占上下文窗口比例 0.0-1.0）—— **引擎本体不消费**（Option 容忍、builder 零接线），仅作桌面 GUI 自动压缩阈值的持久化位：runtime 自动压缩只认全局 `[compact].trigger_tokens`（固定 token 数），桌面 autoCompact 控制器按「已上报输入 token ≥ 窗口 × 本字段」触发 `Op::Compact`（缺省 None = GUI 默认 0.85；桌面落盘走 serde 重序列化，GUI 私有键会被静默丢弃，故必须进 schema）。桌面接线：`[[model_group]]` 解析/渲染 `auto_compact`（groups.ts）、GroupDetail 高级配置加「自动压缩阈值」百分比输入（空 = 默认 85%）、autoCompact 控制器读组级阈值（越界钳 5%-95%）、设置页全局自动压缩开关移除。Op / EventMsg 与内置工具集合零变化，无新增命令。（2026-11-24 起：该 fix 分支已经 b31b02a6 合入 main，gitlink 漂移风险解除。）
> 上一轮审计：submodule `73f61e5`（fix/effort-xhigh-ladder tip；基于 develop `70291c4`；上一审计 `637eb52`）：effort 菜单精确化 —— 新增 `effort_menu_for_model`：models.dev 收录该模型时把厂商档位词表逐词映射（去重、阶梯升序、`none`/`minimal` 等非阶梯词丢弃）后**原样作为 UI 菜单**，目录未收录回落 `supported_efforts_for_model` 阶梯合成；钳制语义不变（wire 前仍 `clamp_effort_for_model` 线性 min）—— 菜单忠实于厂商声明（qwen3.8 系 `low/medium/xhigh`，不凭空补厂商没声明的 `high`），钳制保守于线性阶梯，职责分离。桌面接线：`zhuye_effort_capability` 的 `supported` 改用菜单函数。Op / EventMsg 与内置工具集合零变化，无新增命令。⚠️ gitlink 指向未合入 develop 的 fix 分支，合入前 `update --remote` 会重置回 develop。
> 上一轮审计：submodule `637eb52`（同分支上一提交）：思考强度阶梯新增 `XHigh` 档（wire 词 `xhigh`，声明序 High < XHigh < Max）—— ①**zhuye-protocol / zhuye-llm**：`ReasoningEffortMirror` 与 `ReasoningEffort` 各加 `XHigh`（serde 显式 `rename=xhigh` 避开 snake_case 的 `x_high`；`From` 桥接同步）；`EFFORT_CAP_TABLE` 增 `("qwen3.8" → XHigh)` 排在泛 `("qwen" → High)` 之前（starts_with 先命中先用），使 qwen3.8 系上限为 XHigh、选 `max` 降钳到厂商顶档 `xhigh`；`ladder_cap` 补 `xhigh` 词表映射（此前 models.dev 的 `xhigh` 被静默丢弃，目录投票取 max 得 `medium` 的反常修复）。②**zhuye-config / zhuye-cli**：`ComplexityRoutes` 加 `xhigh` 字段 + `route_for` 穷尽分支 + 反查表；`FromStr` / `config set model.reasoning_effort` 校验清单 / `doctor` 路由 JSON 同步。桌面接线：`commands/effort.rs` 三处 match 加 `XHigh` 分支 + `parse_effort` 认 `xhigh`；前端 `ALL_EFFORTS` / `/effort` 校验 / ModelsBinding 档位提示纳入 xhigh；`EffortPicker` 显示值改随 capability 生效档。Op / EventMsg 与内置工具集合零变化，无新增命令。
> 上一轮审计：submodule `70291c4`（develop tip；上一审计 `bfa2869`）：缓存用量口径批次（2 提交 38fd69e5 + 70291c4e）—— ①**zhuye-llm**：Anthropic 适配器发射 `ChatEvent::Usage` 前把 cache_read / cache_creation 两段折入 `input_tokens`（`TokenUsage::fold_cache_segments`），使「缓存分段是 input 子集」的不变式成立 —— Anthropic 线缆的 `input_tokens` 不含这两段，原样透传导致 `cached > input`，连带四个问题：缓存命中率算出 > 100%（真实事故 1052%）、`pricing::price` 的 `non_cached` 饱和到 0（新鲜输入按缓存价计费）、`total_tokens` 漏掉缓存段（上下文占用与配额低报）、压缩触发判据只看 fresh delta 而几乎永不触发。②**zhuye-protocol**：新增 `repair_unfolded_cache_segments`（幂等修复历史 rollout 的旧口径记录，特征 = 缓存分段之和 > input）；`SessionStats::cache_hit_rate()` 钳到 `[0, 1]`；`TokenCountEvent` 新增 `turn_total`（additive，逐次调用的 wire 逐字节不变）标记回合收尾补发的**回合累计**事件 —— 它与逐次调用语义不同，一并累计会让会话总量与费用翻倍；双 SDK 类型同步。③**zhuye-rollout**：聚合与导出时按旧口径特征修复历史记录。④**zhuye-core**：回合收尾那条事件标记 `turn_total = true`，逐次调用显式 `false`。桌面接线：reducer 只累计逐次调用事件 + 新增 `tokens.turn` 回合级累计（回合收尾由引擎的累计事件校准）；工作台与检查器的命中率改「本回合」口径并钳制；检查器 Token 构成条四段改互斥（未缓存提示词 = input − 缓存命中 − 缓存写入）；用量面板的会话级命中率同步钳制。详见 §3.6。
> 上一轮审计：submodule `6d238c6`（develop tip；上一审计 `467607c`）：v1.x 可靠性与治理能力批次（feat/zcode-gap-v1x 合入 develop，9 提交，含 main 线的 v0.1.16 发布 bump）—— ①**协议面增量**：`EventMsg` 54→59 变体（`cache_warming` + `stream_recovery_started/anchor_selected/tail_discarded/retry_started`，均为引擎主动推的诊断事件，无对应 Op）+ 协议常量 `MAX_STEER_INPUT_BYTES = 200_000`（`Op::Steer` 输入 wire 字节上限，超限引擎侧拒绝入队）；`RolloutRecord` 新增 `StreamRecoveryDiscarded` / `PromptSnapshot` / `InputDisposition` 三变体（桌面 export 不 exhaustive match，零适配）；Op 27 变体零变化。②**可靠性**：流锚点恢复（SSE 中断从安全锚点重开流、丢弃尾部留痕 rollout 不回放）+ Prompt Snapshot（跨重启保已发送前缀字节，prompt cache 不因重渲染全量失效）+ 输入守恒 ledger（turn 终态显式落盘，崩溃窗口永不静默重放）+ rapid-refill 熔断器 + 空结果防护。③**治理/经济性**：prompt cache 保温（`[cache_warming]` 默认关闭）、工具结果预算（`[tool_results]`，超限落盘 artifacts + 信封替换）、tool-defer 按需加载、stop_turn 级联、strict schema 折叠、cache TTL 端到端透传。桌面接线：TS 协议镜像 +5 事件（payload 对齐 wire）+ 契约样本 +5（三方奇偶门禁 59=59=59 过）；reducer 对 `stream_recovery_started` 发「正在自动恢复」toast（半成品输出被 reset 清空后的显性反馈），其余四事件 no-op 保穷尽；config/Builder 变更全部 `serde(default)` 增量，零适配。
> 上一轮审计：submodule `467607c`（上一审计 `c34c5a1`）：CI 门禁修复批次 —— ①子代理父上下文交接回归修复：v1.12 子线程落独立 rollout 后 submission_loop 历史装配走 replay 分支，首回合 replay 只有 SessionMeta，`preload_messages`（`context_tail` / pass_context_messages 父上下文交接）被整体丢弃 —— 修复为 rollout 无对话记录时用 preload 作种子历史，已有记录维持 replay 口径不叠加；②测试适配：子/孙会话落独立 JSONL 后 sessions 多文件，parallel / subagent_failure / nested 三文件按场景标记与 Fork 血缘定位父会话文件（`[-1]` 字典序口径失效）、resume 目标同步修正；③rust stable 1.100 起 `map_unwrap_or` 进默认告警组，四处机械改写（zhuye-tools approval/gate + plan_approval 的 now_ms / created_at_ms、zhuye-core model_call 上下文组成计量）+ 清理 12 个零引用 workspace 依赖声明（pollster / sled / walkdir / zhuye-audit / browser / cli / eval / git-tools / import / kms / py / shell）；④plan 草稿测试夹具写前兜底重建目录（macOS runner 实测 create_dir_all 成功后数微秒内 fs::write ENOENT，疑与并行 Drop 的 remove_dir_all 竞态相关）。桌面配套：compact 确认 e2e 改逐条扫描全部 info toast（提示词预设入口的相邻 toast 堆叠）。Op/EventMsg 与内置工具集合零变化，无新增命令。

> 上一轮审计：submodule `c34c5a1`（v1.12 三支柱：§3.40；子代理会话落盘+血缘+workspace 继承 c0c41d94/c34c5a1f —— SessionMeta.parent_session_id / Fork.child_session_id / 子线程 JSONL 持久化到 sessions 树，桌面侧栏父下缩进树消费）（上一审计 `86d1dd7`）：上游四修复批次 —— ①配置模型 v2 落地后功能测试断言对齐（dump_config / login / doctor 文案 / 免 key 组判定 / 一键导入读 `[[model_group]]` / cli_modules 报错文案，纯测试层）；②plan 审批回执改可靠广播：`apply_plan_approval_choice` 的 PermissionModeChanged / PlanApproved / PlanRejected 经新增 `fan_out_session_reliable`（订阅者通道满等待容量、单订阅者 5s 上限，而非 `try_send` 静默丢）投递，修 CI 慢管道下 test_A8b 断言落空（行为修复，Op/EventMsg 零变化）；③`zhuye-skills` tar 条目路径统一 `/` 分隔（Windows 上 PathBuf 反斜杠形态令布局探测整链失配，修下游 `cargo test (windows)` 的 marketplace 五连败）；④wasmtime 36.0.20→36.0.22（RUSTSEC-2026-0569/0566/0571/0587）+ xcb 1.7.0→1.7.1（连带 quick-xml 0.30 消失，RUSTSEC-2026-0194/0195）。桌面配套：本仓 wasmtime pin 同步 36.0.22，视觉 surfaces 用例超时 30s→90s（Windows runner 冷启动挂载 settings v3 十四分区超 30s，ubuntu/macOS 无此压力）。Op/EventMsg 与内置工具集合零变化，无新增命令。

> 更早轮次：submodule `8da90e5`（上一审计 `0d51379`）：上游 0.1.16 门控型 bundled 插件基建 —— `zhuye-plugin::bundled`（`BUNDLED_PLUGIN_DEFAULTS` 表 + `bundled_plugin_enabled` / `bundled_tool_gates` 判定）+ `[plugins].disabled_plugins` 配置键（显式禁用 > 显式启用 > 默认开关；默认开 web-search / notebook，默认关 verify-hooks / lsp / goal-queue）+ 新增 `plugins/{lsp,notebook,verify-hooks,web-search}` 插件定义；另 `zhuye-kms` 从 abilities 归位 integrations（纯移动，桌面 Cargo.toml path 已随之改）。桌面配套接线：启动装配走 `register_builtin_tools_with_gates`、设置保存后 `apply_bundled_tool_gates` 差量同步共享工具表（web_search / notebook_edit register/unregister）、verify-hooks 门随线程构造注入 hook engine、lsp 手动开启在命令边界对禁用态显性报错、`zhuye_toggle_plugin` 语义对齐 CLI（bundled 停用写禁用表 / 启用清禁用表）；设置页 PluginsEditor 补 `disabled_plugins` 按行编辑。Op/EventMsg 零变化，无新增命令。

> 最早轮次：submodule `0d51379`（完整 SHA `0d513790`；上一审计 `9cab0469`： `f5edab5` ∪ `feat/browser-plugin` 变基 tip）：模型组 `[[provider_group]]` schema/builder 装配 + `active_provider` String 化（env / `[active]` 均可点名组 id）+ anthropic `list_models`（`GET {base}/v1/models`，`model = "free"` 与 `zhuye models list` 对 anthropic 格式端点自此可用），桌面配套「模型组」统一设置页与 Composer 组切换，详见 §3.37。其上：上游 `34e19acf` 引入 `zhuye_llm::models_dev` models.dev 社区目录 —— 窗口 / 输出上限 / 视觉 / 思考档位四维能力，跨厂商投票 + 兜底链 + 内嵌快照 + 24h 磁盘缓存，级联进 `context_window_for` / `output_budget` / `reasoning_effort`，策展静态表优先、目录只填空缺；桌面配套 `zhuye_lookup_model_abilities` 命令 + 模型列表四维标签 + 一键填充最大上下文 + 视觉降级警示/确认弹窗 + provider `max_tokens` 表单，详见 §3.36。更早 `29aa9ad`：`ce57058` 回归测试之上上游 CI functional 套件（test_A8b_plan审批_工具路径全链路）证伪「非 Plan 模式调 ExitPlanMode」守卫 —— 该路径是被测试钉住的合法工作流，且 plan 审批走独立 PlanApprovalGate 永远人工弹窗、不经 approval policy 自动批准，守卫回退（历史保留注释）；另修 main 上预存 CI 红项：single_turn.rs 的 redundant clone 与 COVERAGE.md 计数过期。桌面配套：workspaces/tests.rs fmt、视觉基线重生成（WorkspacesView 新增移除按钮/已移除分区）。更早 `ce57058` 补齐组合穷举回归测试，见 §3.32。其上 `feat/browser-plugin`（f064c1cd 变基为 306dbc1d）新增 `zhuye-browser` crate + `plugins/browser`（F39 受控浏览器）—— 非 Op/EventMsg 变更，能力面为独立 MCP server 二进制 + 桌面显示通道（`zhuye_browser_*` 命令 + `zhuye_browser_frame` 事件），矩阵已补行（§3.38）。Op/EventMsg 与内置工具集合比对仍零变化。）


## 阅读约定

| 记号 | 含义 |
|---|---|
| ✅ | 已接线：命令存在 + 前端有消费面 |
| 🟡 | 部分接线：能看到一部分，缺细节或缺配置面 |
| ❌ | 未接线：基座有能力，GUI 用不到 / 看不到 |
| ⛔ | 有意不接：本质是 CLI / SDK / 服务端专用，无 GUI 类比 |

---

## 1. 能力总览

| 能力族 | 核心 crate | 关键 API | GUI 状态 |
|---|---|---|---|
| 协议 Op / EventMsg | `zhuye-protocol` | `Op`（28 变体）/ `EventMsg`（60 变体） | 🟡 25 个 Op 有桌面命令，另 2 个是远程工具协议专用；事件均有 TS 类型和契约样本，部分显式 no-op 或由视图直接订阅。接线不等于运行态已验证。**v1.12 三支柱**：`Event.seq` 缺口检测 + `interaction_resolved` 了结广播 + `context_composition` 六类分解已接线（§3.34）。**v1.x 可靠性批次**：`stream_recovery_started` toast + 保温/恢复审计事件类型层接线（§3.41）。**v1.x MCP 互操作**：`mcp_elicitation` 事件 + `Op::McpElicitationResponse` 回执通道已接线（§3.12） |
| 线程运行时 | `zhuye-core` | `AgentThread` / `AgentConfig` / `TurnHandle` | 🟡 权限解析器已接线（§3.1）；运行态覆盖缺口见 `tests/RUNTIME_COVERAGE.md` |
| LLM / Provider | `zhuye-llm` | `ModelRegistry` / `CredentialPool` / `RoutingPolicy` / `output_budget` / `reasoning_effort` / `models_dev` | 🟡 plans / quota、凭证池健康度、自适应输出预算、`max` / `ultra` 档位与按模型钳制已接线；**models.dev 四维能力（窗口/输出/视觉/思考）经目录补齐并展示**（§3.33）；冷却原因在核心内不公开 |
| 计价 | `zhuye-llm::providers` | `pricing_table` / `pricing_for` / `RateCard` | ✅ 费率卡直接读核心公开费率表（develop 收编;桌面反解 shim 已删） |
| 可靠性与治理（v1.x） | `zhuye-core` / `zhuye-llm` / `zhuye-tools` | 流锚点恢复 / Prompt Snapshot / 输入守恒 ledger / cache warming 调度器 / 结果预算 / tool-defer / rapid-refill 熔断 | 🟡 恢复启动 toast 已接线，保温 / 恢复审计事件类型层已接、无独立消费面（§3.41）；功能面默认关闭或引擎内部自愈，无配置 UI |
| Autopilot | `zhuye-stream::autopilot` | 配置/历史持久化 + 到期判定 + `fire_if_due` 闭环 | 🟡 桌面后台驱动已接线，指定 agent 经 side-channel 执行；历史终态关联存在并发错配风险，见 `tests/RUNTIME_COVERAGE.md` |
| 侧通道 | `zhuye-core::side_channel` | `SideChannelDriver` / `SideChannelRegistry` / `Op::Start\|Cancel\|QuerySideChannels` | ✅ **引擎原生执行**(develop WP9 收编):driver 经线程工厂注入,命令走协议三 Op,事件三变体全接线(reducer + 视图订阅);registry 进程级共享,跨会话 rebind 存活 |
| 权限 | `zhuye-permissions` | `FilePermissionStore` / `StorePermissionResolver` / 回合审批策略 | ✅ 三层 store 已挂载；Settings 可见规则，会话可独立选择审批策略及 Plan 工作模式 |
| 配置 | `zhuye-config` | `ZhuyeConfig`(~30 段) / `ConfigWatcher` / `[context_windows]` / `[prompt_guard]` | 🟡 结构化表单覆盖大部分 + **配置位置 / 分析健康度**（§3.15）；上下文窗口、思考强度和 prompt guard 随配置生效；**provider 段 `max_tokens` 表单已补**（§3.33），但 guard / 窗口明细仍没有专属配置面 |
| 思考强度 | `zhuye-llm::reasoning_effort` | 按模型族与端点描述支持档位 / 拒绝后逐级降档 / **models.dev 目录档位映射** | ✅ Composer 与 Models 页共用 `zhuye_effort_capability`，只提供可用档位并显示实际生效值；静态表未收录的新模型由目录档位投票补档（§3.33） |
| 模型清单发现 | `zhuye-config::discovery` / `zhuye-llm::model_catalog` / `zhuye-llm::models_dev` | `resolve_model_spec` / `fetch_catalog` / `pick_free_model` / `FreeModelRules` / `abilities_for` | ✅ `model = "free"` 解析成真实 id + **`[model_discovery]` 可配** + 模型列表标注免费（§3.24）+ **models.dev 目录补四维能力**（§3.33） |
| MCP | `zhuye-mcp` | `McpConnectionManager` / registry | ✅ 观测 + **增删 + 精选 catalog + 资源/prompt 浏览**（§3.12 / §3.16）；**elicitation / ToolsChanged 宿主互操作已接**（§3.12，GUI 弹窗待接） |
| LSP | `zhuye-lsp` | `LspConnectionManager` / `DiagnosticRegistry` | ✅ 启停 + 预热 + **诊断可见**（§3.10） |
| 工具注册表 | `zhuye-tools` | `register_builtin_tools` / `ToolRegistry` / `Sanitizer` / `WorktreeCoordinator` / `LoopGuard` / `checkpoint_tool` | ✅ 与上游共用 27 个内置工具清单，桌面注入 AST；工具列表、worktree 状态、checkpoint 与循环失控守卫随运行时生效（§3.16） |
| 注入防护（F01） | `zhuye-sanitize` | `PromptGuard` / `GuardStats` / `Op::QueryGuardStats` / `EventMsg::GuardStats` | ✅ 默认开启（设置「提示注入防护」开关）；工具输出 Block/Review 在消息流渲染 🛡 注入徽标；外部工具定义注册期扫描由引擎侧 fail-closed 执行 |
| Hooks | `zhuye-hooks` | `HookEngine` / `HookEventKind`(12) | ✅ 当前引擎注册表与启停 + **事件类型与可用决策**（§3.16）；未注册的内置项需先在配置中启用 |
| Skills | `zhuye-skills` | `SkillsCatalog` / `scan_skills_dirs` / `merge_bundled` | ✅ 已改为与运行时同源（消除列表分叉，见 §3.2） |
| 记忆 | `zhuye-memory` | `MemoryStore` / `retrieve_relevant` | 🟡 CRUD + 路径对齐（§3.9）+ **分段视图 + 注入预算**（§3.15）；相关性排序仍不可见 |
| 会话笔记 | `zhuye-notes` | `NoteStore` / `FileBackedNoteStore` | ✅ 只读面已补（Memory 视图 §3.3） |
| 恢复 | `zhuye-recovery` | `SubagentRegistry` / `ActiveFileRecovery` | ✅ **已完成的子代理调用**可查（§3.15）；活跃文件恢复仍需消息历史 |
| 提示词 | `zhuye-prompt` | `PromptLibrary` / `PromptSet` / `split_spec` / `catalog`（v1.7：工具×模型两级目录 + auto 匹配） | ✅ 层列表 + 重扫 + **生效正文**（§3.8）+ **两级菜单（工具 → 模型变体）**（§3.8） |
| 压缩 | `zhuye-compact` | `Compactor` / `CompactReport` | ✅ 次数 / 节省 token + **逐次明细**（§3.7） |
| Rollout / 会话 | `zhuye-rollout` | `replay` / `to_markdown` / `session_stats` / `all_model_usage` | ✅ |
| Telemetry | `zhuye-telemetry` | model-io + **span 日志** | ✅ 两面都已接线（§3.4） |
| 子代理 | `zhuye-subagent` | `SubAgentSpec` / `SubAgentFactory` / `Op::Interrupt.child_id` | ✅ 运行态可见与取消、**agent 侧 `call_*` 已注册**（§3.14）+ **spec 可编辑**（§3.16）；`mode=async` 异步派发引擎侧自动生效（占位回执进消息流、进度照常入 feed，打断级联取消），GUI「后台运行中」标注待接（最近审计） |
| Agent 定义 | `zhuye-agent-def` | `AgentDefinition` / `source` | ✅ 含 v1.6 `source` 字段语义 + **活跃 agent 可切换**（§3.9） |
| 目标模式 | `zhuye-goal` | `GoalController` / `GoalState` | ✅ enter/exit + **状态快照读口**（v1.7 上游 `GoalController::snapshot()`，`zhuye_goal_snapshot` 命令 + 徽标 tooltip + 投影校准，§4.1） |
| 任务 / 团队 | `zhuye-task` | `TaskManager` / `TodoWriteTool` | ✅ CRUD + claim + **产出 / 停止 / 释放**（§3.11）+ **agent 侧任务工具**（§3.14）；**todo 清单已展示**（§3.18），清单回灌已由上游闭合（§3.18） |
| 讨论 | `zhuye-discussion` | `DiscussionOrchestrator` | ✅ 顺序和并发讨论可运行，实时事件、失败与取消终态、历史筛选、取消入口和 transcript 持久化已接线 |
| 流水线 | `zhuye-pipeline` | `Pipeline::from_toml` / `PipelineReport` | ✅ shell 节点可执行；桌面适配层透传自定义模板输入并保留失败传播 |
| 插件 | `zhuye-plugin` / `zhuye-wasm` | `PluginManager` / `PluginManifest` / Wasm Hook + Tool / `BUNDLED_PLUGIN_DEFAULTS` 门控 | ✅ 列表 / 启停 / 卸载 / 本地安装 + marketplace；**门控型 bundled 插件已接线**（上游 0.1.16：`[plugins].disabled_plugins` 显式禁用 → `bundled_tool_gates` 判定源三路同源 —— 启动装配 `register_builtin_tools_with_gates`、设置保存后 `apply_bundled_tool_gates` 差量同步共享工具表、verify-hooks 随线程构造注入 hook engine、lsp 手动开启命令边界显性报错；toggle 语义对齐 CLI：bundled 插件停用写禁用表、启用清禁用表）；WASM hook/tool 随插件运行时加载，但详情面仅到文件与启停状态（§3.13） |
| 沙箱 | `zhuye-sandbox` | `OsSandbox` / `detect_backend` | ✅ 有效状态在状态栏可见（§3.5）+ **开关真正生效**（§3.19，每轮协议策略） |
| BM25 | `zhuye-bm25` | `rank_lines` / `tokenize` | ✅ GUI 搜索可选 **BM25 相关性**（§3.16，与 agent 的 grep 同款） |
| 浏览器控制（F39） | `zhuye-browser`（收编上游 `zhuye-browser`） | `BrowserBackend` / `CdpBrowserBackend` / `BrowserSecurity` / `plugins/browser` MCP 工具 | 🟡 agent **控制通道**需安装 browser 插件（CDP 仅 loopback + 单 target + 隔离 profile，Prompt 审批）；桌面**显示通道**已接线 —— `/browser` 面板 + `zhuye_browser_start/stop/status/env` + `zhuye_browser_frame` 帧流；本机无浏览器时双层降级。面板画面为实机验收项 |
| AST | `zhuye-ast` | `LanguageGrid` / `list_languages` | ❌ 语言网格不可见 |
| 配置分析 | `zhuye-config::analytics` | `status_line` / `Health` | 🟡 设置页显示配置路径与分析状态；watcher 健康度不可见 |

---

## 2. 有意不接线（⛔）

| 能力 | 原因 |
|---|---|
| `zhuye-exec::serve` stdin JSONL 循环 | 服务端模式；桌面端是宿主而非客户端 |
| `Op::RegisterTools` / `Op::ToolExecutionResponse` | 远程工具协议要求客户端侧执行器进程 |
| `EventMsg::ToolExecutionRequest` | 同上 —— 桌面端不注册远程工具 |
| `zhuye-py` Python 绑定 / `zhuye-cli` 参数解析 | 无 GUI 类比 |
| `zhuye_stream::postgres_session` / `sse_redis` | 多租户服务端会话存储 |
| `zhuye-core::eval` | 测试/评测 harness，非用户面 |
| `zhuye-ast` `search` / `replace` / `rename_symbol` | 上游 P0 未实现，仅 `list_languages` 可用 |
| `zhuye-integration::WebhookNotifier` | 上游 stub，无 GUI 配置面对应 |
| `zhuye_list_shell_sessions` | 桌面端**本地**诊断命令（列后端 shell 进程注册表的**当前活动**会话 id）。Terminal 视图自己就持有这批会话的状态并渲染成页签，比再查一次后端更准 → 界面用自己的状态即可 |

---

## 3. 缺口闭合台账

各条目的完整「问题 / 修复 / 取舍」论证见 git 历史与对应轮次的变更日志条目；此处保留台账与关键落点。

### 3.1 权限层接线（安全行为分叉修复）

CLI 三层权限 store 桌面端此前未挂载（deny 规则被静默忽略）→ `src-tauri/src/state/permissions.rs` 按 CLI 同构装配三层链式 store + `HeuristicYoloClassifier`；`zhuye_list_permission_rules` + Settings → Permissions「生效的权限规则」只读列表。

### 3.2 Skills 列表与运行时对齐 / skills.sh 市场

桌面手写扫描与运行时两处分叉（目录不同 + 漏内置技能）→ `zhuye_list_skills` 改用核心 `scan_skills_dirs` / `bundled_skills`，DTO 补 `bundled` / `whenPaths` / `version` / `body` / `pluginId`，UI 标注「内置」徽标。

加载链目录收敛到上游唯一出口 `zhuye_config::default_skill_dirs`：`<ws>/.zhuye/skills` → `<ws>/.agents/skills` → `~/.zhuye/skills` → `~/.agents/skills`（顺序即同名优先级）。两个 bootstrap（zhuye-exec / zhuye m4）与 GUI 列表、运行时 `Op::RescanExtensions` 全部消费同一份清单，不重启即生效；`.agents/skills` 是业界通用 agent 目录约定（业界通用约定），属「路径只经 paths 取」红线的说明性例外（非烛夜私有目录，不走 `ZHUYE_HOME` 重定向）。GUI 已装列表按 path 给 `.agents` 来源打徽标。

skills.sh 市场（搜索 + 安装）GUI 全接通：搜索 API 需 Vercel OIDC 认证故不可直调，改用其**公开 sitemap** 建全量本地索引（`~/.zhuye/cache/skills-market.json`，24h TTL，失败降级旧缓存）；安装走 GitHub codeload tarball 整目录提取（skills.sh 生态的技能在 `skills/<name>/` 子目录且带 scripts/references 附属文件，此前只拉仓库根单 SKILL.md 的 `zhuye_install_skill` 对该生态失效）。三条命令 `zhuye_search_skill_market` / `zhuye_install_skill_from_market` / `zhuye_refresh_skill_market_index` 由上游 `zhuye_skills::{directory, marketplace}` 承载，装到用户级 `~/.zhuye/skills/`；搜索结果带 `source`（owner/repo）与 `official`（第一方厂商）来源标签；安装含 zip-slip 防护 / 跳符号链接 / 装前 supply_chain 扫描 / staging 原子替换。原 `zhuye_install_skill`（单仓直装）保留为 UI 高级入口。

### 3.3 会话笔记只读面

笔记链路只有写没有读 → `zhuye_list_session_notes` / `zhuye_list_note_sessions` + Memory 视图「会话笔记」面板。

### 3.4 Span 日志（trace 树）

Traces 只读 model-io，turn → model → tool 父子链不可见 → `app-core/src/traces.rs` 新增 `list_span_log` / `read_span_log`（树深度推导，父链缺失与成环防护）+ Traces 视图「Span 树」标签页。

### 3.5 OS 沙箱有效状态

设置开关看不到实际是否生效 → `zhuye_sandbox_status` + 状态栏徽标（口径在 §3.19 重做为每轮协议策略）。

### 3.6 Token 计算做深（模型级用量 + 计价可解释）

只有「最后一次调用」快照 → `TokenSnapshot` 增 `byModel` / `sessionTotal`；Inspector / `/usage` 视图扩展；费率卡经 `app-core/src/pricing.rs` 反解核心静态费率表（该 shim 已在 §3.25 退役，直接读核心公开费率表）。

**缓存命中率口径（v1.x 修正）**：工作台与 Inspector 的「**本回合**缓存命中率」是回合级口径（`tokens.turn` = 本回合逐次调用的累计 `Σcached / Σinput`），右侧用量面板的「缓存命中率」是会话级口径（后端 `zhuye_session_stats` 的 token 加权累计）—— 两个口径各标各的，不用「平均」这种跨口径词；一律钳到 `[0, 100%]`。上游配套修正（zhuye-agent `develop`）：Anthropic 线缆的 `usage.input_tokens` 不含 cache_read / cache_creation 两段，适配层上报前折入，使「缓存分段是 input 子集」的不变式成立；引擎回合收尾补发的**回合累计** `token_count` 由 `turn_total` 标记，消费方只累计逐次调用的事件 —— 否则会话总量与费用翻倍。

### 3.7 逐次压缩明细

Inspector 只有一行 hover 摘要 → `CompactionStats.records` 逐次明细（封顶 50 条）+ 可展开列表（策略 / 前 → 后 token / 节省量）。

### 3.8 提示词选择与预览

`/prompt` 与设置页选择器（ZhuYe 默认 / 智能选择 / 手动方案 + 共享默认 + 恢复跟随）；面板展示生效方案、回落原因、系统文案与工具描述；会话覆盖随 rollout 恢复。**会话创建时选择入口**（v1.12 引入，**v1.7(submodule) 两级化**）：composer 底栏空会话态提供「提示词」pill —— `prompt_list.groups` 驱动的**两级菜单**（一级工具名 Claude Code / Codex / Kimi / Qwen / Gemini CLI / DeepSeek / GLM / Grok / MiniMax，二级模型变体如 `claude-code-opus-4.6`；单变体组为一级叶项，旧引擎无 groups 平铺回退），顶部固定跟随默认 / 智能匹配模型；选择存 per-session localStorage（`'new'` 键随会话 id 转正），bind 时 `syncSessionPromptSelection` 恢复该会话选择 —— 会话内提示词恒定（入口即消失），保证供应商 prompt cache 命中。引擎侧「智能匹配模型」在两级目录（`sources.json` `tools` 段，26 份英文策展变体内嵌 `prompts/tools/`）按模型 spec 匹配：精确型号 > 最长家族前缀，命中按 default → 家族层 → 变体三级叠加。

### 3.9 活跃 agent 接线（Agents 视图死胡同 + 记忆路径对不上）

桌面硬编码 `"desktop"` 导致 `~/.zhuye/agents/*.md` 定义永远找不到、记忆写读路径分裂 → `src-tauri/src/agent_state.rs`：活跃名由 `~/.zhuye/desktop.json` 决定（缺省 `"default"`，与 CLI 共用定义与记忆目录）；记忆路径经核心 `zhuye_memory::resolve_path`；旧目录一次性迁移；`zhuye_get/set_active_agent` 切换后重放重绑。

### 3.10 LSP 诊断（Problems）

诊断只进核心被动缓存 → `zhuye_lsp_diagnostics(path)`（只读，不主动 pull）+ `LspStatus.diagnostics` 聚合 + Files 视图 Problems 面板（随文件打开轮询刷新）。

### 3.11 任务产出 / 停止 / 释放

任务板只读 → `zhuye_get_task_output`（不阻塞）/ `zhuye_stop_task` / `zhuye_release_task`（守卫与动作同核心 `TaskStopTool` / `TaskReleaseTool`）+ 行内按钮与详情抽屉。核心 `TodoWriteTool` 工具本身实装，占位的只是 `manager` 字段。

### 3.12 MCP 服务管理

GUI 只能观测，加 server 要手改 config → `commands/mcp.rs` 四命令：`list_mcp_servers`（含运行状态与失败原因）/ `mcp_catalog`（核心精选 catalog）/ `upsert` / `delete`（经核心 `mcp_server_configs()` 编译校验，非法不落盘，运行时起停复用 `bootstrap_mcp` 同款路径）；Collaboration 视图 McpManager 面板。

**宿主互操作（submodule e246299e 起）**：lifecycle 转发器对齐 exec
bootstrap 参考实现处理两个新宿主变体 —— `Elicitation`（先登记 waiter
进 `AgentInner.mcp_elicitations`（agent 生命周期唯一一张，thread_factory
装进线程 `approval_context`，插件侧同表共享；rebind 清空重建）再推
`mcp_elicitation` 事件，broadcast 无订阅者时立即 cancel 不杀循环）与
`ToolsChanged`（按 `McpTools` 所有权增量同步注册表：消失的反注册、
新增绑活连接重注册；插件挂载级 manager 工具不经注册表，只记日志）。
回执命令 `zhuye_mcp_elicitation_response`（`commands/agent.rs`）+
IPC 包装 + op/event 类型 + 契约样本 + IPC 测试已接线；**GUI elicitation
弹窗待接** —— 未决请求由引擎 TTL 以 `cancel` 了结（fail-closed）。

### 3.13 插件管理

只能看 slash 命令，启停卸载要手改文件 → `commands/plugins.rs`：`list_plugins`（启用状态与运行时同源）/ `list_marketplaces` / `toggle_plugin`（`reload_plugins` diff 同步，不打断会话；上游 0.1.16 起语义对齐 CLI —— bundled 门控插件停用写入 `disabled_plugins`（默认开插件仅移出 enabled 是 no-op），启用同时清禁用表，并即时差量同步工具门）/ `uninstall` / `install`（经核心 `PluginManager`，含 manifest 校验）；PluginsPanel + 设置页 PluginsEditor（`enabled_plugins` / `disabled_plugins` 两个按行编辑的 textarea）。

### 3.14 工具注册表补齐（agent 侧「能不能用」的关键缺口）

桌面此前只有 15 个基础工具，缺任务 / 会话笔记 / 子代理三族 → `state/subagents.rs`：`register_task_tools`（进程级）、`register_note_tool`（每会话）、`bootstrap_subagents`（按 CLI 口径合并 spec + 注册 `call_<role>` + 补进 always-on 可见集）；注册表测试断言在册。

### 3.15 运行时状态可观测（S 级批量）

四项只读面落 `commands/runtime_status.rs`：凭证池健康度（`healthy_clients()` 反推冷却数，原因核心不公开不编造）、已完成子代理调用（`SubagentRegistry::snapshot()`）、记忆分段与注入预算、配置位置与分析健康度。AST 语言网格**有意不接**（桌面未启用任何 grammar，列表恒为空，属独立构建决策）。

### 3.16 worktree / MCP 原语 / 子代理 spec / BM25 搜索 / Hook 事件

| 能力 | 命令 | 落点 |
|---|---|---|
| worktree 状态 | `zhuye_list_worktrees` | Git 视图 Worktrees 面板（`isolated` / `stranded` 标注丢工风险） |
| MCP 资源 / prompt | `zhuye_list_mcp_resources` / `zhuye_list_mcp_prompts` | McpManager 折叠区（直问 rmcp peer，与核心工具同源） |
| 子代理 spec 编辑 | `zhuye_{list,get,save,delete}_subagent_spec` | Agents 视图子代理页签（编辑原始 md，写前核心校验非法不落盘） |
| BM25 搜索 | `zhuye_search_files` 增 `rank` 参数 | Search 视图排序切换（k1/b 与核心 grep 逐字一致） |
| Hook 事件类型 | `zhuye_list_hook_events` | Hooks 视图可挂载事件折叠区 |

### 3.17 Pipeline 配置编辑 + 安全扫描

Pipeline 只能跑不能编 → `zhuye_validate_pipeline`（校验走核心 `Pipeline::from_toml`，与实际运行同一路径）+ `list/save_pipeline_config`（写前校验非法不落盘）+ Collaboration 编辑器（防抖实时校验）。安全扫描：审计初稿误判「上游 stub」，核实为真实实现 → `zhuye_run_security_scan`（`spawn_blocking`，30s 超时）+ Settings 安全扫描卡片。

### 3.18 agent 的 todo 清单（`TodoWrite`）

前端纯消费：`TodoWrite` 工具产出的 `metadata.todos` 经 reducer 采集（仅 `toolName === 'TodoWrite'` 采信，整体覆盖）+ Inspector TodoPanel 渲染；上游回灌已闭合（v1.7 `todos_slot` 共享槽 + `pre_loop` 注入 `## Current Todo List` 段）。

### 3.19 OS 沙箱开关真正生效（此前是死旋钮）

三条来源（配置 `[sandbox].os_level` / 协议每轮覆盖 / env）桌面一条都没接，配置写 false 也没用 → `app-core/src/sandbox.rs` 纯函数唯一事实源（`normalize_os_level`：`None` → 基线开启；env 优先于配置）+ `state/submit.rs::stamp_sandbox_policy` 每轮在 `Op::UserInput.thread_settings.sandbox_policy` 盖章（**无条件覆盖**客户端传值——沙箱是安全设置）+ 配置归一恒写有效值 + 状态口径与工具同构造器（env 覆盖如实标注 tooltip）。上游 schema v1.7 改 `Option<bool>` 后原始 TOML 嗅探 workaround 已移除。

### 3.20 「有命令无界面」的三处漏网（反向审计）

拿「命令存在 + 前端有消费面」双标准反扫全部 182 个后端命令：**零死命令**；12 个前端包装无界面消费，逐个核实后——`set_dock_badge` 假阳性、Markdown 转录导出与更新检查为真缺口并已接线（命令面板「导出当前会话(Markdown)」+ 新建 `UpdatesSection.tsx`）、team 编辑见 §3.22、allowlist 改写见 §3.23、shell 会话列表归入 §2 有意不接。

### 3.21 两条「有类型无渲染」的事件（`plan_step` / `plugin_loaded`）

reducer 有 case 但 `return {}` → `plan_step` 按 `index` 就地更新/追加（Plan 视图「执行进度」清单）+ `plan_ready` 到达清空；`plugin_loaded` 记进程级 `loadedPlugins`（同 id 覆盖）+ Plugins 面板「运行时已挂载」列表。

### 3.22 团队可建可改可删

加团队只能手写 JSON → `TeamEditor.tsx`：团队面板（列表 + 编辑 / 删除 + 表单成员行增删）；口径与核心对齐（`lead_agent_id` 前端推导 `team-lead@<name>`、名字规则同 `validate_team_name`、`SystemTime` JSON 形态订正 TS 类型错误）。

### 3.23 「始终允许」写进核心权限层（消灭桌面端私有第二套真值）

桌面端私有 `approval_allowlist.json` 与核心权限层功能重复且不可见 → **不接旧机制，改写它**：`zhuye_add_permission_rule` 追加到 `~/.zhuye/permissions.toml`（CLI/GUI 共用，resolver 每次评估重读即生效）；审批弹窗第四动作「始终允许…」；授权范围刻意保守——Bash 整条命令精确匹配（不用首词通配）、只读工具整体放行、写类工具不给按钮（规则模型无路径维度）。

### 3.24 模型清单发现（`model = "free"` 跨模型降级链接线）

上游 v1.7 R3 动态模型 id 桌面三处断点（同步解析拿占位串 / app-core 镜像函数脱节 / 协议缺 `spec_fallback`）→ `state/agent.rs::resolve_model_spec_with_discovery` 统一入口（静态同步、动态走清单发现、失败如实上报）；`install_agent_thread` 改 async，registry 延迟到解析完成才发布；热重载失败保留旧 model 进 `degraded_reason`；前端 `spec_fallback` 变体 + `[model_discovery]` 配置面 + 模型列表免费标记 + 数组字段直接写字面量修复二次编码。

### 3.25 submodule develop 重叠收敛（app-core 九模块切换上游单一事实源）

| app-core 模块 | 处置 |
|---|---|
| `paths` | 删除 → `zhuye_config::paths`（同名 1:1，上游多 getpwuid 兜底） |
| `actor` | 删除 → `zhuye_task::Actor` |
| `squad` | 删除 → `zhuye_task::squad`（上游修 created_at 丢失 / NotFound 映射） |
| `autopilot` | 删除 → `zhuye_stream::autopilot`（真实 cron 到期 + `fire_if_due`） |
| `pricing` | 删除 → `zhuye_llm::providers` 公开费率表（反解 hack 退役） |
| `kms` | 删除 → `zhuye_kms`（API 逐字一致） |
| `activity` | 收缩为再导出垫片 → `zhuye_telemetry::activity`；桌面留 `ActivityLog` 句柄支撑 Inbox 清空 |
| `sandbox` | 收缩为两小助手 → 解析/优先级走 `zhuye_sandbox::os_sandbox` |
| `side_channel` | 删除 → `zhuye_core::side_channel` 引擎原生（§3.26） |

保留（无重叠的桌面装配）：`media` / `stats` / `tailscale` / `traces` / `discussion` / `pipeline`。

### 3.26 Side-channel 引擎原生执行（driver 接线 + 事件面全通）

develop WP9「桌面缺失的那一半」→ `thread_factory.rs` 构造 `SideChannelDriver` 注入 `AgentConfig`；`SideChannelRegistry` Arc 共享（跨会话 rebind 存活）；四命令保持 wire 形状、内部改提交协议三 Op 等配对应答；三事件变体进类型联合 + reducer + 视图订阅；终态经 `side_channel_forwarder` 以 `EVENT_ID_NONE` 信封补发。

### 3.27 submodule 接线 main（`0220677` → `321cb825`，v0.1.10 + 5）

| 上游能力 | 桌面接线 | 状态 |
|---|---|---|
| `Op::RescanExtensions` + 事件 | 命令四方接线 + reducer toast；GUI 触发按钮待接 | 🟡 |
| 思考档位 `max` / `ultra` | Composer 控件 + `/effort` + Models 视图 | ✅ |
| `ThinkingDelta.kind` | payload 类型登记；渲染暂不区分 | 🟡 |
| `PermissionRule.resource_glob` | 命令输入支持（serde default）；规则 UI 未暴露 | 🟡 |
| WASM 插件宿主 / 配置导入 / 会话队列调度 / secrets / audit | 随引擎自动生效，无专属消费面 | 🟡 |
| `RolloutError` / `build_default_m4` 不可失败化 | `recorder_guard` / `thread_factory` 跟随适配 | ✅ |

主仓 workspace 镜像 8 个新继承键（wasmtime 锁 `=30.0.1` 与上游同代）。

### 3.28 submodule 跟随 main（`321cb825` → `54c8a001`，v0.1.11）

版本 bump 四处同步；协议/运行时 API 零变化，桌面无适配；全量门禁复跑通过。

### 3.29 submodule 跟随 main（`54c8a001` → `5f45f0ac`，v0.1.12）

SDK 文档门禁进 CI、协议全集补齐；运行时新增 `[prompt_guard]`（opt-in）。桌面适配一处：zhuye-llm `ChatEvent::AgentMessage` 变体补穷举 match；前端协议面零变更。

### 3.30 完整复审 `d063a5f → 5f45f0ac`（v0.1.12）

审计 538 个文件。协议面：`Op` 26 变体（24 有桌面命令，2 个远程工具协议专用）；`EventMsg` 50 变体三方奇偶覆盖。能力族结论：

| 能力族 | 桌面状态 |
|---|---|
| 运行时安全（PromptGuard / 审批 TTL / 循环守卫 / 中毒判定） | 🟡 自动生效；guard 与中毒退役无专属 UI |
| Provider / 配置（输出预算 / 档位钳制 / 上下文窗口 / 免 Key） | ✅ Composer / Models / plans 消费 |
| 工具（单一事实源 / checkpoint / 循环守卫 / Bash 参数面） | ✅ 共享清单，语义纳入 IPC 回归 |
| 编排（side-channel / steering / queue scheduler / cron / autopilot） | ✅ 已接线（queue scheduler 不接，桌面有自己的会话队列） |
| 导入 / 插件（zhuye-import / WASM / 用户级 slash） | 🟡 插件与用户级 slash 可用；外部会话导入无桌面入口 |
| Rollout / KMS / 费率 / 编排 / CLI SDK | ✅ 已接线；⛔ CLI/SDK 形态不强制映射 GUI |

复审证据：静态门禁、真后端 L3 全量 3,407 条、前端全量 1,529 条测试通过；运行态证据见 `tests/RUNTIME_COVERAGE.md`。

### 3.31 增量复审 `5f45f0ac → f4bb7057`（v0.1.12）

上游 5 个提交集中在测试与 lint 收口；协议、命令面、事件面、工具接口与配置 schema 零变更，桌面无适配。桌面静态门禁 26/26、真后端 3,443 条、前端 1,536 条测试通过。

### 3.32 submodule 跟随 develop（`893faa95` → `199a3d3b`，v1.x）

上游修复「首条消息前切权限模式的会话被索引丢弃」（写路径 SessionMeta 守卫 + 读路径前 8 条扫描恢复存量坏文件）。桌面消费面：

| 能力 | 现在 |
|---|---|
| 会话列表完整性 | 存量坏文件免迁移恢复，workspace 归属找回（L3 回归在案） |
| `plan_draft_updated` | reducer 存 `planDraft`；Inspector「计划」tab 实时渲染；`plan_ready` 终稿优先展示；重放经最后一条 `plan_ready` 恢复 |
| Inspector 计划/Git tab | 补齐缺失的 `onClick` |
| 工作区移除语义 | `zhuye_set_workspace` 可选 `unhide`；remove 按规范化路径匹配所有变体 |

同批上游 `893faa95`（折叠内联 System 消息）修复严格 provider 对压缩摘要中置 System 的 400 拒绝。

### 3.33 附件管线 / 消息渲染 / 消息操作对齐 chat demo（v1.x，桌面侧）

对照 DeepSeek chat demo 的差距审计后接线，引擎协议面零变更（`UserInputItem::File/Image` 本就支持）：

| 能力 | 现在 |
|---|---|
| 通用文件真实进上下文 | `zhuye_pick_files`（原生多选拿真实路径）+ `zhuye_ingest_upload`（webview 字节流落盘 `<workspace>/.zhuye/uploads/` 转路径）；文件按钮 / 粘贴 / DOM drop 三入口不再产生 `(file) 名字` 假占位 |
| 历史消息附件渲染 | `user_attachments` TurnItem：live 提交与回放（image 字节数组 → data-URL；`@path(:Ls-Le)` 标注块 → 文件 chip）两条数据路径同型；`(N attachments)` 占位文本删除 |
| 附件状态机 | pending / ready / error + 失败重试；任一非 ready 禁发 |
| 消息渲染 | LaTeX（KaTeX 行内 + 块级）、Mermaid 按需渲染（strict 安全 + 图表/代码切换）、Prism +18 语言与别名归一、图片 Lightbox |
| 消息操作 | 气泡级整条复制（助手侧剥离思考链）；一键重生成（Rewind 到目标轮含 + `userItemsFromTurn` 原样重发，纯附件轮亦可）；末轮「继续生成」（引擎无 Continue Op，以续写指令 UserInput 近似） |
| 回退语义修正 | `turn_rewound` reducer 此前保留目标轮（与引擎 `truncate_after` 「丢弃该轮含之后」相悖）；`editRewindTargetFor` index>0 时误传前一轮 id 会连带删掉前一轮 —— 两处已与引擎对齐 |

### 3.34 会话后台持续运行（v1.x，桌面侧）

此前换绑会话会取消旧线程的会话级 cancel token（= `Op::Shutdown`），运行中的 turn 被真正中断 ——「切走即停」。引擎本就支持多 `AgentThread` 实例并存，是桌面编排层的单槽设计把它限制成了单活动会话。现在：

| 能力 | 现在 |
|---|---|
| 后台保活 | 跨会话换绑不再 cancel 旧线程：有会话归属的旧线程迁入后台表（上限 8，超限按「空闲优先、最旧兜底」驱逐）继续跑；bind 回该会话时 promote 复用 warm 线程（免重建、免重灌上下文） |
| 后台事件通道 | 新 `zhuye_session_event` 通道（载荷 `{session_id, event}`）；前台 `zhuye_event` 线格式与 reducer 语义不变 |
| 运行可见性 | 会话列表徽标（运行中圆点 + 待确认数，`useBackgroundSessions` 投影）+ 新待确认 toast 引导切回 |
| 后台待确认交互 | gate 请求（审批/提问/ask_user/plan）不落 rollout —— 切回水合后由 `mergePendingInto` 注回主 store，后台会话不再静默卡死在审批上 |
| 队列按会话隔离 | 排队项入队时盖章 session id；展示与排空只取前台会话队列，后台会话的队列回到前台才排空 |
| 边界（诚实声明） | 后台会话不能远程停止/应答（须切回）；切回时 in-flight turn 从首个到达的 delta 起续流（此前增量在后台通道由 `mapTurn` 惰性建 turn 承接，前缀缺失）；原地重建（热重载 / pending error）与后台清场仍走 cancel |

### 3.35 上下文注入接线（v1.x，桌面侧）

引擎已有 AGENTS.md 注入 hook（`zhuye-exec::builtin_hooks`）但只在 headless CLI 路径注册，桌面 `thread_factory` 从未挂载（该文件头注释声称桌面已注册——半接线）；环境上下文（OS 版本 / 平台 / 日期 / 工作目录 / shell）则引擎与桌面均无注入。现在：

| 能力 | 现在 |
|---|---|
| AGENTS.md 项目指令 | `app-core::prompt_env::AgentsMdHook`（复刻 exec 版语义：用户级 + 项目级合并、32KB 截断、`Source:` 标注、`## Project Instructions` 段格式经 `append_agents_md_section` 生成）；`[active] agents_md` 开关（缺省开，与 headless 同口径）。exec crate 拖 clap/opentelemetry 不适合 GUI 依赖，属上游收敛候选 |
| 环境上下文块 | `app-core::prompt_env::EnvContextHook`：会话首轮注入 `## Environment Context`（工作目录、平台/架构、OS 版本 best-effort 缓存探测、今天日期、shell），对齐主流 agent 的 `<env>` 块实践 |
| 注入通道 | `UserPromptSubmit` 首轮 `HookDecision::InjectMessage`（引擎包 `<system-reminder>` user 消息），引擎循环零触碰；`AtomicBool` 每会话只注一次 |

### 3.36 模型四维能力智能化（上游 `34e19acf` + 桌面接线，v1.x）

多来源聚合策略：provider 实拉清单是 live 权威，models.dev 社区目录补缺，用户配置/策展静态表压顶。

| 维度 | 上游级联（策展优先、目录填空缺） | 桌面消费 |
|---|---|---|
| 上下文窗口 | `context_window_for` = override → 静态表 → models.dev 目录 | 用量条 / 压缩阈值（既有链路，目录自动插档）+ 模型列表标签 + 一键填充 `[context_windows]` |
| 输出上限 | `output_budget::model_output_limit` = 精确表 → 目录 | 自适应预算（既有）+ 模型列表标签 + provider `max_tokens` 表单（显式覆盖） |
| 视觉 | `ModelInfo.supports_vision`（live / 目录） | 模型列表标签 + composer 警示条 / 发送确认弹窗（剥离图片），未知不拦截 |
| 思考强度 | `reasoning_effort::max_effort_for_model` = 静态表 → 目录档位映射 → 保守默认 | Composer / Models 页 `zhuye_effort_capability` 档位自动变准（无需改 UI） |

目录实现要点：`zhuye_llm::models_dev` 解析 api.json → 跨 provider 投票（窗口/输出取众数、平票取小；视觉/思考多数表决；档位集合取众数）→ 变体拼写（`.`/`-` 归一）+ `-128k`/`-1m` 名字后缀兜底链；内嵌 gzip 快照（`scripts/fetch-models-dev.sh` 产出）+ 磁盘缓存（`zhuye_config::paths` 用户级目录 `cache/models-dev.json`，24h TTL）+ 显式刷新，**引擎启动不联网**，失败静默用旧数据。桌面新增 `zhuye_lookup_model_abilities`（纯内存查询）供模型卡片与发送前视觉检查；`zhuye_list_provider_models` 条目经 `enrich_with_catalog` 补缺（Anthropic 官方端口从此也有四维能力）。目录数据只补 `None`，从不覆盖 live 披露或用户配置（与上游 Decorate 同语义）。

---

### 3.37 模型组唯一（`[[model_group]]`，上游 `feat/model-group-only` + 桌面接线）

模型配置从「anthropic / openai 两个内置端口」升级为「**模型组是唯一接入单元**」：
固定接入段（`[anthropic]` / `[openai]` / `[ollama]`）整层移除，所有端点一律
是命名模型组（provider 分组模型惯例）。

| 维度 | 落点 |
|---|---|
| schema | `zhuye-config::schema::model_group`：组 id（= 模型 spec 前缀与 registry 池名）/ label / endpoint（openai\|anthropic\|ollama）/ base_url / api_key / model / responses_api / timeout / temperature / max_tokens / ollama 三项 / 嵌套 credentials |
| builder | 组 id 直接 `register_pool`；非法 / 重复 id、未知 endpoint warn 跳过不阻断；池名即组 id |
| active 解析 | `[active].group`（旧 `[active].provider` 由 serde alias 读入）：env 与配置均可点名组 id；fallback 探测追加首个可用组 |
| 迁移 | `CURRENT_CONFIG_VERSION = 2`；`load_from_str` / `load_from_file` / `load_default` **都跑** v1→v2 迁移：旧固定段就地转成等价模型组（组 id = 段名，credentials 原样下沉），已有同 id 的组不被覆盖，迁移幂等，写回不含旧段 |
| 清单发现 | `AnthropicClient::list_models`（404/405 诚实降级）—— anthropic 格式端点的 `model = "free"` 与 `zhuye models list` 自此可用 |
| 桌面命令 | `zhuye_set_model` 的入参由 `provider` 改名为 `group`，值域收敛为「已声明的模型组 id」；热重载 diff 纳入 `model_group` 段；凭证池健康度改为遍历模型组（旧实现漏掉自定义组，本次一并修好） |
| 桌面 UI | 设置页只留「模型组」页（组卡片 + 组内凭据编辑，默认组 = 点卡片写 `[active].group`）；「提供商」分区与「编码套餐」子面板整体删除（多 key / 配额下沉到组内凭据）；Composer 模型选择器只列模型组 |

旧配置**自动迁移**（读入即转组，写回即新格式），用户无感。详见 `docs/protocol-bridge.md` §2 与上游 `docs/configuration.md`「模型组」段。
### 3.38 受控浏览器显示通道（F39 桌面半边）

上游 `zhuye-browser` crate + `plugins/browser` 落地后,桌面接线**显示通道**:
`zhuye_browser_start/stop/status/env` 命令(`commands/browser.rs`)+
`zhuye_browser_frame` 事件(base64 JPEG,`Page.startScreencast` 帧流,
`everyNthFrame=1`，逐帧确认)。与 agent 控制通道共享 `$ZHUYE_HOME/browser-profile`
的 `DevToolsActivePort` 发现契约(先启动者持有,后到 attach)。`status`
无副作用(不拉起浏览器);`start` 的应用句柄检查先于一切浏览器探测 ——
能力覆盖层不会误启真浏览器(L3 `ipc_browser.rs`)。**控制通道**(MCP 工具)
需装 browser 插件与其 `agent-browser` 可执行文件（上游提供构建脚本、PATH 和 `ZHUYE_AGENT_BROWSER` 入口）；隔离 Chrome 测试覆盖帧流、导航与鼠标键盘输入，agent 联动仍为实机验收项。

**面板输入注入**(桌面半边自足,不依赖 browser 插件):`zhuye_browser_input`
命令把面板上的鼠标 / 滚轮 / 键盘转成 CDP Input 域命令
(`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`)—— 右 dock 的浏览器
是**真可交互**的(点击、双击、拖动、滚轮、页面内打字),此前只有只读画面。
坐标由前端送**归一化值**(0..1,相对面板画面),后端按页面 CSS 视口
(`Page.getLayoutMetrics` → `cssVisualViewport`)换算 —— 面板缩放不影响落点。
输入与帧流**共用同一条 page 级连接**(每帧另开 websocket 会让拖动手感崩),
页面会话任务(`browser_backend/page.rs::run_page_session`)同时跑帧流事件与输入
指令;`Emulation.setFocusEmulationEnabled` 保证无头页面恒持焦点,按键能进页面。

### 3.39 Git worktree 完整管理（桌面侧）

`app-core::worktree` 提供 UI 无关的 `worktree_list/add/remove/prune`（判脏复用
`zhuye_tools::worktree::worktree_dirty`），命令层 `commands/git.rs` 薄封装并新增
`zhuye_create_worktree` / `zhuye_remove_worktree` / `zhuye_prune_worktrees`（与既有
`zhuye_list_worktrees` 合为完整面）。GUI Git 视图 WorktreePanel 可内联新建（同名
新分支或指定已有分支）、一键「在此开会话」（切 workspace → 建会话 → 导航）、
脏树 confirmDialog 后 force 删除；`stranded` 告警标出改动滞留隔离工作树的风险。
worktree 是 GUI 用户操作面而非 agent 能力，不上游化（agent 侧 `EnterWorktree`
工具面向自身；无 TUI 第二消费方）。L3 `ipc_git.rs` 临时 repo 闭环覆盖。

## 4. 剩余缺口与后续

当前子模块的能力矩阵已按 `f4bb7057` 复审；接线不等于全链路运行态验证。
已确认的运行态覆盖与待验证项见 `tests/RUNTIME_COVERAGE.md`；
以下记录此前已处理的项目。

- 「todo 清单只出不进」→ **上游已闭合**（zhuye-agent v1.7 `d621397`：
  `AgentConfig.todos_slot` 共享槽 + `tool_exec` 渲染清单 + `pre_loop`
  注入 `## Current Todo List` 段 —— agent 每轮都能看到自己刚写的清单）。
- 「Goal 状态可观测」→ **上游已闭合 + 桌面端已接线**（见 §4.1）。
- 「`[sandbox].os_level` 语义差」→ §3.19 桌面端闭环；上游 schema 亦已改为
  `Option<bool>`（v1.7），桌面端的原始 TOML 嗅探 workaround 已随之移除。
- 「免 Key 端点（免费模型池）配不出来」→ **上游 + 桌面端均已闭合**
  （上游 `122fc3e0`：`CredentialConfig.api_key` 改 `#[serde(default)]`，
  显式配了 `base_url` 就注册 provider；桌面端 `zhuye_list_provider_models` /
  `zhuye_test_provider_chat` 接受空 key，plan 编辑器允许留空并标注
  「免 Key」）。
- 「团队只能看不能改」→ §3.22；「allowlist 三命令无消费方」→ §3.23 改写
  （不再接桌面端私有机制，而是把「始终允许」写进核心权限层）；
  「shell 会话列表」→ §2 归为**有意不接线**（桌面端本地诊断命令，
  界面用自己的会话状态更准）。

### 4.1 Goal 状态可观测（上游已闭合,桌面端已接线）

上游 v1.7 补了 `GoalController::snapshot() -> Option<GoalState>` 与
`AgentThread::goal_snapshot()` 读口。桌面端接线：

- **命令**：`zhuye_goal_snapshot`（`commands/agent.rs`）—— 直读线程
  快照，未进入目标模式（或 rebind 丢控制器）返回 `null`。
- **IPC**：`src/utils/commands/goal.ts` 的 `zhuye_goal_snapshot()`，
  `GoalSnapshotPayload` 镜像 `GoalState`（snake_case 出线）。
- **消费**：store 的 `syncGoalSnapshot`（会话 hydrate 后与 goal turn
  收尾拉取）校准 `goalActive` 投影 —— 此前投影在会话切换 / rebind 后
  与真实状态脱节，现在以快照为准；Composer goal 徽标 tooltip 展示
  轮次 / token / 状态（`composer.goalBadgeDetail`）。
- **覆盖**：L3 `src-tauri/tests/ipc_goal.rs`（stub provider 配置下断言
  挂载 / 覆盖 / 退出全周期的快照形态）+ `ipc_agent_ops.rs`
  （无 provider 时不产生幽灵目标的快照断言）。

### 4.2 核心文件工具的路径竞态防护（上游已闭合，桌面端已接入 submodule）

`f755d73d` 已把「先检查、后按路径读写」改为固定文件/目录句柄，并校验任务列表 ID：

| 位置 | 现状 |
|---|---|
| `zhuye-tools/src/sandbox.rs` | `read` / LSP 文档同步固定只读句柄，写入固定父目录并用私有暂存目录 |
| `builtins/read.rs` | 同一句柄完成二进制嗅探、大小上限和内容读取 |
| `builtins/{write,edit,plan_write,notebook_edit}.rs` | 独占创建临时文件、句柄级替换、保留 mode / owner / ACL / xattr |
| `builtins/image_view.rs` | 固定只读句柄上检查大小并读取 |
| `zhuye-lsp/src/{tool.rs,document.rs}` | 路径解析拒绝外部/悬空符号链接，文档从固定句柄读取 |

覆盖由上游 crate 单测和 mock LSP server 集成测试提供；桌面侧工作区文件命令
仍保留自己的固定父目录实现并有 L3 用例覆盖。

> 上游文档漂移已订正（`3a1bab4b`，含于 `e4560bc`）：`zhuye-task/src/lib.rs`
> 的 TodoWrite 清单通道描述与 `todo_write.rs` 模块注释均已与实现对齐。

---

## 5. 维护约定

- 基座升级（`git submodule update --remote`）后**重新跑一遍本审计**：
  新的 `Op` / `EventMsg` 变体、新的 crate 公开 API 都要在此登记。
- 协议不变量（`AGENTS.md`）：**所有 `Op` 变体 → Tauri 命令**、
  **所有 `EventMsg` 变体 → TS 类型 + reducer**。核对脚本见
  `docs/protocol-bridge.md`。
- 表中状态由「命令是否存在」+「前端是否有消费面」两项共同决定 ——
  有命令但无 UI 视为 🟡（半接线），不是 ✅。
- 本文档头部的「最近审计」锚行是静态门禁依赖（`tests/static/run.sh`
  比对 submodule sha），升级后必须同步更新该行。

---

## 历史审计记录

各轮 submodule 升级的审计流水（最新在上）：

- **上一轮 `5fd69a0`**（develop tip，跟踪分支 main→develop；v1.x 可靠性与治理能力批次 feat/zcode-gap-v1x：流锚点恢复 / Prompt Snapshot / 输入守恒 / cache warming / 结果预算 / tool-defer 等，`EventMsg` 54→59 + `MAX_STEER_INPUT_BYTES`，Op 零变化；桌面接线见 §3.41。其上一轮 `467607c`：CI 门禁修复批次 —— 子代理父上下文交接回归修复 + 测试适配 + clippy 1.100 机械改写 + 清理 12 个零引用 workspace 依赖。）

- **上一轮 `29aa9ad`**（ZhuYe main tip，`ce57058` 回归测试之上：上游 CI functional 套件（test_A8b_plan审批_工具路径全链路）证伪「非 Plan 模式调 ExitPlanMode」守卫 —— 该路径是被测试钉住的合法工作流，且 plan 审批走独立 PlanApprovalGate 永远人工弹窗、不经 approval policy 自动批准，守卫回退（历史保留注释）；另修 main 上预存 CI 红项：single_turn.rs 的 redundant clone 与 COVERAGE.md 计数过期。桌面配套：workspaces/tests.rs fmt、视觉基线重生成（WorkspacesView 新增移除按钮/已移除分区）。其上一轮 `ce57058` 补齐组合穷举回归测试，见 §3.32。）
- **上一轮 `199a3d3`**（rollout 首行修复：首条 UserInput 之前的 `PermissionModeChanged` / `PlanRequest` 等记录在 SessionMeta 未落盘时不再持久化（初始模式改由会话头落地时补记），`parse_first_session_meta` 在前 8 条非空行内扫描 SessionMeta 恢复存量坏文件 —— 修复「先切权限模式再发首条消息的会话被索引丢弃、workspace 归属丢失」。GUI 侧配套：`plan_draft_updated` 消费、Inspector 计划 tab 正文渲染、工作区移除不再被 incidental 切换复活（详见 §3.32）。）
- **上一轮 `893faa9`**（System 消息折叠修复：`ChatRequest::fold_system_messages` 把内联 `System`（压缩摘要 / PreCompact hook 注入 / resume 回放 summary）折叠进 `system` 块，消除严格 OpenAI 兼容网关的 `INVALID_REQUEST`（"System message must be at the beginning."），并修掉 Anthropic 静默丢弃内联 System 导致的内容丢失。本次仅在请求构造层修复，**产品命令、事件、配置与 SDK 公开面零变更，桌面无适配**。）
- **上一轮 `1239806`**（F01 注入防护强化：`[prompt_guard]` 由 opt-in 转**默认开启**，工具输出 Block/Review 裁决 + 外部工具定义注册期扫描（Block 拒绝注册）+ SHA-256 指纹上报；新增 `Op::QueryGuardStats` / `EventMsg::GuardStats`（additive，GUI 已接设置开关 + 工具行注入徽标），及 F24 Windows 沙箱 FFI 等 develop 线全部修复。）
- **注意**：bug-fix 分支原先指向的 `a32b62b`（流式不压缩 / 思考阶段断开重试 / 流式错误必定收尾 / 思考强度按端点能力自动适配）**未推送至 ZhuYe 上游**，本仓库暂以 `7196d3c5`（develop，含审批策略分离 `auto_approve`·`full_access` 变体 + CI 债修复）兜底。当前状态：①审批策略三档已全量支持，按用户偏好原样发送（上游 `fix/desktop-runtime-modes` 已合入）；②思考强度能力走上游静态能力表（与引擎 wire 前钳制同源）——「运行时已验证结论」层（effort_cache）仍待上游合入后叠加。
- **上一轮 `390a88a`**(F01 注入防护强化)之前为 `72d7d97`：TaskOutput block=true 只认非空内容，消除 Windows 上 writer create→write 窗口读到空串的竞态；发布批次 v0.1.14 同步。
- **上一轮 `e3da2540 → 58cebeb6`** 为两项 Windows 平台行为修复：safe_write 原子改名改走 NT 层 `NtSetInformationFile`（Win32 封装层整体拒绝非 NULL RootDirectory，code 87 的真根因；并按 Windows「不能替换仍有打开句柄的文件」约束在改名前释放旧目标句柄）；pipeline shell 节点用例按平台断言（Windows 无沙箱后端，fail-closed 拒绝是可达语义）。
- **上一轮 `0cca4c6a → e3da2540`** 为 safe_write 原子改名切到 FileRenameInformationEx：非 Ex 类拒绝非 NULL RootDirectory（code 87），write/edit/plan_write 落盘与 GUI 文件保存在 Windows 上恒红的根因；plan_write 绝对路径改按分量判定（Windows `is_absolute()` 对无盘符根路径漏网）。均为能力内部实现，产品命令、事件、配置与 SDK 公开面零变更，桌面无适配。
- **上一轮 `8e72bc4c → 0cca4c6a`** 为 Windows 文件锁句柄口径补漏：zhuye-telemetry 的 `activity.lock` 与 zhuye-audit 的 FileSink 公共 open 路径此前仍以纯 append 句柄加锁，`LockFileEx` 在 Windows 上直接 ACCESS_DENIED（code 5）——即上一轮 `1c09f6a4 → c728da8e`（zhuye-task 等三处）同一根因的剩余两处。均为能力内部实现，产品命令、事件、配置与 SDK 公开面零变更，桌面无适配。
- **上一轮 `c728da8e → 8e72bc4c`** 为三项 Windows 平台行为修复：zhuye-git 命令超时用 Job Object 整树终止（孙进程不再逃逸，与 Unix 进程组对等）、zhuye-lsp / zhuye-mcp / zhuye-shell 的 stdio 子进程 `env_clear` 后透传运行时候选变量（缺 SystemRoot 会让 node.exe 等 CRT 程序在输出前即崩溃）、zhuye-shell 会话 kill 整树终止（GUI 终端 kill 按钮在 Windows 上自此清场）。均为能力内部实现，产品命令、事件、配置与 SDK 公开面零变更，桌面无适配。上一轮 `1c09f6a4 → c728da8e` 为修正 Windows 文件锁句柄权限（`LockFileEx` 要求可读句柄），产品命令、事件、配置与 SDK 公开面零变更，桌面无适配。
- **上一轮完整审计覆盖 `f4bb7057 → 57907d5b` 全部 538 个文件**，按协议、运行时、工具、LLM/配置、编排、插件/导入、CLI/SDK 七个能力族逐项对照桌面命令与前端消费面（详见 §3.30）。命令面由静态门禁验证 189 个注册命令全部有前端消费面；事件面由三方奇偶门禁验证 50 个 `EventMsg` 变体；提交面由 Rust/TS/样本奇偶验证 26 个 `Op` 变体；运行态证据按域登记在 `tests/RUNTIME_COVERAGE.md`。
- **历史审计记录**：`d063a5f`（0.1.8 + 路径安全批次）复核过协议面、数据目录口径与核心文件工具；`e4560bc` / `c0377609` 批次闭合了 Goal 快照、todo 回灌、`os_level` schema、免 Key 端点、清单回灌、工具参数整包形态和审批门取消令牌观察。

### 3.40 挂起交互查询面 + 事件可靠性 + 上下文构成（v1.12 三支柱）

引擎 gate 真相上收（`AgentThread::pending_interactions()` + `zhuye_bind_session`
返回 `pending_gates` + `interaction_resolved` 了结广播 + rollout 审计）、
`Event.seq` 会话扇出序号（前端缺口检测 + `zhuye_event_gap` 合成通知双保险 →
重放收敛）、`context_composition` 六类估算分解（工作台容量卡构成条形）。
上游四提交 bcc75dc9…fe87e8e9，桌面接线与线格式见 `docs/protocol-bridge.md`
§1/§2/§3.2/§3.4，roadmap 见 `docs/plans/protocol-upstream.md`。

### 3.41 v1.x 可靠性与治理批次接线（submodule 跟随 develop，`467607c` → `5fd69a08`）

跟踪分支自本轮起 main→develop（`.gitmodules` branch 同步改写，后续
`git submodule update --remote` 拉 develop tip）。上游 feat/zcode-gap-v1x
合入（9 提交）：流锚点恢复 / Prompt Snapshot / 输入守恒 ledger /
rapid-refill 熔断 / 空结果防护 / cache warming 调度器 / 工具结果预算 /
tool-defer 按需加载 / stop_turn 级联 / strict schema 折叠 / cache TTL
透传。协议面 `EventMsg` 54→59（`cache_warming` + `stream_recovery` 四
变体，诊断事件无对应 Op）+ `MAX_STEER_INPUT_BYTES` 常量；Op 零变化；
`RolloutRecord` +3 变体（桌面 export 不 exhaustive match，零适配）；
config `[cache_warming]` / `[tool_results]` 均 serde(default) 增量。

桌面接线（additive 最小面）：TS 协议镜像 +5 事件 + 契约样本 +5（三方
奇偶 59=59=59）；reducer `stream_recovery_started` 发「正在自动恢复」
toast（半成品输出被 `agent_message_reset` 清空后的显性反馈），其余四
事件显式 no-op 保穷尽（契约测试白名单登记）。保温 / 恢复审计事件的
独立消费面（usage 面板保温收益对照、恢复明细 feed）与 `[cache_warming]`
/ `[tool_results]` 配置 UI 留待后续，见线格式 `docs/protocol-bridge.md`
§3.14。

子代理续派复用 `call_<role>` 的 `session_id` 参数；消息活动标识续派，子会话历史可在侧栏查看。任务预算等引擎治理参数经高级 TOML 配置，预算快照暂未提供独立界面。
