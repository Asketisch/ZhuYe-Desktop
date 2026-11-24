# src/stores/ —— Agent 状态层

> **何时读我**：改 agent 状态机（reducer / store / turns）、会话回放水合、editorStore 的 pending diff，或给 store 增删状态字段前先读本篇。

## 模块概述

Zustand 状态层：`agent/` 子目录是主状态机（EventMsg → `reduceEvent` 产出 patch → store 应用），顶层 `editorStore.ts` 管 agent 编辑的 pending diff（逐块 review），`replay.ts` 把会话回放记录构建为 turns。面向用户的兼容入口 `agentStore.ts` 指向 `agent/`。

## 核心文件导航

| 文件 | 职责 |
|---|---|
| `agent/reducer.ts` | `reduceEvent`：EventMsg → 状态 patch 的纯函数核心（约 670 行）；未知 `msg.type` 走 default 分支返回空 patch |
| `agent/store.ts` | 活跃 Zustand store：`useAgentStore` 与 `subscribe()`（建立事件订阅，幂等） |
| `agent/types.ts` | AgentState / Turn 等状态类型联合（约 495 行）；挂起交互类型拆在 `agent/pendingTypes.ts`（含 MCP elicitation 的 `PendingElicitation`：事件入列、`resolveElicitation` 移除，GUI 弹窗待接） |
| `agent/pendingGates.ts` | v1.12：引擎挂起交互快照（bind 返回 `pending_gates`）→ 合成事件流（零语义复制，走同一份 reducer）；`hydratePendingGates` 按 request_id 去重水合 |
| `agent/eventGap.ts` | v1.12：`Event.seq` 缺口跟踪器 + 重放收敛（缺口与 `zhuye_event_gap` 合成通知两条触发路径共用） |
| `agent/turns.ts` | Turn / TurnItem 构建与工具入参、输出摘要；含 `userAttachmentsFromItems`（提交 items → 附件元数据）与 `userItemsFromTurn`（轮内用户内容逆转回可重发 items，重生成用） |
| `agent/selectors.ts` | 细粒度 selector（`selectHasPendingInteraction` 等），配合 `useAgent` 防过宽 re-render |
| `agent/index.ts` | 桶导出 `useAgentStore` / `reduceEvent` / `useAgent` 与类型联合；新导出只进这里 |
| `backgroundSessions.ts` | 后台会话注册表（v1.x 后台持续运行）：消化 `zhuye_session_event` 通道（`{session_id, event}`），每会话持一份主 reducer scratch 投影 running / pending / **实时 turns**（形状零漂移）；`demote` 在切走时把前台投影播种进 scratch，`mergePendingInto` 在切回水合后把待确认交互与在飞 turns 整体注回主 store。v1.12：订阅 `zhuye_event_gap` 后台缺口 → 按 replay 重灌各后台会话 scratch 的 turns（pending 以引擎注册表为权威，切回时 bind 兜底） |
| `editorStore.ts` | agent 编辑的 pending hunk 列表，自订阅 agentEventBus；Accept 保留内容、Reject 用 inverse patch 经 `zhuye_write_file` 落盘 |
| `replay.ts` | `zhuye_replay_session` 返回的 RolloutRecord 流 → turns + 压缩聚合统计；剥除引擎注入的 `<system-reminder>` 块（注入内容不冒充用户发言） |
| `shellUi.ts` | harness 壳层 UI 状态（v3 设计）：rail / dockMode（五档）/ dockOpen / dockWide / dockWidth（用户拖拽出的 dock 宽度，`null` = 未拖过，用各档位默认宽度）/ termOpen / inbox / settings / palette / inspectorTab（检查器页签，StatusPanel「计划」行可编程切到 plan）/ dropHint / unread（后台完成未读产出）。rail·dock·term·semantic·dockWidth 持久化到 localStorage（`zhuye-harness-ui`；dockWidth 拖拽中只改内存态、松手 `commitDockWidth` 落盘一次）；快捷键（`logic/shell/useHarnessShortcuts`）与标题条/侧栏/壳视图全部消费本 store，不另设组件内状态 |
| `approvalPolicy.ts` | 会话级审批策略偏好（per-session localStorage + `'new'` 预创建键；`wireApprovalPolicy` 发送时进 `thread_settings`；`moveApprovalPolicy` 在会话 id 落定后转正） |
| `permissionPreference.ts` | 会话级工作模式偏好（per-session localStorage + `'new'` 预创建键）。首页/未绑定会话选「计划/询问/默认」时 `Op::SetPermissionMode` 只落占位线程，首条消息建会话后模式回落默认 —— `syncPreferredPermissionMode` 在 bind→replay 为空（新会话）时按偏好校准；老会话尊重 rollout；`movePermissionPreference` 随会话 id 落定转正。写入点：PermissionPicker / 设置页 / PromptPicker 的 /plan 预设 / `/plan` 斜杠 |
| `planActions.ts` | plan 域 actions 工厂（queue/toast 同款模式）：`approvePlan`（命令失败 toast + 照常清挂起态，不吊死审批条）+ enter/exit/set/cycle 工作模式。request 在 IPC 后本地清挂起，ready 等事件回执关闭 |
| `promptSelection.ts` | 会话级提示词预设偏好（v1.12：per-session localStorage + `'new'` 预创建键，值 = 协议 `PromptSelection` wire 形状）。`syncSessionPromptSelection` 在 bind 后恢复该会话选择（有记录提交 Select；无记录且锁残留恢复跟随默认；已跟随默认则跳过不写 rollout）—— 会话内提示词恒定是供应商 prompt cache 命中的前提，入口只在空会话态（底栏提示词预设 pill `PromptPicker`，权限按钮右边）存在。v1.x：`/plan` 预设联动计划模式 —— `syncPlanPresetPermissionMode` 在 bind→replay 为空（新会话）时把工作模式校准到 plan，老会话尊重已持久化模式；选中动作的即时联动在 `PromptPicker.onPick`（同时写 `permissionPreference`，用户显式选择优先） |

