# 更新日志

ReflectDesktop 的所有重要变更均记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/)，版本号遵守[语义化版本](https://semver.org/)。

## 未发布

### 新增 — GUI 质量维度:a11y 审计 / 性能预算 / 错误边界 / 配置兼容 / 产物深度

- **axe 可访问性审计**(`tests/a11y.route-matrix.test.tsx`,与路由矩阵共享
  `helpers/routeMatrix.ts`):34 条路由逐挂 axe-core,serious/critical 违规
  为零(jsdom 无布局,`color-contrast` 留给视觉回归层)。审计直接抓出并
  修复 **7 处产品 a11y 缺陷**:
  - 无可访问名称的 `<select>` ×5 —— 设置页语言下拉、plans 的 provider /
    quotaVia、collaboration 的流水线团队、design-system 演示下拉
    (补 `aria-label`);
  - 任务视图的视图切换 SegmentedControl 选项为纯图标(lucide SVG 无名)
    —— 原语新增 `ariaLabel` 选项,调用点补齐(新增 i18n 键
    `tasks.viewList` / `tasks.viewBoard`);
  - autopilot 的最大并发数字输入无 label(补 `aria-label`)。
- **模态键盘可达性**(`tests/a11y.keyboard.test.tsx`):Tab 焦点陷阱
  (连按不逃出 dialog)、Escape 的**线上回执**(审批弹窗必须回发
  `deny{reason:"dismissed"}`、plan 弹窗必须回发 `revise` —— 关闭不是
  单纯 UI 消失,agent 在等回执)、堆叠模态只有栈顶响应。
- **性能预算(冒烟级)**:前端 `perf.budgets.test.tsx`(reduceEvent 1 万
  delta / bucketSessions 5k 会话 / 2k 记录会话水合渲染)+ 后端
  `ipc_perf_budgets.rs`(500 条 rollout 的索引 / 5k 行记录回放)。
  阈值宽(防数量级回归),`PERF_STRICT=1` 收紧供性能迭代用。
- **视图渲染错误边界(产品改动)**:此前 `src/` 没有任何 ErrorBoundary,
  任一视图 render 抛错 = 整树白屏只能重启。新增
  `ViewErrorBoundary`(类组件 + `resetKey` 路由切换复位 + Retry)包住
  `<Outlet />` —— 崩溃被限制在主内容区,侧栏/状态栏存活;
  `errors.boundary.test.tsx` 用真实视图崩溃路径(KMS `tags:null`)锁定。
- **配置向前兼容**(`ipc_config_compat.rs` + `tests/fixtures/config/`
  四份夹具):最小 / 旧版本全量 / 未知键 / 当前全量,各自以独立子进程
  全新启动(= 升级后旧配置文件)—— 已知键生效、未知键不致命、agent
  存活。实测确认:进程内直接写配置文件**不会**热重载(`get_config` 读
  内存快照),故必须走子进程路径。
- **宿主壳层单测**(`menu.rs` 内嵌):自定义菜单 id ↔ 常量表 ↔ 事件分支
  对齐自检(新增菜单项忘了接分支立即暴露,而不是落进 `_ => debug!`
  静默兜底);mock runtime 上逐 id 驱动 `handle_menu_event`,恰好发出
  对应 `menu-*` 事件。顺带移除死常量 `MENU_MINIMIZE`。dock / 全局快捷键
  为平台运行时绑定(AppKit 主线程 / 插件),无纯逻辑可单测,降级语义由
  既有 ipc 用例覆盖(见 COVERAGE §4 备案)。
- **产物审查深度扩展**(`tests/artifact/run.sh`):.deb 从「含可执行文件」
  升级为解包校验(usr/bin 可执行 + `.desktop` 含 Exec + 图标 + control
  Version == package.json);.AppImage 解包验 AppRun + .desktop;.msi 从
  「非空」升级为管理映像解包(exe 存在 + ProductVersion);新增启动冒烟
  (二进制 8-10s 内不崩,退出码 124=被超时杀=正常)—— 本机默认关
  (会弹真窗口),`CI=1` 或 `ARTIFACT_LAUNCH_SMOKE=1` 启用。
- **CI**:clippy 矩阵加入 `windows-latest`(Windows 编译面)。Rust test
  矩阵**有意**不加 Windows —— 夹具靠 HOME 隔离,Windows 的
  `dirs::home_dir()` 走 USERPROFILE,跑测试会污染真实用户目录
  (COVERAGE §4 备案)。

### 修复 — 配置兼容审计发现的线格式漂移(第 4 处)

- `reflect_kms_list_pages`:真后端返回 `Vec<Page>` **对象数组**,前端按
  `ReflectPage[]` 消费,而 fakeBackend 一直返回**文件名字符串** —— 即
  L2 从来没有任何测试在 /kms 点开过 wiki(一点开 `page.tags.map` 就崩,
  这次恰好成为错误边界测试的真实崩溃路径)。fake 对齐为对象数组,往返
  契约补 `kms_list_pages` 对(22 对);按实际行为对齐 `name` 带 `.md`
  后缀(app-core `Page.name` 的文档注释写「不含 .md」,与行为相悖,
  待上游修正)。

### 新增 — 假模型全链路 / 并发不变量 / 重启恢复:三个零覆盖维度闭合

- **`src-tauri/tests/ipc_mock_provider.rs`** —— 「有模型的完整一轮」首次
  在自动层确定性跑通:wiremock 在本机起假 Anthropic 网关
  (`[anthropic].base_url` 指向它,离线),真后端 + 真 AgentThread +
  真 HTTP/SSE 解析。四个场景顺序执行(共享 AgentThread,interrupt 是
  全局的):
  - 纯文本回复:delta 按 submission id 配对累积 + `token_count`
    (来自 SSE usage)+ `turn_complete`;
  - bash 工具调用:`prompt` 审批模式下的 `approval_request`(完整参数在
    `kind.args`)→ `reflect_tool_approval` 放行 → 工具真实执行 → 第二跳
    请求携带 `tool_result` → 最终回复;断言恰好两次 HTTP 请求、自定义
    base_url 走 `Authorization: Bearer`(第三方网关兼容分支);
  - HTTP 500:`error` 事件走同一 `reflect_event` 通道;随后提交仍被受理
    (循环不卡死;凭证进入冷却是诚实结果);
  - 流中 interrupt:25s 延迟回复被取消 —— 收尾有两条竞态路径
    (`error` code=CANCELLED 或 `turn_aborted` user_interrupt),任一即
    通过;中断后零 delta;随后提交仍被受理。
  顺带确认并记录核心的既定语义:异常取消(error/cancel)走「静默丢弃
  分支」,即 **error 之后没有 turn 终态事件**(`submission_loop.rs` 注释
  明示)—— 前端靠 `stream_error`/`error` 自行收尾,与
  `errors.resilience` 测试的口径一致。
  夹具配套:`common::set_config_before_install()`(在 AgentThread 安装前
  注入自定义 config.toml)。
- **`src-tauri/tests/ipc_concurrency.rs`** —— 并行 IPC 下的不变量:
  32 线程混合只读命令全 Ok;16 并发 submit + 交错 interrupt 全受理、
  事后 agent 仍响应;8 并发 `upsert_mcp_server`(**不持** state_lock)
  后 config.toml 仍为合法 TOML、不死锁 —— 「并发丢更新」按
  `tests/COVERAGE.md` §4 已知口径不在断言范围,盯的是写坏文件/卡死。
- **`src-tauri/tests/ipc_restart.rs`** —— 「退出 → 重启」恢复:子进程
  重执行两阶段(`current_exe --exact` + `REFLECT_TEST_HOME` 共享同一份
  `~/.reflect`),阶段一写配置/记忆/白名单/agent 定义/squad/任务/工作区
  后进程退出,阶段二以全新 app 逐项读回。夹具配套:
  `REFLECT_TEST_HOME` 覆盖隔离基目录;默认 config.toml 改为**仅在不存在
  时写入**(不再覆盖阶段一留下的状态)。定时任务不在此列 ——
  `add_schedule` 当前为内存态(持久化留后续,见 `src-tauri/Cargo.toml`
  注释),重启后为空是已知口径。
- **往返契约口径修正**:effort 对移出 `roundtrips.json`(它是
  AgentConfig 内存态而非持久化状态,启动期 MCP bootstrap 完成时的重配置
  会复位它,与持久化语义无关);新增 `pollMs` 轮询选项(Op 类命令异步
  生效,紧读会竞态);config 对固定表尾(save 触发 ConfigWatcher
  热重载,会重置 agent 内存态)。

### 新增 — 跨运行时线格式契约:同一份样本,同时喂 fakeBackend 与真后端

参数形状的漂移(历史实例:allowlist 的 `entries` vs `prefixes`)此前只能靠
人眼发现 —— L2 全部前端测试跑在 fakeBackend 上,模拟层走样时测试照常全绿。

- **`tests/contracts/payloads.json`** —— 185 条注册命令逐条一份**真后端可
  反序列化**的参数样本(顶层键 camelCase,嵌套结构按各自 serde 规则;
  `${TMP}` 占位符由运行方替换)。副作用命令(截屏 / 电脑操控 / …,与
  COVERAGE §3 同源)样本同样存在,但 L3 不投喂真后端 —— 跳过清单放在
  契约文件里,避免字面量混进 `.rs` 被 L1 的覆盖棘轮误计。
- **三层消费同一份样本**:L1 新增 `payload-sample-complete`(注册表 ↔
  样本表双向无差集);L2 `tests/ipc.payload-contract.test.ts`(fakeBackend
  必须接受真后端形状、调用参数完整回放);L3
  `src-tauri/tests/ipc_payload_contract.rs`(真后端逐条反序列化 —— 业务
  错误可接受,`invalid args` 类不行;含探测器自检:历史漂移形状必须被
  识别、业务错误不得误判)。
- **`tests/contracts/roundtrips.json`** —— 21 对「写 → 读」持久化往返,
  同一份表双端跑(L2 `ipc.roundtrip-contract.test.ts` / L3
  `ipc_roundtrip_contract.rs`)。参数形状对齐只能保证「收得下」,往返保证
  「存得对」—— 一个返回固定 fixture 的无状态桩会立刻露馅。
- **fakeBackend 从无状态桩升级为有状态(14 处)**:MCP 服务器 / 权限规则 /
  子代理 spec / 流水线配置 / KMS wiki 与页面 / autopilot / 远程配置 /
  effort / 活跃 agent / 文件写读 / 按名读取(agent def / squad / team),
  以及 allowlist 完整语义(trim / 去重 / 字典序 / 前缀匹配)。
- **韧性不变量**:`ipc_events.rs` 新增「转发器在 `RecvError::Lagged` 之后
  必须存活」—— 容量 4 的 broadcast 通道 + 单线程 runtime 确定性触发
  `AGENTS.md` 明文的这条宿主不变量(慢订阅者撑爆通道后,转发器只记日志
  不退出;破了前端会静默永久收不到事件)。
- **i18n 渲染级检查**:路由矩阵 34 条路由在 zh-CN 下再挂载一遍,断言页面
  出现中文且**无裸 i18n key** —— 目录奇偶校验测不到「组件传了不存在的
  key」(`t()` 对缺失 key 的回退就是返回 key 本身)。

### 修复 — 往返契约发现的线格式生产 bug(remote / autopilot camelCase)

- 后端 `RemoteConfigSnapshot` / `TailscaleStatus` 都是
  `#[serde(rename_all = "camelCase")]`,线上字段是 `authToken` /
  `autoConnect` / `isReady` / `dnsName` / `tailnetName` / `suggestedRemoteHost`;
  而前端接口与 `RemoteView` 读的是 snake_case —— 生产环境这些字段**永远是
  undefined**(就绪徽标永不亮、autoConnect 恒显示「否」),且
  `reflect_update_remote_config` 发出的 snake_case 键被 Tauri 当缺参
  **静默丢弃**。`RemoteView.test.tsx` 自己的 mock 用了同样的错误形状,
  所以一直是绿的。前端(`src/utils/commands/remote.ts` /
  `useRemoteController.ts` / `RemoteView.tsx` 及其测试)与 fakeBackend
  全部对齐 camelCase;`docs/PROTOCOL_BRIDGE.md` remote 行同步修正。
- fakeBackend 的 `reflect_get_autopilot_config` 返回 `{enabled, max_turns}`,
  而真后端(与前端 `autopilot.ts` 声明)是 camelCase 的
  `{enabled, schedule, taskTemplate, agent, maxConcurrent}` —— 同批修正。
- `reflect_kms_create` 对重名 wiki:fake 静默覆盖、真后端报错 —— fake
  对齐为报错。`reflect_read_file` 的 fake 补齐 `size` / `binary` 字段。

### 新增 — 发布门禁:分层严格功能测试脚本(对标 submodule 的严格测试标准)

发布阶段此前**没有**统一的功能审查入口:`pnpm test` 的后端是**模拟**的
(`tests/helpers/fakeBackend.ts` 实现了全部 IPC 命令),真后端的命令体
只在零散的单元测试里被碰到。模拟后端的 bug 会把真后端的 bug 遮住 ——
与 submodule「能力覆盖层不经过任何 SDK」是同一个道理。

本轮按 submodule `reflect-agent/tests/` 的标准建了一套**分层发布门禁**:

- **`tests/run_all.sh`** —— 唯一门禁入口,退出码 0 = 允许发布。四个分层
  可单跑:`static` / `frontend` / `backend` / `artifact`。逐套件结果落盘
  `.test-results/`,并汇总成发布审查报告 `.test-results/release-review.md`
  (含逐用例明细与分层结论)。
- **`tests/lib.sh`** —— 公共助手:隔离环境(mktemp HOME + 独立 cwd)、
  便携超时(macOS 无 coreutils `timeout`)、断言助手、用例统计与失败汇总。
- **L1 静态审查层**(`tests/static/`)—— 源码级**全量**交叉比对(不是抽样):
  命令面四方一致(后端实现 ↔ `lib.rs` 注册表 ↔ 前端包装)、路由↔视图文件、
  i18n 命名空间↔barrel、版本号四处一致、CHANGELOG 与能力矩阵新鲜度、
  仓库卫生、调试残留、硬编码密钥、生产文件大小预算。
  两项**棘轮**检查(协议文档覆盖率 / 文件大小预算)与
  `tests/static/baseline.json` 比对 —— 新增违规立即失败,存量逐步偿还。
- **L2 前端行为层**(`tests/frontend/`)—— `tsc --noEmit` + vitest 全量。
- **L3 真后端能力覆盖层**(`tests/backend/` + `src-tauri/tests/ipc_*.rs`)——
  **本轮的关键新增**。用 `tauri::test` 的 mock runtime 建 app,挂上
  **生产同一份** `generate_handler!` 注册表,以 `InvokeRequest` 注入 JSON
  负载驱动**真实命令体**。不经前端 `invoke` 包装,不经 `fakeBackend`。
  四个文件覆盖 60+ 条命令域:核心域 / 工作区域 / 领域管理域 / Agent 生命周期
  (4 文件 / 91 个测试)。
  另新增 `src-tauri/tests/ipc_events.rs`(4 个测试)覆盖**事件回传通路** ——
  这是「UI 点一下 → 命令 → agent → 事件回前端」链路的最后一环,验的是
  `AGENTS.md` 里写死的三条协议不变量:信封 `{ id, msg }`、`msg.type` 判别子、
  生命周期事件的 `id == ""`(`EVENT_ID_NONE`)、per-turn 事件与
  `Submission.id` 的配对、以及**失败也走同一条通道**。这三条破了不会报错,
  只会让前端静默地不更新 —— 正是最该被门禁盯住的那类。
  夹具把 `HOME`、`REFLECT_HOME` 与 **cwd** 全部沙箱化到进程专属临时目录 ——
  不污染开发者的 `~/.reflect`,也不往仓库里写 `.reflect/`。
  **真后端 185 条 `reflect_*` 命令中,能力覆盖层直接驱动 179 条(96.8%)**;
  余下 6 条(截屏 / 电脑操控 / 在文件管理器里打开目录 / 启停 tailscale
  守护进程 / cargo audit)在 `tests/COVERAGE.md` §3 逐条说明排除理由。
  该覆盖数是**棘轮**项(L1 静态审查盯住)—— 删用例而不改文档会失败。
- **L4 发布产物审查层**(`tests/artifact/`)—— 审**真要发出去的那个包**:
  `.app` 结构、`Info.plist` 必备键与版本一致性、前端资源确实嵌进了二进制、
  bundle 内无 `.DS_Store` / sourcemap / node_modules 残留、macOS 签名成立。
- **`tests/COVERAGE.md`** —— 发布审查口径:每个能力域由哪层验、后端真伪、
  以及**显式排除**的命令与逐条理由(原生对话框 / 截屏 / 电脑操控 /
  启停系统守护进程 / 需真模型的编排 / 依赖外网的 provider 探测 …)。
  排除必须有理由,不允许「没顾上」。

### 变更 — 后端命令面与 runtime 解耦(为能力覆盖层让路)

- `src-tauri/src/lib.rs` 新增 `configure<R: Runtime>()` —— 把命令注册表
  (`generate_handler!`)、托管状态、插件、窗口事件钩子收敛到**唯一入口**,
  生产 `run()` 与能力覆盖层测试**共用同一份注册表**。此前测试若自己维护
  一份命令清单,两份清单迟早分叉,「命令已接线」就成了自说自话。
- `src-tauri/src/events.rs` 的 `forward_agent_events` 同样泛型化为
  `R: Runtime` —— 它只做「读 broadcast → emit 到 app」,没有任何 Wry 专属
  行为,写死 Wry 就等于把**链路的最后一环**(agent 事件 → 前端
  `reflect_event` 通道)排除在自动测试之外。
- 4 条命令不再把 `tauri::AppHandle` 当参数(`reflect_set_dock_badge` /
  `reflect_run_shell` / `reflect_pick_workspace_folder` / `reflect_pick_file`)。
  `AppHandle` 等于 `AppHandle<Wry>`,与 runtime 绑死 —— 那几条命令**只能**
  注册到 Wry builder 上,mock runtime 装不下整张注册表,真命令体也就驱不动。
  应用句柄改由托管状态持有(`MinimalAgent::set_app_handle` / `app_handle`),
  生产 setup 注入一次。**线格式不变**(`AppHandle` 本来就不是前端传的参数),
  无原生 runtime 时这些命令走「无句柄」分支:降级但**不崩**。
- `ping` 命令体移到 `src-tauri/src/commands/health.rs` —— 单独成模块才能
  `pub`(命令宏需 `#[macro_export]` 到 crate 根,定义在 crate 根会与导出位置冲突)。
- `.github/workflows/release.yml`:新增 **gate** job(出包前跑
  `tests/run_all.sh static frontend backend`),build job 依赖它;并在出包后
  追加**产物审查**步骤(审刚打出来的包)。顺带修了一个真 bug ——
  build job 的 checkout **漏了 `submodules: recursive`**,核心 crate 全在
  `reflect-agent/` 里,缺了就编不过。
- `.github/workflows/ci.yml`:新增 `static-audit` job —— 每次 push/PR 都跑
  静态审查层,挡住接线漂移(秒级,不拖慢 CI)。

### 修复 — 能力覆盖层发现的问题

- `tests/helpers/fakeBackend.ts` 的 `reflect_save_allowlist` 用 `entries` 键,
  而**真后端**用 `prefixes`(前端 `src/utils/commands/allowlist.ts` 用的是
  `prefixes`,正确)。模拟层与真后端不一致 —— 这正是能力覆盖层存在的意义。
- **10 处 clippy 拒绝项**(本仓库自有 crate,此前被 `app-core` 的编译失败
  挡住而未暴露):
  - `app-core/src/pipeline.rs` —— `let...else` 改写为 `?`;
  - `src-tauri/src/commands/mcp.rs` ×2 / `plugins.rs` —— 「同类型转换」
    (`map_err(CommandError::from)` → 直接 `?`);
  - `src-tauri/src/commands/tasks.rs` ×3 / `state/subagents.rs` —— 冗余闭包
    (`map(|x| Arc::new(x))` → `map(Arc::new)`);
  - `src-tauri/src/commands/runtime_status.rs` —— 复杂类型抽成
    `ProviderSection<'a>` 类型别名;
  - `src-tauri/src/commands/skills.rs` —— 文档列表项缩进
    (`clippy::doc_lazy_continuation`)。
  这些此前会让 `cargo clippy --workspace --all-targets` 失败 —— 也就是
  仓库自己的 CI clippy job 一直是红的。发布门禁把它显式化了。
- **测试替身漏了一条命令** —— `tests/helpers/fakeBackend.ts` 没有实现
  `reflect_set_dock_badge`(前端 `src/utils/notify.ts` 在待办数变化时会
  调它)。之所以没人发现:契约测试提取后端命令名时只扫 `pub async fn`,
  **同步命令整个漏掉**(全仓只有 `reflect_set_dock_badge` 一条同步命令)。
  已补上替身实现,并把提取正则改成 `pub (?:async )?fn`;L1 静态审查新增
  「测试替身实现了全部已注册命令」一项,让第四方一致性也进发布门禁。

### 修复 — 文档与产物卫生

- `docs/codebase-map.md` / `AGENTS.md` 增补发布门禁入口与分层说明。
- `tests/README.md` 重写为「发布门禁 + 应用级套件」两部分,给出分层模型、
  能力覆盖层的实现原理与运行方式。
- **门禁自身的三个漏洞**:
  - 套件**一条用例都没产出**时,原来算「通过」—— 套件自己坏了(提前退出 /
    忘了写用例)门禁也照样放行。现在判为失败。
  - 整层**跳过**(如本地没构建产物时的产物审查层)原来在报告里显示
    「✅ 通过」,读报告的人会以为审过了。现在显示「⏭ 跳过」,结论里
    明写「N 层未真正审过」;跳过**不**阻断本地跑(发布流水线里用
    `ARTIFACT_REQUIRED=1` 让它硬失败)。
  - 夹具 `harness()` 返回互斥锁守卫,攥着它再调 `invoke()` 会**死锁**
    (自己写探针时踩到)。新增 `common::listen()` 助手(内部加锁、调用即释放),
    并在 `harness()` 文档里写明这个坑。
- **发布审查报告进入发布流水线** —— `release.yml` 的 gate job 用
  `if: always()` 上传 `release-review` 报告与逐层日志(**失败时最需要看它**),
  release job 把它与安装包一起挂到 GitHub Release 上:评审者一眼能看到
  「这批包审过没有、审了什么」。

### 新增 — 核心能力覆盖审计:把「harness 基座的能力」真正在 GUI 里用起来、看起来

此前的工作止于**协议对齐**(Op/EventMsg 有对应命令与类型),但基座的
能力面远大于此 —— 大量能力在 GUI 里既用不到也看不到。本轮以
`docs/CAPABILITIES.md`(核心能力 → GUI 覆盖矩阵)为纲,闭合其中六块:

- **权限层接线(安全行为分叉修复)** —— CLI 装了三层权限 store
  (`config.toml [permissions]` > `<workspace>/.reflect/permissions.toml` >
  `~/.reflect/permissions.toml`),桌面端**根本没挂**
  `AgentConfig::with_permission_resolver`(`reflect-permissions` 在
  `src-tauri/Cargo.toml` 声明却从未使用):同一份配置在 CLI 里生效的
  `deny` 规则,在桌面端被静默忽略。现按 CLI(`reflect-exec` 的
  `apply_permission_layers`)同构装配(`state/permissions.rs`),
  并新增 `reflect_list_permission_rules` + Settings → Permissions
  分节的「生效的权限规则」列表(只读,按匹配顺序展示)。
- **Skills 列表与运行时对齐** —— 桌面端手写的扫描器扫的是 `cwd`
  而运行时扫 `<workspace>`,且**漏掉** `merge_bundled` 的内置技能:
  GUI 列出的技能少于 agent 实际能激活的。改用核心的
  `reflect_skills::{scan_skills_dirs, bundled_skills}`,目录与合并
  语义与运行时逐行一致;DTO 补 `bundled` / `whenPaths` / `version` /
  `body` / `pluginId`,UI 加「内置」徽标与路径自动激活条件。
- **会话笔记只读面** —— agent 经 `AddSessionNoteTool` 写进
  `<notes_home>/session-notes/<thread_id>.jsonl` 的持久结论,此前
  **只有写、没有读**。新增 `reflect_list_session_notes` /
  `reflect_list_note_sessions` + Memory 视图的「会话笔记」面板。
- **Span 日志(trace 树)** —— Traces 视图此前只读 model-io,从不读
  span 日志:turn → model → tool 的父子链、耗时归因、`reflect_goal`
  事件全部不可见。新增 `app-core::traces::{list_span_logs,
  read_span_log}`(含树深度推导,父链缺失/成环均有防护)+
  `reflect_list_span_logs` / `reflect_read_span_log` + Traces 视图
  「Span 树」页。
- **OS 沙箱有效状态** —— 设置页有 `[sandbox].os_level` 开关,却看不到
  实际是否在 Seatbelt / Landlock 里跑。新增 `reflect_sandbox_status`
  + 状态栏徽标。(口径后由下方「OS 沙箱开关真正生效」重做)
- **OS 沙箱开关真正生效(此前是死旋钮)** —— `[sandbox].os_level` 是 GUI 里
  唯一一个**写了不生效**的安全开关:核心的 OS 沙箱有三条来源(配置 /
  协议 `sandbox_policy` / env `REFLECT_SANDBOX_OS_LEVEL`),桌面端此前
  **一条都没接** → `ctx.os_sandbox` 恒为 `None` → BashTool 走
  `OsSandbox::from_env()` → env 未设置时**默认开启** → 配置写 `false`
  也没用,状态栏显示的还是 env 推导值。CLI 侧同样如此(桥接只处理
  `true`,`false` 分支落空)—— 该旋钮在**两个前端**都是死的。
  - `app-core/src/sandbox.rs`(新,纯函数):原始 TOML 里
    `[sandbox].os_level` 是否显式写过 → **没表态走核心基线(开启)**,
    显式值原样;env 优先于配置(与核心 CLI 注释一致)。
  - 每轮提交时在 `Op::UserInput.thread_settings.sandbox_policy` 盖策略
    (开 → `OsSandbox`,关 → `WorkspaceOnly`;核心映射为
    `ctx.os_sandbox`)→ **前台 bash 与后台 bash 同时生效**,配置改动
    下一轮即生效。走协议通道而非改进程 env(Rust 2024 下
    `std::env::set_var` 是 `unsafe`,多线程进程改 env 有 UB 风险),
    且**无条件覆盖**客户端传来的策略(沙箱是安全设置)。
  - 状态口径重做:改用与工具同一个构造器 `OsSandbox::with_enabled`,
    新增 `enabled` / `envOverride` 字段 —— 用户用 env 覆盖时在 tooltip
    里如实标注,否则「拨开关看不到变化」会被当成 bug。
  - 上游残留建议:核心 `SandboxSection::os_level` 应为 `Option<bool>`
    (现在是 `bool` + `#[serde(default)]`,「没写」与「写了 false」在
    核心侧不可区分);桌面端已用「原始 TOML 是否含该 key」侧补齐。
- **Token 计算做深(模型级用量 + 计价可解释)** ——
  - store 侧:`TokenSnapshot` 增 `byModel`(会话内**按模型**累计)与
    `sessionTotal`(真实会话累计 —— 此前「累计 tokens」实为单次值);
    切会话时一并清空(否则 Inspector 的「按模型」挂着上个会话的行)。
  - Inspector:token 段增「模型」行 + 「按模型（会话累计）」子区块;
    「累计 tokens」改用 `sessionTotal`。
  - `/usage` 视图:新增「实时（本次会话）」与「费率」两个区块。
  - `app-core/src/pricing.rs`:用 4 次合成用量**反解**核心静态费率表
    (`price()` 对 usage 线性)得每模型输入/输出/缓存读/缓存写单价 ——
    唯一事实源仍是核心的表,桌面端不持第二份,表更新后 GUI 自动跟随。
  - 逐次压缩明细:`CompactionStats` 增 `records`(封顶 50 条),Inspector
    增可展开的明细列表(此前只有一行 hover 摘要)。
  - 提示词生效正文:`reflect_get_effective_prompt` 返回当前模型经
    `reflect_prompt::library().resolve(spec)` 解析后的 section 正文,
    PromptLayersModal 按需展开 —— 模型真正吃到的那段提示词。
- **活跃 agent 接线(GUI 的 Agents 视图此前是死胡同)** —— 核心按
  **名字**找 agent 定义(CLI 用 `--agent`,缺省 `"default"`),桌面端却
  **硬编码 `"desktop"`**,导致两个后果:(1) 用户在 GUI 的 Agents 视图
  创建/编辑的 agent 定义,运行时**永远不加载**;(2) 记忆文件路径由
  agent 名派生,GUI 写 `agent-memory/reflect/`、运行时读
  `agent-memory/<agent>/` —— **GUI 里编辑的记忆,agent 根本读不到**。
  修复:新增 `src-tauri/src/agent_state.rs`(活跃 agent 名存桌面端
  偏好 `~/.reflect/desktop.json`,缺省 `"default"` 与 CLI 一致);线程
  构造改用该名;记忆路径改经**核心的 `reflect_memory::resolve_path`**
  解析(与运行时 pre_loop 注入逐字一致);旧版 `agent-memory/reflect/`
  数据在启动时一次性迁移(目标存在则不覆盖);新增
  `reflect_get_active_agent` / `reflect_set_active_agent`(切换后
  replay 历史并强制重绑,与 provider 热重载同款语义),Agents 视图新增
  「当前活跃」卡片 + 逐条「设为活跃」按钮,Memory 视图新增提示:agent
  未声明 `memory` 作用域时写入内容不会被注入 system prompt。
  另加不变量测试:GUI 记忆路径 == 核心 `resolve_path` 结果。
- **LSP 诊断(Problems)** —— LSP 开着、文件也预热了,但编译/检查器反馈
  **一条都看不到**:诊断只进了 core 的 `DiagnosticRegistry` 被动缓存。
  新增 `reflect_lsp_diagnostics(path)`(读 core 的
  `LspConnectionManager::diagnostics()`,与核心 `LspTool` 同款「只读被动
  缓存」语义),`LspStatus` 增诊断聚合,Files 视图编辑区下方新增
  **Problems 面板**(当前文件的诊断,随打开轮询)。
- **任务产出 / 停止 / 释放** —— 任务板此前只能看到 subject / 状态 /
  认领人,**看不到 worker 产出了什么**,也停不下卡住的 worker。新增三个
  命令,语义与核心工具**同款**(守卫在命令层):`reflect_get_task_output`
  (读任务 `output_path`,不阻塞)、`reflect_stop_task`(守卫
  `in_progress`,退回 pending + 清 owner)、`reflect_release_task`
  (守卫存在 `claimed_by`,退回 pending + 清 claimed_by/claimed_at)。
  任务板行内加「详情 / 停止 / 释放」+ **详情抽屉**(描述 + 产出路径 +
  产出内容)。
- **MCP 服务管理(扩展机制的自助入口)** —— MCP 是基座最主要的扩展机制,
  但 GUI 此前**只能观测**:加一个 server 必须手改 `config.toml` 的
  `[mcp_servers.<name>]`(Collaboration 视图空态原话就是「Add an
  `[mcp_servers.<name>]` section in Settings → Advanced」)。新增 4 个命令:
  `reflect_list_mcp_servers`(配置 + 运行状态)、`reflect_mcp_catalog`
  (核心内置的**精选 catalog**,离线清单 + 安装提示,解决「我不知道能装
  哪些」)、`reflect_upsert_mcp_server` / `reflect_delete_mcp_server`
  (改内存 config → 经**核心 `mcp_server_configs()` 编译校验**(非法配置
  不落盘)→ 落盘 → 运行时起停 + 注册/反注册其工具)。运行时起停复用
  `mcp::start_one_server` / `stop_one_server`,与启动时的 `bootstrap_mcp`
  同款路径(含 `McpToolInvoked` 事件通道)。Collaboration 视图新增
  **McpManager 面板**:已配置列表(运行状态 + 失败原因 + 删除)、新增表单
  (stdio command+args / http+sse url)、精选 catalog 一键加入。
- **插件管理** —— GUI 此前只能看到插件带来的 **slash 命令**:装了什么、
  哪个加载失败、启用哪些、marketplace 有哪些全部不可见;启停只能手改
  `config.toml` 的 `[plugins] enabled_plugins`,卸载只能手改
  `installed_plugins.json`。新增 `reflect_list_plugins`(已装 + 是否启用,
  启用态与运行时挂载集合同源)、`reflect_list_marketplaces`、
  `reflect_toggle_plugin`(改 config → 落盘 → 核心 `reload_plugins`
  diff 同步,挂/卸不打断会话)、`reflect_uninstall_plugin` /
  `reflect_install_plugin`(经核心 `PluginManager`,含 manifest 校验)。
  Collaboration 视图新增 **PluginsPanel**(启停开关 + 卸载 + marketplace
  + 本地安装表单,目录选择器复用既有的 `reflect_pick_workspace_folder`)。
- **工具注册表补齐(agent 侧「能不能用」的关键缺口)** —— 桌面端此前只注册
  **15 个基础工具**,缺三族:① 任务工具(`reflect_task::register_task_tools`)
  —— GUI 建的 task,agent **既看不到也改不了**,任务板对 agent 是单向的;
  ② 会话笔记工具(`AddSessionNoteTool`)—— agent 写不了笔记,本次新增的
  笔记读取面**永远是空的**;③ 子代理 `call_<role>` 工具 —— agent 无法
  委派子任务,Inspector 的子代理区块**永远是空的**。CLI 三族都注册
  (`reflect-exec` 的 `bootstrap_m5` + `headless.rs`),两个前端能力不一致。
  新增 `state/subagents.rs`:任务工具进程级注册、笔记工具每会话注册
  (store 路径含 thread id)、子代理按 CLI 口径合并 spec(TOML >
  workspace md > home md > 硬编码 explorer)并把 `call_<role>` 补进
  always-on 可见集(否则模型请求里没有子代理 schema,LLM 永远无法委派)。
- **运行时状态可观测(S 级批量)** —— 四项基座有、GUI 完全看不到的「系统此刻
  怎么了」,补齐只读面:① **凭证池健康度**
  (`reflect_credential_pool_status` → Inspector;核心的 cooldown 集合是私有
  字段,用 `healthy_clients()` 的健康集合反推「总数 − 健康 = 冷却中」,冷却
  **原因**在核心内不公开故不编造);② **已完成的子代理调用**
  (`reflect_recovery_state` → Inspector;读 core 的 `SubagentRegistry` 快照,
  回答「agent 刚才派了哪些子代理、结论是什么」);③ **记忆分段**
  (`reflect_memory_sections` → Memory 视图;用 core 的 `split_sections` 按
  `## ` 切分 + 注入预算占用 —— GUI 此前显示整份原文,而 agent 实际吃的是
  切分 + 筛选后的条目);④ **配置位置与分析健康度**
  (`reflect_config_info` → Settings 侧栏顶部;手改 config.toml 的用户终于
  知道应用读的是哪个文件)。
  AST 语言网格**有意不接**:核心的 grammar 由 `lang-*` feature 编译,桌面端
  未启用任何 grammar → 列表恒为空,启用会把 tree-sitter 语法包拉进桌面
  构建(独立的构建决策,非接线缺口)。
- **又一批能力面** —— ① **worktree 状态**(`reflect_list_worktrees` → Git
  视图;核心的 worktree 状态在 `ToolContext` 里读不到,但 worktree 文件系统
  可见 —— `git worktree list --porcelain` + 核心 `worktree_dirty` 判脏,
  标出 `isolated` 与 **`stranded`**(隔离 + 有未提交改动 → 改动还没落回
  主分支,丢工风险));② **MCP 资源 / prompt**
  (`reflect_list_mcp_resources` / `_prompts` → McpManager;三大原语里此前
  只有 tools 对用户可达,现直接问 rmcp peer,与核心 `ListMcp*Tool` 同源);
  ③ **子代理 spec**(`reflect_list/get/save/delete_subagent_spec` → Agents
  视图新增页签;与 agent 定义是两套东西,此前 `call_<role>` 工具的来源
  **无任何编辑面**,现按运行时同款口径合并(TOML > workspace md > home md
  > 硬编码 explorer),编辑器改原始 md,写前由后端 `parse_subagent_str` 校验);
  ④ **BM25 搜索**(`reflect_search_files` 增 `rank` 参数 → Search 视图;
  复用核心 `reflect_tools::bm25::{tokenize, rank_lines}`,`k1=1.2`/`b=0.75`
  与核心 grep 工具逐字一致);⑤ **Hook 事件类型**
  (`reflect_list_hook_events` → Hooks 视图;此前只列 name/kind/enabled,
  用户不知道能在哪些时机挂 hook、能做什么决策,现列出 12 个事件 + 可用决策)。
- **Pipeline 配置编辑** —— 此前 GUI 只能**跑**一个已有的 TOML 文件(还得
  手写),新增拓扑只能靠「手改文件 + 跑失败才知道写错了」。新增
  `reflect_validate_pipeline`(校验走核心 `Pipeline::from_toml`,与**实际运行
  同一条路径**;结构摘要只读顶层 `nodes` 表,不复刻核心 schema)、
  `reflect_list_pipeline_configs` / `reflect_save_pipeline_config`
  (落盘 `~/.reflect/pipelines/<name>.toml`,**写前先校验,非法不落盘**)。
  Collaboration 视图新增 Pipeline 编辑器(TOML 文本框 + 防抖实时校验 +
  节点徽标 + 缺 team 提示 + 保存)。
- **安全扫描** —— 审计初稿把核心的 `reflect_integration::security_scan`
  标为「上游 stub」,**核实后是错的**:它是**真实实现**(`cargo audit`、
  30s 超时、管道排空、IO 错误落结构化报告而非 panic)。新增
  `reflect_run_security_scan`(阻塞调用放 `spawn_blocking`,不占住 async
  worker)+ Settings → Advanced 的「安全扫描」卡片。
- **审计结论修正**:① `reflect-integration` 的安全扫描**不是** stub;② 核心的
  `TodoWriteTool` **工具本身是实装的**(占位的只是它的 `manager` 字段 ——
  上游注释「Phase 1 不用,仅占位避免破坏 register_all 签名」指该字段)。
- **agent 的 todo 清单(`TodoWrite`)** —— 核心把清单写进
  `ToolOutput.metadata.todos`(`{ content, status, activeForm }`,整体覆盖
  语义),此前 GUI **完全看不到**。现由 reducer 在 `tool_call_end` 分支按
  `toolName === 'TodoWrite'` 提取到 `AgentState.todos`,Inspector「概览」新增
  Todo 清单面板(完成数 / 总数徽标 + 每项状态徽标 + 已完成项删除线)。
  纯前端接线,零后端改动。
  > 注:核心 `TodoRow` 带 `rename_all = "camelCase"` → 线上字段是
  > **`activeForm`** 而非 `active_form`;reducer 同时接受两种写法。
- **能力覆盖矩阵文档** —— 新增 `docs/CAPABILITIES.md`:基座 30+ 能力族
  逐项标注 ✅ / 🟡 / ❌ / ⛔,含本轮闭合项的根因说明,以及剩余 1 项
  (**需上游变更**:todo 清单**只出不进** —— 基座无消费方,清单没回灌
  模型上下文,LLM 写完即忘)。
  缺口(按用户感知价值排序、含落点与规模估计)与 2 项需上游 API 变更的
  说明(`GoalController` 无公开 `GoalState` 读取口;todo 清单回灌需上游
  reducer)。
  > 原先并列的「`[sandbox].os_level` 语义差」已由本批次的「OS 沙箱开关
  > 真正生效」在**桌面端闭环**,不再是缺口。
- **反向审计:「有命令无界面」的三处漏网** —— 换成矩阵自己的判定标准
  (「命令存在 + 前端有消费面」两项都满足)去扫**全部** 182 个后端命令
  与 114 个前端包装,而不再只问「基座有什么没接」。
  - 扫描结论:**零死命令**;12 个前端包装无界面消费,逐个核实后分三类
    (详见 `docs/CAPABILITIES.md` §3.20 的分类表)。
  - **Markdown 转录导出有入口了** —— 命令面板新增「导出当前会话(Markdown)」
    (核心 `to_markdown` + 用量小节)。此前 GUI 只能导出 JSON 原始记录,
    核心的 `to_markdown` 能力**完全用不到**。
  - **更新检查有界面了** —— 新建 `src/features/settings/sections/UpdatesSection.tsx`
    (正是 `AGENTS.md` 同步检查表点名的路径,此前**文件不存在**):当前版本、
    点按探测、「已是最新 / 有新版 vX」徽标、发布说明、发布页链接;探测失败
    **如实展示** `error`。顺带把后端 `UpdateInfo` 的 DTO 改成 camelCase
    (桌面端出线约定,此前是 snake_case)。
  - **两条「有类型无渲染」的事件接上了** —— reducer 里 `plan_step` 与
    `plugin_loaded` 的分支原本是 `return {}`(注释写着「TODO:接入 plan
    步骤 UI」/「TODO:展示到 plugins panel」):**事件在流里,界面上什么
    都不发生**。
    - `plan_step` → reducer 按 `index` 就地更新或追加(与核心 TUI 语义
      同构),Plan 视图新增「执行进度」清单。此前 agent 执行已批准的 plan
      时**执行到哪一步完全不可见**(GUI 只在审批前展示 plan 正文)。
    - `plugin_loaded` → reducer 记 `store.loadedPlugins`(进程级),Plugins
      面板新增「运行时已挂载」列表。此前只能从**配置**反推「装了什么」,
      看不到**运行时真正挂载了什么**。
  - **协议文档过期订正** —— `docs/PROTOCOL_BRIDGE.md` 的事件表此前漏登
    `plan_draft_updated` / `plan_step` / `plugin_loaded` 三个事件,段落
    计数停在升级前(Lifecycle 5→7、Plan 5→7,新增 §3.12 Plugin / Quota);
    能力矩阵的「43/43 EventMsg」也过期 —— 实际是 **45/45**(逐条核对)。
  - **团队可建可改可删** —— §3.20 反向审计里唯一一个还属于**基座能力**
    的缺口。核心 `TaskManager::upsert_team` / `delete_team` 早已实现
    (存储 `~/.reflect/teams/<name>.json`,与 CLI/TUI 共享),GUI 却只能
    在列表选择器里点一下切到某个 team —— 想加团队只能**手写 JSON**。
    任务板头部新增「团队」按钮 → 团队管理面板(列出 / 新建 / 编辑 /
    删除 + 成员增删行)。口径与核心对齐:`lead_agent_id` 前端按
    `team-lead@<name>` 推导(核心会校验,不该让用户手填必然量)、名字规则
    `[a-z0-9_-]{1,64}` 与核心 `validate_team_name` 一致。顺带订正 TS 侧
    把 `created_at` / `joined_at` 标成 `number | string` 的类型错误 ——
    核心 `SystemTime` 的 JSON 形态是 `{ secs_since_epoch, nanos_since_epoch }`。
  - **「始终允许这条命令」写进核心权限层(消灭第二套真值)** —— 桌面端
    原本有一套私有的 `~/.reflect/approval_allowlist.json`(前缀匹配),
    后端注释描述的「审批弹窗勾选 Always allow」流程**从未在 GUI 存在**。
    但核心 `reflect-permissions` 已是同一件事的正规实现,且真值唯一
    (CLI/GUI 共用)、**写完即生效**(核心 resolver 每次评估都重读文件)、
    可见(Settings → Permissions 列表实时显示)—— 所以本轮**没有**再接
    一套机制,而是把审批弹窗的「始终允许」直接写进核心的用户级权限文件。
    授权范围刻意保守:Bash = **整条命令**精确匹配(不用「首词 + 通配」,
    那会顺带放行 `rm` / `curl|sh`);只读工具 = 整个工具;**写类工具不给
    按钮**(核心规则模型没有路径维度,放行整个写工具等于一次性打开
    AcceptEdits)。
- 审计结论(有意不接线的项):`Op::RegisterTools` /
  `Op::ToolExecutionResponse` / `EventMsg::ToolExecutionRequest` 为
  serve 模式 SDK 远程工具专用(文档已记录);`reflect notes` 经 M4
  bootstrap 自动装配(工具面已通);CLI `doctor` / `security audit`
  为维护工具,GUI 由 health / About 覆盖。

### 新增 — submodule 能力全量接线收尾:traces / discussion / pipeline + 协议类型对齐

对照 submodule 全部 crate 能力面(protocol Op / EventMsg 全变体 + CLI
`reflect` 子命令)审计 GUI 接线状态,补齐最后三块未接线能力与一处协议
类型漂移:

- **Traces(模型调用记录)**:新增 `reflect_list_traces` /
  `reflect_get_trace` 命令(`app-core/src/traces.rs` 只读包装
  `reflect-telemetry` 的 model-io JSONL,支持前 8 字符前缀定位)+
  `/traces` 路由的 TracesView(session 摘要列表 + 逐条调用详情:
  模型 / 耗时 / 来源 / token 用量 / 脱敏请求响应)。CLI
  `reflect traces ls / show` 的 GUI 对应。
- **多 agent 讨论**:新增 `reflect_list_discussions` /
  `reflect_run_discussion`(`app-core/src/discussion.rs` 重组
  `reflect-discussion` 的 LLM 组装,provider 不可用降级 `run_noop`,
  与 CLI 同语义)。运行期间 Collab* 事件经 `event_sink` 桥进
  session broadcast —— 前端 collab_* reducer(此前为死代码路径)
  实时渲染,`agent store` 的 `collabSessions` 状态首次有了 UI 消费方。
  Collaboration 视图新增「多智能体讨论」区(历史列表 + TOML 配置
  选择 + 运行 + transcript 展示),替换原「后续阶段添加」占位卡。
- **DAG 流水线**:新增 `reflect_run_team_pipeline` /
  `reflect_run_pipeline`(`app-core/src/pipeline.rs`,registry 从配置
  引导、`REFLECT_MODEL=mock` 可离线跑通)。team 预设四阶段
  (plan → prd → exec → verify)+ TOML DAG 两条入口,与 Squad 视图
  共享 `~/.reflect/tasks|teams/` 存储。Collaboration 视图新增
  「团队流水线」区。
- **`reflect_pick_file`**:原生文件选择框(`tauri-plugin-dialog`
  Rust API,扩展名白名单过滤),discussion / pipeline 的 TOML 配置入口。
- **协议类型对齐**:Rust `EventMsg` 的 `submission_closed` 变体补进
  TS `EventMsgType` / `EventMsgByType`(此前手动同步漂移;reducer 补
  no-op case 保穷尽性守卫)。Desktop 内嵌线程不发该事件(serve SDK
  专用),纯类型完整性修复。
- 审计结论(有意不接线的项):`Op::RegisterTools` /
  `Op::ToolExecutionResponse` / `EventMsg::ToolExecutionRequest` 为
  serve 模式 SDK 远程工具专用(文档已记录);`reflect notes` 经 M4
  bootstrap 自动装配(工具面已通);CLI `doctor` / `security audit`
  为维护工具,GUI 由 health / About 覆盖。
- 测试:app-core 新增 traces / discussion / pipeline 单测(81 通过);
  前端新增 TracesView / CollaborationView 编排区测试 + fakeBackend
  新命令 handler + 路由矩阵条目(1009 通过);Rust 132 通过。
- 文档:`PROTOCOL_BRIDGE.md` §2.0 命令表(七条新命令)+ §3 事件表
  (`submission_closed`)同步。

### 新增 — submodule v1.6.1 接线:提示词层 + 模型级 token 统计

submodule `af0483b → e4bc182`(12 个提交)引入 v1.6.1 提示词层外置、
模型级 token 统计与记忆访问审计。本次把这些能力接到 GUI:

- **提示词层(`/prompt`)**:`Op::PromptCommand { action }` 是新增 Op 变体
  (协议内联判别联合 `PromptAction::List` / `PromptAction::Switch`)——
  按 AGENTS.md 的「所有 Op 变体 → Tauri 命令」不变量,新增
  `reflect_prompt_command`(`commands/prompts.rs`)+ 前端 IPC 包装
  (`utils/commands/prompts.ts`)。应答事件 `EventMsg::PromptList` /
  `EventMsg::PromptSwitched` 补进 TS `EventMsgType` / `EventMsgByType`
  + reducer(写 `store.prompt`,**进程级** —— 提示词库不随会话切换重置)。
  新增 `PromptLayersModal`(展示当前模型 / 生效层 / 可用层 + 「重新扫描」
  按钮),`/prompt` slash 展开它;重扫应答按协议约定弹「提示词已刷新」toast。
- **模型级 token 统计**:新增 `reflect_session_stats` /
  `reflect_all_model_usage`(`app-core/src/stats.rs` 只读包装
  `reflect-rollout` 的 `session_stats` / `all_model_usage`,与 CLI
  `reflect session stats` 同源,桌面端不复刻聚合)。新 `/usage` 视图
  (当前会话统计 + 按模型拆分表 + 全部会话合计),`/usage` slash 路由到
  该视图,ActivityBar 加「用量」入口。
- **`TokenCountEvent.model`**:协议新增模型级字段(本轮命中的模型 spec),
  TS `TokenCountPayload` / `TokenSnapshot` 同步(reducer 落 `model`,
  旧引擎不上报 → `null`)。
- **记忆访问审计 + 压缩 token 前后量**:协议 `RolloutRecord` 新增
  `MemoryAccess` 变体,`Compaction` 新增 `before_tokens` /
  `after_tokens`,`TokenCount` 新增 `model` / `provider`。Markdown 导出
  (`reflect_export_session_markdown`)据此补齐:记忆读写审计行、压缩前后
  token 与节省量、文末「Usage」段(复用 `app_core::stats` 的规范聚合)。
  `SessionStats` 相应暴露 `memoryReads` / `memoryWrites` /
  `compactionTokensSaved`,在 `/usage` 视图展示。
- **`AgentDefinition.source`(v1.6)**:协议新增 `source: SystemPromptSource`
  (`custom` / `builtin_default`)—— 决定 system prompt 用用户 md 原文
  还是按模型从提示词库解析 `system.main`。前端 `ReflectAgentDef` 同步该
  字段;桌面端 agent 文件的 frontmatter **不写** `source`(上游 parser 对
  文件来源强制 `Custom`,写了也会被覆盖),`BuiltinDefault` 只属引擎自带
  的默认 agent。
- **编译断裂修复**:新增协议变体打破了两处穷尽匹配 —— `state/activity.rs`
  的 `EventMsg` match(补 `PromptList` / `PromptSwitched`)与
  `commands/export.rs` 的 `RolloutRecord` match(补 `MemoryAccess`)。
- **子模块指针**:`reflect-agent` → `e4bc182`。
- 测试:app-core 新增 stats 聚合单测(3 通过);`commands/export.rs` 抽出
  纯渲染函数并补 6 条单测(记忆审计 / 压缩 token / Usage 段);前端新增
  reducer 用例(`prompt_list` / `prompt_switched` / `token_count.model`)+
  slash 用例(`/prompt` → `prompt_list`、`/usage` → `open_usage`)+
  UsageView / PromptLayersModal 视图测试 + fakeBackend 新命令 handler +
  路由矩阵 `/usage` 条目。Rust 149 通过,前端 1023 通过。
- 文档:`PROTOCOL_BRIDGE.md` §2.0 命令表(三条新命令)+ §3.2
  (`token_count.model`)+ 新增 §3.11 提示词层事件表同步。
- 审计结论(本轮新增的有意不接线项):
  - `reflect_protocol::bash_command`(`BASH_COMMAND_KEYS` /
    `resolve_bash_command` / `split_shell_segments`)是 BashTool 参数解析
    与 `reflect-permissions` shell_pattern 匹配之间的**内部契约**,
    桌面端不解析 Bash 工具参数、不做 shell 权限匹配 —— 由引擎承担。
  - `reflect_protocol::text`(`truncate_chars` 等)是 Rust 侧按字符边界
    截断的工具函数;桌面端的截断在 TS 侧(`String.slice` 本身按 UTF-16
    码元安全),不重复实现。
  - `reflect_telemetry` 的 `list_span_log_files` / `read_span_log_file`
    (span 日志)目前**无 CLI / GUI 对应面**(CLI `reflect traces` 只读
    model-io),桌面端 Traces 视图与 CLI 保持同口径;span 读取面留待
    后续有明确用户需求时再接。
  - `reflect::ReflectBuilder::with_telemetry` 不适用 —— 桌面端内嵌
    `reflect_core::AgentThread`(经 `MinimalAgent`),不走 `ReflectBuilder`。

### 新增 — 插件系统接线(v1.x):`[plugins]` 挂载 + `/plugin:*` 命令展开

子模块 `f7a8f24 → b359883`(插件运行时自 reflect-exec 下沉为
`reflect-plugin` 独立 crate)后,GUI 侧完成与 exec/serve 同构的接线
(`src-tauri/src/state/plugins.rs`):

- **插件挂载**:真实会话 rebind 时异步挂载 enabled 插件的五类能力
  (skills / agents / MCP servers / slash 命令 / hooks),挂载与线程同寿
  —— 每次 `construct_thread` 卸旧装新(`plugin_mount_lock` 串行化,
  后完成者赢);占位线程不挂载。插件 agents 能力经最小 `SubAgentFactory`
  (不注册内置子代理 spec)挂载;插件 MCP server 用挂载级专用 manager
  (lifecycle 事件 v1 暂不透传前端)。`PluginLoaded` 事件经 session
  broadcast 透传。
- **命令展开**:`reflect_submit` 投递前对 `Op::UserInput` 首个 Text 条目
  做 `/plugin:ns:name args` 展开(命中 → 命令正文 + `Submission.
  source_command` 标注;未命中透传;命令文件读取失败报错给前端,消息
  不投递)。steer 与其他 Op 不展开(与 exec submit 边界一致)。
- **配置热重载**:设置保存时 `[plugins] enabled_plugins` 变更走轻量
  diff 同步(不动线程);provider 栈变更触发的 rebind 全量重挂。
- **插件 MCP lifecycle 透传**:插件 server 的 Started/Failed 复用
  `mcp::spawn_mcp_lifecycle_forwarder` 推 session broadcast,前端与
  用户 MCP 同通道可见。
- **Composer 斜杠菜单**:新增 `reflect_list_plugin_commands` 命令 +
  `usePluginCommands` hook(Composer 挂载即重取),已挂载插件的命令
  追加进弹层候选(展示 frontmatter description);引擎对插件命令
  **直通提交**(内置命令优先,插件不可劫持内置语义),展开仍由后端
  submit 边界统一做 —— 前端保持无命令文件 IO。未挂载时与未知命令
  同路径 reject,提示真实。
- **自动受益的上游修复**(无需 GUI 改动):plan 审批信号回传
  (`plan_approved` 事件真正发出,PlanReadyModal 关闭链路打通)、
  bash seatbelt/Landlock 修复、skills always-on 修复、goal 模式 spec
  回退修复。
- 已知 v1 边界:插件管理 UI(marketplace 安装/启停)留后续批次。
- 文档:`PROTOCOL_BRIDGE.md` §2 命令表 + §3 Submission 信封
  (`source_command`)同步。

### 变更 — reflect-agent 子模块升级(v1.4 批次)+ steer / 子代理可观测全链路接线

子模块 `31c6e72 → f7a8f24`(本地 2 个与远端同补丁的重复提交已对齐为
上游改写后的历史,合并冲突就地消解)。升级适配与接线:

- **工作区清单**:根 `Cargo.toml` 镜像新增 `reflect-bm25`(自
  reflect-tools 抽离的叶 crate)、`tiktoken-rs`、`pyo3`;`reqwest` 对齐
  上游补 `gzip` feature(workspace 继承以外层声明为准,缺失会静默丢
  gzip 解压)。
- **新事件(3)**:`tool_call_output_delta`(工具输出流式增量,reducer
  no-op 保穷尽)、`subagent_progress` / `subagent_status`(子代理可观测
  双通道);前端 `src/types/protocol/event.ts` 类型补全。
- **新 Op(2)接线**:`reflect_steer` / `reflect_query_subagents`
  (`commands/agent.rs` + IPC 包装)。
  - **Steer 真实化**:Composer「转向」模式从「中断 + 重发」升级为
    v1.4 A2 真·转向 —— 不打断当前 run,消息经 `Op::Steer` 进转向队列,
    下一个 pre_loop 安全点注入;纯文本按 `now`(用户中途说话),带附件
    按 `attachment`(参考资料)。引擎注入不发协议事件(仅落
    recorder),`store.steer` 乐观渲染插话;steer 失败按引用回滚乐观项。
  - **子代理面板**:Inspector 概览新增子代理区块 —— `subagent_progress`
    滚动 feed(封顶 200 条)+ `subagent_status` 状态快照(角色/状态/
    迭代数/token);turn 收尾且出现过子代理活动时自动刷新快照,亦可
    手动刷新。会话切换(hydrate/clear/reset)复位。
- 文档:`PROTOCOL_BRIDGE.md` §2 / §3.3 / §3.10 / §6 同步。

### 修复 — `/goal` 在首页输入后「什么都没发生」（未建会话、无反馈、goal 被静默丢弃）

core 的 `EnterGoalMode` 只做一件事：构造 `GoalController` 挂入当前线程
（每轮 turn 结束自校验,未完成则 steering 续作）—— **不启动 turn、不建
会话**。GUI 旧实现把它原样提交：在首页（无任何绑定会话）输入 `/goal`
时,goal 挂到 install 时的幽灵线程上 —— 无会话创建、无消息、无 toast;
切进任何会话时 rebind 重建线程,挂载的 goal 又被静默丢弃。

新契约（GUI 语义：`/goal <描述>` = **开目标会话**）：

- **会话守卫**：新增 `useEnsureSession` hook —— 无会话时
  `reflect_create_session` + 路由切换,并轮询 `loadedSessionId` 等
  ChatView 的 bind → hydrate 序列完成（提交 op 前必须等绑定,否则 op
  落到 rebind 前的旧线程;超时 10s 显式报错而非静默挂错）。
- **立即启动循环**：arm（`enter_goal_mode`）后**以目标文本为首条消息**
  提交 —— 两个 op 经同一 mpsc 保序,首轮 turn 结束时校验器必然就位,
  agent 立刻开始朝目标工作,循环滚动直到 met/blocked/预算耗尽。
- **可见性**：启动成功 toast（含目标摘要）;Composer 控制条新增
  🎯 goal 徽标（前端投影,会话切换/`/goal clear` 后消失 —— goal 挂在
  线程上,rebind 即丢,协议层尚无 goal 事件,真实状态展示待上游）。
- 斜杠 submission `enter_goal_mode` 更名 `start_goal`（slashEngine →
  dispatchSubmission;Composer 与命令面板两条路径共用同一编排）。
  `/goal clear` 语义不变（ExitGoalMode）。

### 修复 — `[active].credential` 悬空导致每次请求报 ALL_CREDENTIALS_EXHAUSTED (0 tried)

`[active].credential` 指向不存在的凭证 label 时(配置手改 / 凭证改名后残留,
如钉着 `"default"` 而池里只有 `"MiniMax"`),model spec 显式解析链
(env > 钉住条目 > 段级)返回 None → 线程构造静默降级到 `"stub/test"` →
路由池没有 stub provider → **每次对话报
`ALL_CREDENTIALS_EXHAUSTED: all credentials exhausted (0 tried)`**,
而池里明明有可用凭证、额度充足 —— 一个可自愈的配置问题被放大成硬故障。

- **spec 兜底**（`state/agent.rs::resolve_model_spec_with_fallback`）：显式
  解析失败时回退到 active provider 下**第一个带 model 的凭证条目**，与
  `next_for` 对悬空 preferred 的「静默回落轮询」语义对齐。接入线程构造
  （install / thread_factory / 热重载）三处。
- **降级判定同口径**：`compute_degraded_reason` 改用兜底后的结果 —— 有
  可用凭证就不再挂「未配置模型」黄点；真没有任何带 model 的凭证时仍诚实
  降级。
- 彻底解法在上游 `reflect-config::resolve_model`（悬空钉住回落首个凭证），
  待随下次 submodule 升级生效；本修复已让桌面端不再受此配置形态影响。

### 新增 — 基于历史会话 fork 出子会话（支持按轮分叉）

会话列表的 kebab 菜单新增「Fork」入口（侧边栏与 /sessions 全量视图共用）：
点击后内联输入分支名（默认 `manual`，与 CLI 一致），确认即把该会话的完整
历史复制为一个新子会话，并自动切换过去（ChatView 挂载 → bind + replay
即得全部历史，可从 fork 点继续对话）——原会话保持不变。GUI 此前完全没有
fork 入口（CLI 专有 `reflect session fork`）。另外 ChatView 的「正在查看
会话」横幅右侧也加了 Fork 按钮 —— 查看历史对话时一键开分支（默认分支名，
成功后 toast 提示子会话 id 并切换）。

**按轮分叉**：消息流中每个已结束 turn 尾部 hover 出现「从此轮 Fork」按钮
（`turn.id` 即 rollout 的 turn_id）——例如 5 轮对话想从第 2 轮重新开始，
点第 2 轮的按钮即得只含前两轮内容的子会话；分支名自动记为 `fork@<轮次>`
（写入子会话自定义名，列表中可辨 fork 点）。流式中的 turn 不作为 fork 点。

- **后端**：新增命令 `reflect_fork_session`（`commands/sessions.rs`），包装
  core 既有的 `rollout_index::fork_with_history`（子会话继承父 SessionMeta
  model，父文件 append `Fork` 血缘 marker；`up_to_turn_id` 截至某 turn
  含——横幅按钮全量复制传 None，按轮入口传该轮 turn_id），并把分支名写成
  子会话自定义名（`_names`，列表中直接可辨）；同步 IO 包 `spawn_blocking`。
- **前端**：`useSessions` 新增 `fork` mutation（成功后失效会话列表缓存）；
  `SessionItemMenu` 新增 fork 菜单项 + 分支名内联表单（复用 rename 表单
  模式）；`Sidebar` / `ThreadsView` 经 `onFork` 接线，fork 成功后路由切换
  到子会话；`MessageList` 新增 `onForkTurn`（每轮 hover 按钮，ChatView
  下发处理链：fork → toast → 切换子会话）。

### 新增 — 剪贴板图片附件预览 + 原生文件拖拽进对话框

- **原生文件拖拽**：此前 Composer 的拖拽走 DOM `dataTransfer.files` ——
  Tauri 的 WKWebView(macOS) 下 Finder 拖入的文件根本不进该通道，拖拽实际
  不可用。现在经 `getCurrentWebview().onDragDropEvent` 订阅原生拖拽事件
  （`src/utils/dragDrop.ts` 降级封装，非 Tauri 环境回退 DOM drop 兜底）：
  拖悬时输入卡片高亮 + 提示层；图片（png/jpg/jpeg/gif/webp/bmp）经新命令
  `reflect_read_image_base64` 读字节转 data-URL 走 inline image 附件
  （core 的 `LocalImage` item 尚未接通，必须以字节提交），其余文件添加
  真实路径的 file mention（由 agent 的 `/read` 按需读取）。
- **图片缩略图预览**：附件条的 inline image 从文字 chip（`🖼 inline
  (image/png)`）改为真实缩略图（data-URL 直接作 `<img src>`，36px
  圆角 + mime 标签），粘贴 / 选择器 / 拖拽三条管线共用。
- **后端**：新增应用命令 `reflect_read_image_base64`（`commands/files.rs`），
  不做工作区沙盒（拖拽来源任意），扩展名白名单 + 20 MiB 上限防 IPC
  payload 失控。

### 改进 — 工具调用与输出合并同框

工具调用和它的结果此前渲染为两个独立折叠框（调用框 + 「输出」框），视觉
碎片化且调用/结果对应关系要靠位置猜。现在 `MessageList` 把 `tool_call` 与
按 `callId` 配对的 `tool_output` 分组为单个 `ToolCell`：展开后 raw args 在
上、输出在下（带小节标签），edit/write 的 unified diff 用 DiffViewer 内嵌
且**默认展开**（沿用旧独立 diff 框的行为，流式期间 diff 后到也会自动展开）。
无配对调用的孤儿输出（回放数据缺 tool_use 块时）保持原独立折叠框渲染。

### 修复 — 工具调用渲染位置漂移 + Yolo 档切换回弹

- **流式文本分段**：一轮 turn 常含多次模型迭代（文本 → 工具调用 → 文本
  …）。此前 `upsertDelta` / `upsertThinking` 把整轮文本都向**首个**文本
  item 回溯合并，工具调用在视觉上全部被挤到对话流底部、与正文时序错位。
  现在只向**末尾**同类 item 拼接（`finalizeAssistantText` 同口径）：工具
  item 插入后新文本另起气泡，渲染顺序与事件流的真实时序一致。
  （注：历史回放仍只显示落盘的最终 assistant 消息 —— rollout 每轮只记
  `latest_content`，中途工具调用链未持久化，需上游 recorder 改进。）
- **Yolo = bubble**：core v1.3 安全基线把 `SetPermissionMode(Bypass)` 一律
  降级为 Prompt（blanket bypass 不再是合法运行时状态），GUI 的 Yolo 段
  此前仍发 `bypass`，表现为「点 Yolo 自动弹回询问、bash 照样审批」。Yolo
  段改映射 `bubble`（自动批准非高危工具 + 非阻塞气泡通知；高危操作仍强制
  人工确认）。`permission_bubble` 事件从合成 pendingApproval（会渲染成
  无法应答的阻塞 modal）改为 toast 通知。设置 → Permissions 移除 bypass
  卡片，bubble 描述文案同步修正。

### 修复 — 未配置 hooks 时内置 verification hook 污染每个会话

用户只发一句问候，模型却回复大量「收到系统提醒 / 测试失败 / 确认状态」
自检文本（如 `cargo: command not found`）：`[hooks]` 未配置时所有内置
hook 默认全开，其中 verification（Stop hook）对**每个 turn** 无条件跑
`cargo test`；桌面端 Finder 启动没有 `~/.cargo/bin`（或工作区无 Rust
项目）时命令 exit 127，被当成「测试失败」注入假提醒并**否决 turn 完成**，
强迫模型连答数轮。两层修复：

- **GUI 侧（本仓库）**：`thread_factory` 构建 hook 引擎改为**显式启用**
  语义 —— `[hooks]` 未配置 = 不挂任何内置 hook（与 headless serve 的
  `hooks_explicit_only` 同一原则）。需要 hook 的用户在 config 显式写
  `[hooks] enabled = [...]`。
- **上游（Reflect-Agent `31c6e72`）**：verification hook 把 exit 127 /
  spawn 失败 / 信号终止视为「无法验证」→ 放行 + warn 日志，不再与真实
  测试失败（exit ≠ 0）混为一谈；超时仍按失败处理。

### 修复 — FINAL ANSWER 标记泄漏 + 模型思考过程视觉分级

- **思考分段加固**：`splitAssistantText` 的 `<think>` 识别从"任意位置首现"
  收紧为**行首锚定 + 代码围栏感知**（围栏内的 `<think>` 字样是代码内容不
  误判），并支持 `thinking` / `thought` / `reasoning` 别名标签；行文中
  内联出现的 `<think>` 字样保持原文。三类思考路径的归属：Anthropic 原生
  thinking 块与 OpenAI 兼容端点 `reasoning_content` 字段走 ThinkingDelta
  事件（上游已支持）；标签混入正文由本模块拆分；无标签纯文本泄漏原理上
  不可检测，不处理。
- **FINAL ANSWER 标记不再渲染**：系统提示词（所有模式）与 nudge /
  auto-continue 提醒都要求模型以 `FINAL ANSWER:` 收尾，模型（尤其
  MiniMax-M3）会把标记照字面回显到答案里。渲染层在展示前剥离行首标记
  （容忍 `**` / `>` / 列表符修饰）及 `<answer>` 模板占位符行，正文数据
  原样保留。
- **上游配合（Reflect-Agent，随下次 submodule 升级生效）**：运行时没有任何
  代码消费该标记（turn 收尾判定 = 模型不再调工具，ReAct 本就等待自然结束），
  常驻注入系统提示词纯属输出污染 —— 已从 ephemeral 提示词移除；收敛模板
  只保留在真正需要强收口压力的边路（nudge / max-iterations force-final /
  auto-continue）。
- **`<think>` 推理折叠显示**：MiniMax M3 / DeepSeek 系模型把推理以
  `<think>…</think>` 标签混在正文流式输出（而非 Anthropic thinking 块），
  此前按正文渲染。现在渲染层把思考段拆分为独立的可折叠块（复用
  ThinkingDelta 的 thinking 折叠样式），文字用弱化色、与正文视觉分级；
  流式中标签未闭合时整段按思考显示并默认展开，正文出现后自动收起。
  新增纯函数 `splitAssistantText`（`assistantText.ts`）承载拆分逻辑，
  streaming / 定稿 / 会话回放三条路径统一生效。

### 修复 — Coding plan 拉取模型后无法选择

- 设置 → Coding Plans 的模型候选此前用 `<datalist>` 承载：macOS Tauri 的
  WKWebView 对 datalist 建议下拉支持不可靠，拉取成功后没有任何可选入口。
  改为显式 listbox（可滚动、点击即填入、当前值高亮），模型 id 等宽字体
  展示、display_name 与视觉能力标记作次要信息。

### 修复 — coding plan 切换空转 + 凭证钉住 + model 显示诚实化

同 provider 的多个 coding plan（如顶层 stepfun + 凭证 MiniMax，均未配
model）此前在 Composer 下拉切换时**空转回弹**：`reflect_set_model` 只写
`[active].provider` + 段级 model，两个 plan 都不改任何字节 → 热重载跳过 →
选中态兜底链把下拉挤回第一个 plan；同时状态栏在未配置任何模型时展示
编造的 `anthropic/claude-3-5-sonnet-latest`（实际请求也会带着这个编造
模型名打向第三方端点）。本次随 Reflect-Agent `2a1ea42` 全面修复：

- **上游（Reflect-Agent）**：`[active]` 新增 `credential` 钉住字段，
  `CredentialConfig` 补齐 `model` 条目级字段（GUI 此前写入一直被忽略）；
  `apply_to_registry` 把钉住注册为 registry preferred label —— 钉住条目
  健康则始终优先派位，其余条目仅在其 cooldown 时 failover；
  `resolve_model`（取代 `model_for`）按 env > 钉住条目 model > 段级解析，
  **未显式配置返回 None，不再编造内置默认**；headless 对无 provider /
  无 model 分别 fail-fast 报因。
- **`reflect_set_model(provider, model, label)`**：新增 `label` 参数写
  `[active].credential`；钉住条目时 model 写入条目自身（与 plan 编辑器
  同源），顶层隐式 plan 走段级；钉住 label 不存在时报错而非静默失效。
  同 provider 切 plan 现在真正改变请求路由。
- **选中态单一事实源**：Composer 控制条与 ModelsView 的「当前默认」判定
  改读 `[active].credential`（此前 ModelsView 两个空 model plan 会同时
  被标成默认且按钮全禁用）。
- **诚实显示**：`has_model=false` 时状态栏/Composer 不再展示 `stub/test`
  占位，显示「未配置模型」；install/热重载的降级原因区分「无 provider」
  与「有 provider 但没 model」两级并给出指引。
- 伴生修复：补齐缺失的 i18n key `composer.controls.modelCurrent`；切换到
  无 model 的 plan 时 toast 明示；切换成功后重读配置刷新 plan 列表；
  MCP adapter 接入 upstream `from_descriptor` 的 `event_tx`（工具调用
  事件经 mpsc→broadcast 推前端）；activity 映射补 `SubmissionClosed` 忽略
  分支。

### 移除 — 已完成/过时的历史设计文档

- 删除 `docs/PLAN_FAILOVER.md`：coding plan 多计划配置、默认供应商热切换与
  额度耗尽自动 failover 已全部落地（`src/features/settings/config/plans.ts`、
  `sections/PlansSection.tsx`、`src/features/models/ModelsView.tsx`、
  `src/stores/agent/planFailover.ts`、`src-tauri/src/state/{quota,reload,rebind}.rs`），
  用户可见能力并入 README「功能特性 → Coding Plan 与额度自动切换」；
  `docs/PROTOCOL_BRIDGE.md` / `docs/codebase-map.md` 中的引用改为直接指向代码。
- 删除 `docs/reflect-agent-token-persistence.md`：会话 token/cost 持久化 PR
  已在 Reflect-Agent 上游落地（`RolloutRecord::TokenCount` 变体 + `SessionInfo`
  聚合字段随 submodule 进入本仓库），PR 设计稿使命完成。
- 删除 `docs/REVIEW_LEDGER.md`：2026-07-28 的逐文件审查快照，内容已随后续
  大规模重构过时，按「文档仅保留当前有效状态」的仓库约定移除。

### 移除 — app-core 未接线的 Rust 渲染状态管线（B2 脚手架）

- 删除 `app-core/src/{reducer,protocol,state}` 三个模块（约 1.4k 行）：
  与前端 `src/stores/agent/`（AgentState / reduceEvent / submissions）平行的
  Rust 镜像实现（B2-01 RenderState / B2-08 reducer / B2-03 Op 构造器），
  自创建起从未被 `src-tauri` 接线。渲染主线确定为 TS + Tauri，Rust 镜像
  不再保留。
- app-core 定位收敛为「Tauri 命令层的 UI 无关领域服务」（activity / kms /
  media / squad / side-channel / tailscale / autopilot / actor），同步裁剪
  7 个未使用依赖（reflect-core / llm / hooks / skills / memory /
  permissions / tools）及 uuid / anyhow，更新 crate description。
- 同步修订 AGENTS.md / SUBMODULE.md / docs/codebase-map.md /
  docs/ARCHITECTURE.md 中对 app-core 旧定位（reducer/state 共享层）的描述。

### 变更 — GitHub 开源铺垫批次

仓库身份与元数据：

- **仓库地址统一为 GitHub `Asketisch` 组织**：`Cargo.toml`（repository +
  homepage + rust-version 1.85）、`src-tauri/tauri.conf.json`（identifier
  `com.asketisch.reflectdesktop`、publisher、homepage、copyright）、
  README / SUBMODULE.md / USER_GUIDE / docs 站点中的克隆与链接地址。
  ⚠️ identifier 变更后应用数据目录从
  `~/Library/Application Support/com.cnb.reflectdesktop.app` 变为
  `~/Library/Application Support/com.asketisch.reflectdesktop`，旧目录数据
  需手动迁移。
- **更新检查端点修正**（`commands/update.rs`）：`DEFAULT_UPDATE_URL` 指向
  `Asketisch/ReflectDesktop` 的 GitHub Releases。
- **许可证口径统一为 Apache-2.0**：LICENSE 替换为完整 Apache-2.0 文本；
  README / docs 站点此前误标 MIT 的地方已更正。

开源社区与 CI 配套（对齐 Reflect-Agent / Reflect-TUI）：

- 新增 `.github/workflows/ci.yml`（前端 typecheck+test；Rust fmt/clippy/test，
  ubuntu + macOS 矩阵，递归 checkout submodule）与 `audit.yml`（每周
  cargo-audit，结果上报 Security tab）。
- 警告拒绝策略改为成员 crate 清单级 `[lints]`（`rust.warnings = deny`、
  `clippy.all = deny`）：只约束自有 crate，submodule path 依赖的上游警告
  不阻塞本仓库 CI。
- 自有 crate 全量 `cargo fmt` + clippy 违规清零（约 60 个文件机械格式化；
  修复 deprecated `TempDir::into_path`、`sort_by` → `sort_by_key`、
  `walk_dir` 冗余参数、`Default` 实现等）。
- 新增 `.github/dependabot.yml`（cargo + github-actions 每周一）、
  `SECURITY.md`、`.editorconfig`、`.gitattributes`、`rust-toolchain.toml`。
- 新增英文版 `README.en.md`；README 徽章改为真实 CI / Release / License
  徽章并加中英切换。
- 文档脱敏：内部绝对路径（`/Users/admin/...`）规范为 `~/...`；submodule
  指针说明去除过时分支信息。

### 修复 — 全量代码 review 批次（5 路并行审查,P0/P1 全修 + 高价值 P2）

交互与弹窗：

- **ModalShell 焦点/键盘两处缺陷**：副作用依赖 `onClose`/`primaryAction`
  （调用方均传内联函数）导致每次渲染重跑,把正在输入的 textarea 焦点
  抢回 primary 按钮（AskUserModal 实际不可连续输入）;堆叠弹窗共享
  window keydown,一次 Escape 会同时否决全部待审批。改为副作用只依赖
  `open` + latest-ref 回调,模块级弹窗栈保证只有栈顶响应键盘。
- **全局 toast 队列从未被渲染**：`pushToast` 只入队 `useAgentStore.toasts`,
  全仓无宿主组件消费,git/tasks/设置/导出等失败提示全部静默丢失。
  AppShell 新增 `ToastHost` 统一渲染（`--z-toast` 层级）。
- **editorStore 在 StrictMode 下永久失聪**：cleanup 摘除事件订阅但保留
  `subscribed` 标志,第二次 mount 短路成 no-op,dev 模式下 Files 页的
  agent 编辑 review 永不出现。cleanup 现重置标志（与 agentStore 一致）。
- **提交失败后乐观 turn 永久卡 streaming**：`reflect_submit` reject 时
  turn 无回滚,`selectIsTurnRunning` 恒真 → 队列永不排空,会话假死;
  `drainQueue` 先删队首再提交,失败即丢消息。现在失败落 turn 为
  aborted + 记录 lastError,队列消息放回队首。
- **命令面板 slash 项把字面文本发给模型**：`runSlash('/compact')` 直接
  `submit` 文本,后端不解析 slash,命令既不执行还污染会话历史。抽出
  `composer/dispatchSubmission.ts` 共享管线,面板与 Composer 走同一分发;
  顺带修复 `/rename "x"` 引号剥离。
- **KMS 编辑器永远打不开**：`editingPage` 只被赋 `null`,无法新建/编辑
  页面。「New page」现打开空白编辑器,页面卡片可点击进入编辑;删除
  Wiki 增加 `confirmDialog` 二次确认;搜索加 200ms 防抖。
- **设置页后台 refetch 覆盖未保存编辑**：`staleTime: 0` + 窗口聚焦
  refetch 会无条件覆盖 `rawToml`。增加 seed 基准 + 脏标记,只在缓冲未被
  修改（或刚保存成功）时接受服务端刷新。
- 其余：steer 等待收尾期间切会话的跨会话提交（实时路由比对守卫）、
  ChatView Retry 路径缺过期守卫、`permission_bubble` 同 turn 同工具
  气泡 id 重复（approve 误杀）、notify 的 per-turn Map 在门控拒绝/
  `turn_aborted` 路径泄漏、GitView tab 快速切换乱序覆盖 diff（单调
  请求令牌）、AppShell 快速连点会话的 `setActiveId` 竞态、命令面板
  「清空全部会话」增加二次确认、`!` 直通监听注册失败永久失聪、
  Remote 表单被后台 refetch 重置草稿、终端种子行 seq 与 stdout 冲突
  及信号退出误显示 "exit 0"、composer slash 补全对连字符命令失效、
  `clearSession` 残留上一会话的 token/压缩/路由数据。

IPC 参数契约（Tauri 2 平铺参数按 camelCase 匹配）：

- `reflect_kill_shell`（`session_id`→`sessionId`）、
  `reflect_start_side_channel`（`agent_name`→`agentName`）此前每次调用
  必报 `missing required key`;`reflect_create_task` 的 `active_form`
  （→`activeForm`）被静默丢弃。相关测试/假后端已同步为新契约。

后端安全边界：

- **`resolve_under_workspace` 写路径 `..` 绕过**：目标不存在时
  canonicalize 失败退回原始 join 路径,`starts_with` 词法前缀挡不住
  `ws/../etc/x`,渲染层可借 `reflect_write_file` 写工作区外任意文件。
  现拒绝 `..` 组件并对最深已存在祖先做 canonicalize。
- **KMS 路径穿越**：`reflect_kms_delete/save_page` 等的名字直接
  `root.join(name)`,`name="../../x"` 可对任意目录执行 `remove_dir_all`。
  命令层新增 `validate_kms_name`（拒绝分隔符/`..`/控制字符等）。

后端正确性：

- **会话回放单一事实源**：三日快路径按「今天→昨天→前天」拼接,而写入端
  按首次写入日期分桶,跨午夜会话 replay/preload 乱序;且快路径非空即跳过
  全树兜底,跨 ≥3 天重开的会话历史静默丢失。`replay_session` 改为始终
  全树按时间序拼接;Markdown 导出此前只走快路径（旧会话导出为空稿）,
  JSON/Markdown 导出统一走 `sessions_base()` 同源回放。
- **app-core reducer turn 身份键错配**：`TurnStarted` 存储用 payload 的
  `turn_id`（独立随机 UUID）,后续 per-turn 事件按 event.id（submission id）
  查找,永远 miss → 正文/工具/完成状态全部丢失。统一为 event.id 派生键
  （与 TS 对齐）;`TurnRewound` 按索引截断（v4 UUID 不可字典序比较）;
  `SessionConfigured` 不再用硬编码默认 approval_policy 覆盖
  permission_mode（会冲掉 bind 恢复的模式）;`ContextCompacted` 不再
  写入 Turn.error。
- **shell 会话注册表泄漏**：进程自然退出后条目永不回收（只有 kill 路径
  删除）,map 单调增长、list 返回死 id。stdout reader 在进程终结后回收
  条目（与 kill 竞争幂等）。
- 其余：全局快捷键注册失败降级为日志（不再阻断启动）、tailscale 探测
  两个调用都套超时、memory project 作用域改用活动工作区（原用进程 cwd,
  打包后不可写）且 `remove` 改整行精确匹配（`## a` 不再误删 `## about`）、
  media 尺寸上限 + u64 比例计算（原 u32 乘法可溢出）+ PNG 保留透明通道 +
  组合键失败时释放修饰键（原会 OS 级卡键）、skills 扫描不跟随符号链接
  （原可无限递归 abort）、git 输出统一 `-c core.quotepath=off`
  （中文文件名不再显示为八进制转义、可正常 stage）、KMS `dream` 时间戳
  不再 `unwrap()`。

### 修复 — Coding plan 保存后无法选择/切换模型

- **「保存 Plan」写盘被后端拒绝（根因）**：`reflect_get_config` 返回的
  TOML 由 `toml::to_string_pretty` 序列化,空凭证池被写成段内内联
  `credentials = []`;前端追加 plan 是在文件末尾加 `[[provider.credentials]]`
  块 —— TOML 不允许同一 key 既是普通数组又被数组表扩展,
  `load_from_str` 拒绝整份保存（"Cannot mutate immutable namespace"）。
  凡是配置被应用序列化过一轮的用户,添加 plan 必然失败。修复:
  追加首个块前剥离 `[provider]` 段内的内联 `credentials` 行
  （`credentials` 带 `#[serde(default)]`,删除后缺省合法;其他段的
  内联值不受牵连）。
- **「保存 Plan」只改内存不落盘**：Plans 页的保存 Plan / 删除 /
  设为默认三个操作此前只更新设置页内存中的 TOML 草稿,必须再点页面
  底部「保存到 ~/.reflect/config.toml」才真正写盘 —— 漏点的话后端
  config 从未更新,模型选择器与 Models 页读到的永远是旧配置。
  现在三个操作即时落盘（reflect_save_config → 后端校验 + 热重载
  provider 栈）,失败原因经设置页错误条展示。
- **Models 页「设为默认」只切 provider 不切模型**：同 provider 下的
  多个 plan(如顶层 api_key 隐式 default + 自建的 credentials 条目)
  此前全部被标成「当前默认」且按钮禁用,无法切换;且切换只写
  `[active].provider`,段级模型名不变,实际使用的模型不变。改为按
  plan 粒度判定(provider + 段级模型名一致才算默认),切换走
  `reflect_set_model`(同时写 provider 与模型名,热重载 + 强制重绑)。
- **Composer 模型选择器切换失败静默**：`reflect_set_model` 被后端
  拒绝时此前无任何反馈,现以 toast 展示原因。

### 修复 — 全量 diff review 发现的八处缺陷

- **Files 页 Reject 时序竞态**：单块拒绝后,`invalidateQueries` 的
  refetch 窗口期内 `value` 仍是 agent 版本,CodeMirrorEditor 的
  revision effect 会把刚恢复的缓冲整体替换回旧内容；Reject All 则
  没有任何路径把恢复值写回缓冲 —— 磁盘已恢复但编辑器显示 agent 版本。
  改为拒绝落盘成功后 `setQueryData` 直接写入恢复内容（内容已确定,
  无需等 refetch）。
- **Git staged 语义**：`reflect_git_status` 的 `status` 是 trimmed 的
  porcelain 码,`"M "`（已暂存）与 `" M"`（仅工作区）折叠成同一个
  "M" —— GitView 新增的 staged tab 计数把未暂存修改也计入、列表里
  还混入 untracked 文件。后端 `GitStatusEntry` 新增 `staged: bool`
  （porcelain index 列推导,向后兼容字段）,前端 staged/working 分 tab
  与计数改用该字段判定（`"MM"`/`"AM"` 这类暂存后又改的条目两个 tab
  都出现）。
- **inverse-patch 纯删除 hunk 错位**：纯删除块此前按 `oldStart` 行号
  插回 —— 若先拒绝了更早的 hunk（行号整体漂移）,被删行会插到错误
  位置（静默内容损坏）。改为优先用 hunk 上下文行做内容锚定（与新增
  块同规则）,锚定失败才退化行号;另外多文件 diff 的 `---`/`+++` 文件头
  不再被吞进 hunk。
- **Coding Plans 表单保存**：编辑条目后改名 / 换 provider / 转
  topLevel 保存时,upsert 按"新位置"找不到旧块会**追加重复条目**
  （旧块残留进凭证池）—— 保存前先摘除旧位置的块。`findCredentialBlock`
  的 label 正则此前只认双引号,单引号 label 的条目删除时会 fallthrough
  **误删顶层隐式 default plan 的 api_key**。
- **TOML 往返合法性**：`[context_windows]` 手写 bare 键（`model = …`）
  与写入的 quoted 键构成 duplicate key,整份保存被后端拒绝 —— 写入前
  先删两种形式；数字形字符串（如纯数字 api_key）此前被裸写为 TOML
  整型（serde 拒绝）,`encode` 改为一律加引号；`weight` /
  `window_secs` / `max_tokens`（后端 u32/u64）非数字输入不再拼入
  （weight 回落默认 1,半截 quota 整体不声明）。
- **bind 契约对齐（测试基建）**：fakeBackend 的 `reflect_bind_session`
  未随真实后端改为返回权限模式字符串 —— 测试环境下 ChatView 的
  `syncPermissionMode(undefined)` 会把徽标状态打成 undefined。
- **CodeMirror 语言加载竞态**：快速切换文件时,旧文件的
  `LanguageDescription.load()` 后 resolve 会把新文件的语言高亮覆盖成
  旧语言（补 stale 守卫）。

### 变更 — LSP 按工作区手动开启 + 打开文件才预热

- 此前安装时只要配置了 `[lsp_servers]` 就无条件启动全部语言服务并注入
  `lsp` tool；多项目场景下多份语言服务并发会加重系统负担。现在改为
  **按工作区手动开启**（默认关闭）：Files 页路径栏新增 LSP 开关
  chip，开启提示「agent 的代码理解（定义/引用/诊断）更准确，但会增加
  系统资源占用」；偏好按 workspace 路径持久化（localStorage），切换
  工作区自动恢复。关闭 = 反注册 `lsp` tool + 停掉全部 server——
  未开启时工具集中**不注入** LSP 工具。
- **文件预热（VSCode 式按需索引）**：开启后仅当用户在编辑器里真正
  打开代码文件时才触发 `reflect_lsp_warmup`（`ensure_open` → didOpen，
  server 侧建索引），后续 agent 的 LSP 查询即时可用；未打开的文件
  不预热。LSP 未开启或无匹配 server 时预热静默跳过。
- 新命令 `reflect_lsp_set_enabled` / `reflect_lsp_status` /
  `reflect_lsp_warmup`（`commands/lsp.rs` + `src/utils/commands/lsp.ts`）；
  `MinimalAgent` 新增 `lsp_manager` 常驻句柄，`bootstrap_lsp` 改为
  幂等（重复开启不重复起 server）。

### 新增 — CodeMirror 6 编辑器 + Cursor 式变更确认/拒绝

- **可编辑代码编辑器**：Files 页的只读 prism 预览升级为 CodeMirror 6
  编辑器（行号、历史、主流语言语法高亮经 `@codemirror/language-data`
  动态加载），程序员可直接在工作区文件上编辑。
- **Cursor 式变更 review**：agent 的 edit/write 工具每次修改文件后
  （`tool_call_end` 事件携带 before→after 的 unified diff 与目标 path，
  经 `stores/editorStore.ts` 累计为该文件的 pending 变更），编辑器内
  直接渲染变更区域——新增行绿色背景 + 左侧亮边，被删除的行以红色块
  呈现在新增区域上方（参考 Cursor / void / continue 的 review 视图），
  每块顶部挂 Accept / Reject 悬浮控件，顶栏提供「全部接受 / 全部拒绝」。
  - **Accept**：保留 agent 的修改，清除该块标记；
  - **Reject**：按内容锚定的 inverse-patch 从当前内容重建该块原文
    （`features/editor/diffHunks.ts`，容忍行号漂移；锚点歧义或写盘
    失败则保持 pending 不变并提示），经新命令 `reflect_write_file`
    （工作区沙盒内）写回磁盘。agent 刚编辑过的文件会自动在 Files 页
    聚焦打开，编辑即可 review。

### 新增 — Plan 最大上下文/自动压缩 + 连接测试；舍弃费用展示

- **Plan 最大上下文与自动压缩**：Coding Plans 表单新增「最大上下文
  (tokens)」字段，落盘到 config.toml 官方 `[context_windows]` 段
  （key = plan 的 model 名）——runtime 会把它级联进
  `session_configured.context_window_size`（Inspector 上下文仪表与
  `get_context_remaining` 工具的既有分母），plan 卡片显示 `ctx` 徽标。
  自动压缩（`stores/agent/autoCompact.ts`）：runtime 的压缩触发只认全局
  `[compact].trigger_tokens`、不感知模型窗口，因此 GUI 侧补齐——监听
  `token_count` 事件，已上报输入 tokens 达到 plan 最大上下文的 80% 时
  自动触发 `reflect_compact`（Op::Compact），回落 50% 以下重新武装；
  30s 节流 + 触发闩防连环压缩；Plans 页提供开关（默认开，localStorage
  `reflect.autoCompact`）。
- **连接测试（两种）**：Plans 表单新增「连接测试」区——
  ① **测试连接**：纯 API 测试，拉一次模型列表接口（GET /models，零
  token 消耗），显示连接正常/失败；
  ② **发送测试消息**：新命令 `reflect_test_provider_chat`
  （`commands/models.rs`）发送固定「你好」——单条 user 消息，
  **刻意无 system 提示词、无 tools 定义**，`max_tokens = 32` 压低无效
  消耗，展示模型回复或失败原因。
- **舍弃费用/价格功能**：多数 API 提供商提供缓存服务，按 API 价格推算
  的费用失真。移除 Inspector 的费用行与会话费用指标、StatusBar 费用
  片段、`TokenSnapshot.cost` 字段、`/cost` 斜杠命令、提供商表单的
  输入/输出价格配置字段及相关 i18n。token 用量统计（输入/输出/缓存/
  总量）全部保留。

### 新增 — 模型列表从接入端口拉取 + 图片附件链路修复

- **模型列表拉取**：新增 `reflect_list_provider_models` 命令
  （`commands/models.rs` + `src/utils/commands/models.ts`）：对着
  base_url + api_key 拉取可用模型——`openai` 端口走 `GET {base}/models`
  （Bearer），`anthropic` 端口走 `GET {base}/v1/models`（`x-api-key` +
  `anthropic-version`）。两处 UI 接入：Composer 模型选择器新增拉取按钮
  （⟳），拉到的模型以「接口模型列表」分组进入下拉，选中即
  `reflect_set_model` 切换；Coding Plans 新增/编辑表单的模型字段新增
  「拉取模型列表」按钮，结果进 datalist（保留手输自由）。
- **模型视觉能力标记**：部分兼容网关（OpenRouter 风格）在模型对象里带
  `input_modalities`，据此在下拉项标注「支持视觉 / 不支持视觉」；
  官方 API 不返回能力信息时为空、不标注，是否视觉可用由用户自行判断
  （对应「模型不支持视觉」场景的手动选择）。
- **图片附件修复**：此前 GUI 粘贴/选择/拖拽的图片以 data-URL 字符串随
  `reflect_submit` 发送，而协议 `UserInputItem::Image.data` 是
  `Vec<u8>`（serde 要求数字数组）——提交会在后端反序列化阶段直接失败，
  图片从未真正到达模型。现在 `reflect_submit` 在应用层把 image 条目的
  data-URL / 裸 base64 解码为字节数组再反序列化（`commands/agent.rs::
  normalize_image_data` + 手写 base64 解码器 + 单测），协议层不动。
  注：非图片文件仍以占位 chip 附件（运行时按设计跳过），不发送内容。

### 变更 — 设置页瘦身与「更多」页面翻译补全

- **设置页每个页签重复的控件**：Agent 就绪状态徽标移到「提供商」页
  （它反映的正是 provider 配置状态），权限模式快捷控件移到「权限模式」
  页，不再在每个设置页签顶部重复出现。
- **更新页暂时移除**：Settings → Updates 区块、独立的 `/update` 路由页、
  命令面板「打开更新」入口及其 i18n 文案全部移除，待更新机制稳定后
  再加回。后端更新命令与 IPC 封装保留，重新接入只需恢复 UI。
- **Coding Plans 术语**：中文界面不再译作「编码计划」，直接显示
  **Coding Plan / Token Plan**（导航、标题、Model 页区块、空态文案）；
  「供应商」在 Coding Plans 语境下改为「接入端口」，配额相关文案统一。
- **「更多」浮层内六个页面补齐翻译**：Squad（小队）、Autopilot（自动
  任务）、Remote（远程）、Media（媒体工作室）、KMS（知识库）、
  Side-channels（侧通道）此前整页硬编码英文，现已全部接入 i18n 体系
  （新增 6 个 strings 模块共 150+ 键，en 值与原硬编码逐字符一致，
  中文为完整翻译）；其余 zh-CN 与 en 相同的键均为刻意保留的专有名词
  或协议标识（Git / Hooks / MCP / 权限模式名 / 斜杠命令 / 产品名）。

### 变更 — 上下文压缩改为聚合统计,不再逐条刷屏对话流

- `context_compacted` 事件（microcompact / smart_prune / llm_summarize，
  如 `smart_prune: 0 msgs (7731 → 5344 tokens)`）此前每次触发都会在
  对话中插入一条压缩提示行，长会话里是纯噪声。现在改为聚合统计：
  AgentState 新增 `compactions`（次数 / 累计移除消息数 / 累计节省
  tokens / 最近一次明细），展示在 Inspector 概览的上下文窗口区块
  （hover 显示最近一次明细）；无变化的 noop 事件不计入。会话回放时
  历史 compaction record 同样汇入统计（rollout record 不带 token 数，
  `tokensSaved` 仅累计 live 事件）；对话流内的 compacted 行、
  `chat.compacted` 文案与对应 CSS 一并移除。

### 变更 — provider 收敛为接入端口（anthropic / openai），移除 ollama 选项

- GUI 层面的 provider 概念明确为**接入端口**（API 协议端点）：只有
  `anthropic` / `openai` 两种。多数模型供应商对两种端口都有兼容实现，
  本地 Ollama 服务走 OpenAI 兼容端口（base_url 指向
  `http://127.0.0.1:11434/v1`），因此不再作为独立的第三种 provider：
  Coding Plans 的默认供应商卡片与新增表单、提供商页 `active.provider`
  选项与 `[ollama]` 字段组、模型页供应商切换均已移除 ollama。
  跨供应商自动切换顺序相应收敛为 anthropic → openai
  （`PLAN_PROVIDERS` / `pickFailoverProvider`）。后端 `[ollama]` 段
  与 `reflect_set_model` 的参数校验保持不变（协议稳定；手写 TOML
  仍可用，但 GUI 不再展示）。

### 新增 — Coding Plans 手动查询用量

- 设置 → 编码计划的每个 plan 卡片新增「查询用量」按钮（配置了
  `quota.check_via` 时出现）：对着厂商用量 API 实时查询用量，
  卡片内展示已用百分比 / 剩余 token / 窗口重置时间，鉴权与网络失败
  以错误文本内联展示。用量查询仅对 coding plan / token plan 订阅
  开放。查询端点与 cc-switch 一致（Kimi
  `/coding/v1/usages`、智谱 `/api/monitor/usage/quota/limit`、MiniMax
  `/coding_plan/remains`、ZenMux base_url），实现复用
  `reflect_llm::QuotaProvider`（与运行时 failover 判定共用，不在 GUI
  重复逻辑）。新增命令 `reflect_query_plan_quota`（`commands/config.rs`
  + `src/utils/commands/config.ts`），传显式 baseUrl/apiKey，编辑中
  未保存的表单也能直接试查。`volcengine` / `anthropic_usage` /
  `open_a_i_usage` 的查询仍需上游实现（AK/SK 签名 / OAuth），选择后
  明确报错而非静默失败。顺带修正 `QUOTA_SOURCES` 中 `openai_usage`
  的拼法 —— serde snake_case 对连续大写逐字母拆词，`OpenAIUsage`
  实际接受 `open_a_i_usage`，旧拼法会导致配置保存时
  `load_from_str` 解析失败。

### 变更 — 打开的目录与 git 分支移到对话框下方

- 目录 / 分支是当前会话的上下文（在哪个项目、哪个分支上工作），不是
  全局状态：从底部 StatusBar 移除，新增 Composer 下方的上下文条
  `ComposerContextBar`（模型/权限控制条之下）：目录显示 basename、
  hover 全路径；分支显示名称 + ↑↓ 领先/落后；非 repo 或未打开目录时
  对应段隐藏，两段皆无则整条不渲染。数据 hook
  `useGitStatusSummary`（useEffect + useState，工作区切换 / 窗口聚焦
  时重取，与 ComposerControls 同样规避 react-query 依赖）。StatusBar
  保留：模型 @ provider · 权限模式 · 上下文占比 · MCP/LSP · token ·
  会话数 · 主题。

### 修复 — 删除/归档确认在桌面端静默失效（批量删除"点了没反应"的根因）

- Tauri 的 WebView 层（wry 0.55）在 macOS WKWebView 上不实现 JS 对话框
  回调，`window.confirm()` **不弹窗且恒返回 false** —— 此前所有依赖它
  的二次确认（单条删除 / 批量删除 / 归档）点击后静默失败，多选删除
  因此"还是没办法删除"。改为应用内确认对话框：新增
  `features/modals/ConfirmDialog.tsx`（promise 式 `confirmDialog()` +
  应用根部挂载 `<ConfirmDialogHost />`，复用 ModalShell 的焦点陷阱 /
  Esc / 遮罩关闭语义），替换 Sidebar 批量删除、SessionItemMenu
  删除/归档、ThreadsView 批量删除/归档区删除共 5 处调用；ModalShell
  的 primary/secondary action 支持可选 `dataTestId`（确认框测试锚点
  `confirm-dialog-confirm` / `confirm-dialog-cancel`）。

### 修复 — 体验反馈五项：权限模式随会话 / slash 清理 / Composer 布局 / 多选删除 / 右键菜单

- **权限模式绑定会话**（此前表现为“全局”）：模式本就存于每个
  AgentThread，但 rebind 重建线程时静默落回默认 `Auto`，前端切换会话也
  不清空显示 → 徽标与实际不一致。现在 `reflect_bind_session` 从该会话
  JSONL 审计轨迹末次 `PermissionModeChanged` 恢复初始模式
  （`with_initial_permission_mode`；`Bypass` 按 v1.3 安全基线降级
  `Prompt`），并把绑定后线程的实际模式随 bind 返回（返回 `null` →
  `string`，线格式变更见 PROTOCOL_BRIDGE §2）；ChatView 用返回值
  `syncPermissionMode` 同步徽标/切换器；provider 热重载的强制重绑透传
  旧线程当前模式。多项目并行时各会话保留各自的 plan / auto 模式。
- **删除 /theme /vim 斜杠命令**：纯 TUI 镜像 stub（GUI 无 vim 实装，
  主题切换由 Settings → Display / StatusBar / 命令面板承担，`/vim`
  引导指向的 Settings → Keymap 页面并不存在）。从 `SLASH_COMMANDS`
  清单、engine 分支与 i18n 文案移除，Tier A 工具栏 chips 9 → 7。
- **Composer 控制条移位**：模型 / 思考深度 / 权限模式从输入卡片内部
  （textarea 与附件栏之间）移到输入卡片**下方**独立一行。
- **侧边栏会话多选删除**：头部「多选」进入 → 行首勾选框（点行 =
  切换选中，不导航）→ 选择条显示已选数 + 批量删除（逐条复用
  onDelete，含取消置顶 / 当前会话退出语义）→「完成」退出。与
  /sessions 页多选共用 i18n 文案；归档区行为不变。
- **禁用 WebView 默认右键菜单**：macOS WKWebView 右键出现的 Reload
  等浏览器项与桌面应用语义不符；`main.tsx` 全局 `contextmenu`
  preventDefault，文本编辑走应用菜单 Edit 项与 Cmd+C/V 快捷键。

### 修复 — macOS Overlay 标题栏原生窗口标题与自绘顶栏重叠

- `titleBarStyle: "Overlay"` 下 macOS 仍会把原生窗口标题文字（config
  `title: "ReflectDesktop"`）绘制在顶栏位置，压在自绘 TitleBar 的侧栏切换
  按钮与视图标题上。主窗口配置增加 `"hiddenTitle": true`（Tauri 2 原生
  选项，等价 `NSWindow.titleVisibility = .hidden`），只隐藏文字绘制，
  窗口标题语义（Accessibility / Mission Control）保留；仅影响 macOS，
  Windows/Linux 原生标题栏不受影响。

### 功能 — P1 会话组织 / P2 运行时可观测性 / P3 生态补全（全面对齐成熟 agent 桌面端）

- **P1 会话组织与导航**：
  - 会话置顶：localStorage 持久化（`sessions/utils/pins.ts` 新，有序 id +
    pub/sub），侧边栏顶部「已置顶」区（对标 ZCode），会话菜单加 置顶/取消置顶，
    删除/归档自动摘除置顶；置顶会话从项目分组中上移不重复。
  - 侧边栏归档区：底部可折叠「已归档」，菜单「恢复」直走 unarchive
    （此前归档列表只在 /sessions 底部）。
  - 跨会话内容搜索：新命令 `reflect_search_sessions`（grep 会话 JSONL 的
    user/assistant 文本，ASCII 折叠大小写不敏感，覆盖活跃树 + 归档树，
    最近 120 会话扫描上限，返回命中片段）；搜索页改「会话 / 文件」双 tab，
    会话命中点击跳转 `/chat/$id`。
  - 命令面板补全：/search /memory /tasks /schedule /agents /side-channels
    /remote /kms /autopilot /squad /media 11 个此前只能手输 URL 的路由。
- **P2 运行时可观测性（对标 Reasonix）**：
  - Inspector 改「概览 / 文件 / 改动」三 tab：概览含上下文窗口仪表
    （占比条 + 80% 压缩阈值刻度线）+ Token 构成堆叠条（提示词/缓存命中/
    缓存写入/回复）+ 会话指标（轮数/累计 token/费用）；文件 tab 复用
    FileTree（depth 2）；改动 tab 复用 DiffViewer（`reflect_git_diff`）。
  - 主动压缩预警横幅：上下文 ≥80% 在消息流顶部出横幅 + 一键 /compact
    （此前只有 Composer 角落变色 tooltip）；占比回落自动重置，可手动关闭。
  - StatusBar 加 git 分支（含 ↑↓ ahead/behind）与上下文占比（≥80% warning 色）。
  - Composer 支持剪贴板粘贴图片/文件与拖拽投放（复用附件管线）。
- **P3 生态补全**：
  - `!` 终端直通：`! <cmd>` 经 `reflect_run_shell` 本地执行，输出面板
    （Composer 卡片上方）流式呈现、可终止/折叠；不进 agent 循环、不写
    会话历史（`useBangShell.ts` 新，共享 `reflect_terminal_output` 订阅）。
  - Git 操作化：新命令 `reflect_git_stage` / `reflect_git_unstage` /
    `reflect_git_commit`（`git add --` / `reset HEAD --` / `commit -m`；
    push/pull 仍留给终端）；GitView 条目可勾选 + Stage/Unstage selected
    + 提交框（成功 toast 短 hash）。
  - 拉取请求：新命令 `reflect_gh_pr_list`（shell out `gh pr list --json`，
    gh 缺失/非 repo 空态给原因）+ `/pulls` 视图（对标 Codex「拉取请求」，
    点击在系统浏览器打开）。
  - Hooks 管理 UI：`/hooks` 视图（`reflect_list_hooks` /
    `reflect_toggle_hook` 此前无任何 UI 消费），运行时启停 + 计数。
  - SkillsView 接入真 skills 列表（`reflect_list_skills` 此前从未消费）：
    名称/描述/触发词/允许工具，空态提示安装路径。
  - 清理：31 个 no-op slash stub 标记 `hidden` 不再进弹层（手输仍给引导，
    engine case 保留）；删除死代码 ApprovalHistory（tsx/css/test 三件）；
    修复 SlashPopup 键盘导航（此前 node 监听收不到按键 —— 改为受控组件，
    选中态由 Composer 持有，箭头/Enter/Tab 在 textarea 键盘路径路由；
    完整输入命令名时 Enter 仍直接执行）。
- 文档：`docs/PROTOCOL_BRIDGE.md` §2.0 命令表补 6 个新命令；
  `docs/codebase-map.md` 视图清单同步。
- 测试：Rust `search_tests`（片段窗口 4 例）；前端 pins / Sidebar 置顶与
  归档区 / Composer `!` 直通与 slash 键盘 / ContextBanner / Inspector 三 tab
  / 路由矩阵补 /pulls /hooks；fakeBackend 补全部新命令 handler。

### 功能 — 首页工作台 + 侧边栏精简（对标成熟 agent 桌面端首屏体验）

- **侧边栏默认精简（大众模式）**：左侧导航栏新增双模式
  （`uiPrefs.activityBarMode`，默认 `simple`）：
  - `simple`（默认）：只保留 新会话 / 搜索（接通原孤儿路由 `/search`）/
    「更多」浮层 / 设置 四个入口；其余 13+ 个视图（文件/Git/终端/技能/
    任务/定时/Autopilot/Agents/Squad/通知/听写/远程/知识库/媒体/并行通道/
    首页/关于）按「开发工具 / 自动化 / 更多功能」三组收进「更多」浮层，
    外点/Esc 关闭 —— 此前 17 个平铺图标对非程序员用户过于硬核。
  - `full`（开发者模式）：Settings → Display 新增「显示全部高级视图」
    开关，开启后恢复全部平铺（历史行为不删）。⌘K 命令面板不受模式影响，
    始终可达全部视图。
- **首页工作台（新对话英雄态）**：落地页 `/` 在无会话无消息时呈现
  问候语（按时段 早/午/晚）+ 副标题 + 当前工作区提示 + 居中 Composer +
  快捷模板 chips（探索代码 / 构建新功能 / 审查改动 / 修复问题，
  点击**预填**草稿不自动发送，经 `useComposerDraft` 新增的模块级 prefill
  总线）；首条消息发出后同一 Composer 实例自然落回底部常规布局。
  （对标 Codex/ZCode：欢迎页即空对话态。）
- **Composer 内联控制条**（`ComposerControls.tsx` 新）：输入框卡片内
  新增 模型选择器（选项与 Models 页的 coding plans 同源）+ 思考深度
  （low/medium/high）+ 权限模式分段（计划/询问/自动/Yolo，完整 7 段仍在
  Settings）；placeholder 提示补 `@ 文件` 语法。
- **新命令**（见 `docs/PROTOCOL_BRIDGE.md` §2.0）：
  - `reflect_set_model { provider, model }`：运行中切换模型 —— 协议
    `Op` 不变，改 `[active].provider` + `[<provider>].model` 后复用
    `reflect_save_config` 的写盘 + provider 栈热重载链路，下一个 turn 生效；
  - `reflect_get_effort`：直读线程内 `AgentConfig::current_effort()`，
    修复 Models 页 effort 控件不回读后端值（此前固定显示 medium）。
- i18n：`shell.nav.search` / `shell.nav.more` / `shell.more.*` /
  `settings.display.advancedViews*` / `chat.greeting.*` / `chat.hero.*` /
  `chat.quick.*` / `composer.controls.*`（zh/en）。
- 测试：ActivityBar 双模式与浮层、ChatView 英雄态三用例、Composer
  内联控件三用例、Settings 开关持久化；`tests/helpers/fakeBackend.ts`
  补 `reflect_set_model` / `reflect_get_effort` handler；测试 setup 增补
  新命令默认 mock + uiPrefs 跨用例复位。

### 功能 — Coding Plan 管理：计划配置入口 + 默认供应商切换 + 额度耗尽自动切换

- **配置模型**（无新命令/线格式变更，复用 `~/.reflect/config.toml`）：
  - 一个 coding plan = `[[<provider>.credentials]]` 一条带 `label` 的凭证
    （`api_key` / `base_url` / `model` / `weight` / `quota`）；顶层
    `[provider].api_key` 视为隐式 `default` 计划；默认供应商 =
    `[active].provider`。功能说明见 README「Coding Plan 与额度自动切换」。
- **后端热生效闭环**（此前改配置必须重启）：
  - `src-tauri/src/state/quota.rs`（新）：按 config 中 `quota` 声明构建
    `QuotaTracker`（GLM/Kimi/MiniMax/Zenmux 用量 API），随
    `AgentConfig::with_quota_tracker` 进入每个线程（与 TUI/headless 对齐；
    此前桌面端从未接线）——额度窗口耗尽 → `quota_exhausted` 事件 + 凭证
    冷却 + 池内自动 failover。
  - `src-tauri/src/state/reload.rs`（新）：`reflect_save_config` 检测
    provider 段（`active`/`anthropic`/`openai`/`ollama`/`routing`）变更 →
    重建 ModelRegistry + QuotaTracker → `rebind_session_forced`（新增
    `state/rebind.rs` 强制变体，跳过同 id 短路；preload 与 bind 命令同源，
    会话上下文保留）。
- **前端自动切换**：`src/stores/agent/planFailover.ts`（新）消费
  `quota_exhausted` / 耗尽特征 `error` 事件，挑选下一个有可用计划的
  供应商 → `reflect_save_config` → toast 告知；开关（默认开，
  localStorage `reflect.plans.autoFailover`）+ 60s 防抖；失败 turn 不自动重发。
- **UI 入口**：
  - 设置页新增「编码计划」nav（`sections/PlansSection.tsx` 新）：计划卡片
    （增删改、密钥遮罩、额度徽标）、默认供应商一键设置、自动切换开关；
    与 ConfigForm 共享 rawToml buffer、统一 Save 落盘。
  - Models 页新增编码计划列表 + 「设为默认」一键切换（默认供应商热切换）。
  - `src/features/settings/config/plans.ts`（新）：plan 解析/增删/切换/
    failover 挑选纯函数（与 schema.ts 同风格的字符串手术）。
- i18n：`settings.plans.*` / `models.plans.*`（zh/en）。
- 测试：Rust `state::{quota,reload,rebind}`；前端 `plans.test.ts` /
  `planFailover.test.ts` / `PlansSection.test.tsx`。

### 修复与体验 — 会话侧边栏打开项目 / 历史会话多选删除 / ActivityBar 溢出

- **侧边栏「打开项目…」**：会话侧边栏底部新增入口，调起系统目录选择器
  （复用 `reflect_pick_workspace_folder` → `reflect_set_workspace`，与
  WorkspacesView 同语义），切换后 toast 告知并刷新 workspaces / sessions /
  当前工作区缓存 —— 此前新增项目必须进 Workspaces 页。
- **历史会话多选删除**：Threads 页新增「多选」模式 —— 行首勾选框 +
  顶栏操作条（已选计数 / 删除所选 / 完成），确认后逐条走既有
  `reflect_delete_session`（无线格式变更）；删除含当前会话时先退出会话路由。
- **ActivityBar 溢出修复**：主导航 17 项在窗口高度不足时曾溢出栏体、
  叠在底部 StatusBar 上 —— 主导航组改为占满剩余高度并内部滚动
  （细滚动条），Settings / About 固定钉在栏底部。
- 测试：ThreadsView 多选删除（确认删除 / 取消不删）、Sidebar
  「打开项目」按钮。

### 体验 — Agent 桌面应用核心交互升级（对标 CodexMonitor）

按用户旅程组织：发起任务 → 观察 agent 工作 → 运行中交互 → 回来看结果。

- **消息内 diff 渲染**（观察）：
  - edit/write 工具的结构化 `ContentBlock::Diff` 此前被压成 JSON 文本
    （live 流）或直接丢弃（历史回放）。现在 `summarizeToolOutput`
    返回 `{ text, diff, path }`（`src/stores/agent/turns.ts`），live
    （`reducer.ts::tool_call_end`）与历史（`src/stores/replay.ts`）统一
    提取 diff 块与目标路径。
  - `MessageList` 的 tool_output 带 diff 时复用 `git/DiffViewer` 渲染
    （unified 着色 + 行号 gutter，默认展开、路径为标题，可折叠）；
    ChatView 分屏 diff 面板同步替换裸 `<pre>`。无新增依赖。
- **运行状态与上下文可见性**（观察/交互）：
  - Composer 运行中显示「停止」按钮（此前只有 `/interrupt` 斜杠命令）；
  - Composer 角落新增上下文用量条（`tokens.total / contextWindowSize`，
    ≥80% 转警示色并提示 `/compact`；数据来自已有的 `token_count` /
    `session_configured` 事件，纯前端）。
- **跟进消息 Queue vs Steer**（运行中交互；纯前端，不改协议）：
  - turn 运行中发送的消息不再静默滑入后端不可见 mpsc 队列，而是进入
    前端可见队列（`queuedMessages` + `enqueue/removeQueued/updateQueued/
    drainQueue`）：消息流底部「待发送」气泡支持编辑 / 移除 / 立即发送。
  - 排空时机：`turn_complete` / `turn_aborted` 后自动逐条发出；存在
    待审批 / 待提问 / 待输入 / 待 plan 时暂停。
  - Steer 语义：Composer 运行中显示 Queue（默认）/ Steer 模式切换 +
    `Shift+Cmd/Ctrl+Enter` 单次反转；Steer = `reflect_interrupt()` →
    等 `turn_aborted` → 立即提交（已完成工具调用保留在会话历史）。
  - 会话切换（hydrate/clear）清空队列，消息不串会话。
- **会话标题自动生成**（回来看结果；新命令，见 PROTOCOL_BRIDGE §2）：
  - `reflect_generate_session_title(id, force?)`：replay 取首条 User +
    Assistant 种子 → MinimalAgent 的 SharedModelRegistry one-shot 调用
    → `derive_title` 清洗 → 落盘 `~/.reflect/sessions/_titles/<id>.title`。
  - 标题优先级升级为三级：自定义名（`_names`）> AI（`_titles`）> 首条
    消息派生；手动 rename 永不被覆盖。归档 / 删除同步搬移 / 清理 `_titles`。
  - 触发：会话首次 `turn_complete` 自动生成（后端幂等，失败静默）；
    会话菜单新增「AI 重命名」重新生成；Home / Threads 标题展示改用
    `sess.title`（此前显示 session id 前 8 位）。
- **通知与召回精细化**（回来看结果）：
  - 通知门控（对标 CodexMonitor）：仅窗口失焦时通知、运行 <60s 不通知
    （可设 30s/1m/2m/立即）、同 turn 1.5s 节流；通知正文改为 agent 最后
    一条回复（截断 200 字符），点击通知聚焦窗口并跳回当前会话。
  - 「需要你处理」通知：等待审批 / 提问 / 输入 / plan 时单独召回。
  - Dock badge 接线：后端 `reflect_set_dock_badge` 此前无前端调用方，
    现按待处理交互数实时更新（命令体按领域约定移入
    `commands/dock.rs`；非 macOS 为 no-op）。
  - 设置项扩展（Settings → Notifications）：仅失焦通知 / 最短运行时长 /
    等待处理通知 / Dock 角标；持久化沿用 localStorage
    `reflect.notify.options`。门控纯函数（`shouldNotifyTurnComplete`）
    独立可测。
- **Composer 草稿按会话持久化**（发起任务）：
  - `useComposerDraft`：草稿写入 localStorage `reflect.draft.<sessionId>`，
    切换会话自动恢复各自草稿，发送后清除 —— 此前草稿是组件内 state，
    切会话即丢。
- 测试：前端新增 `turns.test.ts` / `queue.test.ts` /
  `useComposerDraft.test.ts` / `QueuedMessages.test.tsx` / notify 门控
  用例 / Composer Queue-Steer 集成用例；fakeBackend 补齐 turn 生命周期
  事件（`turn_started`/`turn_complete`）与 `reflect_tailscale_status`
  线契约字段（修复 `RemoteView.ipv4` 偶发崩溃）、`reflect_generate_session_title`
  与 dock badge 处理器；Rust 新增 `refine_session_titles` 三级优先级 /
  `ai_titles` / `extract_title_seed` / `truncate_seed` 用例。

### 功能 — 侧边栏按项目目录分组显示会话（可折叠 + 多项目）

- **侧边栏结构**（纯前端，无线格式变更）：
  - `Sidebar` 从时间分桶（Now/今天/…）切换为**项目目录分组**：每组头部显示
    目录名（basename，hover 显全路径）+ 会话数 + 当前工作区标记，组下为该
    项目的会话（`started_at` 倒序，标题即后端首条消息派生摘要）。
  - 分组可折叠（`aria-expanded` 组头按钮），折叠态经 localStorage 持久化；
    默认全展开，未归属分组默认折叠。搜索（标题 / session id / 项目名）时
    强制展开所有命中分组。
  - workspaces.json 中的已知项目即使无会话也显示，组头「+」可在该项目下
    新建会话（先 `reflect_set_workspace` 再预分配 id 并导航）。
  - 未归属旧会话（v1.x 之前创建、无 `SessionMeta.workspace`）归入「未归属」
    分组，固定最后。
- **新模块**：
  - `src/features/sessions/utils/workspaceGroups.ts`：`groupSessionsByWorkspace`
    纯函数（会话按 `workspace` 归组 ∪ 已知项目合并，跳过后端 `$HOME/.` 兜底
    占位；组间最近活跃倒序，未归属组固定最后）。
  - `src/features/sessions/components/WorkspaceGroup.tsx`：可折叠项目分组组件。
  - `src/features/sessions/hooks/useCollapsedGroups.ts`：折叠态持久化 hook。
  - `useSessions` 新增 `groups` 输出（`buckets` 保留，HomeView / ThreadsView
    仍用时间分桶）。
- **行为修复**：点击其他项目的会话时，工作区跟随会话——先
  `reflect_set_workspace(会话.workspace)`（失效 `current-workspace` /
  `agent-status` / `workspaces` 缓存）再导航，保证 `reflect_bind_session`
  重建线程时烧入正确的 cwd（此前跨项目点选会以旧工作区续写）。
- HomeView / ThreadsView / 线程页时间分桶不受影响。

### 功能 — GUI 会话持久化：M4 recorder 接线 + 跨轮记忆修复（v1.x）

- **协议/引擎层**（reflect-agent submodule）：
  - `SessionConfiguredEvent.session_id` 不再随机 —— `submission_loop` 在
    `SessionConfiguredEvent::new` 后覆盖为线程预分配 id（serve.rs 同），
    与 rollout 文件名 / `SessionMeta.session_id` / 前端路由 id 一致。
  - 新模块 `reflect_core::resume::records_to_preload(&[RolloutRecord]) ->
    Vec<ChatMessage>`：rollout 记录 → LLM 历史映射（legacy String / 图文
    blocks / 工具对顺序 / compaction 摘要前置 System），`bootstrap_resume`
    与 GUI 回填共用单一实现。
  - `submission_loop` **每轮历史回填**：有 recorder 的线程在每 UserInput
    turn 前从 `recorder.replay` 重建会话历史（修复跨轮失忆 —— 旧引擎
    `AgentState::default()` 每轮新建、`preload_messages` 一次性 take，
    模型每轮只见新输入）。无 recorder 线程保留 preload-once 语义。
  - `CronScheduler::rebind_sender(Option<Sender<Submission>>)`：换绑
    投递通道（纯字段赋值；调用方须 stop + 重启 driver，job uuid 经共享
    Arc 保留）。
  - `ToolRegistry::external_tool_names()` + `pre_loop` 外部工具可见性补丁：
    `effective_tools` 增并非 `Builtin` 源工具名 —— **M4 开启后 MCP/LSP/
    Plugin 工具不再被隐藏**（此前过滤为 always_on ∪ 已激活 skill，CLI 同受益）。
- **Tauri 适配层**：
  - 新命令 `reflect_bind_session({ id })`：replay 该 id 的 JSONL →
    `records_to_preload` → `state::rebind::rebind_session`（换绑线程：
    `construct_thread` 带 `with_session_id` + 完整 M4（`build_default_m4`，
    recorder 覆写为同 id 的 `JsonlRolloutWriter`），旧 turn `cancel_token`
    有界排空，cron driver 换 sender 重启；同 id 幂等短路；未知 id 空历史
    绑定不报错）。
  - 新模块 `state/thread_factory`：registry 构造 + `construct_thread(sid,
    preload)` 统一 install / rebind 两路径；M4 全量启用（skills / memory /
    compaction / notes），recorder base 统一到
    `reflect_rollout::path::default_base()`。
  - **cron 修复**：install 时 `let _driver_handle = driver.start(30)` 立即
    Drop 句柄 → driver 任务被 abort → **cron 任务从未真正触发**。句柄现
    存 `inner.cron_driver`，rebind 时 stop 旧 driver 后重启。
  - **rebind 写锁自死锁修复**：`rebind_session` step 5 的
    `if let ... = cron_scheduler.write().clone()` scrutinee 临时值（写
    guard）活到 if-let 块结束，块内再对同一把锁 `write()` 因 parking_lot
    非重入自死锁 → 每次 `reflect_bind_session` 永久挂起 IPC 线程。改为
    读锁 clone 释放 guard 后再取写锁写回。
  - **cron 换向提前**：旧 driver 的 stop 从新线程构造之后提前到旧线程
    cancel 之后立即执行 —— `CronScheduler::start` 按值捕获旧
    `sub_tx`，窗口内旧 driver 仍会把到期 job 投进已 cancel 的旧线程
    （静默丢触发）；新 driver 首个 tick 立即扫描补发，不丢触发。
  - `sessions_base()` 对齐 `default_base()`，杜绝列表/回放路径分叉。
- **前端**：`reflect_bind_session(id)` IPC 包装；`ChatView` 加载序列改为
  **bind → replay → hydrate**（已水合同 id 也先 bind 再早退，后端幂等；
  retry 同构）—— 切换会话后续写该会话文件且 LLM 恢复上下文。
- **行为变化**（需知）：
  - GUI 会话开始落盘 `~/.reflect/sessions/YYYY/MM/DD/<id>.jsonl`（首行
    `SessionMeta.workspace` = 归属工作区）。
  - 多轮记忆恢复（此前每轮失忆）；系统 prompt / 工具表与 CLI 同款
    （M4 全量），prompt 变长由 compactor 收敛。
  - 配置的 cron 任务开始真正按周期触发。
- **测试**：submodule 侧 `resume` 映射 6 用例 + `pre_loop` M4/回填/rewind
  3 用例 + `session_configured_reports_preallocated_session_id` +
  cron rebind 用例；GUI 侧 rebind 4 用例 + install registry/cron 句柄用例；
  前端 ChatView bind→replay 顺序 / 切会话重绑 2 用例 + fakeBackend /
  mock / contract 同步。
- **文档**：`docs/PROTOCOL_BRIDGE.md` 补 `reflect_bind_session` 行 +
  `SessionConfigured.session_id` 语义。

### 功能 — 工作区 ↔ 会话归属 + Composer `@` 文件弹层（v1.x）

- **协议层**（reflect-agent submodule，serde 全兼容 —— 新字段均带
  `#[serde(default, skip_serializing_if = "Option::is_none")]`）：
  - `UserInputItem` 新增 `File { path, range? }` 变体（`FileRange { start_line, end_line }`）；
    core 侧 `user_input_items_to_messages` 展开为 `@<path>`（含行区间时
    `@<path>:L<n>-L<m>`）文本块，真实读取由 LLM `/read` 工具按需触发。
  - `Submission.workspace: Option<String>` —— 会话归属随首条 UserInput 传递，
    后端写入 `RolloutRecord::SessionMeta.workspace`（回退 `cfg.current_workspace()`）。
  - `SessionInfo.workspace: Option<String>` —— 旧 JSONL 反序列化为 `None`，
    前端按"未归属"展示。
  - `rollout_index::list_sessions_in_workspace(base, ws)` —— 精确匹配过滤；
    旧会话（`workspace = None`）在过滤视图不出现（归属创建时确定，避免误归类）。
    JSONL 路径布局不变（`<base>/YYYY/MM/DD/<id>.jsonl`）。
- **Tauri 适配层**：新命令 `reflect_create_session -> string`（无参纯 ID
  分配，New Chat 先拿路由 id，workspace 归属经 `Submission.workspace`
  注入）；`reflect_list_sessions` 增加可选 `workspace`
  过滤参数（老 IPC 传 `null` 兼容全量列表）。
- **前端 — 会话归属**：新 hook `useCurrentWorkspace`（30s staleTime）；
  `AppShell.handleNewChat` 改为 `reflect_create_session()` →
  `setActiveId` → 导航；`useSessions` 支持 `workspacePath` 过滤（queryKey 含
  workspace 维度）；`reflect_set_workspace` 成功后失效 current-workspace +
  sessions 缓存；`SessionItem` 副标题显示归属项目名（basename，hover 全路径），
  未归属显示"未归属"。
- **前端 — `@` 文件弹层**：`useComposerInput` 增 `MENTION_QUERY` 检测
  （`(^|\s)@([^@\s]*)$`）+ Escape 关闭；`MentionPicker` 切到文件源
  （`reflect_list_dir(null, 2)` 浅层递归，跳过 node_modules/target/.git 等，
  复用 command-palette fuzzy，slice 50）；`useAttachments.addFileMention` +
  `toUserInputItems` file 映射；工具栏 `@` 按钮改为追加 `@` 并直接开弹层
  （显式 `setMentionVisible(true)` —— setState 不触发 onChange）；
  `useComposerSubmission` 透传 `workspace` 进 Submission 信封。
- **测试**：前端 7 组新增/扩展（@ 触发检测 / MentionPicker / addFileMention
  线格式 / useSessions workspace 过滤 / Composer @ 弹层集成 / AppShell New
  Chat / useCurrentWorkspace）；Rust `list_sessions_in_workspace` 过滤断言。
- **文档**：`docs/PROTOCOL_BRIDGE.md` 补 `File` / `FileRange` /
  `Submission.workspace` / `SessionInfo.workspace` schema 与
  `reflect_create_session` 命令行。

### 修复 — 窗口拖拽 / 项目目录 / 会话归档（GUI 三项可用性补齐）

- **窗口拖拽**：根因是 Tauri 2 的 `core:window:default` 权限集不包含
  `core:window:allow-start-dragging`，`data-tauri-drag-region` 触发的
  `plugin:window|start_dragging` IPC 被 ACL 静默拒绝，标题栏拖不动。
  - `src-tauri/capabilities/main.json` 新增 `core:window:allow-start-dragging`。
  - `src/features/shell/TitleBar.tsx` 改用 `data-tauri-drag-region="deep"`
    （Tauri drag.js 在子树内命中非交互元素即触发，整条顶栏可拖）；
    移除冗余的手写 `onMouseDown` preventDefault（drag.js 已自带）。
  - `src/styles/base.css` 与 `TitleBar.module.css` 移除无效的
    `-webkit-app-region: drag`（WKWebView 不识别此 CSS 属性，Tauri 拖拽是
    属性 + JS 命中 + ACL 三件套）。
- **项目目录**：WorkspacesView 接入真实历史列表 + 原生目录选择。
  - 后端 `commands/workspaces.rs`：
    - `reflect_set_workspace` 切换即把当前项 upsert 进
      `~/.reflect/workspaces.json`（去重 + last_used 刷新 + 截断到 20 条）。
    - `reflect_pick_workspace_folder`：原生目录选择对话框（Rust 侧
      调 `tauri-plugin-dialog` 的 `DialogExt::pick_folder`，经 oneshot
      折回 async 返回；不走 JS IPC，无需 dialog capability）。
    - `reflect_reveal_path`：在系统文件管理器中定位路径（macOS `open -R` /
      Windows `explorer /select,` / Linux `xdg-open`）。
  - 依赖：`src-tauri/Cargo.toml` 新增 `tauri-plugin-dialog = "2"`，
    `lib.rs` 注册 `tauri_plugin_dialog::init()`。
  - 前端 `src/features/workspaces/WorkspacesView.tsx` 重写：当前 workspace
    卡 + 「打开项目目录…」主按钮 + 「在文件管理器中显示」次按钮；最近
    项目区按 `last_used` 倒序，每条支持 reveal / use。
  - IPC 包装 `src/utils/commands/workspaces.ts` 补三个新 wrapper；
    `commands/mod.rs` 注册三个新命令 + `lib.rs::invoke_handler!` 同步。
- **会话归档 / 恢复 / 删除**：共享 `SessionItemMenu` 让侧边栏与
  ThreadsView 都能执行 rename / export / archive / delete。
  - 后端 `commands/sessions.rs`：新增 `reflect_archive_session` /
    `reflect_unarchive_session` / `reflect_list_archived_sessions`。
    归档把 session 的所有文件（含轮转副本、文件名错位副本）+ 自定义名
    搬到 `~/.reflect/sessions-archive`，相对路径不变（unarchive 沿同一
    相对路径搬回）。归档目录放在 sessions 树之外，避免被
    `rollout_index::list_sessions` 全树扫描命中。
  - 前端：抽出 `src/features/sessions/components/SessionItemMenu.tsx`
    （合并 `threads/components/ThreadItemMenu.tsx`），SessionItem 行尾
    kebab（⋯）悬停出现；`BucketGroup` / `Sidebar` / `ThreadsView` 透传
    菜单 handler；归档当前打开会话后自动回 `/chat`。
  - ThreadsView 新增「Archived」区（带 restore / 彻底删除）。
  - IPC 包装 `src/utils/commands/sessions.ts` 补三个 wrapper；
    `useSessions` hook 新增 `archive` / `unarchive` / `archived` 字段。
- **Capabilities / Tests / Docs**：
  - `tests/helpers/fakeBackend.ts` 同步四个新命令 + workspaces 线格式
    改为后端 `WorkspaceInfo`（unix 秒 + label）。
  - `tests/ipc.command-contract.test.ts` 加 archive round-trip + folder
    picker / reveal 路径断言。
  - `tests/sessions.lifecycle.test.tsx` 加侧边栏 kebab 归档 / 删除 /
    自动回 `/chat`、ThreadsView restore 归档全流程用例。
  - `tests/views.route-matrix.test.tsx` 改为校验
    `reflect_list_workspaces` + `reflect_agent_status`。
  - 新增 `src/features/sessions/components/SessionItemMenu.test.tsx`（6 用例）。
  - 后端 `commands/{workspaces,sessions}.rs` 加 7 个 Rust 单元测试（去重 /
    持久化 / 容量上限 / archive+restore 整树搬移），`cargo test --lib
    commands::` 48 个测试全绿。
  - `docs/PROTOCOL_BRIDGE.md` 新增 6 个命令条目 + 归档树 / workspaces.json
    持久化约定。

### 修复 — v1.x diff 审查修复（前端）

- **MentionPicker 路径契约**：后端 `DirEntry.path` 是绝对路径，弹层原样
  透传 → 违反 `UserInputItem.File.path` 工作区相对路径契约。现按
  `listing.root` 剥离前缀（hint 展示同走相对路径）；`onPickFile` 契约
  回归用例（绝对路径 mock → 相对路径断言）。
- **MentionPicker i18n**：`Files` / `Loading files…` / `No matching files.`
  硬编码英文改 `composer.mentionPicker.*` 键；补漏的
  `composer.toolbar.mentionFile` 键（工具栏 `@` 按钮此前取不到文案）；
  清理死键 `session.workspaceBadge` / `composer.mentionPicker.placeholder`。
- **ChatView 加载 effect**：unmount / 换 session 时递增 `requestIdRef`
  使在途 replay 作废（防旧 replay 水合进全局 store 污染新会话）；
  已水合判断改读 `useAgentStore.getState()` 实时值并把
  `loadedSessionId` 移出 deps —— 水合成功后不再二次重跑
  （多余 bind + loading banner 闪断 + 双份 JSONL 读）。
- **New Chat 失败兜底**：`handleNewChat` 补 `.catch` → error toast
  （新键 `toast.newSessionFailed`）。
- **SessionItemMenu 主题**：`--rd-*` 令牌全仓不存在，暗色 hex fallback
  在亮色主题下渲染成深色面板。改 `tokens.css` 既有令牌
  （`--bg-elevated` / `--border-default` / `--text-primary` / `--accent` …）。
- **`/goal` 斜杠命令**：缺参 reject 文案混排中英，改与 engine 其余
  消息一致的英文（engine 保持纯函数，文案走 caller toast）。
- **`Submission.workspace` 线格式测试**：新增 `stores/agent/store.test.ts`
  —— 非空注入顶层字段、null/undefined 省略字段（后端回退
  `cfg.current_workspace()` 的前提）。

### 新增 — goal 模式 GUI 触发面（Op 直通 + `/goal` 斜杠命令）

- **背景**：上游 `reflect-protocol` v1.2 P1 已有 `Op::EnterGoalMode { goal,
  verify_command?, token_budget? }` / `Op::ExitGoalMode`（core 侧
  `GoalController` 每轮 turn 结束自校验、未完成自动续作），但 Desktop GUI
  此前无触发面（i18n 标注"后续阶段"）。
- **后端**：`src-tauri/src/commands/agent.rs` 新增 `reflect_enter_goal_mode` /
  `reflect_exit_goal_mode` 两个薄 Op 适配（与其他 14 个 Op 命令同模式，经
  `MinimalAgent::submit_op` 投递），`lib.rs` 注册表同步。
- **前端**：新域文件 `src/utils/commands/goal.ts`（barrel 导出）；Composer
  新增 `/goal <description>` 斜杠命令（`/goal clear` 退出，与 TUI 约定一致），
  无参数时 reject 并给出引导。
- 文档：`docs/PROTOCOL_BRIDGE.md` §2 注记 + §6 Op 联合补两个变体。
- 测试：`tests/flows.chat-plan-goal-edit.test.tsx` 覆盖 goal 多轮自动续作
  （零用户提交下多 turn 累积/状态流转/退出）；契约测试补 goal round-trip
  （可选字段缺省/完整两形态 + 状态清除）。

### 新增 — `tests/` 应用级全量测试套件（168 测试，全绿）

- **基础设施**：`tests/helpers/fakeBackend.ts` 实现 `lib.rs` 注册表中的
  全部 `reflect_*` IPC 命令（带状态、失败注入、调用日志、线格式参数断言），
  内置 ScriptedAgent 事件编排（`emit` / 审批·提问·计划 `gate` 挂起，
  复刻真实 agent 审批停顿与提交抢占）；`tests/helpers/appHarness.tsx`
  挂载完整真实应用（真实 reducer / React Query / 路由 / 事件总线订阅）。
- **覆盖**：IPC 契约与四方对齐（后端函数 ↔ 前端包装 ↔ handler 注册 ↔
  模拟实现 + `PROTOCOL_BRIDGE.md` 覆盖率下限）、全部 `EventMsg` 变体
  协议矩阵、聊天端到端主流程（含审批门）、**chat → plan → edit 全链路**
  （plan 草稿多次更新 → plan_ready → 三选择决策 → 编辑工具逐审批 →
  完成，含 IPC 时序断言）、**goal 模式多轮自动续作**、审批/提问/计划
  四模态全路径、会话生命周期（分桶/重放/切换）、Composer 斜杠命令/
  历史/附件、设置页配置读写、34 条路由视图矩阵、错误与韧性（流错误/
  配额/后端故障/中断）。
- 运行：`pnpm vitest run tests/`；全量 `pnpm test` 现共 77 文件 732 测试。
- 详见 `tests/README.md`。

### 修复 — reflect-sandbox seatbelt 临时 profile 并发写竞争（上游 submodule）

- **现象**：`cargo test --workspace` 多线程下 `reflect-sandbox` 的
  `rm_rf_root_is_blocked_in_sandbox` 必挂（stdout 为空），单线程 / 单用例
  通过。**这不是测试问题,是 `seatbelt_argv` 的真实缺陷**:临时 profile
  固定写 `reflect-sandbox-<pid>.sb`,同一进程内并发调用(桌面应用并行
  工具执行、并行测试)在 `fs::write` 截断重写窗口内互相踩踏 ——
  `sandbox-exec` 读到半截 profile 编译失败、子进程不启动(fail-closed);
  或读到他人完整 profile,workspace 写白名单错乱。
- **修复**(Reflect-Agent 仓库,submodule 指针同步升级):文件名追加原子
  自增序号(`reflect-sandbox-<pid>-<seq>.sb`),每次调用独立文件;新增
  回归测试 `seatbelt_argv_temp_profiles_are_unique_per_call`。验证:
  `--lib` 多线程 5 连跑 15/15 全绿。
- 顺带:全量测试亦确认根 workspace 经 path 依赖自动纳入全部子模块 crate
  (共 26 成员),`cargo test --workspace` 实际覆盖核心 crate 自身测试。

### 修复 — submodule 协议新增 `tool_execution_request` 变体导致编译失败

- **`app-core` reducer 编译错误（根因）**：submodule `reflect-protocol` 新增
  `EventMsg::ToolExecutionRequest(ToolExecutionRequestEvent)`（v1.3 SDK serve
  模式远程工具执行请求）后，`app-core/src/reducer/mod.rs` 的穷尽 match 未覆盖
  该变体，`cargo check` 报 E0004、整个后端无法编译。已将其加入协议层
  no-op 分支（Desktop 内嵌 AgentThread、不注册远程工具，不会收到此事件）。
- **前端协议类型同步**：`EventMsgType` 联合此前缺 `tool_execution_request`
  （线格式 snake_case tag），已补齐类型镜像 `ToolExecutionRequestPayload`
  （`call_id` / `tool` / `args`）+ `EventMsgByType` 条目；
  `reduceEvent` 加对应 no-op case，配合穷尽性守卫保持前后端事件表一致。
- 文档：`docs/PROTOCOL_BRIDGE.md` §3.3 工具事件表补 `tool_execution_request`
  行（标注 serve 模式语义与 Desktop no-op 决策）。

### 修复 — 全量测试发现的问题（会话归属 / 事件层前向兼容 / 删除会话）

- **session 归属按内嵌 `session_meta.session_id` 匹配（根因）**：真实数据中存在
  「文件名 ≠ 内嵌 meta id」的会话文件（如 resume 沿用旧文件名写入新线程），
  而索引 `list_sessions` 以 meta id 标识 session，按文件名定位会全部 miss。
  `src-tauri/src/commands/sessions.rs` 统一改为：文件定位先读首行 meta
  （`first_line_session_id`），无 meta 时回退文件名 stem——三处受益：
  - 标题精化 `derived_titles` 以 meta id 为 key（此前按文件名 key，
    实测 260 个会话全部停留在 JSON 脏标题 `[{"text":"…","type":"text"}]`，
    精化从未生效；修复后脏标题清零，GUI 实机复验通过）；
  - 回放/导出兜底 `session_files` 同样按 meta 命中错位文件；
  - `reflect_delete_session` 此前删 `sessions/<id>/` 目录——真实布局是
    `YYYY/MM/DD/<id>.jsonl`，删除永远是静默 no-op；现删除该 session 的
    全部文件（含错位/轮转副本）+ `_names/<id>.name` + 旧布局目录。
- **事件层前向兼容**：
  - `reduceEvent`（`src/stores/agent/reducer.ts`）switch 无兜底分支，
    运行时遇到未知 `msg.type`（submodule 升级新增事件、前端类型未同步）
    返回 `undefined`，调用方 `Object.keys(patch)` 抛 TypeError 中断事件
    处理。新增带 `never` 穷尽性守卫的 `default` 分支：运行时安全返回空
    patch，同时保留「新增事件类型未处理时编译报错」的信号。
  - 前端协议类型镜像补齐 `plan_draft_updated`（`PlanDraftUpdatedEvent`，
    后端已有而前端联合缺失）；reducer 加对应 no-op case（GUI 决策路径
    走 `plan_ready` 弹窗，草稿正文暂不渲染）。
- 测试：sessions.rs 新增 4 个回归用例（meta 错位定位/精化、无 meta 回退、
  删除三布局）；agentStore.test.ts 新增未知事件安全 + plan_draft_updated
  用例。Rust 79 + 前端 564 用例全绿。

### 修复 — 历史会话无法显示 + 会话标题 + Composer 默认发送键

- **历史会话回放修复（根因 ×2）**：
  - 前端 `turnsFromRollout`（`src/stores/replay.ts`）此前按一个不存在的
    `{ seq, kind, payload }` 事件信封解析回放记录，而
    `reflect_replay_session` 实际返回的是 `reflect_protocol::RolloutRecord`
    tagged union（`{"type":"message","turn_id","role","content"}`）——
    所有记录都被丢弃，历史会话永远空白。已重写转换器：按 `turn_id` 分组，
    `content` 支持纯字符串与 `ContentBlock` 数组（text / tool_use /
    tool_result），`compaction` 记录渲染为单行 `compacted` 摘要（与 live
    `context_compacted` 一致）。
  - 后端 `reflect_replay_session` / `reflect_export_session` 兜底：
    submodule 的 `reader::replay` 只查「今天/昨天/前天」三日窗口，三日以上
    的历史会话拿到空结果。`src-tauri/src/commands/sessions.rs` 新增
    `replay_session()`：快路径为空时全树扫描该 session 的所有文件
    （跨日期目录 + 轮转副本 `.1`~`.3`，按时间升序拼接），导出命令同步受益。
- **会话列表标题**：
  - `SessionInfo.title`（自定义名 / 首条 user 消息派生）此前未被前端使用，
    侧边栏固定显示 session_id 前 8 字符。`displayTitle`（`buckets.ts`）
    现优先展示 `title`，无标题时回退 id 前缀；`ReflectSessionInfo`
    （`src/utils/types.ts`）补齐 `title` / token 字段镜像。
  - 后端标题精化（`src-tauri/src/commands/sessions.rs::refine_session_titles`）：
    submodule 派生标题对 block 数组 `content`（user 消息新格式）会退化成
    整段 JSON 字符串（`[{"text":"…","type":"text"}]`），且从不合并
    `_names/<id>.name` 自定义名。列表命令现做两级精化：自定义名优先
    （镜像 TUI 语义）→ block-aware 首条 user 消息重派生（全树单次 walk）。
  - 新会话首条消息发送后自动 invalidate 会话列表 query，派生标题立即可见
    （不再等 5min staleTime）。
- **Composer 默认发送键**：裸 Enter 现在直接发送（Shift+Enter 换行；
  ⌘/Ctrl+Enter 保持兼容；IME composition 期间的 Enter 不发送）。
  发送按钮 tooltip 文案同步更新（en/zh-CN）。

### 新增 — 前端 token usage UI 接通

后端 `token_count` 事件（`TokenCountEvent`）早已由 `model_call` 节点每轮 emit，前端
reducer 也已写入 `state.tokens`，但此前没有任何 UI 消费这些数据。本次接通展示层：

- **StatusBar**（`src/features/shell/StatusBar.tsx`）：右侧新增 token/cost 指示器，
  显示 `total` + `cost`（`testid="statusbar-tokens"`），hover tooltip 展示完整细分
  （input/output/cached/cacheWrite/total/cost）。
- **Inspector**（`src/features/shell/Inspector.tsx`）：新增 "Token Usage" section，
  镜像 MCP/LSP section 结构，展示 input / output / cached（含 "input 子集" 提示）/
  cacheWrite（>0 时显示，含 "不计入 total" 提示）/ total（强调）/ cost / provider /
  credential。空态显示 "No token data yet."
- **字段补全**：reducer 此前丢弃了 `cache_write_tokens` / `provider` /
  `credential_label`，现已对齐后端 `TokenCountEvent`；同时 `session_configured` 的
  `context_window_size` 也存入 `state.contextWindowSize`（为后续 usage 占比预留）。
- **斜杠命令引导**：`/usage` / `/cost` / `/context` / `/stats` / `/insights` /
  `/ctx_viz` 从 no-op stub 改为返回引导提示（指向 StatusBar/Inspector），保持
  `executeSlash` 纯函数契约。
- **i18n**：`inspector.*` 命名空间新增 token 相关文案（中英双语）。
- **测试**：`agentStore.test.ts` 补全 token_count + session_configured 字段断言；
  新增 `Inspector.test.tsx` / `StatusBar.test.tsx` 组件测试。
- **Tooltip 多行支持**：design-system `Tooltip` primitive 新增可选 `multiline`
  prop（CSS `white-space: pre-line`），让 StatusBar token tooltip 的
  `\n`-joined 细分真正换行渲染；默认关闭，不影响现有单行 tooltip。

> 注：未接入 `ContextRing` 圆环——后端无 token **分类**细分（仅有计费维度），硬套
> 5 段分类会制造虚假精确感；列为未来增强（需后端先提供分类 usage）。

### 新增 — Phase 3 纯本地功能批次（KMS + Autopilot + 听写接线）

补齐所有剩余的纯本地功能，不依赖云服务、SSO 或第三方 API。IM 桥接（Phase 2 第 7 项）
与多租户/SSO/云（Phase 3 第 14 项）明确跳过，因为它们依赖外部服务。

- **Phase 2 第 6 项：听写（Dictation）** — UI + hook + i18n + 路由此前已完成；
  补上缺失的 ActivityBar 入口（`/dictation`，Mic 图标）+ `shell.nav.dictation`
  i18n 键（en/zh-CN）。
- **Phase 3 第 12 项：KMS（知识管理系统）**：
  - **新 `app-core::kms` 模块**（`app-core/src/kms.rs`）：`KnowledgeManager`，提供
    基于 grep 的 wiki 存储（`~/.reflect/kms/<name>/pages/*.md`）、frontmatter
    解析（title/tags/description）、全文搜索和 `/dream` 会话挖掘。
    6 个单元测试全部通过。
  - **后端命令**（`src-tauri/src/commands/kms.rs`）：8 个命令 —
    `reflect_kms_list` / `reflect_kms_create` / `reflect_kms_delete` /
    `reflect_kms_save_page` / `reflect_kms_get_page` / `reflect_kms_list_pages` /
    `reflect_kms_search` / `reflect_dream`。
  - **前端包装**（`src/utils/commands/kms.ts`）：8 个函数 + 4 个类型。
  - **功能 UI**（`src/features/kms/`）：`KmsView.tsx`，含 wiki 选择 tab、
    页面列表、内联编辑器和全局搜索栏。
  - **状态接线**：`MinimalAgentInner.kms_manager` + facade `kms_manager()`。
- **Phase 3 第 10 项：Autopilot**：
  - **新 `app-core::autopilot` 模块**（`app-core/src/autopilot.rs`）：
    `AutopilotManager`，基于 JSON 的配置持久化 + 运行历史。
    `AutopilotConfig`（enabled/schedule/taskTemplate/agent/maxConcurrent）+
    `AutopilotRun` + `AutopilotRunStatus`。4 个单元测试全部通过。
  - **后端命令**（`src-tauri/src/commands/autopilot.rs`）：3 个命令 —
    `reflect_get_autopilot_config` / `reflect_update_autopilot_config` /
    `reflect_autopilot_history`。
  - **前端包装**（`src/utils/commands/autopilot.ts`）：3 个函数 + 2 个类型。
  - **功能 UI**（`src/features/autopilot/`）：`AutopilotView.tsx`，含配置
    编辑表单（enable/schedule/template/agent/concurrency）+ 运行历史面板。
  - **状态接线**：`MinimalAgentInner.autopilot_manager` + facade `autopilot_manager()`。
- **路由 + 导航**：注册 `/kms` + `/autopilot` 路由；
  `ActivityBar` 新增 KMS（BookOpen 图标）和 Autopilot（Zap 图标）入口；
  i18n `shell.nav.kms` + `shell.nav.autopilot`（en/zh-CN）。
- **验证**：`cargo check` ✅、`cargo test -p reflect-app-core` ✅（42 通过）、
  `pnpm typecheck` ✅、`pnpm test` ✅（61 文件 / 524 测试）。

### 新增 — Phase 3 第 8/9/11/13 项（Squad + Activity + Actor + Media Studio）

最后一批纯本地功能：补齐 Phase 3 路线图中所有不依赖云服务、SSO、第三方 API
或未经验证的外部桌面自动化 crate 的条目。

- **Phase 3 第 8 项：多态 Actor（语义层）** —
  - `app-core/src/actor.rs`：`ActorType`（Human / Agent / System）、
    `ActorKind`（User / Lead / Member / System）、`Actor { actor_type,
    actor_id, kind, display_name, team_name }`（camelCase serde）。
  - 辅助方法：`Actor::user()` / `system()` / `agent(team, role)` /
    `from_agent_id()` + `actor_from_team_member(&TeamMemberSpec)` +
    `encode_metadata` / `decode_metadata`，用于经 `Task.metadata.actor`
    往返序列化。不重构 vendor `Task` schema。
  - 12 个单元测试覆盖 `actor_type` / `actor_kind` 序列化、lead
    角色检测、metadata 往返、默认 = user。
- **Phase 3 第 9 项：Inbox + Activity 时间线 + @提及** —
  - `app-core/src/activity.rs`：`ActivityLogger`，内存环形缓冲（上限 500）+
    JSONL 持久化到 `~/.reflect/activity/`（1 MB 轮转）+ `record` /
    `list(filter)` / `search_mentions(q)` / `clear_memory`。
    `ActivityEvent { id, ts_ms, kind, actor, summary, task_id?, team_name?,
    level }`；`ActivityFilter` 按 kind / level / actor_id / team_name /
    since_ms 匹配。
  - `src-tauri/src/state/activity.rs`：独立的 broadcast 订阅者，
    将每条 `reflect_protocol::Event` 映射为 `ActivityEvent`
    并经 logger 写入。与 `forward_agent_events` 并行运行
    （互不干扰）。
  - `src-tauri/src/commands/activity.rs`：4 个命令 —
    `reflect_list_activity` / `reflect_search_activity` /
    `reflect_clear_activity` / `reflect_activity_count`。
  - `src/utils/commands/activity.ts`：TypeScript 包装 + `Actor` /
    `ActivityKind` / `ActivityLevel` 类型 + `extractMentions(text)`
    辅助函数（regex `@[a-z0-9_@-]+`）。
  - `src/utils/commands/squad.ts`：re-export。
  - `src/features/notifications/useActivityController.ts`：TanStack
    Query 控制器（activity + mentions 子查询）。
  - `src/features/notifications/NotificationsView.tsx`：重构为
    经 `SegmentedControl` 切换的三个 tab — **Inbox**（既有实时
    store 派生的 pending 项）、**Activity**（带 level 过滤 + 清除
    按钮的审计时间线）、**Mentions**（`@<query>` 输入框 +
    搜索结果）。
  - `ActivityLogger` 注入 `MinimalAgentInner` +
    `subscribe_activity_logger` 在 `install_agent_thread`
    中启动（线程之后、cron 调度器之前）。
  - 12 个 activity 单元测试（环形淘汰、过滤、持久化
    往返、mention 搜索）。
- **Phase 3 第 11 项：Squad + Leader 委派** —
  - `app-core/src/squad.rs`：`SquadSpec`（name、description、
    leader_actor、members、created_at_ms）+ `SquadMember { actor,
    role, model, system_prompt, allowed_tools }` + 包装
    `Arc<reflect_task::TaskManager>` 的 `SquadManager`。方法：
    `create_squad(spec)` 以 `TeamFile` upsert（`team-lead@<name>`
    lead + 映射后的 member spec）；`list_squads()` / `get_squad(name)` /
    `delete_squad(name)`；`delegate_next(squad_name, leader_id)`
    调用 vendor `claim_next_available`，以 per-list mutex 安全地
    原子认领首个 Pending + 已解除阻塞的任务；
    `assign_task(squad_name, task_id, assignee)` 经 vendor `TaskPatch`
    写入 `owner` + `metadata.actor`。
  - 不重构 vendor Team/Task schema；squad 通过既有的
    `~/.reflect/teams/<name>.json` 文件存储。
  - `src-tauri/src/commands/squad.rs`：6 个命令 —
    `reflect_list_squads` / `reflect_create_squad` /
    `reflect_get_squad` / `reflect_delete_squad` /
    `reflect_delegate_next` / `reflect_assign_squad_task`。
  - `src/utils/commands/squad.ts`：包装 + `ReflectSquadSpec` /
    `ReflectSquadMember` 类型。
  - `src/features/squad/`：`SquadView`（master-detail：左侧 squad 列表
    + 创建表单，右侧所选 squad 的 members + tasks + "Delegate next"
    按钮 + 每任务 assignee 下拉）+ `useSquadController`（TanStack Query，
    含 create / delete / delegate / assign mutations）+ CSS module +
    barrel + 3 个测试。
  - 12 个 squad 单元测试（CRUD、validate、spec↔TeamFile 往返、
    delegate、带 actor metadata 往返的 assign）。
- **Phase 3 第 13 项：Media Studio + Computer Use（仅元数据
  脚手架）** —
  - `app-core/src/media.rs`：`MediaAsset`（path / filename /
    size_bytes / mime_type / width / height / modified_at_ms）+
    `ImageProcessSpec` / `ImageProcessResult` + `ImageFormat`
    （Png / Jpeg / Gif / WebP / Bmp）+ `scan_dir_for_assets(dir)`
    （基于 stdlib，无外部依赖）+ `BackendCapability` enum +
    `ImageBackend` / `ComputerBackend` traits +
    `ComputerUseAction`（Screenshot / MouseMove / MouseClick /
    KeyType / KeyCombo / Scroll，`#[serde(tag = "kind")]`）。
  - 默认后端：`MetadataOnlyBackend`（仅读文件头）+
    `UnavailableComputerBackend`（返回
    `MediaError::Unavailable` 并附 capability 原因）。需要真实
    `image` / `xcap` / `enigo` cargo 依赖的命令会优雅地
    返回 `MediaError::Unavailable` 而非 panic，
    因此该功能在 dev / CI / headless 下可用。
  - `src-tauri/src/commands/media.rs`：5 个命令 —
    `reflect_list_media` / `reflect_image_process` /
    `reflect_screenshot`（base64 编码的 PNG 字符串）/
    `reflect_computer_use` / `reflect_media_capabilities`。
  - `src/utils/commands/media.ts`：包装 + 类型
    （`ReflectMediaAsset` / `ReflectImageProcessSpec` /
    `ReflectComputerUseAction` / `ReflectMediaCapabilities`）。
  - `src/features/media/`：`MediaView`（经 `SegmentedControl` 的
    2 个 tab — **Studio** 列出用户输入目录中的 asset；
    **Computer Use** 提供 screenshot / click / move / scroll /
    keytype / key combo 控制卡片，并优雅显示
    `MediaError::Unavailable`）+ `useMediaController`（TanStack
    Query）+ CSS module + barrel + 3 个测试。
  - 12 个 media 单元测试，覆盖格式检测、Asset 序列化、
    action 摘要、后端错误路径和 `scan_dir` 过滤。
  - **注**：真实的图像处理 / 截屏 / 鼠标键盘控制需要
    `image` / `xcap` / `enigo` cargo crate。本批次有意
    不将它们加入 `Cargo.toml` —— 契约是稳定的，
    把默认后端换成真实实现只是局部改动。
- **路由 + 导航**：注册 `/squad` + `/media` 路由；
  `ActivityBar` 新增 Squad（Users 图标）+ Media（Image 图标）
  入口；i18n `shell.nav.media`（en/zh-CN）。`shell.nav.squad`
  已在听写批次中加入。
- **验证**：`cargo check` ✅、`cargo test -p reflect-app-core`
  ✅（90 通过；12 actor + 12 activity + 12 squad + 12 media + 42
  既有）、`pnpm typecheck` ✅、`pnpm test` ✅（63 文件 / 530
  测试）。

### 新增 — Phase 2 第 2 项：远程 daemon / Tailscale 助手 / iOS 配置 UI

Phase 2 首个条目：用户驱动的并发 agent 编排（相对于模型驱动的 `Task`
subagent）。每个 side-channel 在自己的 `CancelToken` 上与主 agent 并发
运行 —— 主 agent 的 `Cmd+C` 不会停止它。

- **新 `app-core::side_channel` 模块**（`app-core/src/side_channel.rs`）：
  - `SideChannelRegistry`（进程级）+ `SideChannelHandle`（每次运行）。
  - 稳定 id `side-<8hex>`，冲突时确定性 salt 重试。
  - 经 `tokio::sync::broadcast::Sender<SideChannelEvent>` 发出
    `Started` / `Done` / `Cancelled` / `Error` / `Output` 事件 —— 既有
    Tauri 事件转发器可接收，并以 `reflect_event` 消息（标记
    `kind: side_channel_*`）呈现给前端。
  - 6 个单元测试（start 返回 id + cancel token / cancel 发出事件 /
    对已终结的取消是 noop / finish done/error 状态迁移 /
    独立 cancel / cancel 不阻塞后续 start）。
  - `app-core/Cargo.toml` 新增 `tokio-util = { workspace = true, features = ["rt"] }`
    以支持 `CancellationToken`。
- **后端接线**：
  - `MinimalAgentInner.side_channels` 持有 `SideChannelRegistry`（在
    `build_empty_inner` 中构建，故安装前即就绪）。
  - 供命令层使用的 facade `MinimalAgent::side_channels()`。
  - `src-tauri/src/commands/side_channel.rs` 新命令：
    `reflect_start_side_channel` / `reflect_cancel_side_channel` /
    `reflect_list_side_channels` / `reflect_get_side_channel`。
  - 6 个单元测试覆盖 start/get/cancel + finish 状态迁移。
- **前端包装**（`src/utils/commands/side_channel.ts`）：
  - 4 个函数 + `ReflectSideChannelInfo` / `ReflectSideChannelStatus` /
    `ReflectStartSideChannelResult` 类型。
  - Index barrel 新增 re-export；`commands.test.ts` 增加 3 条转发
    断言（list/get 无参数、start 转发 `{ agent_name, prompt }`、
    cancel 转发 `{ id }`）。
- **功能 UI**（`src/features/side-channel/`）：
  - `SideChannelView.tsx` — PageShell + 运行计数徽标 + Start 表单
    （agent 名 + prompt）+ 列表行（id / agent / prompt / 时长）+
    运行行上的取消按钮。
  - `useSideChannelController.ts` — TanStack Query + start/cancel
    mutations，带 toast + 5s 轮询 refetch。
  - 5 个冒烟 + 行为测试。
- **路由 + 导航**：注册 `/side-channels` 路由；`ActivityBar`
  新增 Side-channels 入口（`Workflow` 图标）；i18n
  `shell.nav.sideChannels`（en/zh-CN）。
- **范围说明**（后续计划）：真正运行 side-channel 的运行时 driver
  （把 prompt 作为 `Submission::user_input` 提交到 agent
  循环并在完成后更新注册表条目）尚未实现。
  当前视图展示注册表状态并提供 create/cancel；
  driver 是 Phase 2 下一个子项。
- **验证**：`cargo check` ✅、`cargo test commands` ✅（27 通过）、
  `pnpm typecheck` ✅、`pnpm test` ✅（60 文件 / 516 测试）。

### 新增 — Phase 2 第 2 项：远程 daemon / Tailscale 助手 / iOS 配置 UI

Phase 2 第二个条目：桌面 daemon 状态呈现 + Tailscale 网络助手
+ iOS 配置入口。为远程客户端（iOS）经 Tailscale 连接到
ReflectDesktop 实例提供建设基础。

- **新 `app-core::tailscale` 模块**（`app-core/src/tailscale.rs`）：
  - `TailscaleStatus` 结构体（installed/running/dns_name/ipv4/ipv6/suggested_remote_host）。
  - `detect()` — shell 调用 `tailscale status --json=true`，解析 JSON 输出，
    任何失败（缺二进制、非零退出码、解析错误）都返回降级状态。
  - `daemon_command_preview()` — headless daemon 配置的提示字符串。
  - `derive_suggested_host()` — 优先 DNS 名（如 `node.tail.net`），回退到 IPv4。
  - 6 个单元测试（4 同步 + 2 异步）：建议 host 推导（DNS/IPv4/无）、
    降级状态形状、daemon 命令预览含默认端口、
    即使 tailscale 缺失 detect 也返回状态而不 panic。
- **远程配置状态**（`src-tauri/src/state/remote_config.rs`）：
  - `RemoteConfig`（host/port/auth_token/auto_connect）+ 返回
    `<host>:<port>` 字符串的 `endpoint()` 方法 + 检查 host 是否已设置的
    `is_ready()`。
  - `RemoteStatus`（state/message/endpoint/since_ms）用于连接跟踪。
  - 默认配置：host/port/auth_token/auto_connect 全为 null 或空。
  - 4 个单元测试：默认 endpoint 使用默认端口、设置 host 后
    is_ready 为真、host 为空时 is_ready 为假、断开状态携带 since_ms。
- **后端接线**：
  - `MinimalAgentInner.remote_config: RwLock<RemoteConfig>`（在
    `build_empty_inner` 中以默认配置构建）。
  - 供命令层使用的 facade 访问器 `MinimalAgent::remote_config()`。
  - `src-tauri/src/commands/remote.rs` 新命令：
    `reflect_get_remote_config` / `reflect_update_remote_config` /
    `reflect_get_remote_status` / `reflect_tailscale_status` /
    `reflect_tailscale_daemon_command_preview` /
    `reflect_tailscale_daemon_start` / `reflect_tailscale_daemon_stop` /
    `reflect_tailscale_daemon_status`。
  - `RemoteConfigSnapshot`（camelCase serde）携带 endpoint + is_ready 标志。
  - 3 个单元测试：snapshot endpoint/ready 标志处理、端口默认、
    更新配置往返。
- **前端包装**（`src/utils/commands/remote.ts`）：
  - 8 个函数 + `ReflectRemoteConfigSnapshot` / `ReflectRemoteStatus` /
    `ReflectTailscaleStatus` 类型。
  - Index barrel re-export；`commands.test.ts` 增加 8 条转发断言
    （带默认值的 config get/update、无参数的 tailscale status、
    无参数的 daemon 命令 preview/start/stop/status）。
- **功能 UI**（`src/features/remote/`）：
  - `RemoteView.tsx` — PageShell + 4 个卡片区块：iOS 配置（host/port/auth/
    auto_connect 编辑表单 + 保存）、Tailscale 检测（状态徽标 + DNS 名 +
    IPv4 显示）、Daemon 提示（命令预览 + 复制到剪贴板）、传输状态
    （断开/连接状态显示）。
  - `useRemoteController.ts` — 4 个 TanStack Query 查询（remote config、
    remote status、tailscale status、daemon 命令预览）+ update mutation
    + iOS 配置表单的草稿编辑状态。
  - `RemoteView.module.css` — 纯 token 卡片布局样式。
  - 5 个测试：页面标题、4 张卡片可见、ready 徽标 + endpoint 显示、
    tailscale 字段渲染、daemon 预览文本展示、保存转发 update。
- **路由 + 导航**：注册 `/remote` 路由；`ActivityBar`
  新增 Remote 入口（`Wifi` 图标）；i18n `shell.nav.remote`（en/zh-CN）。
- **范围说明**（后续计划）：真正的 TCP JSON-RPC daemon 二进制
  （`src-tauri/src/bin/reflect_daemon.rs`）尚未实现 —— 需要
  独立的 workspace crate 和交叉编译目标。iOS 客户端
  应用也尚未启动。当前实现先提供桌面配置
  界面与 Tailscale 网络检测作为前置。
- **验证**：`cargo check` ✅、`cargo test -p reflect-app-core -- tailscale`
  ✅（6 通过）、`cargo test -p reflect-desktop -- remote` ✅（7 通过）、
  `pnpm typecheck` ✅、`pnpm test` ✅（61 文件 / 524 测试）。

### 新增 — Phase 1 第 3 项：Agent 定义管理（profile UI）

落地 Phase 1 第 3 项的最后一个切片：端到端的 agent profile 管理。
现在可以在桌面端创建 / 编辑 / 删除 agent 定义，
以 Markdown + YAML frontmatter 形式存储于 `~/.reflect/agents/<name>.md`，
与 TUI/CLI 共享。

- **依赖**：`src-tauri/Cargo.toml` 新增
  `reflect-agent-def = { workspace = true }` + `serde_yaml`
  （serde_yaml 用于保存时的 frontmatter 序列化；
  vendor crate 仅提供解析器）。
- **后端命令**（`src-tauri/src/commands/agents.rs`）：
  - `reflect_list_agent_defs` / `reflect_get_agent_def` /
    `reflect_save_agent_def` / `reflect_delete_agent_def` /
    `reflect_parse_agent_md`（无副作用的预览/校验）。
  - 保存时序列化 frontmatter（YAML，省略空的 optional 字段）+ body，
    然后重新解析写入的文件做往返校验。
  - 路径安全：`path_for()` 拒绝名称中的空 / `..` / 斜杠 / 反斜杠 /
    NUL，防止越出 `~/.reflect/agents/` 的路径穿越。
  - 错误映射：`From<AgentDefError> for CommandError`。
  - 4 个单元测试：序列化往返、minimal 省略 optional、
    路径穿越拒绝、文件名构建。
- **前端包装**（`src/utils/commands/agents.ts`）：5 个函数 +
  `ReflectAgentDef` / `ReflectMemoryScope` 类型。`index.ts` re-export；
  `commands.test.ts` 中 4 条转发断言。
- **功能 UI**（`src/features/agents/`）：
  - `AgentsView.tsx` — PageShell + 列表行（name / description / model /
    readonly / spawnable 徽标）+ New 按钮。
  - `AgentEditor.tsx` — 全字段编辑器：name / description / model /
    tools（csv）/ disallowed_tools（csv）/ spawnable / readonly /
    max_turns / max_result_chars / memory scope / system_prompt（markdown
    body）。编辑时锁定名称（重命名会改变文件）。
  - `useAgentsController.ts` — query + save/delete mutations + 草稿状态。
  - 5 个冒烟 + 行为测试。
- **路由 + 导航**：注册 `/agents` 路由；`ActivityBar` 新增
  Agents 入口（`Bot` 图标）；i18n `shell.nav.agents`（en/zh-CN）。
- **验证**：`cargo check` ✅、`cargo test commands` ✅（21 通过）、
  `pnpm typecheck` ✅、`pnpm test` ✅（59 文件 / 508 测试）。

### 新增 — Phase 1 第 2 项：Schedule（cron）命令面 + UI

端到端落地 cron 驱动的自主触发（后端 → 包装 → UI）。vendor
`reflect-stream::cron::CronScheduler` 现已接入桌面端：
`install_agent_thread` 注入真实的 `AgentThread::submission_sender()` 并
启动 30s driver tick；到期的 job 会把其 `prompt` 作为
`Submission::user_input` 发送到 agent 循环。

- **依赖**：`src-tauri/Cargo.toml` 新增
  `reflect-stream = { workspace = true }`。
- **状态注入**：`MinimalAgentInner.cron_scheduler:
  RwLock<Option<CronScheduler>>`（安装前为 None）。facade
  `MinimalAgent::install_cron_scheduler(sender)` 用真实 sender 构建调度器，
  迁移既有 job，启动 30s driver 并写回。
  供命令层使用的 `cron_scheduler()` 访问器。
- **后端命令**（`src-tauri/src/commands/schedule.rs`）：
  - `reflect_list_schedules` / `reflect_add_schedule` /
    `reflect_update_schedule` / `reflect_remove_schedule` /
    `reflect_get_schedule_status`。
  - 错误映射：新增 `From<CronParseError> for CommandError`；`thiserror`
    `Display` 保留 variant 信息。
  - 3 个单元测试覆盖 create/list/update/delete 链、非法表达式
    拒绝和错误映射。
- **前端包装**（`src/utils/commands/schedule.ts`）：5 个函数 +
  `ReflectCronJob` / `ReflectScheduleStatus` 类型（snake_case vendor payload；
  camelCase 状态信封，对应 Rust `rename_all`）。`index.ts`
  新增 re-export；`commands.test.ts` 增加 4 条转发断言。
- **功能 UI**（`src/features/schedule/`）：
  - `ScheduleView.tsx` — PageShell + 状态徽标（`enabled/total active`）+
    内联创建表单 + job 行（schedule / prompt / next-fire + 开关 /
    移除）。
  - `useScheduleController.ts` — list + status 的 TanStack Query + 3 个
    mutations（add / toggle / remove），带 toast + invalidation。
  - `ScheduleView.module.css` — 仅用 design token。
  - 6 个冒烟 + 行为测试。
- **路由 + 导航**：注册 `/schedule` 路由；`ActivityBar` 新增
  Schedule 入口（`Clock` 图标）；i18n `shell.nav.schedule`（en/zh-CN）。
- **范围外（下一步）**：`run_now`（需要 vendor `pub async fn run_now(&self)`
  —— `CronScheduler::tick` 是 public 但读取私有的 `jobs` Arc；上游一行
  访问器是干净路径）、持久化（vendor 调度器是
  内存态；重启丢 job）、tick 间隔配置、一次性 `run_at`。
- **验证**：`cargo check` ✅、`cargo test commands::schedule` ✅（3/3）、
  `pnpm typecheck` ✅、`pnpm test` ✅（58 文件 / 499 测试）。

### 新增 — Phase 1 多 agent 功能 UI（Tasks 看板）

端到端补全 Phase 1 第 1 项（「Team/Task/Coordinator 命令面」）：
后端命令（上上个切片）和 IPC 包装（上个切片）现在可以在桌面功能
视图中驱动。多 agent 任务协调首次在 GUI 中可见、可操作。

- **新功能** `src/features/tasks-board/`：
  - `TasksBoardView.tsx` — 页面外壳，含 List / Board 视图切换
    （`SegmentedControl`）、活跃列表选择器（自由文本 list id + 来自
    `reflect_list_teams` 的 team chip）和内联创建表单。
  - `useTasksBoardController.ts` — `reflect_list_tasks` /
    `reflect_list_teams` 的 TanStack Query + 四个 mutations（create /
    claim / advance-status / delete），带 toast + 缓存失效。沿用
    `useMemoryController` 的形状（2026-07-25 重构先例）。
  - `TaskRow.tsx` — 展示性行，含 id / subject / claimer / 状态
    徽标 + 按状态的操作（Claim / Start / Complete / Delete）。
  - `TaskCreateForm.tsx` — 内联创建表单（subject / description / owner）。
  - `TasksBoardView.module.css` — 仅用 design token 的样式（无 inline
    hex），board 视图是 3 列网格，900px 以下折叠为 1 列。
  - `index.ts` — feature barrel。
- **路由**：`tasksRoute`（`/tasks`）注册到 `src/router.tsx`。
- **导航**：`ActivityBar` PRIMARY 分组新增 Tasks 入口
  （`FolderKanban` 图标）；新增 i18n 键 `shell.nav.tasks`（en/zh-CN）。
- **测试**：`TasksBoardView.test.tsx` — 8 个冒烟 + 行为用例，覆盖
  空态、创建表单提交、board 视图切换、带操作按钮的预置行，
  以及 claim / complete / delete 转发到正确命令。
  全套：57 文件 / 489 测试通过。
- **范围外（下一步）**：Phase 1 第 2 项 —— Schedule（cron）命令面
  （后端 `commands/schedule.rs` + 包装 `commands/schedule.ts` + UI）。

### 新增 — Phase 1 多 agent IPC 包装（前端）

为上个切片落地的 Task/Team 命令提供前端 TypeScript 包装。
这 10 个后端命令现在可从
`@/utils/commands`（以及兼容 barrel `@/utils/commands` /
`@/utils/tauri`）调用。

- **新包装**：
  - `src/utils/commands/tasks.ts` — `reflect_list_tasks` /
    `reflect_create_task` / `reflect_get_task` / `reflect_update_task` /
    `reflect_claim_task` / `reflect_delete_task` + 类型 `ReflectTask`、
    `ReflectTaskStatus`、`ReflectTaskPatch`、`ReflectTaskUpdateResult`、
    `ReflectTaskStatusChange`。
  - `src/utils/commands/teams.ts` — `reflect_list_teams` /
    `reflect_upsert_team` / `reflect_get_team` / `reflect_delete_team` +
    类型 `ReflectTeam`、`ReflectTeamMember`。
- **类型保真**：`Task` / `TeamFile` / `TeamMemberSpec` 逐字对应
  vendor serde 形状（snake_case，因为 Rust 类型未
  derive `rename_all = "camelCase"`）。只有 `TaskUpdateResult` 信封是
  camelCase（对应 `commands/tasks.rs` 中的 Rust
  `#[serde(rename_all = "camelCase")]`）。`TaskPatch` 用
  `T | null | undefined` 镜像 `Option<Option<T>>`
  三态。
- **Barrel 接线**：`src/utils/commands/index.ts` re-export 两个模块
  （置于 `hooks` 之后、`git` 之前）。兼容 barrel
  （`src/utils/commands.ts`、`src/utils/tauri.ts`）经既有的
  `export * from './commands/index'` 链自动获得。
- **测试**：`src/utils/commands.test.ts` 增加 8 条转发断言，
  锁定全部 10 个新包装的命令名 + 参数键不变量
  （沿用既有 per-domain 模式）。全套：
  56 文件 / 481 测试通过。

### 新增 — Phase 1 多 agent 命令面（Task / Team）

后端 `vendor/reflect-task` 早已实现完整的 `TaskManager` API
（Task/Team CRUD + 原子认领 + 依赖跟踪），但它既不是 Tauri 应用的
依赖也未暴露为命令。本次落地多 agent 桌面路线图
（`docs/reference-projects-survey.md` §10 Phase 1 第 1 项）的
第一个切片：把 `TaskManager` 接入 `MinimalAgentInner` 并暴露
10 个命令，让前端可以观察 / 驱动多 agent 协同。

- **依赖**：`src-tauri/Cargo.toml` 新增
  `reflect-task = { workspace = true }`。存储复用 vendor 默认 home
  （`~/.reflect/tasks/<list>/`、`~/.reflect/teams/<name>.json`），与
  TUI/CLI 共享 —— 无新配置项，不改 vendor。
- **状态注入**：`MinimalAgentInner` 现持有
  `Arc<reflect_task::TaskManager>`（Phase 0 形态：无 `hook_engine` /
  `event_sink`；它们在前端 UI 订阅任务生命周期事件时落地）。
  新增 facade 访问器 `MinimalAgent::task_manager()`。
- **命令**（`src-tauri/src/commands/tasks.rs`，注册于
  `src-tauri/src/lib.rs::invoke_handler`）：
  - Task：`reflect_list_tasks` / `reflect_create_task` / `reflect_get_task` /
    `reflect_update_task` / `reflect_claim_task` / `reflect_delete_task`。
  - Team：`reflect_list_teams` / `reflect_upsert_team` / `reflect_get_team` /
    `reflect_delete_team`。
- **返回类型整形**：`reflect_update_task` 返回扁平化的
  `TaskUpdateResult { task, updatedFields, statusChange? }` 而非
  vendor `UpdateOutcome`（其 `(TaskStatus, TaskStatus)` 元组对前端
  不友好且类型缺 `Serialize`）。以 camelCase 序列化
  以匹配既有 IPC 约定。
- **错误映射**：`commands/error.rs` 新增
  `From<reflect_task::TaskError> for CommandError`；`TaskError` 的
  `thiserror::Display` 确保不丢失
  variant 信息。
- **测试**：`commands::tasks` 覆盖 task create→get→update→list→claim→
  delete、team upsert→get→list→delete 和错误映射（3 个测试，
  全绿）。不启动 Tauri 运行时（沿用 `commands/sessions.rs` 模式）。
- **范围外（后续轮次）**：前端 IPC 包装
  （`src/utils/commands/{tasks,teams}.ts`）、功能 UI
  （`src/features/{tasks-board,agents}/`）、Task 生命周期事件的
  `hook_engine`/`event_sink` 注入、Schedule（cron）命令、Coordinator
  模式开关。

### 变更 — 结构重构（规范化实时状态文档）

结构重构后的规范化实时状态文档整理。无代码或
运行时行为变更；仅更新文档。模块布局重写为
与重构后的文件树一致。移除过时的硬编码计数（Tauri 命令
数、命名空间数等），改用「按域拆分」表述。

- **后端 `src-tauri/src/commands/`**：每个 `#[tauri::command]` 函数体现在位于
  `src-tauri/src/commands/<domain>.rs` 的按域模块中；薄壳
  `src-tauri/src/commands/mod.rs` re-export 它们。共享错误助手位于
  `src-tauri/src/commands/error.rs`（`CommandError` / `CommandResult`）。域
  模块涵盖 agent / allowlist / config / export / files / git / hooks /
  memory / search / sessions / shell / skills / update / workspaces。完整
  命令清单枚举于 `docs/PROTOCOL_BRIDGE.md` §2.0 并注册在
  `src-tauri/src/lib.rs::invoke_handler`。

- **后端 `src-tauri/src/` 支撑模块**：从
  `state.rs` 拆出的私有助手现与其并列：`hook_store.rs`、`memory_store.rs`、
  `shell_sessions.rs` 和 `workspace_state.rs`。public 模块仍为
  `state.rs`、`events.rs`、`dock.rs`、`menu.rs`、`shortcut.rs`、`tray.rs` 和
  `mcp.rs`。

- **前端 agent store**：Zustand store 实现现为
  `src/stores/agent/` 模块（`store.ts`、`reducer.ts`、`turns.ts`、`toast.ts`、
  `servers.ts`、`types.ts`、`useAgent.ts`、`index.ts`）。`src/stores/agentStore.ts`
  保留为薄兼容 facade，re-export `useAgentStore`、
  `reduceEvent`、`useAgent` 和来自 `./agent` 的类型联合。新代码应
  直接从 `@/stores/agentStore` 导入（或从 `./agent` 获得更细
  粒度）；旧 `src/services/agent.ts` re-export 继续可用。

- **Composer 归属**：`Composer` 现由 `src/features/composer/` 持有
  （`Composer.tsx`、`SlashPopup.tsx`、`MentionPicker.tsx`、`AttachmentBar.tsx`、
  `slashCommands.ts`、`slashEngine.ts`、`useComposerInput.ts`、
  `useComposerSubmission.ts`、`useAttachments.ts`、`usePromptHistory.ts`）。原先的
  `src/features/messages/Composer.tsx` 现为薄 re-export 垫片 ——
  `export { Composer } from '@/features/composer/Composer'` —— 因此既有
  导入继续可用。

- **Settings 拆分**：`src/features/settings/` 拆为：
  - 顶层外壳 —— `SettingsView.tsx`、`ConfigForm.tsx`、`configSchema.tsx`
  - `sections/` —— `DisplaySection.tsx`、`NotificationsSection.tsx`、
    `UpdatesSection.tsx`（各自带适用的 `.ssr.test.tsx`）
  - `components/` —— `StructuredField.tsx`、`ComplexEditors.tsx`、`index.ts`
    （共享表单原子 + 复杂区块编辑器）
  - `config/` —— `schema.ts`（按 `ReflectConfig` 区块的 FieldSpec 目录）、
    `toml.ts`（保持未知键完整的纯读/写助手）、`index.ts`
    （barrel）、`toml.test.ts`

- **前端 IPC 包装**：按域包装现在位于
  `src/utils/commands/<domain>.ts`，由
  `src/utils/commands/index.ts` 聚合。`src/utils/tauri.ts` 和 `src/utils/commands.ts`
  保留为兼容 barrel，从 `./bridge` + `./commands`
  + `./types` re-export。`src/utils/bridge.ts` 是底层 `invoke` / `listen` + Tauri
  上下文回退层，带 `isMissingTauriInvokeError` 守卫。

- **i18n 拆分**：运行时拆为
  `src/utils/i18n/{context.tsx,locale.ts,interpolate.ts,lookup.ts,types.ts}`；
  `STRINGS` 字典在 `src/utils/i18n/strings/index.ts` 中由
  `src/utils/i18n/strings/` 下的按命名空间目录模块合并组成
  （about / app / apps / chat / collaboration / common / composer / debug /
  design / dictation / files / git / home / inspector / memory / mobile /
  modal / models / notifications / palette / permissionMode / plan / prompts /
  settings / shell / sidebar / skills / slash / terminal / threads / toast /
  update / workspaces）。`src/utils/i18n.ts` 是兼容 barrel，
  re-export 运行时 API 及合并后的 `STRINGS` / `ALL_KEYS`。

- **Modal 拆分**：`src/features/modals/` 现在每个 modal body 一个
  `.tsx` —— `ApprovalModal.tsx`、`QuestionModal.tsx`、`AskUserModal.tsx`、
  `PlanReadyModal.tsx`、`ApprovalHistory.tsx` —— 外加共享的 `ModalShell.tsx`
  和 `index.tsx` 的 `ModalStack` 编排器。

- **Terminal / memory / shell 拆分**：有状态编排抽为
  同目录的 controller：
  - `src/features/terminal/TerminalView.tsx`（展示层）+
    `src/features/terminal/useTerminalController.ts`（sessions / lines /
    run / kill / clear）
  - `src/features/memory/MemoryView.tsx`（展示层，含 `MemoryRow.tsx`
    和 `MemoryAddForm.tsx`）+ `src/features/memory/useMemoryController.ts`
    （TanStack query + mutations + 过滤/编辑/新表单状态）
  - `src/features/shell/hooks/{useCommandPaletteShortcut,usePaletteActions,useThemeCycle}.ts`
    承担 shell 层交互。

- **文档更新**：`AGENTS.md`、`README.md`、`docs/codebase-map.md`、
  `docs/ARCHITECTURE.md`、`docs/PROTOCOL_BRIDGE.md` 和 `docs/CHANGELOG.md`
  重写为以重构后布局为规范的实时状态。changelog 之外无
  历史评注。所有引用路径均存在。

### 修复 — 核心 UX

- **窗口拖拽区**：TitleBar 的 `-webkit-app-region: drag` 现在真正生效。在
  `src/styles/base.css` 中加固 `[data-tauri-drag-region]`（`position: relative; z-index: 1;
  user-select: none`），避免 flex/transform 祖先截获拖拽。在
  `src/features/shell/TitleBar.module.css` 中对 `.bar` / `.left` / `.right` / `.title` / `.sessionStatus`
  显式声明 `-webkit-app-region: drag` 作为双保险。放宽
  `AppShell.module.css` 的 `.shell { overflow: clip }`（原为 `hidden`），让拖拽元素
  真正收到 mousedown。TitleBar 增加 `onMouseDown` 守卫，防止 webview
  抢焦点破坏原生拖拽。

- **全项目 i18n（英语 + 简体中文）**：`src/utils/i18n.ts` 从
  32 个键扩展到 **280+ 个键**、覆盖 24 个命名空间（`common`、`app`、`shell`、`sidebar`、
  `threads`、`composer`、`chat`、`settings`、`palette`、`modal`、`home`、`files`、`git`、
  `terminal`、`skills`、`workspaces`、`models`、`plan`、`prompts`、`notifications`、
  `about`、`apps`、`collaboration`、`debug`、`mobile`、`update`、`memory`、`dictation`、
  `design`、`toast`、`slash`、`permissionMode`、`inspector`）。此前硬编码英文文案的 43 个组件
  全部改为经 `useI18n()` 渲染。标题、aria-label、
  toast、命令面板条目、slash 命令、听写语言（`zh-CN` /
  `en-US`）、权限模式描述、配置 schema 字段标签与
  占位符、全部四个 modal（Approval / Question / AskUser / PlanReady）、
  ConfigForm 每个区块、每个路由视图（Home / Files / Search / Git / Terminal / Skills
  / Workspaces / Models / Plan / Prompts / Notifications / About / Apps / Collaboration
  / Debug / Mobile / Update / Memory / Dictation / DesignSystem）全部本地化。目录
  一致性由 `src/utils/i18n.test.ts` 保证（一致性 + 插值 + 复数 +
  回退）。持久化到 `localStorage` 并在切换时同步到 `<html lang>`。

- 新增持久化的英/简体中文本地化，Settings 中提供语言选择器，覆盖核心 shell、聊天、会话和设置 UI。
- 用全结构化表单取代仅覆盖 provider 的窄表单，为 `vendor/reflect-config/src/schema.rs` 支持的每个区块渲染直接输入项：`active`、`anthropic`、`openai`、`ollama`、`compact`、`token_budget`、`sandbox`、`routing.{main,compact,subagent}`、`coordinator`、`ask_user_question`、`model`、`analytics`、`notifications`、`postgres_session`、`sse_redis`、`bridge`、`voice`、`dap`、`acp`、`sanitize`、`plugins`、`feature_flags`、`mcp_servers`、`lsp_servers`、`hooks`、`subagent_providers`、`config_version`。每个输入项就地编辑并序列化 TOML；高级 raw TOML 编辑器仍作为兜底出口。
- 会话选择现在会重放所选 rollout、替换过期聊天轮次，并显示本地化的加载、空态、重试和错误状态。通过 request id ref 做竞态保护。

### 新增

- **外观定制**：Settings → Display 现提供 system/dark/light 主题、自定义强调色、可调表面透明度、持久的本地或 URL 背景图以及背景图强度。外观偏好从既有 `reflect.uiprefs.v1` 数据安全迁移并经共享 design token 应用；开启「减少透明度」时强制不透明表面并隐藏壁纸。
- `ConfigForm` 组件（`src/features/settings/ConfigForm.tsx`）与 `configSchema` 助手（`src/features/settings/configSchema.tsx`）。
- `src/features/messages/ChatView.test.tsx` 覆盖加载、空态、错误、重试、语言切换和会话清除流程（5 个用例）。
- 扩展 `SettingsView.test.tsx`，覆盖全部 25+ 个结构化输入和 `configSchema` 助手（5 个新用例）。

### 新增 — Batch 12（原生菜单接线 + 文档打磨）

- **原生菜单基础设施**：`src-tauri/src/menu.rs` 已提供 5 个子菜单
  （Reflect / Edit / Composer / View / Window），含 12 个带快捷键的菜单项：
  - Reflect：About / Check for Updates / Settings (Cmd+,) / Quit
  - Edit：Undo / Redo / Cut / Copy / Paste / Select All（Predefined）
  - Composer：Cycle Model (Cmd+M) / Cycle Reasoning (Cmd+R) / New Agent (Cmd+N) / Interrupt (Cmd+.)
  - View：Toggle Sidebar (Cmd+B) / Toggle Terminal (Cmd+T)
  - Window：Minimize / Zoom / Close
- **菜单事件转发**：`handle_menu_event` 向前端发出 `menu-*` 事件，覆盖
  Settings 导航、Cycle Reasoning、New Agent、Interrupt、Toggle Sidebar、Toggle Terminal。
  AppShell 增加 menu 事件监听器，经 `listen()` 处理这些事件。
- **听写 stub**：`DictationView` 显示 "Voice input coming soon"，带 Mic 图标
  及 Web Speech API / macOS Speech Recognition 路线图。
- **更新视图**：`UpdateView` 显示来自 ping 查询的当前版本、经
  `bash scripts/install.sh` 的手动更新说明，以及 tauri-plugin-updater 集成备注。
- **TitleBar ⌘K 提示**：右侧 Search 图标 + "⌘K" 键盘提示（带 tooltip），
  让 CommandPalette 更易被发现。
- **StatusBar 会话计数**：来自 `reflect_list_sessions` 的 MessagesSquare 图标 + 会话数，
  tooltip 为 "N sessions on disk"。
- **文档**：CHANGELOG.md + PROTOCOL_BRIDGE.md + codebase-map.md 更新覆盖
  全部 B1-B12 变更。342/342 测试全部通过；tsc 无错；cargo check 无错。

### 新增 — Batch 1 (协议层 + app-core 基础)

- **协议类型生成 (B1-01)**:给 `vendor/reflect-protocol` 的 `EventMsg` / `Op` /
  `Submission` / `UserInputItem` / `ContentBlock` / `Question` 等所有
  协议类型加上 `schemars::JsonSchema` derive。重写 `dump_schema` example
  真正从 Rust 导出 2944 行 JSON Schema(33 EventMsg + 15 Op variants +
  所有嵌套 payload)。新增 `scripts/dump-ts-types.sh` + `pnpm run types:gen`。

- **ReflectEvent union 类型 (B1-02)**:用 `EventMsgByType` discriminated
  union 重写 `src/types/protocol.ts`,使 `event.msg.type` 收窄 payload 形状。
  涵盖全部 33 个 EventMsg variant + 15 个 Op variant + 完整
  `UserInputItem` / `ContentBlock` / `ReviewDecision` / `AskUserAnswer` 等。

- **Submission 构造器 (B1-03)**:新建 `src/protocol/submissions.ts`,
  导出 `userInputText` / `userInputImage` / `userInputSkill` / `compact` /
  `rewind` / `shutdown` / `toolApproval` / `hookApproval` / `planApproval` /
  `enterPlanMode` / `exitPlanMode` / `setEffort` / `setPermissionMode` /
  `cyclePermissionMode` / `askUserQuestionResponse` / `askUserInputResponse`
  等 16 个 Submission 构造器,统一 id 生成。

- **reducer 覆盖全部 33 variant (B1-04)**:重写 `agentStore.ts::reduceEvent`
  处理 `turn_rewound` / `shutdown_complete` / `token_count` / `config_reloaded` /
  `routing` / `collab_started` / `collab_message` / `collab_finished` /
  `mcp_tool_invoked` / `lsp_server_started` / `lsp_server_failed` /
  `plan_request` / `plan_ready` / `plan_approved` / `plan_rejected` /
  `permission_mode_changed` 等之前被静默丢弃的事件。新增 store 字段:
  `tokens` / `collabSessions` / `mcpInvocations` / `lastRouting` /
  `configReloadedAt`。

- **reducer 单元测试 (B1-05)**:新增 `src/stores/agentStore.test.ts` 38 个
  单元测试覆盖所有 33 个 EventMsg variant。

- **agentEventBus fan-out 服务 (B1-06)**:新建 `src/services/agentEventBus.ts`
  —— 单 Tauri `reflect_event` 订阅 + 引用计数 + 消费者错误隔离。`agentStore`
  改用 bus 而非自开 listener;Inspector / Notifications / DevTools 可
  各自订阅同一事件流。7 个单元测试。

- **后端域管理命令 (B1-07)**:新增 12 个 Tauri 命令 + 状态方法:
  - `reflect_list_workspaces` / `reflect_set_workspace` / `reflect_current_workspace`(B9-06)
  - `reflect_list_skills`(B11-06)— 扫描 `~/.reflect/skills/**/SKILL.md` + `<cwd>/.reflect/skills/**/SKILL.md`
  - `reflect_list_memory` / `reflect_add_memory` / `reflect_remove_memory`(B11-01)
  - `reflect_list_hooks` / `reflect_toggle_hook`(B11-02)
  全部 12 个命令注册到 `src-tauri/src/lib.rs::invoke_handler`;TS 包装
  在 `src/utils/commands.ts`。

### 验证

- `cargo check -p reflect-protocol` ✓(76 单元测试通过)
- `cargo check src-tauri` ✓
- `cargo test -p reflect-desktop` ✓(5/5)
- `pnpm typecheck` ✓(0 errors)
- `pnpm test` ✓(257/257 通过)



### 修复 — 顶栏贯通 + 红绿灯避让 + drag region

- **根因**:`tauri.conf.json` 已设 `titleBarStyle: "Overlay"`(红绿灯按钮浮在
  webview 之上),但 React 树**没有任何元素为红绿灯预留避让空间**,
  `ActivityBar` 的 32px "R" logo 正好被 3 个圆点盖住。同时 `base.css` 的
  `[data-tauri-drag-region]` 规则虽然存在,**全代码库没有任何元素挂这个属性** ——
  整个窗口无法靠标题栏拖动。此外旧 `TitleBar` 只横跨主区(嵌在 `.main` 内),
  与 ActivityBar/Sidebar 视觉脱节,与「一条贯通全宽的深色顶栏」范式不符。
- **修复**:
  - `AppShell` 把 `TitleBar` 从 `.main` 内提升到 `.shell` 顶层(与 ActivityBar 同级、
    在它之前),顶栏现在横跨整个窗口宽度;`.body`(ActivityBar + Sidebar + Main + Inspector)
    全部从顶栏下方开始。
  - `TitleBar` 根元素挂 `data-tauri-drag-region`(整条顶栏可拖动窗口);内部 button/a/input
    由 `base.css` 既有规则自动 `no-drag`,sidebar/inspector toggle 仍可点击。
  - 新增 `--titlebar-height: 40px` / `--traffic-light-gutter: 80px` token;
    `TitleBar.module.css` 用 token 驱动高度 + 左 padding 为红绿灯让位。
- **回归保护**:`AppShell.test.tsx` 新增断言 TitleBar 是 `.shell` 的第一个子元素
  且挂了 `data-tauri-drag-region`。

### 修复 — 主内容区永久空白（严重回归）

- **根因**:`AppShell` 用 `children` prop 渲染主内容,但 TanStack Router v1 的
  root route component 不会收到 children —— 必须渲染 `<Outlet />` 才能把
  匹配到的子路由(HomeView / ChatView / SettingsView / …)挂到 DOM。
  现象:打开 app,ActivityBar / Sidebar / TitleBar / StatusBar 都正常,
  **唯独中间主区域永远是空白**(无论点哪个路由)。
- **修复**:`AppShell` 改用 `<Outlet />`;同步更新 `AppShell.test.tsx` +
  `app.smoke.test.tsx` 的 Outlet mock,新增回归测试断言 Outlet 内容真的挂载。
- **StatusBar 模型显示**:之前 store.session 为空时永远显示 "no model",
  哪怕后端 `reflect_agent_status` 查询返回了真实 model —— 现在按
  store.session → statusQuery.data.has_model → "no model" 三级 fallback,
  并把 `degraded_reason` 作为 tooltip 暴露。
- **TitleBar session 文案**:`session: (waiting...)` → `(waiting…)`(排版),
  并在 statusQuery 有 model 时显示真实 model 名,而不是永远 "waiting"。

### 变更 — UI 全面重建收尾（打磨 + a11y + 测试 + 文档）

#### 功能性 bug 修复
- **`AppShell.Sidebar` 接线**:`onNewChat` 接入 → 导航 `/chat` 并清 active；`onSelect`
  同步 URL（`/chat/$sessionId`）+ 本地高亮。之前 "New chat" 按钮点击无反应。
- **`ChatView` 读 sessionId**:显示当前 viewing session banner（info 色 + monospace ID）。
- **`ActivityBar` active 边界修复**:`pathname.startsWith(prefix + '/')` 取代裸 `startsWith`,
  避免 `/git` 误匹配 `/github-webhook`。`aria-current="page"` 加到当前路由图标。

#### ModalShell 加固
- `aria-modal="true"` + `role="dialog"` + `tabIndex={-1}`。
- **焦点陷阱**:Tab/Shift+Tab 在 dialog 内循环,打开聚焦 primary,关闭还原焦点。
- **Enter 收紧**:仅当焦点在 dialog 容器自身（非 INPUT/TEXTAREA/SELECT/BUTTON）
  时触发 primary,避免输入表单时误提交。
- **响应式**:`<480px` 时 dialog 自适应到视口宽度,无溢出。
- 新增 `ModalShell.test.tsx` (7 测试:open 切换/Esc/overlay 点击/内部点击/footer
  省略/焦点还原)。

#### AppShell / 响应式 / a11y
- **响应式布局**:`<1100px` Inspector 变窄;`<900px` Sidebar+Inspector 转 absolute
  overlay;`<600px` Main 占满。
- **`MessageList` 空态优化**:从裸文字升级为 EmptyState 风格(图标 + 标题 +
  快捷键提示),加 `role="log"` + `aria-live="polite"` + `aria-label="Conversation"`。
- **`Composer` a11y**:`textarea` 加 `aria-label="Message Reflect"` + `autoFocus`;
  toolbar slash 按钮加 `aria-label`。
- **`Input/Textarea` a11y**:`invalid` 映射 `aria-invalid`。
- **`AppShell` a11y**:两个 `<aside>` 加 `aria-label="Sessions"|"Inspector"`。
- **WCAG AA 对比度修复**:`--text-muted` 深色 `#6b7488→#828c9f`,浅色
  `#8a93a6→#6b7488`,占位/提示文本达到 4.5:1。

#### 死代码清理 + i18n
- **删除 `SessionsView.tsx`**:死代码（Sidebar 包装,未被任何路由挂载）。从 sessions
  barrel 移除,更新 smoke test 和 README。
- **`i18n` 接入**:`DEFAULT_LOCALE` 改为 `en`(UI 主体语言),新增
  `composer.placeholder` / `chat.empty.title` / `chat.empty.hint` 三个键,中英双语
  一致。i18n 测试更新。

#### 文档同步
- **`docs/codebase-map.md`**:移除 `src/features/app/AppLayout.tsx`、`@widgets/*`、
  `(planned)` 标记;`shell/` 加入;`Composer` 路径纠正到 `features/messages/`。
- **`AGENTS.md`**:移除 `AppLayout`、`@widgets/*`、`Composer` 旧路径;`tokens.css`
  标记为 live;Hotspots 更新指向 `shell/`/`messages/`/`tokens.css`/`agentStore.ts`。
- **`docs/ARCHITECTURE.md`**:重写目录树(feature slice 枚举 `shell` 加入、`widgets/`
  移除);PROTOCOL_BRIDGE 不再标 `(planned)`;State flow 图更新反映 Zustand
  single store。
- **`src/features/sessions/README.md`**:入口说明更新为 `AppShell` 渲染 Sidebar。

#### 新增测试 (38 个, 总数 170→208)
- `shell/AppShell.test.tsx` (5):初始状态/sidebar 折叠/inspector 切换/双折叠 round-trip。
- `design-system/primitives/SegmentedControl.test.tsx` (8):role/aria-checked/onChange/disabled/hint/size。
- `features/notifications/NotificationsView.test.tsx` (8):空态/错误/4 个 pending 源/MCP&LSP/plan/过滤/dismiss。
- `features/modals/ModalShell.test.tsx` (7):open 切换/Esc/overlay 点击/Enter/footer/焦点还原。
- `utils/theme.test.ts` (9):localStorage/data-theme/subscribe/getResolvedTheme/initTheme/jsdom fallback。
- `utils/i18n.test.ts` (6):DEFAULT_LOCALE=en / 双语对齐。
- 修改 `MessageList.test.tsx` (中文→英文空态文案)。
- 修改 `app.smoke.test.tsx` (移除 SessionsView barrel 断言)。
- 修改 `Button.test.tsx` / `settings/SettingsView.test.tsx`(此前阶段)。

**全套 210 测试绿,生产 build 成功(CSS 76KB / JS 627KB)。**

### 新增 — Batch 7（按工具 ToolCells + 审批历史）

- **ToolCells (B7-05)**:新增 `src/features/messages/ToolCells.tsx`,
  per-tool 渲染 `tool_call` TurnItem。`ICON_MAP` 把
  `shell`/`bash`/`read_file`/`write_file`/`create_file`/`web_fetch`/`web_search`
  映射到专属 lucide 图标(Terminal / FileText / FileEdit / FilePlus /
  Globe / Search),未知 tool fallback `Wrench`。`summarize(name, args)`
  给出短摘要(`$ command` for shell,path for read_file 等)。
  `StatusIcon`(running=Loader2 spin / done=CheckCircle2 / error=XCircle)。
  折叠 header + 原始 args 详情。
- **MessageList 集成**:`tool_call` case 改用 `<ToolCell />` 替代通用
  `Collapsible`;删掉本地 statusIcon 计算。
- **ApprovalHistory (B7-03)**:新增 `src/features/modals/ApprovalHistory.tsx`,
  按 `decidedAt` 倒序展示历史 approval 决策(approve / approve_for_session /
  deny),带专属图标(CheckCircle2 / ShieldOff / XCircle)和 time 戳;
  可配置 `limit`、空态文案。
- **vitest setup**:`afterEach(cleanup)` 加入,避免 testid 跨测试泄漏。
- **jsdom polyfill**:`Element.prototype.scrollIntoView = noop`，
  让 autoscroll 组件在测试环境不报错。

### 新增 — Batch 11（记忆管理视图）

- **MemoryView (B11-01)**: 新 `src/features/memory/MemoryView.tsx`,
  通过 `reflect_list_memory` / `reflect_add_memory` / `reflect_remove_memory`
  与后端同步持久记忆。
  - Scope 过滤: All / Global / Project / Session 四个 tab,
    实时计数;`filterBar` + `addBtn` 一行完成。
  - 新增表单: scope select + key + value input + Save button,
    点击 Add 展开,Cancel 收起。
  - 内联编辑: 点击 edit → textarea + Save/Cancel; delete → Trash2。
  - 空态: "Add a key above or let the agent learn your preferences."
- **router**: 新增 `/memory` → `MemoryView` 路由。
- **测试**: MemoryView 5 个 vitest (title/filters/add toggle/form/empty state)。
  342/342 tests pass; tsc clean; cargo check clean。

### 新增 — Batch 10（CommandPalette + ⌘K 键映射 + StatusBar 会话计数）

- **CommandPalette (B10-01)**:新 `src/features/command-palette/` 目录
  - `CommandPalette.tsx`: 模态浮层 + 输入框 + 模糊匹配列表; ↑↓ 选择,
    Enter 触发,Esc 关闭; backdrop blur + 最大 30 条可见;
    支持 `to`(路由导航) / `slash`(/compact /interrupt 等) / `run`(回调)。
  - `registry.ts`: 45+ 条命令覆盖全部导航(Home/Chat/Sessions/Settings/Files/
    Models/Skills/Workspaces/Git/Terminal/Plan/Prompts/About/Update/
    Notifications/Debug/Apps/Collaboration/Dictation/Mobile/Design-system),
    Session actions(New/Clear all/Export/Save config),
    Slash actions(/compact /interrupt /clear /help /rename /export),
    Theme(cycle/dark/light/system + current)。
  - `fuzzy.ts`: 轻量模糊匹配(子序列 + 开头加权 + 连续匹配加分 + keywords);
    7 个单元测试覆盖。
- **AppShell ⌘K 集成**: `AppShell.tsx` 添加全局 keydown listener(⌘K / Ctrl+K
  toggle palette, Esc close); `CommandPalette` 挂载在 AppShell 底部。
- **TitleBar**: 右侧新增 `Search ⌘K` 键盘快捷提示(kbd hint + tooltip)。
- **StatusBar session count**: 新增 `reflect_list_sessions` 查询,
  在状态栏右侧显示 MessagesSquare 图标 + session 总数,
  带 tooltip(「N sessions on disk」)。
- **测试**: fuzzy 7 + CommandPalette 6 = 13 个新 vitest。337/337 tests pass;
  tsc clean; cargo check clean(无 Rust 变更)。

### 新增 — Batch 9（文件树 + 代码编辑器 + 工作区切换器）

- **Backend (B9-01)**:新 `reflect_list_dir(path?, maxDepth=4)` 返回
  `DirListing { root, entries, truncated }`,跳过 dotfile + node_modules /
  target / dist 等;封顶 2000 entries,按 dir→file,名称排序。`DirEntry`
  含 name/path/kind/size/mtime/depth。
- **Backend (B9-01)**:新 `reflect_read_file(path)` 返回
  `FileReadResult { path, content, size, binary, truncated }`,1 MiB 上限,
  NUL byte 判 binary(返回空 content),`canonicalize` 后必须仍在 workspace
  下(防 `..` 逃逸)。
- **Frontend FileTree (B9-01)**:新 `src/features/files/FileTree.tsx`,
  flat 列表按 parent path 构造折叠树,默认打开 depth-0 目录;按扩展名
  分文件图标 (Code/Text/Generic),size 显示(B/K/M)。5 个测试覆盖。
- **Frontend CodeEditor (B9-01)**:新 `src/features/files/CodeEditor.tsx`,
  只读代码预览,左 gutter 行号 + prismjs 高亮(13 种语言:
  rust/typescript/javascript/jsx/tsx/bash/json/yaml/toml/python/go/
  markdown/css/markup);不支持的扩展回退 plaintext;binary 文件显示提示;
  >1 MiB 标 "clipped to 1 MiB"。5 个测试覆盖。
- **FilesView 重写**:左 FileTree + 右 CodeEditor split 布局;顶 path bar
  + 刷新按钮;empty / error / loading 三态;`width="lg"`。
- **WorkspacesView 升级 (B9-04)**:每个非 active workspace 卡片右侧加
  "Use" 按钮(ghost sm size + ArrowRight 图标),点击调
  `reflect_set_workspace` 后 invalidate `agent-status` 缓存 + toast 反馈
  (success / error)。
- **测试**:FileTree 5 + CodeEditor 5 = 10 个新 vitest。324/324 tests pass;
  tsc clean;cargo check clean。

### 新增 — Batch 8（Terminal：真实 shell 执行 + 流式输出）

- **Backend (B8-01)**:`reflect_run_shell(cmd) -> ShellSession { id, command, cwd }`
  用 `tokio::process::Command` 启动 `/bin/zsh -lc` (macOS) / `/bin/sh -lc`。
  stdout/stderr 各起一个 `BufReader::lines()` 后台任务,通过
  `app.emit("reflect_terminal_output", ShellOutputChunk)` 流式推给前端;
  主任务 `wait()` 后再 emit 一条 `stream="exit"` 携带退出码。
  进程在 `MinimalAgent` 的 `shell_sessions: HashMap<id, Arc<Mutex<Child>>>`
  中保留 kill handle。`reflect_kill_shell(id)` 幂等,`start_kill + wait`;
  `reflect_list_shell_sessions()` 诊断。
- **Frontend**:新增 `ReflectShellSession` / `ReflectShellOutputChunk` 类型
  + `reflect_run_shell` / `reflect_kill_shell` / `reflect_list_shell_sessions` /
  `onTerminalOutput` 四个 IPC wrapper。
- **TerminalView 重写**:多 session tab 流(可点击切换)+ 行级流式渲染
  (`stdout`/`stderr`/`exit`/`error`/`info`/`input` 不同色)+ Kill 按钮
  + Clear 按钮 + 5K 行滚动裁剪 + autoscroll + 命令历史 input。
- **测试**:TerminalView 4 个 presentational tests;`scripts/dump-ts-types.sh`
  重新生成。

### 变更 — UI/UX 全面重建（阶段 4：剩余视图统一外壳 + stub 美化）
- **新增 `shell/PageShell`**:非 Chat 视图统一外壳(图标 + 标题 + 副标题 + 右侧操作 +
  滚动内容容器,sm/md/lg 三档宽度)。
- **剩余 13 个视图全部 CSS Modules 重写**:
  - **agent 操作类**:`Files`/`Git`/`Prompts` 卡片网格 + 快捷 prompt 按钮(sent 态 success
    反馈)。
  - **展示类**:`Skills`(工具表格 + Built-in/MCP 分组 badge)、`Collaboration`(MCP/LSP
    状态行 + 状态点 + future 卡)、`Workspaces`(workspace 卡片 + active 高亮)。
  - **信息类**:`About`(品牌卡 + info 表 + 链接)、`Update`(版本卡 + 命令块)。
  - **终端类**:`Terminal` 深色终端风(prompt + 命令输入 + CornerDownLeft 提示)。
  - **计划类**:`Plan` 计划卡片 + 编号步骤 + Approve/Reject DS Button(标注 sample data)。
  - **列表类**:`Threads` + `ThreadBucketGroup` + `ThreadItem`(active 高亮 + meta)。
  - **stub + dev**:`Apps`(sample data badge + Connect/Disconnect)、`Dictation`/`Mobile`
    (EmptyState coming soon)、`Debug`(深色 JSON 块 + 事件日志)。
- **ModalStack/ModalShell 视觉重写**:
  - `ModalShell`:header(title + close IconButton)+ body + footer(Deny/Approve for session/
    Approve 三按钮层级),backdrop blur,z-modal。
  - 4 个 modal(Approval/Question/AskUser/PlanReady)全部消费 token + CSS Modules。
- **品牌**:`index.html` title 改为 "Reflect Desktop"。
- **审计**:全 23 个 view 文件(19 路由 + Chat 三件套 + DesignSystem)100% CSS Modules 覆盖;
  view 层 inline style 硬编码颜色彻底清零(仅 Spinner 的动态 size prop 保留);
  emoji 图标全部替换为 lucide-react;M1.x scaffold 字样全部移除。
- **测试**:全套 170/170 绿,生产 build 成功(CSS 74KB / JS 625KB)。

### 变更 — UI/UX 全面重建（阶段 3：高频视图精修）
- **新增 primitive `SegmentedControl`**:分段选择控件(low/medium/high 互斥切换),
  支持 stacked 卡片式 + hint。
- **`SettingsView` 重写为 IDE 式二级导航 + 卡片**:
  - 左侧 nav(Provider / Permissions / Advanced)+ 右侧内容区。
  - 顶部始终可见的 Permission mode 快捷控件(auto/prompt/deny/plan)。
  - Provider 卡片:Anthropic/OpenAI 各一张,API key 带显隐切换(Eye/EyeOff IconButton),
    configured 时显示 success dot badge。
  - Permissions section:4 张 PermCard(带说明文案)。
  - Advanced:raw TOML 编辑器(等宽卡片)。
  - sticky Save 栏。
- **`HomeView` 重写为 dashboard**:
  - hero 区(R logo + 标题 + model/workspace 状态卡)。
  - Quick start 4 张大卡片(New chat / Workspaces / Models / Settings),hover 升起 + 箭头。
  - Recent sessions 卡片列表(相对时间 + token)。
  - 空态用 EmptyState primitive。
  - 新增 `/home` 路由 + ActivityBar Home 入口。
- **`ModelsView` 重写**:
  - Current model 大卡片(图标 + model 名 + ready badge + workspace)。
  - 降级态 EmptyState 引导去 Settings。
  - Reasoning effort 用 SegmentedControl(stacked + hint)+ Apply 按钮。
- **`NotificationsView` 重写**:
  - 顶部 error/pending 计数 badge。
  - All/Errors/Pending 过滤 tab。
  - 通知项 Card + 左侧语义色条(error/warn/info)+ lucide 图标。
  - 空态 EmptyState。
- **测试**:`SettingsView.test.tsx` 的 section 断言改 getAllByText(nav + section 同名)。
  全套 170/170 绿,生产 build 成功(CSS 51KB / JS 611KB)。

### 变更 — UI/UX 全面重建（阶段 2：IDE 式 Shell + 核心三件套）
- **新建 `src/features/shell/` IDE 三栏布局**:
  - `AppShell`:ActivityBar(56px) + Sidebar(可折叠) + Main + Inspector(可折叠) + StatusBar
    五区布局,取代旧的 Topbar/三栏/BottomBar 脚手架。
  - `ActivityBar`:lucide 图标导航(Chat/Files/Git/Terminal/Skills/Notifications +
    Settings/About),active 态从 `useLocation` 派生,tooltip 提示。
  - `TitleBar`:Main 顶部标题栏,显示当前 view 名 + session 状态(model @ provider /
    waiting) + permission badge + sidebar/inspector 折叠按钮。
  - `StatusBar`:底部状态栏,model@provider + 可点击循环 permission + workspace basename
    + MCP/LSP 失败计数 + 错误提示 + 主题切换按钮(Sun/Moon/Monitor 三态循环)。
  - `Inspector`:右侧面板,pending 交互计数 + MCP/LSP server 状态列表 + 最近错误。
- **核心三件套全部 CSS Modules 重写**:
  - `MessageList`:用户气泡右对齐 accent-subtle,助手左对齐 + R 头像 + markdown;
    thinking/tool_call/tool_output 统一用新抽出的 `Collapsible` 组件(左侧状态色条
    + lucide 图标 Brain/Wrench/CheckCircle/XCircle/Loader);streaming 光标改为
    CSS 脉冲块;移除顶部调试 session 行(已移到 TitleBar)。
  - `Composer`:卡片式容器(elevated bg + focus 环),toolbar 9 个 slash 命令 pill,
    底部 SlashSquare 触发按钮 + ArrowUp Send IconButton(primary 态),IME 安全
    Cmd/Ctrl+Enter。
  - `Markdown`:消费 token 的排版,代码块带 header(lang + Copy 按钮),Prism 深色
    okaidia 风格 token 配色。
  - `Sidebar` / `BucketGroup` / `SessionItem`:New chat 主按钮 + 搜索框 + 时间分桶
    + active 左边条 + token/meta 信息。
  - `SlashPopup`:深色阴影弹层 + 键盘选中高亮 + mono 字体命令名。
- **路由**:`router.tsx` root component 从 `AppLayout` 切到 `AppShell`;index 路由
  改为直接渲染 ChatView(HomeView 留待阶段 3 精修)。
- **清理**:删除死代码 `src/features/app/AppLayout.tsx` + `src/widgets/StatusBar.tsx`
  (旧 Topbar/BottomBar,M1.7 scaffold 字样彻底移除)。
- **主题**:`utils/theme.ts` 增加 jsdom 环境 matchMedia 防御。
- **测试**:更新 `MessageList.test.tsx`(session 状态行断言改为空态提示)、
  `app.smoke.test.tsx`(AppLayout → AppShell 断言 + 补 useLocation/useMatches mock)。
  全套 170/170 绿,生产 build 成功(CSS 37KB / JS 600KB)。

### 变更 — UI/UX 全面重建（阶段 1：设计系统地基）
- **`tokens.css` 深色优先重写**:`:root` 即深色主题(IDE 风,4 级背景层次
  `--bg-app/surface/elevated/input`),`[data-theme="light"]` 覆盖为浅色,
  `prefers-color-scheme` 媒体查询支持 system 模式。语义色(success/warning/danger/info)
  各含 fg/bg/border 三态。新增间距(9 档)、字号(9 档)、圆角、阴影、z-index、transition
  token。原 `--bg/--ink/--muted` 等旧 token 已移除。
- **新建 `base.css`**:全局 reset(box-sizing/margin/padding)、`body` 消费 token、
  滚动条(macOS 风细滚动条)、`::selection`、`:focus-visible` 全局环、
  `[data-tauri-drag-region]` 拖拽区、`prefers-reduced-motion` 无障碍。
- **新建 `typography.module.css`**:h1-h4 / body / caption / mono / label 排版原子类。
- **新建 `utils/theme.ts`**:主题切换基础设施(light/dark/system),localStorage 持久化,
  `subscribeTheme` 订阅,`initTheme()` 在 main.tsx 启动时 apply。
- **设计系统 primitive 全部用 CSS Modules 重写**:
  - `Button`:`data-variant` + `data-size` 驱动(primary/secondary/tertiary/danger/ghost
    × sm/md/lg),新增 `loading` 态(spinner)。废弃 `buttonStyle()` 工具。
  - 新增:`Icon`(lucide-react 封装)、`IconButton`、`Input`/`Textarea`/`Select`、
    `Badge`(6 variant + solid + dot)、`Card`(flat/outlined/elevated)、`EmptyState`、
    `Spinner`、`Tooltip`(纯 CSS)。
  - `Toast`/`ContextRing`/`KeyHint` 从 inline style 迁移到 CSS Modules。
- **`DesignSystemView` catalog 重写**:展示全部新 primitive(10 个 section),
  作为活体参考。`main.tsx` import tokens + base + 调用 `initTheme()`。
- **测试**:`Button.test.tsx` 断言改为 `data-variant`(CSS class 取代 inline style);
  删除 `buttonStyles.test.ts`(工具已废弃);`app.smoke.test.tsx` 同步更新 barrel/token 断言。
  全套 170/170 绿。

### 新增
- **跨平台打包脚本 `scripts/build.sh`**:自动检测 OS(macOS/Linux/Windows),
  输出对应原生包(macOS→app+dmg / Linux→deb+appimage / Windows→msi)。
  支持 `--universal`(macOS arm64+x86_64 合一)、`--fast`(release-fast profile)、
  `--bundles=LIST` 覆盖、`--dry-run` 预览。配套 npm scripts:`build:native` /
  `build:universal` / `build:fast`。
- **CI workflow `.github/workflows/release.yml`(备用)**:`push tag v*` 触发,
  三平台并行构建(macos-14/macos-13/ubuntu-22.04/windows-latest),自动上传
  artifacts 到 workflow run + tag release。日常 push 不触发。本地构建不依赖它。
- **`tauri.conf.json` 平台专属字段补全**:修正 `homepage` 指向 ReflectDesktop 仓库;
  新增 `copyright`;`macOS.minimumSystemVersion = "11.0"`;`windows.webviewInstallMode =
  downloadBootstrapper`(用户无 WebView2 时自动下载);`linux.deb.depends` 对齐
  README 文档化的 webkit2gtk-4.1 / libayatana-appindicator3 / librsvg2 依赖。

### 新增
- **真实 agent 集成(阶段 1)**:`MinimalAgent` 不再用空 `ModelRegistry` +
  `EchoTool` stub。现在经 `reflect_config::load_default()` 读 `~/.reflect/config.toml`
  + 环境变量(`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OLLAMA_HOST` /
  `REFLECT_PROVIDER` / `REFLECT_MODEL`),`cfg.to_registry()` 构建真实 provider pool,
  注册 16 个 reflect-tools 内置工具(Bash/Read/Write/Edit/Delete/Grep/Glob/
  NotebookEdit/EnterPlanMode/ExitPlanMode/EnterWorktree/ExitWorktree/WebFetch/
  WebSearch/ToolSearch/Echo)。
- **降级策略**:开发环境无 API key 时 fallback 到空 registry + EchoTool + warn,
  `pnpm tauri dev` 永远能起;新增 `reflect_agent_status` 命令暴露
  `{ready, has_model, model, workspace, degraded_reason}` 供前端显示状态徽标。
- **12 个 Op 命令实装(阶段 2)**:`reflect_compact` / `reflect_rewind` /
  `reflect_shutdown` / `reflect_tool_approval` / `reflect_hook_approval` /
  `reflect_plan_approval` / `reflect_enter_plan_mode` / `reflect_exit_plan_mode` /
  `reflect_set_effort` / `reflect_set_permission_mode` / `reflect_cycle_permission_mode` /
  `reflect_ask_user_question_response` / `reflect_ask_user_input_response` 不再是
  空 `Ok(())`,改为构造对应 `Op` 经 `MinimalAgent::submit_op` 真正驱动 AgentThread。
- **新增命令**:`reflect_agent_status` / `reflect_get_config` / `reflect_save_config` /
  `reflect_list_tools`(诊断 + 配置持久化 + 工具列表)。
- **Zustand agent store(阶段 3a)**:`src/stores/agentStore.ts` 单 store + 单次事件订阅,
  修复 M1.x 各组件持独立 turns 副本的结构 bug;`Turn` 模型从 `{user,reply,done}`
  升级为 `{id,items,status}`,`TurnItem` 覆盖完整 33 种 `EventMsg`(user_text /
  assistant_text / thinking / tool_call / tool_output / error / compacted)。
- **富文本 Chat 渲染(阶段 3b)**:`MessageList` 按 `turn.items[]` 渲染多行;工具调用
  可折叠(参数 + 输出 + 状态徽标)、thinking 可折叠、错误红框、compacted 提示。
- **真 modals(阶段 3c)**:`ModalStack` 从 store 的 pending 队列渲染 ApprovalModal /
  QuestionModal / AskUserModal / PlanReadyModal,提交调 store action。
- **MCP / LSP 运行时接入(阶段 3d)**:vendor `reflect-mcp` + `reflect-lsp` crate;
  `src-tauri/src/mcp.rs` 经 `McpConnectionManager` / `LspConnectionManager` 启动
  `[mcp_servers.*]` / `[lsp_servers.*]` 配置的 server,MCP 工具 `register_if_absent`
  到 ToolRegistry,LSP 单例 `LspTool`;lifecycle event 经 session broadcast 推前端。
- **Settings 真持久化(阶段 4)**:SettingsView 经 `reflect_get_config` /
  `reflect_save_config` 读写 `~/.reflect/config.toml`;结构化 API key / provider /
  model 编辑 + 高级 raw TOML 编辑器(MCP/LSP/sanitize);ModelsView 从真实
  `agent_status` 读当前 model。
- **STUB view 真实化(阶段 5)**:Skills/Notifications/Collaboration 接 store 真实数据;
  Workspaces 从 sessions 聚合;Prompts/Files/Git/Terminal 改为"发送到对话"快捷面板;
  About/Update 用真实 `ping` + `agent_status`。
- **Docs**: `docs/codebase-map.md` — 任务导向导航。
- **Docs**: `docs/PROTOCOL_BRIDGE.md` — Tauri ↔ reflect-protocol 信封规范。

### 变更
- `ReviewDecision` TS 类型对齐 Rust `#[serde(rename_all = "snake_case")]`:
  从 `'approve'|'deny'|'abort'` 改为 `'approve'|'approve_for_session'|{deny:{reason}}`。
- `reflect_*` Op 命令返回类型从 `void` 改为 `string`(submission id,供 pairing)。
- `services/agent.ts` 改为 `stores/agentStore.ts` 的兼容 re-export 层。

### 移除
- `src/App.tsx`(死代码入口,真根是 `main.tsx` → `router.tsx`)。
- `commands/mod.rs::all_commands()`(dead code)。
- 所有 view 的硬编码 `STUB_*` 数组 + phantom `invoke()`(Files/Git/Terminal/About/Update
  曾 invoke 不存在的命令,违反 AGENTS.md 规则 5)。

### 修复
- 修复 `useAgent()` 各组件持独立 turns 副本的结构 bug(改用 Zustand 单 store)。
- 修复 `handle_event` 只处理 4/33 事件类型、丢弃工具调用/思考/审批/错误的问题。
- 修复 Files/Git/Terminal/About/Update 调用不存在的后端命令的问题。

### 安全
- 工具输出经 `Sanitizer::with_defaults()`(10 个默认密钥脱敏 pattern)。

---

## 0.1.0 — 2026-07-07（初始 MVP）

首个可对外发布的里程碑。应用可启动，三栏布局正常渲染，会话列表可用，Tauri 命令桥往返打通。

### 新增
- **M1.1 脚手架** (commit `2c73335`): Tauri 2 + React 19 + Vite + TS 工作区；`reflect-desktop` 二进制名；5 个图标；capabilities。
- **M1.2 协议桥** (M1.2): 14 个 Tauri 命令 + 1 个推送事件（`reflect_event`）；`forward_agent_events` 循环；4/4 E2E 测试。
- **M1.3 三栏布局** (M1.3): 左侧栏 + 聊天 + 右侧面板 + 底部状态栏；会话列表占位。
- **M1.4 聊天渲染** (M1.4): `MessageList`、`MessageRow`、`Composer` —— 流式 / Markdown / 工具行的占位实现。
- **M1.5 Composer + Slash 弹层** (M1.5): `/` 弹层、`slashCommands.ts` 目录。
- **M1.6 Modal 套件** (M1.6): `ModalShell` + `index.tsx`，覆盖 approval / question / plan / ask_user。
- **M1.7 状态栏 + 设置** (M1.7): 顶部 + 底部栏；`SettingsView` 骨架，含 Display/Editor/Provider 区块。
- **M1.8 打磨** (M1.8): macOS overlay 标题栏（`titleBarStyle: "Overlay"`）、`macOSPrivateApi: true`、USER_GUIDE。
- **M2.x 真实后端** (commit `65bff4b`): `MinimalAgent` 换成真实 `reflect_core::AgentThread`（M2.x = stub 模型 + `EchoTool`；无网络依赖）。会话事件经 `tokio::sync::broadcast` 广播（fan-out）。
- **4 项产品联动**: `tray.rs`、`menu.rs`、`shortcut.rs`、`dock.rs`（macOS 关闭到托盘）。
- **路由** (commit `29044a4`): TanStack Router v1 + TanStack Query v5。
- **B1..B6 功能切片** (commits `d7ddb03`, `1dee7c1`, `3a85fce`, `76d7717`): Home / Threads / Models / Settings / Files / Git / Skills / Workspaces / Plan / Prompts / Notifications / Terminal 视图全部渲染。
- **测试** (commit `2ed587c`): Vitest 配置 + 初始测试（`SettingsView`、`MessageList`、`ThreadsView`、`useSessions`、`agent`）。

### 说明
- M2.x 后端有意保持 **stub**（单个 `EchoTool`、空 `ModelRegistry`）。网络 LLM 客户端和其余 21 个内置工具在 M3.x 落地。
- `reflect_delete_session` 返回 `delete not implemented in M1; use archive in M2.4`，以防误删数据。
- 所有事件在线上使用 `snake_case` 判别符（`#[serde(tag = "type", rename_all = "snake_case")]`）；Rust 的 `PascalCase` 结构体 variant 是内部细节。

---

## 版本策略

- **Major**: 协议级破坏性变更（`Op` / `EventMsg` 形状变更）。
- **Minor**: 新功能切片、新 Tauri 命令、新事件 variant（始终**增量**）。
- **Patch**: bug 修复、文档更新、内部重构。

GUI 跟随 Reflect-Agent 的主版本节奏；minor 版本可独立发布（协议是增量稳定的）。