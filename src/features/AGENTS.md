# src/features/ —— 功能切片层

> **何时读我**：新增或改动功能切片（视图组件、控制器/hook、切片样式与就近测试）前先读本篇——切片怎么组织、往哪里接线，在这里。

## 层定位

全部功能切片的宿主，是根 AGENTS.md「开发流程检查表」中「表现层 UI」与「有状态编排 hook」的落地处。每个切片 = 视图组件 + 控制器/hook + 就近测试；样式几乎每组件一个同名 `*.module.css`，颜色一律消费 `src/render/styles/tokens.css` 标记（规则见根 AGENTS.md「约定」）。

## 子区速览（全量登记，以文件系统为准）

| 分组 | 切片 | 一句话职责 / 备注 |
|---|---|---|
| 会话与对话 | **sessions**、**messages**、threads、home | sessions 是会话列表规范切片（v3 harness 侧栏：置顶 + 工作区行 + 扁平会话列表，徽标/⋯菜单状态在 `SidebarBinding`，渲染层纯展示；归档列表移至 /sessions 页）；messages 渲染聊天流（v3：760px 居中列 + fill 用户气泡 + 无头像直排助手）；threads 线程聚合视图（有 README）；home 入口页（ChatHero 带像素吉祥物 + 轮廓水印） |
| 输入运行时 | **composer**、editor、dictation、command-palette | composer（39 文件）是编辑器运行时规范位置（根 AGENTS.md本篇规则 3）；editor 仅 `diffHunks.ts` 纯 diff 算法（供 editorStore 复用）；dictation 语音输入；command-palette 命令面板 |
| 壳层与弹窗 | **shell**、**design-system**、**modals** | shell：v3 harness 壳（`AppShell.tsx` 组 slots → ShellBinding → `render/shell/AppShell` 纯展示；`DockPanel` 五档调度、`TerminalDock` 底部 PTY 终端、`InboxPanel` 任务中心、`SettingsHost` 设置弹窗；旧 IDE 五窗格与 `zcode/` 子树保留但壳层不再挂载 StatusBar/ZRail）；design-system（`primitives/` + README）共享组件；modals 由 `index.tsx` 编排全部弹窗 |
| 设置 | **settings** | 39 文件，`config/` + `sections/` + `components/` 分层；「模型组」统一页（`GroupsSection` = 组卡片 + `GroupForm`（自定义 `[[provider_group]]`，保存后自动拉模型）+ `PlansSection`（内置端口 plan）），纯 TOML 手术在 `src/logic/settings/config/{plans,groups,modelCatalog}.ts`；应用状态同步检查表（根 AGENTS.md）的 UI 端 |
| 工作台 | files、terminal、git、preview、browser、import | files：页面视图 + 右 dock 紧凑档 `FilesDock`（懒加载树 + git 徽标 + 代码预览）；terminal 交互终端（页面视图 + 壳层 `TerminalDock` 底部面板双形态）；git 面板、预览、browser 受控浏览器（页面视图 screencast + dock 档 `BrowserDock` 带 CDP 导航）、会话导入 |
| 多 agent 与任务 | agents、squad、collaboration、tasks-board、autopilot、plan、schedule、lanes | subagent 编排、小队、协作通道、任务看板、自动驾驶、计划审批、定时任务；lanes（/lanes）子代理并行执行泳道（引擎子代理快照 + side-channel 归一成泳道行，turn 在飞时 5s 轮询） |
| 可观测与遥测 | traces、usage、notifications、debug、media | 轨迹、用量、活动通知、agent 状态调试镜像、媒体资产 |
| 知识与资产 | memory、skills、prompts、models、apps、market | 记忆库、技能、prompt 模板、模型选择、应用面板；market（/market）插件与 MCP 市场（MCP server + 插件 + 技能三源合并卡片，marketplace 安装 / 插件启停卸载走真实命令） |
| 连接与扩展 | remote、side-channel、kms、hooks | 远程连接（Tailscale 探测 + iOS daemon 配置 + **SSH 远程开发**:host 注册表/连接表单/活跃会话管理）、侧信道、密钥管理、用户 hooks 配置面板 |
| 入口与平台 | about、mobile、workspaces | 关于页、移动端视图、工作区管理 |

全部路由页面、主壳、会话侧栏、消息流、输入框、配置健康提示和终端页由 `src/logic/` 的绑定接收 `src/contracts/` 契约，并通过 `RendererProvider` 注入 `src/render/` 的默认视图。切片文件目前负责组合尚未迁移的子面板。会话列表与输入框的 TS 逻辑在 `src/logic/`，旧路径提供兼容导出。

## 层内依赖约定

- 切片之间不互相 import 视图；共享 UI 用 `design-system/primitives`，共享状态经 `src/stores/`，Tauri 调用只经 `@/utils/commands/{domain}`（见 [utils/AGENTS.md](../utils/AGENTS.md)）。
- 布局三模式（见规则 1）没有强制目录命名，判定标准是「视图与有状态编排是否分文件」。

## 跨层边界

- 切片对外暴露的只有视图与 hook；跨切片复用一律经 `design-system` / `stores` / `utils/commands` 三个共享面，不走切片直连。

## 层通用规则

1. **三种布局模式**（新切片任选其一，同切片内不混用）：① 同名 Controller——如 `terminal/useTerminalController.ts`、`memory/useMemoryController.ts`、`tasks-board/useTasksBoardController.ts`、`files/useFileDraftController.ts`、`collaboration/useOrchestrationController.ts`、`agents/useAgentsController.ts`、`notifications/useActivityController.ts`；② `hooks/` 子目录——`shell/hooks/`、`sessions/hooks/`；③ 平铺 hook——composer 的 9 个 `useXxx` 加 `slashCommands.ts` / `slashEngine.ts` / `dispatchSubmission.ts`。
2. **新切片落点链（本篇独有契约，缺一不可）**：
   1. 建 `src/features/<slice>/` 目录（视图 + 就近测试 + 同名 module.css）；
   2. `src/router.tsx` 三处接线：import 视图 → `new Route(` → 挂入 `rootRoute.addChildren([...])`；
   3. `src/utils/i18n/strings/<domain>.ts` 新建文案模块并在 `strings/index.ts` import + merge（挂载机制见 [utils/AGENTS.md](../utils/AGENTS.md)）；
   4. 视觉基线：`tests/visual/__baselines__/{linux,macos,windows}/` 补 `<route>--{dark,light}.png`（路由 × 双主题，数量以基线目录为准）；
   5. 带测试——`tests/views.untested-slices.test.tsx` 为零就地测试视图（about/apps/debug/dictation/home/mobile/models/prompts/skills）提供行为级兜底，新切片不要进这份清单。
3. **同名 Composer 分叉澄清**：`features/composer/Composer.tsx` 是编辑器运行时规范实现；`features/messages/Composer.tsx` 是一行薄 re-export（`export { Composer } from '@/features/composer/Composer'`）。二者同名不同物，改编辑器行为只动前者。
4. **既有切片 README**：sessions / design-system / threads 三 slices 自带 README，进这些切片先读（链接见文末）；其余切片以本篇与根 AGENTS.md 为准。

## 深入阅读

- [sessions/README.md](sessions/README.md) / [design-system/README.md](design-system/README.md) / [threads/README.md](threads/README.md) —— 既有切片自述
- [../AGENTS.md](../AGENTS.md) —— src 层篇（组合根、路由锚点、事件桥、类型分工）
- [docs/gui/00-index.md](../../docs/gui/00-index.md) —— GUI 设计历史与决策记录
- [docs/codebase-map.md](../../docs/codebase-map.md) —— 全仓任务路径映射