## 本地契约与同步点

- **状态变更只走 reducer**：事件消化集中在 `reduceEvent`。`agent/protocol-replay.test.ts` 用 submodule 契约样本（`zhuye-agent/tests/contracts/events.json`）加 fast-check 守三条不变量——全部 EventMsg 变体喂入不抛错、流式分片与整段消息等价、完整回合回放幂等。改 reducer 后必跑它和 `agentStore.test.ts`（约 1100 行，全仓最大 store 测试）。
- **兼容链**：`agentStore.ts`（纯 re-export）与 `src/services/agent.ts` 都指向本目录，文件头注明「新代码直连实现」；新导出只进 `agent/index.ts`，两个兼容层不加项。
- **订阅建立**：`subscribe()` 在 `router.tsx` 的 `AppProviders` mount 时调用（agentStore + editorStore 各一次）；扇出机制见 [../AGENTS.md](../AGENTS.md) services 节，切片不自建监听。
- **会话切换水合**：`zhuye_replay_session(id)` → `replay.ts` 构建后灌入 store；会话列表侧不变量见根 AGENTS.md「关键不变量」。
- **引擎注入块不渲染（回放层职责）**：`app-core/src/prompt_env.rs` 的 `EnvContextHook` / `AgentsMdHook` 以 `<system-reminder>` 包裹注入环境上下文 / AGENTS.md 指令，引擎把它们与用户输入**同批落盘**（role 仍是 user）。`replay.ts::stripInjectedSystemBlocks` 在回放时剥除 —— 模型侧上下文（后端 `records_to_preload`）保持原样，仅 UI 不冒充用户发言。改注入通道时同步这里。
- **用户附件双路径同型（A2）**：`TurnItem::user_attachments`（图片 data-URL / 文件路径 chip）由两条路径产出——live `submitItems` 乐观渲染（`turns.ts::userAttachmentsFromItems`）与回放水合（`replay.ts`：image 字节数组 → data-URL、整块 `@path(:Ls-Le)` 标注 → 文件 chip）。改任一侧须保持形态一致。
- **`turn_rewound` 截断语义**：引擎 `truncate_after(to_turn_id)` 丢弃该 turn **含**及其之后（recorder.rs）；reducer 本地截断同语义（`slice(0, idx)`），与 `editRewindTargetFor`（回退目标恒为目标轮自身 id）配套。
- **权限模式恒为三态**：store 的 `permissionMode` 只经两个写入口写入——reducer 的 `permission_mode_changed` 与 `syncPermissionMode`（bind 返回值）——两者都过 `normalizePermissionMode`（`src/types/protocol/enums.ts`：`accept_edits→auto`、`bypass→prompt`、其余弃用档→auto）。引擎计划批准的 `auto_mode` 会切到弃用档 `accept_edits`（上游 `submission_loop.rs` 待修），归一化保证输入卡权限下拉（`PermissionPicker`）恒为计划/询问/默认三段、不裸回显 wire 值。
- **worktree 隔离意图是草稿级临时态**：`worktreeIntent`（非持久，`null` = 关）由输入卡顶栏开关写入、发送链路一次性消费（`useComposerSubmission` 建隔离 worktree → 切 workspace → 首条提交携带 worktree 路径）。`reset()` / `clearSession()` / `hydrateSession`（换会话）三处必须清空 —— 残留会让下一个新会话意外走建树链路。
- **后台会话投影与主 reducer 的分工（v1.x 后台持续运行）**：主 reducer 只消化前台会话事件；后台会话事件走 `zhuye_session_event` 通道由 `backgroundSessions.ts` 消化（每会话 scratch 直接跑同一份 `reduceEvent`，pending 形状零漂移）。切回会话的水合序列必须调 `mergePendingInto`（gate 请求不落 rollout），切走时若旧会话有 streaming turn 或有待确认交互必调 `demote`（把前台投影播种进 scratch）。后台会话不能远程停止/应答——须切回操作。
- **在飞内容靠内存投影跨会话存活（关键）**：上游已按步骤增量落盘 assistant 内容（`persist_assistant_step`），但正在流出的半截文本、运行态，以及审批 / 提问 / plan 这些 gate 请求仍不在 rollout 里。因此切走时必须 `demote`（播种前台 turns + pending），切回时 `mergePendingInto` 整体注回 —— 否则切回后最新增量丢失、运行态退化成「已结束」（停止按钮随之消失，卡住的回合再也停不下来）、审批框永久丢失。
- **队列按会话隔离**：`QueuedMessage.sessionId` 在入队时盖章（`enqueueMessage` 取 `loadedSessionId`）；展示（`QueuedMessages` / `Inspector` / `ZDock`，均经 `selectQueuedForActiveSession` + `useShallow`——选择器返回新数组，裸用会触发 zustand v5 无限重渲）与排空（`drainQueue`）只作用于前台会话的队列项。
- **壳层 UI 状态归 shellUi**：窗口摆法（rail / dock / 终端面板 / 任务中心 / 设置弹窗 / 命令面板 / 单色模式）只进 `shellUi.ts`，不进组件 useState —— 标题条按钮、快捷键、侧栏按钮三方共享同一状态；paletteOpen 由 `useCommandPaletteShortcut`（⌘K）与标题条按钮共用。
- **`token_count` 有两种语义，靠 `turn_total` 区分（v1.x）**：引擎逐次模型调用发一条**单次调用快照**（`turn_total` 缺省 `false`），回合收尾再发一条**本回合累计**（`turn_total = true`，数字 = 本回合逐次调用的累计）。reducer 只把 `false` 的事件累加进 `sessionTotal` / `sessionCost`（一并累计会让会话总量与费用翻倍），且回合累计**不覆盖**「最后一次调用」快照（`input` / `output` / `cached` / `cacheWrite` / `total`）—— 后者是上下文占比的判据。回合级累计另存 `tokens.turn`（按 `event.id` 归零，回合收尾时由引擎的累计事件校准），供「本回合缓存命中率」使用。改 `token_count` 分支前先读 `agent/tokenTypes.ts` 的口径注释。

