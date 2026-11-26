# src/render/ —— 纯展示视图层

> **何时读我**：改视图组件外观/布局、排查渲染层越界依赖、或为新域放置 View 组件前先读本篇。

## 层定位

**纯展示视图层**：只消费 props 与 tokens 渲染 DOM，不持有状态、不调 IPC。默认视图在此实现，由 `src/render/index.ts` 组装成 `Renderer` 对象、经 `main.tsx` 注入 `RendererProvider`，logic 层 Binding 经 `contracts/` 契约可整体替换（`tests/renderer.swap.test.tsx` 冒烟）。`check-render-boundaries.mjs` 守卫：本层禁 hook、禁宿主对象（window/localStorage）、禁 `@/logic/*`、`@/stores/*` 跨层 import。

## 域族速览（9 族，以文件系统为准）

| 族 | 域目录 |
|---|---|
| `conversation/` 会话与对话 | chat, sessions, messages, threads, home |
| `input/` 输入运行时 | composer, dictation, command-palette |
| `harness/` 壳层·设置·弹窗 | shell, design-system, design-system-page, modals, settings |
| `workbench/` 工作台 | files, terminal, git, preview, browser, search |
| `orchestration/` 多 agent 与任务 | agents, squad, collaboration, tasks-board, autopilot, plan, schedule, lanes |
| `telemetry/` 可观测与遥测 | traces, usage, notifications, debug, media |
| `knowledge/` 知识与资产 | memory, skills, prompts, models, apps, market |
| `connect/` 连接与扩展 | remote, side-channel, kms, hooks |
| `pages/` 入口与平台 | about, mobile, workspaces |

顶层例外：`styles/`（tokens.css / base.css / harness.css 设计标记，全局契约，不落族目录）、`index.ts`（Renderer 组装点）。

## 本层契约与同步点

- **新域视图三件套**：`render/<族>/<域>/XView.tsx` + 同名 `*.module.css` + 就近 `.test.tsx`；颜色一律消费 `../styles/tokens.css` 标记，禁止内联硬编码色值。
- **组装点唯一**：新视图必须在 `src/render/index.ts` 挂入 `Renderer`；slot 形状定义在 [contracts/](../contracts/AGENTS.md)。
- design-system 视图助手（keyHints/ring/toast 常量）住 `harness/design-system/` 本地——本层不可依赖 `@/logic/*`（含纯函数）。

## 禁止事项

1. 禁 hook / 宿主对象 / `@/logic` / `@/stores` 跨层 import（守卫脚本会把关）。
2. 不要把业务分支写进视图——条件装配是 logic 层 Binding 的职责。

## 深入阅读

- [../contracts/AGENTS.md](../contracts/AGENTS.md) —— 接缝契约
- [../AGENTS.md](../AGENTS.md) —— src 层篇
