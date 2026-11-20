# src/utils/ —— IPC 包装与 i18n 层

> **何时读我**：新增或修改任何 Tauri IPC 包装、i18n 文案模块、底层桥接降级行为前先读本篇——新命令的 5 处落点链在这里。

## 模块概述

前端 IPC 与通用工具层：`commands/` 按领域封装全部 `zhuye_*` 调用（根 AGENTS.md「Tauri 调用仅放在 `src/utils/commands/`」的实体），`i18n/` 是双语文案运行时，`bridge.ts` 提供脱离 Tauri 上下文的降级原语，其余为带就近测试的小工具。

## 核心文件导航

| 文件 | 职责 |
|---|---|
| `commands/runtimeStatus.ts` | 配置状态包含健康问题代码与级别 |
| `bridge.ts` | `invoke` / `listen` 原语；非 Tauri 上下文（浏览器 preview / 测试）识别后静默降级为 `undefined` / noop unlisten，其余错误照抛 |
| `commands/index.ts` | 按领域拆分的 barrel，逐个 `export *` 各 `commands/{domain}.ts`；新领域文件必须挂入 |
| `commands/sessions.ts`（范式示例） | 单领域包装的标准形态：导出函数名与后端命令同名（`zhuye_list_sessions` 等），参数与负载对齐后端命令表 |
| `tauri.ts` / `commands.ts` / `i18n.ts` | 三个兼容桶，仅保留向后兼容 re-export，文件头明令不再新增 |
| `i18n/` | 运行时拆分：`context.tsx`（Provider / `useI18n`）、`locale.ts`、`lookup.ts`、`interpolate.ts`、`types.ts` + `strings/` 领域文案目录 |
| `notify.ts` | 系统通知（本目录最大单文件，约 330 行）；读 agentStore 做通知决策，是 utils → stores 的已知反向边 |
| `theme.ts` / `uiPrefs.ts` | 主题与 UI 偏好兼容导出；持久化位于 `logic/preferences/`，外观映射位于 `render/appearance.ts`（**主题 → body 底色的重算契约在 `logic/webview/appearance.ts`**：body 背景色是行内样式且依赖当前主题的 `--bg-app-rgb`，显式切主题或系统主题变化时必须重放一次偏好，否则会话区底色冻结在旧主题） |

## commands/ 领域登记（全量，以文件系统为准）

| 领域文件 | 领域文件 | 领域文件 | 领域文件 |
|---|---|---|---|
| activity | agent | agents | allowlist |
| approvals | autopilot | browser | config |
| discussion | events | files | git |
| goal | health | hooks | importSessions |
| kms | lsp | mcp | media |
| memory | models | notes | notifications |
| pipeline | plan | plugins | preview |
| prompts | questions | remote | runtimeStatus |
| sandbox | schedule | search | security |
| sessions | side_channel | skills | squad |
| stats | subagents | tasks | teams |
| terminal | traces | updates | workspaces |

（目录内另有两个非领域文件：`index.ts` 桶与 `workspaces.test.ts`；`side_channel.ts` 是唯一带下划线的文件名，import 时注意拼写。）

## 本地契约与同步点

- **新增 IPC 命令 5 处落点链（本篇独有契约）**：
  1. `commands/{domain}.ts` 写包装（新领域则建文件并挂入 `commands/index.ts`）；
  2. 后端命令表 `src-tauri/src/commands/`（顺序与文档同步要求见根 AGENTS.md「开发流程检查表」）；
  3. `src/test/setup.tsx` 补默认 stub（mock 契约见 [../AGENTS.md](../AGENTS.md)）；
  4. `tests/helpers/fakeBackend.ts` 补模拟实现（L2 前端行为层的后端）；
  5. 涉线格式契约时更新 `tests/contracts/`（events / ops / payloads / roundtrips）与 `docs/protocol-bridge.md`。
- **i18n 文案挂载**：新切片文案进 `i18n/strings/<domain>.ts`，并在 `strings/index.ts` import + merge 进单一 STRINGS dict；flat key + 编译期 `LocaleString` 类型校验，缺中文 fallback 英文、缺英文返 key，占位符仅支持 `{key}` 简单语法。
- **降级语义**：包装层不得假设 `invoke` 必有返回值（浏览器环境为 `undefined`）；测试统一用 setup 的 `mockInvoke`，不在包装里做环境探测。

## 禁止事项

- 不要在 `tauri.ts` / `commands.ts` / `i18n.ts` 兼容桶新增导出或包装。
- 不要绕过 `commands/{domain}.ts` 在组件/切片里直调 `@tauri-apps/api` 或 `bridge.invoke`。
- 不要手写 `Op` / `EventMsg` 协议类型——手写与生成的分工见 [../AGENTS.md](../AGENTS.md)。
- 不要把用户可见文案硬编码在组件里，一律进 `strings/`。
- 不要「顺手规范化」命令名或负载结构——协议不变量见根 AGENTS.md「关键不变量」，命令面四方一致由 L1 静态审查守卫。

## 注意事项

- `debounce` / `dragDrop` / `theme` / `time` / `types` / `uiPrefs` / `uuid` 各带就近 `.test.ts`，改行为先看对应测试期望。
- vitest 覆盖 `src/**` 与 `tests/**`（e2e / visual 除外），`@` 别名指向 `./src`——配置以仓库根 `vitest.config.ts` 为准。

## 深入阅读

- [docs/protocol-bridge.md](../../docs/protocol-bridge.md) —— 命令面与线格式权威规范
- [../AGENTS.md](../AGENTS.md) —— src 层篇（协议类型生成链、测试挂载契约）
- [tests/COVERAGE.md](../../tests/COVERAGE.md) —— 能力域 → 门禁套件映射
