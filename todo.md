# ZhuYe-Desktop · 剩余工作清单

> 基线:`develop` @ 84213e3。F50 已落地子项:prompt_guard UI(GuardStatsCard + 注入徽标)、
> ThinkingDelta 分条渲染、ContextGauge、配置健康横幅 + doctor --drill 探活、SCM 消息-文件
> 联动、HTML 预览升级(LivePorts 端口发现)、多会话 Dashboard、审批卡增强(risk 徽标 +
> RejectForSession never-again)、OS 通知。本文件记录未落地子项与验证欠账。

## 一、F50 未落地子项(按 todolist 原文)

- [ ] **外部 agent 入口**:引擎侧 F28 external 已有(`zhuye-subagent::external`),桌面 UI 未接。
- [ ] **queue scheduler UI**:审批/工具队列的优先级调整与重排界面(引擎 queue.rs 已支持)。
- [ ] **secrets GUI**:凭据/密钥管理界面(设置页仅有 env 字段编辑)。
- [ ] **小模型后台任务面**:分类/摘要/起标题路由给便宜小模型的任务管理界面。
- [ ] **桌面功能插件化**:功能面插件注册机制。
- [ ] **menubar**:系统菜单栏(macOS NSMenu / 平台等价物)。
- [ ] **WASM 能力**:客户端侧 WASM 扩展点。
- [ ] **性能矩阵完整基线**:`desktop.performance` 全门类基线采集。
- [ ] **D1 完整版受控浏览器**:iframe JS 水合(当前 HtmlPreviewView 为静态预览轻版,
      见 `gap-docs/remote-dependent-features.md`)。

## 二、验证欠账

- [ ] **src-tauri 全量 cargo test 复跑**:mock-provider 场景二修复(84213e3)后,
      全量中仍余 1 个 FAILED 未定位(单测/集成各自均绿,疑似并行构建负载 flaky)——
      需复跑定位并修复,这是 master todolist F50 步骤 3「标准门禁全绿」的最后一项。
      已确认绿:vitest 1655、L1 26、场景二专项。
- [ ] **desktop.visual 视觉基线 / tauri-driver e2e**:多路由 × 双主题截图基线,
      按 AGENTS.md 要求提交前至少完整跑过一次。

## 三、长期约束(非欠账,持续遵守)

- `zhuye-agent/` submodule 只读;引擎改动回 ZhuYe 仓库,升级指针与适配代码同一提交。
- IPC 四方契约(op-parity / event-parity / payload-sample / fakeBackend)新增命令需同步收录。
