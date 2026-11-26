# src/logic/ —— 控制器与 hook 层

> **何时读我**：写/改控制器（`*Controller`、`*Binding`）、编排 hook、或排查「状态对了但界面没跟上」类接线问题前先读本篇。

## 层定位

**有状态编排层**：Binding 组件消费 `stores/` 状态 + `utils/commands` IPC，按 `contracts/` 契约把 render 默认视图装配成 slot；控制器/hook 承载会话、任务等编排逻辑。与 features 绑定壳的分工：Binding 实现契约 props，features 切片只做 slot 组装壳。

## 域族速览（9 族，以文件系统为准）

| 族 | 切片目录 |
|---|---|
| `conversation/` 会话与对话 | chat, sessions, messages, threads, home |
| `input/` 输入运行时 | composer, editor, dictation, command-palette |
| `harness/` 壳层·设置·弹窗 | shell, design-system, modals, settings, renderer, generic, preferences |
| `workbench/` 工作台 | files, terminal, git, git-pulls, preview, webview, search |
| `orchestration/` 多 agent 与任务 | agents, squad, collaboration, tasks-board, autopilot, plan, schedule, lanes |
| `telemetry/` 可观测与遥测 | traces, usage, notifications, debug, media |
| `knowledge/` 知识与资产 | memory, memory_view, skills, prompts, models, market |
| `connect/` 连接与扩展 | remote, side-channel, kms, hooks |
| `pages/` 入口与平台 | about, workspaces |

命名例外：`git-pulls` 与 `git` 同属 git 域（pulls 契约共用 render/git 视图）；`memory_view` 与 `memory` 同域（Binding 分离）；`generic/` 提供跨域 `createStatusBinding` 工厂。

## 本层契约与同步点

- **状态变更只走 `stores/agent` reducer**：本层读状态、发 Op，不直接 `set`  agent store（显式 UI 动作除外）。
- **IPC 只经 `@/utils/commands`**：本层不自拼 invoke；命令包装按域族分目录（见 [../utils/AGENTS.md](../utils/AGENTS.md)）。
- 新 Binding 三点一线：`contracts/<域>.ts` 定义 props → 本层 `XBinding.tsx` 实现 → `render/<族>/<域>/XView.tsx` 消费；改 props 形状三处同批。

## 禁止事项

1. 禁止 import `@/render/*` 具体视图——默认视图由 `render/index.ts` 组装后从 Provider 读取，Binding 只认契约类型。
2. 禁止把会话状态消化逻辑复制进组件（唯一订阅点 `services/agentEventBus.ts` → reducer）。

## 深入阅读

- [../contracts/AGENTS.md](../contracts/AGENTS.md) —— 接缝契约
- [../stores/AGENTS.md](../stores/AGENTS.md) —— 状态机口径（reducer / turns / 兼容层）