## 禁止事项

- 不要绕过 reducer 直接改 turns / 交互等待状态——`set` 只用于应用 reduceEvent 产物与显式 UI 动作。
- 不要在 `agentStore.ts` 或 `src/services/agent.ts` 兼容层新增导出。
- 不要把 EventMsg 分支消化逻辑复制进组件；新变体处理进 reducer，让 protocol-replay 守卫覆盖到。
- 不要让 editorStore 的 pending diff 随会话切换清空——它刻意跨会话存活（磁盘上的 pending 变更与会话无关）。

## 注意事项

- `agent/` 下另有 approvalPolicy / autoCompact / planFailover / guardStats / queue（队列 actions 工厂，按会话隔离）/ servers / tokenTypes / toast 等专题模块及各自 `.test.ts`，职责以文件头注释为准。
- StrictMode 双 mount 的重复订阅由 `subscribe()` 幂等保证，consumer 侧不要再加防抖或单例守卫。

## 深入阅读

- [../AGENTS.md](../AGENTS.md) —— src 层篇（事件桥、协议类型分工、测试挂载）
- [docs/protocol-bridge.md](../../docs/protocol-bridge.md) —— EventMsg 线格式权威定义
- [../logic/sessions/useSessions.ts](../logic/sessions/useSessions.ts) —— 会话列表规范 hook（消费本层水合结果）
