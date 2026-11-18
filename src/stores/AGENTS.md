# src/stores/ —— Agent 状态层

> **何时读我**：改 agent 状态机（reducer / store / turns）、会话回放水合、editorStore 的 pending diff，或给 store 增删状态字段前先读本篇。

## 模块概述

Zustand 状态层：`agent/` 子目录是主状态机（EventMsg → `reduceEvent` 产出 patch → store 应用），顶层 `editorStore.ts` 管 agent 编辑的 pending diff（Cursor 式 review），`replay.ts` 把会话回放记录构建为 turns。面向用户的兼容入口 `agentStore.ts` 指向 `agent/`。

## 核心文件导航

| 文件 | 职责 |
|---|---|
| `agent/reducer.ts` | `reduceEvent`：EventMsg → 状态 patch 的纯函数核心（约 670 行）；未知 `msg.type` 走 default 分支返回空 patch |
| `agent/store.ts` | 活跃 Zustand store：`useAgentStore` 与 `subscribe()`（建立事件订阅，幂等） |
| `agent/types.ts` | AgentState / Turn / 交互等待等状态类型联合（约 480 行） |
| `agent/turns.ts` | Turn / TurnItem 构建与工具入参、输出摘要 |
| `agent/selectors.ts` | 细粒度 selector（`selectHasPendingInteraction` 等），配合 `useAgent` 防过宽 re-render |
| `agent/index.ts` | 桶导出 `useAgentStore` / `reduceEvent` / `useAgent` 与类型联合；新导出只进这里 |
| `editorStore.ts` | agent 编辑的 pending hunk 列表，自订阅 agentEventBus；Accept 保留内容、Reject 用 inverse patch 经 `reflect_write_file` 落盘 |
| `replay.ts` | `reflect_replay_session` 返回的 RolloutRecord 流 → turns + 压缩聚合统计 |

## 本地契约与同步点

- **状态变更只走 reducer**：事件消化集中在 `reduceEvent`。`agent/protocol-replay.test.ts` 用 submodule 契约样本（`zhuye-agent/tests/contracts/events.json`）加 fast-check 守三条不变量——全部 EventMsg 变体喂入不抛错、流式分片与整段消息等价、完整回合回放幂等。改 reducer 后必跑它和 `agentStore.test.ts`（约 1100 行，全仓最大 store 测试）。
- **兼容链**：`agentStore.ts`（纯 re-export）与 `src/services/agent.ts` 都指向本目录，文件头注明「新代码直连实现」；新导出只进 `agent/index.ts`，两个兼容层不加项。
- **订阅建立**：`subscribe()` 在 `router.tsx` 的 `AppProviders` mount 时调用（agentStore + editorStore 各一次）；扇出机制见 [../AGENTS.md](../AGENTS.md) services 节，切片不自建监听。
- **会话切换水合**：`reflect_replay_session(id)` → `replay.ts` 构建后灌入 store；会话列表侧不变量见根 AGENTS.md「关键不变量」。

## 禁止事项

- 不要绕过 reducer 直接改 turns / 交互等待状态——`set` 只用于应用 reduceEvent 产物与显式 UI 动作。
- 不要在 `agentStore.ts` 或 `src/services/agent.ts` 兼容层新增导出。
- 不要把 EventMsg 分支消化逻辑复制进组件；新变体处理进 reducer，让 protocol-replay 守卫覆盖到。
- 不要让 editorStore 的 pending diff 随会话切换清空——它刻意跨会话存活（磁盘上的 pending 变更与会话无关）。

## 注意事项

- `agent/` 下另有 approvalPolicy / autoCompact / planFailover / guardStats / servers / tokenTypes / toast 等专题模块及各自 `.test.ts`，职责以文件头注释为准。
- StrictMode 双 mount 的重复订阅由 `subscribe()` 幂等保证，consumer 侧不要再加防抖或单例守卫。

## 深入阅读

- [../AGENTS.md](../AGENTS.md) —— src 层篇（事件桥、协议类型分工、测试挂载）
- [docs/protocol-bridge.md](../../docs/protocol-bridge.md) —— EventMsg 线格式权威定义
- [../features/sessions/hooks/useSessions.ts](../features/sessions/hooks/useSessions.ts) —— 会话列表规范 hook（消费本层水合结果）
