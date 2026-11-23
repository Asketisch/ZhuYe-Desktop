# src/features/ —— 功能切片层

> **何时读我**：新增或改动功能切片（视图组件、控制器/hook、切片样式与就近测试）前先读本篇——切片怎么组织、往哪里接线，在这里。

## 层定位

全部功能切片的宿主，是根 AGENTS.md「开发流程检查表」中「表现层 UI」与「有状态编排 hook」的落地处。每个切片 = 视图组件 + 控制器/hook + 就近测试；样式几乎每组件一个同名 `*.module.css`，颜色一律消费 `src/render/styles/tokens.css` 标记（规则见根 AGENTS.md「约定」）。

## 子区速览（全量登记，以文件系统为准）

| 分组 | 切片 | 一句话职责 / 备注 |
|---|---|---|
| 会话与对话 | **sessions**、**messages**、threads、home | sessions 是会话列表规范切片（v3 harness 侧栏三分区：置顶 + 「工作区」目录分组（组下列各工作区会话，可折叠）+ 「会话」全部平铺（最近活跃倒序）；同一会话渲染两份行 —— 权威 testid `harness-session-*` 在平铺区，分组副本带 `ws-` 前缀，⋯ 菜单与行内重命名框只挂被操作的副本（`menuScope` / `renameScope`）；无消息空会话不进列表；**子代理会话缩进挂父行下：父行标题前折叠 chevron（整块显隐）+ 子会话行点击走 `onSelectSub` → `?sub=<子id>` 只读查看器**），徽标状态在 `SidebarBinding`，`SidebarMenu` 挂窗口层并避开视口边缘与侧栏裁切，渲染层纯展示；归档列表移至 /sessions 页）；messages 渲染聊天流（v3：760px 居中列 + fill 用户气泡 + 无头像直排助手；**工具调用按轮聚合成组**（`ToolGroup`，一行摘要 + 展开后逐条，默认折叠），思考块默认折叠 —— 会话默认只露模型真实输出；**子代理会话只读查看器 `SubagentViewer`**（`render/chat/SubagentSessionViewer` + 本切片绑定：replay 落盘记录构建本地 turns，不 bind 子线程、不动主 store，ChatBinding 按 `?sub` 早退渲染））；threads 线程聚合视图（有 README）；home 入口页（ChatHero 带「火中生羽」Canvas 像素徽记 `ZhuyeEmblem`：四层 224×224 画布（本体/双层辉光/火星）+ bloom 呼吸，移植自 zhunye_pixel_pure_v4.html 设计稿，jsdom 跳过绘制；占位工作区（`.` 等）显示「默认」） |
| 输入运行时 | **composer**、editor、dictation、command-palette | composer（编辑器运行时规范位置，根 AGENTS.md本篇规则 3）：双层嵌套聊天栏 —— 外层 surface 顶栏胶囊行（`ComposerTopBar`：工作区下拉 `WorkspaceMenu` / 分支下拉 `BranchMenu`（脏树走「提交后重试」）/ 添加工作区；右簇运行位置 + worktree 隔离开关，勾选后分支胶囊替换为起点分支选择器 `StartRefPicker`，建树在发送瞬间一次性消费 `worktreeIntent`）；内卡底栏左侧「+」入口菜单（`ComposerPlusMenu`：附件/斜杠/@ 引用/技能/插件/压缩/目标/计划）+ 权限下拉（`PermissionPicker`：工作模式三段 + 审批策略四档，完全访问档转警示色并弹确认）+ 提示词预设 pill（`PromptPicker`：**两级菜单** —— 一级工具名（`prompt_list.groups` 的工具分组）、二级模型变体，单变体组为叶项；无 groups 平铺回退；权限按钮右边，仅空会话显示；选 `/plan` 预设联动下发 `SetPermissionMode(Plan)`，免 EnterPlanMode 确认框），右侧用量环（`ContextUsage`，常驻空环、token 上报后按比例填充，% 收进 tooltip）+ 模型选择器（`ModelPicker`，原生 select 伪装紧凑触发器）+ 思考深度 pill（`EffortPicker`）+ 发送锁定（sendOnEnter 偏好，锁定时 Enter 只换行）+ 圆形发送（语音输入待后端接入后回归，`useDictation` 切片保留）；editor 仅 `diffHunks.ts` 纯 diff 算法（供 editorStore 复用）；dictation 语音输入；command-palette 命令面板 |
| 壳层与弹窗 | **shell**、**design-system**、**modals** | shell：v3 harness 壳（`AppShell.tsx` 组 slots → ShellBinding → `render/shell/AppShell` 纯展示；`DockPanel` 五档调度、`DockResizer` 右 dock 左缘拖拽分隔条（宽度真源在 `stores/shellUi.ts`）、`TerminalDock` 底部 PTY 终端、`InboxPanel` 任务中心、`SettingsHost` 设置页宿主；**会话区右侧常驻工作台列** `session/StatusPanel.tsx`（chatpane 的 flex 右列 300px，可折叠 44px 窄条；段落按需出现：目标(⏱ 计时，**仅 goal 模式显示**，空闲不常驻空段)/计划(→`shellUi.setInspectorTab('plan')`)/进程/上下文容量(总进度+缓存命中率)/凭据池(healthy/total 轮询)；全空时只留面板级空态提示）；`sessionChips/` 内容体（GoalBody/TodoBody 等被状态面板复用）；chips 速控行 `session/SessionDock.tsx`（子代理 / 建议 / 排队 —— 任务/目标已迁移状态面板）；旧 IDE 五窗格保留但壳层不再挂载 StatusBar；会话视图组件树在 `session/` 子目录（SessionDock/StatusPanel/WorkHead/TrajView/ViewRail 等））；design-system（`primitives/` + README）共享组件；modals 由 `index.tsx` 编排全部弹窗 |
| 设置 | **settings** | **全屏两栏设置页**（`render/settings/SettingsPage.module.css` 套件：268px 分组导航 + 圆角内容面板 + 896px 内容列，窄窗口收 68px 图标栏；`SettingsHost` 只管开闭与 Esc）。分区注册表在 `render/settings/SettingsView.tsx`（`GROUPS`）：基础设置（常规 / 外观 / 模型设置 / 远程设备）· Agent 能力（个性化 / 行为与工具 / 记忆 / 子智能体 / 插件 / MCP 服务器 / 技能 / 钩子）· 数据与统计（使用统计 / 高级）—— 14 分区；个性化 = `PersonalizationSection`（用户级 `AGENTS.md`，`zhuye_get/save_user_instructions` 命令，与会话首轮注入同源）；外观 / 常规（通知）已重皮为套件行卡，其余分区内容复用既有 sections/ 与路由页 slots（`SettingsSlots` 嵌入分区，PageShell 壳经 `data-pageshell-*` 属性折叠）；⌘K 分区搜索弹层；「模型组」是**唯一**的模型接入单元，主从布局（`GroupsSection` → `GroupNav` / `GroupDetail` / `GroupModelList` / `GroupAdvancedFields` / `GroupCredentialsEditor`）；纯 TOML 手术在 `src/logic/settings/config/{groups,contextWindows,toml,modelCatalog,schema}.ts`（context_windows 表双形态兼容拆在 `contextWindows.ts`）；应用状态同步检查表（根 AGENTS.md）的 UI 端 |
| 工作台 | files、terminal、git、preview、browser、import | files：页面视图 + 右 dock 紧凑档 `FilesDock`（懒加载树 + git 徽标 + 代码预览）；terminal 交互终端（页面视图 + 壳层 `TerminalDock` 底部面板双形态）；git 面板、预览、browser 受控浏览器（页面视图 screencast + dock 档 `BrowserDock` 带 CDP 导航）、会话导入 |
| 多 agent 与任务 | agents、squad、collaboration、tasks-board、autopilot、plan、schedule、lanes | subagent 编排、小队、协作通道、任务看板、自动驾驶、计划审批、定时任务；plan —— 计划正文是 markdown，**正文由右侧面板渲染**（Inspector「计划」tab 用共享 `Markdown` 组件渲染终稿/草稿，`/plan` 路由页经 slots 注入同一个渲染器），会话里不再倾泻 markdown 原文（计划类工具的 args 折叠为提示文案）；lanes（/lanes）子代理并行执行泳道（引擎子代理快照 + side-channel 归一成泳道行，turn 在飞时 5s 轮询） |
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
5. **缓存命中率分两个口径（v1.x）**：工作台 `session/StatusPanel.tsx` 与 `shell/Inspector.tsx` 显示的是**本回合**口径（`logic/usage/cacheHitRate.ts` 的 `useTurnCacheHitRate`，读 store 的 `tokens.turn`），右侧用量面板 `usage/UsageDock.tsx` 与 `/usage` 页显示的是**会话级**口径（后端 `zhuye_session_stats`）—— 两个标签各标各的（`statusPanel.cacheHit` / `usage.turnCacheHitRate` vs `usage.cacheHitRate`），不要用一个标签混指两个口径。命中率一律钳到 `[0, 100%]`。检查器的 Token 构成条四段**互斥**（未缓存提示词 = `input − 缓存命中 − 缓存写入`），别把 `input` 与缓存分段直接相加。

## 深入阅读

- [sessions/README.md](sessions/README.md) / [design-system/README.md](design-system/README.md) / [threads/README.md](threads/README.md) —— 既有切片自述
- [../AGENTS.md](../AGENTS.md) —— src 层篇（组合根、路由锚点、事件桥、类型分工）
- [docs/gui/00-index.md](../../docs/gui/00-index.md) —— GUI 设计历史与决策记录
- [docs/codebase-map.md](../../docs/codebase-map.md) —— 全仓任务路径映射
