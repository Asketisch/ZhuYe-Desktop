# 协议上游升级 —— 三支柱落地与 roadmap

> 对标参照：ZCode 桌面版源码实测对照（见 `docs/visual-parity.md` 与 2026-11-21
> 审查）。本文档登记**引擎协议（zhuye-agent submodule）**的可靠性三支柱落地
> 状态与后续 roadmap。烛夜与 ZCode 的形态差异是**有意取舍**：烛夜走「类型安全
> 查询 API + 原始事件直通 + rollout 重放」的 Rust 路线，不引入 ZCode 的
> 7 层 RPC + 服务端投影网关（其 v4-gateway 单文件 ~4000 行）；可靠性闭环由
> 引擎侧真相 + 客户端检测收敛达成。

## 已落地（上游 commits bcc75dc9 → fe87e8e9，桌面 submodule 同步）

### 支柱一：gate 真相上收引擎（对标 pendingInteraction 快照行）

| 能力 | ZCode | 烛夜实现 |
|---|---|---|
| 挂起态权威 | `pendingInteraction` 是服务端快照行 | `ApprovalGate` waiter 之外并排 `PendingRegistry` 快照行（zhuye-tools `approval/pending.rs`，父子代理共享） |
| 查询 API | snapshot 携带 | `AgentThread::pending_interactions()`（`zhuye_bind_session` 返回体 `pending_gates` 送达前端） |
| 完整重建 UI | interaction 载荷在快照 | `PendingInteraction.payload` 与对应 `EventMsg` 变体字段同构（原始 args / questions / prompt / plan 正文） |
| 了结广播 | resolveInteraction 命令 + 服务端收敛 | `interaction_resolved` 事件按任意路径了结（应答 / TTL 过期 / 取消 / 中断 / 通道关闭）广播，客户端无条件清理挂起态 |
| 审计 | 服务端持久化 | `RolloutRecord::InteractionRequest / InteractionResolution`（**有意不参与 resume 回放**：进程重启后原回合已不存在，重发即幽灵弹窗；跨进程应答属 roadmap） |
| TTL 过期可见 | auto-resolution 倒计时 | TTL 清扫先摘注册表再投递 Deny，等待侧凭条目缺席识别清扫方，无双份通知；过期路径同样广播 `interaction_resolved(Expired)` |

桌面接线：`hydratePendingGates`（`stores/agent/store.ts`）把 bind 返回的快照行
还原为合成事件走同一份 `reduceEvent`（零语义复制），按 `request_id` 与后台
scratch 注回（`mergePendingInto`）去重 —— 同进程内切走切回走前端投影（更鲜），
reload / 换绑走引擎快照（跨进程兜底）。

### 支柱二：事件序号（对标 seq 水位 + 断档重订阅）

- `Event.seq`（`#[serde(default)]`，wire 双向兼容）：`submission_loop` 的会话
  扇出出口（`fan_out_session` / `fan_out_session_reliable`）统一赋号，
  per-session 单调从 1 起；per-turn 专属流 seq = 0 不参与判定。
- 前端 `store.subscribe` 内联检测：`seq > last + 1` → 当前会话 re-replay
  收敛（防抖：一次缺口风暴只同步一次）。
- 后端转发器 broadcast `Lagged(n)` → `zhuye_event_gap` 合成通知（第 6 条推送
  通道，非 EventMsg 变体），覆盖 per-turn 快路丢包；后台缺口由
  `backgroundSessions` 定向重灌 scratch turns 投影。

### 支柱三：上下文组成分解（对标 context composition）

- `context_composition` 事件：六类估算分解 —— `system_prompt / memory /
  skills / tool_schemas / mcp_tools / messages`（ZCode 11 细类按烛夜组装段
  归并为 6，语义不丢）。
- 唯一计量点：`model_call` 在 ChatRequest 组装后（复用 compact 全局估计器，
  估算值非精确计量，不保证求和 = input_tokens）；**组成指纹无变化省略不发**。
- 消费：工作台容量卡六类构成条形（`StatusPanel`）——
  `docs/visual-parity.md` #3 收口。

## Roadmap（按价值排序，实现走 SUBMODULE.md 上游流程）

1. **跨进程 gate 应答**：`InteractionRequest` 已落盘，缺「进程重启后重开
   未决交互的回合复活语义」—— 需要引擎支持「挂起回合持久化 + 重放时恢复
   waiter」而非仅审计。对齐 ZCode 的服务端 pending 天然跨 reload 形态。
2. **hook 执行生命周期事件**：`hook_started / hook_finished`（现状 hook 执行
   对前端完全不可见，仅 Ask 决策间接可见）—— 对齐 ZCode 的 hook run 事件组。
3. **session title 模型生成 + Rename Op**：现只有首条 user 消息派生标题 +
   CLI rename 落 sidecar；协议层无 Rename Op / TitleGenerated 事件。
4. **steer 队列可见性事件**：引擎两级转向队列（Now/Attachment/Step）对前端
   不可见（排队提示行只能猜）；补 `steer_queued / steer_drained` 事件组，
   支撑 composer 排队面板（ZCode ConversationQueuePanel 形态：拖拽重排 /
   send-now / edit-lock）。
5. **Rust 端未知变体容错**：协议 crate 未用 `deny_unknown_fields`，但未知
   `type` 在 Rust 反序列化仍报错（与「客户端容忍未知 type」承诺相悖）——
   评估 untagged fallback 或版本协商字段。
6. **`PROTOCOL_VERSION` 标记**：现无数字版本常量（纯文档约定），serve 握手
   无法协商能力。

## 明确不采纳（评估后弃）

- **服务端投影网关**（ZCode v4 快照/delta 协议）：复杂度另一头（~4000 行
  gateway + 客户端三铁律），烛夜的「原始事件 + rollout 重放 + seq 缺口检测」
  以小得多的机制达成同等可靠性；TUI/GUI 消费同一信封的红线也更易维持。
- **gate 服务端倒计时自动收敛 UI**（ZCode auto-resolution 状态机）：TTL
  fail-closed Deny + `interaction_resolved` 广播已覆盖「不悬挂」的核心诉求；
  倒计时 UX 属增强，非可靠性缺口。
