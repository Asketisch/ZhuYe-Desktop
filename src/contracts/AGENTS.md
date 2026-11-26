# src/contracts/ —— Slot 契约层

> **何时读我**：新增注入面（View props / Slots 槽位表）、改 Binding↔View 接缝、或排查「换视图不生效」类问题前先读本篇。

## 层定位

logic 层 Binding 与 render 层 View 之间的**可替换接缝**：每个契约文件导出 `XxxViewProps`（View 组件 props 注入面）和/或 `XxxSlots`（子组件槽位表），全部为**纯类型文件**（仅 type-import，无运行时代码）。经典三点一线：`contracts/<域>.ts` ↔ `logic/<族>/<域>/XBinding.tsx`（实现 props）↔ `render/<族>/<域>/XView.tsx`（消费 props）。

## 域族速览（8 簇 + 1 个根 hub，以文件系统为准）

| 簇 | 契约文件 | 消费族 |
|---|---|---|
| `harness/` | shell, sidebar, titleBar, statusBar, activityBar, modalStack, appearance, configHealth, basicPages, designSystem, renderLayer, generic, mobile | logic+render 的 shell/sessions/modals/settings/webview |
| `conversation/` | chat, composer, messageList, sideChannel, threads, copyButton, home, dictation | conversation 族 Binding/View |
| `settings/` | settings, settingsCards, settingsPersonalization, settingsDisplay, settingsNotifications, settingsConfigInfoLine | logic/settings 的 8 个 Binding + render/harness/settings |
| `orchestration/` | tasksBoard, taskWidgets, squad, collaboration, mcpManager, pluginsPanel, agents, agentWidgets, autopilot, plan, scheduleView, lanes | orchestration 族 |
| `workbench/` | git, pulls, files, terminal, browser, htmlPreview, workspaces, search | workbench 族（pulls 与 git 共用 render 视图） |
| `telemetry/` | traces, traces_spans, usage, notifications, media | telemetry 族（两者共用 TracesBinding） |
| `knowledge/` | memory, skills, prompts, models, market | knowledge 族 |
| `connect/` | hooks, kms, remote | connect 族 |
| 根 `renderer.ts` | **组装 hub**：相对 import 全部 61 个契约，组装 `Renderer` 大接口 | `logic/harness/renderer/RendererProvider`、`render/index.ts`、`main.tsx` 注入 |

## 本层契约与同步点

- **新增契约文件必须挂入根 `renderer.ts`**：它是 `Renderer` 的唯一组装点，漏挂 = 注入面缺失、运行期该 slot 为 undefined。
- 簇内互引仅 4 条边（sidebar→shell、settingsDisplay→appearance、taskWidgets→tasksBoard、messageList→copyButton），其余簇间零 import——新增跨簇依赖前先考虑提升到根 hub。
- 渲染层保持纯展示（禁 hook / 宿主对象 / 跨层 import，`scripts/check-render-boundaries.mjs` 守卫）；契约本身禁止运行时代码。
- 改契约 props 形状时，三点一线同步改：Binding（实现）+ View（消费）+ 本篇速览表不登记单个 props。

## 禁止事项

1. 不要在契约文件里写运行时逻辑或默认实现——接缝只描述形状。
2. 不要绕过 `RendererProvider` 直接 new `Renderer`；组装点只有 `src/render/index.ts` 一处。

## 深入阅读

- [../AGENTS.md](../AGENTS.md) —— src 层篇（组合根注入链）
- [render/AGENTS.md](../render/AGENTS.md) · [logic/AGENTS.md](../logic/AGENTS.md) —— 接缝两侧
