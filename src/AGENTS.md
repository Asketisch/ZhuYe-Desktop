# src/ —— 前端组合根与基础设施

> **何时读我**：改 `src/` 下任何基础设施（组合根、路由表、协议类型、事件桥、样式底座、测试挂载）前先读本篇；业务切片看 [features/AGENTS.md](features/AGENTS.md)，状态看 [stores/AGENTS.md](stores/AGENTS.md)，IPC 看 [utils/AGENTS.md](utils/AGENTS.md)。

## 层定位

前端组合根与共享底座：`main.tsx`（30 行）只做启动序列——`initTheme()` → `bootstrapUiPrefs()` → 拦截 WebView 右键菜单 → `AppProviders` + `RouterProvider`，不 import 任何切片。其余一切按「切片 / 存储 / IPC 包装」三个子层展开；本篇是根 AGENTS.md「开发流程检查表」「约定」在本层的执行面。

## 子区速览

| 子区 | 职责 | 进它读哪篇 |
|---|---|---|
| `features/` | 全部功能切片（视图 + 控制器/hook + 就近测试） | [features/AGENTS.md](features/AGENTS.md) |
| `stores/` | Zustand 状态层（agent 主状态机、editorStore、回放构建） | [stores/AGENTS.md](stores/AGENTS.md) |
| `utils/` | IPC 包装、i18n 运行时、桥接降级、通用小工具 | [utils/AGENTS.md](utils/AGENTS.md) |
| `services/` | `agentEventBus.ts` 持有唯一 Tauri `reflect_event` 订阅并一对多扇出；`agent.ts`（18 行）是指向 stores 的兼容 re-export | 本篇规则 2、4 |
| `types/` | 协议类型：`protocol.ts` + `protocol/` 10 个分域手写文件 + `css-modules.d.ts`，另有脚本按需生成物 | 本篇规则 1 |
| `styles/` | `tokens.css`（设计标记单一事实来源）+ `base.css` + `typography.module.css` | 根 AGENTS.md「约定」 |
| `components/` | 跨切片通用组件，当前仅 `Markdown.tsx` + 同名 module.css | — |
| `protocol/` | 前端侧提交构造，当前仅 `submissions.ts` | — |
| `test/` | `setup.tsx`：Vitest 全局挂载与 mock 契约 | 本篇规则 3 |

## 层内依赖约定

- 常规依赖方向 `features/ → stores/ → utils/`，`utils/bridge.ts` 是最底层。
- `router.tsx` 是唯一集中 import 全部视图的文件：`rootRoute`（AppShell）+ 39 个 `new Route(` 经 `rootRoute.addChildren([...])` 组树；`AppProviders`（I18n + React Query + 事件订阅建立）也定义在此，文件尾部保留 `ModalStack` 向后兼容 re-export。

## 跨层边界

- 已知两处反向边：`stores/editorStore.ts` 复用 `features/editor` 的纯 diff 算法、`utils/notify.ts` 读取 `stores/agentStore`——新增反向边前先确认不构成环。
- 本层不自拼数据目录路径（根 AGENTS.md「关键不变量」），一切文件/会话路径经后端命令往返。

## 层通用规则

1. **协议类型手写 vs 生成分工**：`types/protocol/` 是手写分域类型（UI 消费面）；`scripts/dump-ts-types.sh`（`pnpm types:gen`）从 Rust `zhuye-protocol` 生成 `src/types/protocol.generated.ts`，用于防 `Op` / `EventMsg` 手写漂移。生成物不常驻工作树——改线格式后运行脚本比对，禁止手改生成物。
2. **事件单订阅点**：新 consumer 不自开 `listen('reflect_event')`，一律 `subscribeAgentEvent(callback)`（`services/agentEventBus.ts` 内部引用计数开关底层 listener，consumer 回调彼此隔离）。订阅建立时机在 `AppProviders` mount（agentStore + editorStore 各一次，StrictMode 双 mount 幂等）。
3. **测试挂载契约**：`src/test/setup.tsx` 是 Vitest 全局 setup，导出 `mockInvoke` / `resetMockInvoke` / `emitMockEvent` / `resetMockEvents` / `createTestQueryClient` / `renderWithQueryClient`，并预置约 40 个 `reflect_*` 默认 stub；`tests/helpers/fakeBackend.ts` 依赖它。新增命令时的 stub 同步是 5 处落点链的一环，见 [utils/AGENTS.md](utils/AGENTS.md)。
4. **兼容桶不加新导出**：`services/agent.ts`、`stores/agentStore.ts`、`utils/tauri.ts` / `commands.ts` / `i18n.ts` 只减不增；各桶链路细节分别见 [stores/AGENTS.md](stores/AGENTS.md) 与 [utils/AGENTS.md](utils/AGENTS.md)。
5. **新切片不在本层注册**：`src/` 顶层不放业务组件；建切片的完整落点链（router 三处接线 + i18n 文案 + 视觉基线）见 [features/AGENTS.md](features/AGENTS.md)。

## 深入阅读

- [docs/codebase-map.md](../docs/codebase-map.md) —— 面向任务的「需要改 X，编辑 Y」路径映射
- [docs/protocol-bridge.md](../docs/protocol-bridge.md) —— 协议信封与 Op → 命令映射权威规范
- [features/AGENTS.md](features/AGENTS.md) / [stores/AGENTS.md](stores/AGENTS.md) / [utils/AGENTS.md](utils/AGENTS.md) —— 三个子层分篇
