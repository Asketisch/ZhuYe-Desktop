# 协议桥（Tauri ↔ ZhuYe 协议）

<p align="center">
  <b>中文</b> · <a href="protocol-bridge.en.md">English</a>
</p>

> **线格式 = `zhuye_protocol::Event` / `Submission` 直接传递（snake_case JSON）。** 桌面端的 `zhuye_protocol` 是上游 `zhuye-protocol` 包的 Cargo 别名；同一信封与上游 TUI 和 `zhuye exec` 共享。
>
> 阅读顺序：§1 信封 → §2 提交（UI → 后端）→ §3 事件（后端 → UI）→ §4 ID 配对 → §5 版本兼容性 → §6 生成的 TS 类型。

---

## 1. 信封

```rust
// zhuye-agent/crates/protocol/zhuye-protocol/src/event.rs
pub struct Event {
    pub id: String,     // matches Submission.id; EVENT_ID_NONE = "" for lifecycle
    pub msg: EventMsg,  // serde-tagged enum (snake_case)
    pub seq: u64,       // v1.12:会话扇出序号(per-session 单调从 1 起;0 = per-turn 专属流)
}
```

> **v1.12 缺口检测**：`seq > last + 1` 即 broadcast 慢订阅丢过事件，前端触发
> 当前会话 re-replay 收敛（`store.subscribe` 内联检测；`#[serde(default)]` 旧
> wire 无 seq 解析为 0，不参与判定）。后端转发器在 broadcast `Lagged(n)` 时另发
> `zhuye_event_gap` 合成通知（见下），覆盖 per-turn 快路丢包。

两条通道：

- **UI → 后端**：`invoke('zhuye_submit', { submission })` 其中 `submission: Submission = { id, op, ... }`。
- **后端 → UI**：`listen('zhuye_event', handler)` 载荷为 `Event`。**单一通道名**；按 `msg.type`（snake_case 鉴别器）分派。
- **后端 → UI（后台会话，v1.x）**：`listen('zhuye_session_event', handler)` 载荷为
  `{ session_id: string, event: Event }`。桌面换绑不再杀旧线程（后台持续运行），非前台
  线程的事件经此通道带 session id 送达；前端 `src/stores/backgroundSessions.ts` 消化
  （运行徽标 / 待确认交互投影），**主 reducer 不处理**。会话切回（bind → promote）后，
  该线程事件回到 `zhuye_event` 前台通道。
- **后端 → UI（缺口通知，v1.12）**：`listen('zhuye_event_gap', handler)` 载荷
  `{ dropped: number, scope: "foreground" | "background", session_id?: string }`。
  转发器 broadcast `Lagged(n)` 时的**合成应用级通知**（非 EventMsg 变体，不进引擎
  协议）；前端据此重放当前会话 / 重灌后台投影。通道共 6 条：`zhuye_event` /
  `zhuye_session_event` / `zhuye_terminal_output` / `zhuye_browser_frame` /
  `zhuye_update_progress` / `zhuye_event_gap`。

> 前端从不使用信封包装。Tauri 命令名是唯一框架。

---

## 2. 提交（UI → 后端）

`Op` 变体列在 `zhuye-agent/crates/protocol/zhuye-protocol/src/op.rs` 中；每个 1:1 映射到一个 Tauri 命令，其主体位于 `src-tauri/src/commands/<domain>.rs`（由 `src-tauri/src/commands/mod.rs` re-export）。完整集合见下方 §2.0 表格；规范的 Op→命令映射是唯一真相源，应在 `zhuye-protocol/src/op.rs` 变更时重新生成。

> **注**:除 `UserInput` 经 `zhuye_submit` 接受完整 `Submission` 外,其余 Op 命令
> 后端在 `commands/<domain>.rs` 内部构造 `Op` 并经 `MinimalAgent::submit_op` 投递。
> 所有 Op 命令返回 `string`(submission id,供前端 pairing/调试)。

> **v1.4 转向 / 子代理桥接**:`steer`(回合中途转向)与 `query_subagents`
> (子代理状态查询,应答 `subagent_status` 事件)经 `zhuye_steer` /
> `zhuye_query_subagents`(`commands/agent.rs`)桥接;前端 IPC 包装在
> `src/utils/commands/agent.ts`。Steer 的注入由引擎在 pre_loop 安全点
> 收割,**不发协议事件**(仅落 recorder),GUI 在 `store.steer` 内乐观
> 渲染插话。

> **Goal 模式(v1.2 P1)**:`enter_goal_mode { goal, verify_command?, token_budget? }` /
> `exit_goal_mode` 映射到 `zhuye_enter_goal_mode` / `zhuye_exit_goal_mode`
> (`commands/goal.rs` / `commands/goal.ts`)。进入目标模式后,core 侧
> `GoalController` 在每轮 turn 结束自校验(LM judge + 可选校验命令),未完成则
> steering 自动续作 —— **不需要新的用户提交**;GUI 经常规 turn/流式事件呈现
> 多轮续作,事件侧无 goal 专属变体。状态可观测走**读口**而非事件:
> `zhuye_goal_snapshot`(v1.7)直读 `AgentThread::goal_snapshot()`
> (上游 `GoalController::snapshot()`),返回 `GoalState | null`(snake_case
> 出线)—— Composer 的 goal 徽标 tooltip 与 `goalActive` 投影校准消费;
> 触发点:会话 hydrate 后、goal turn 收尾(`turn_complete` 且 goalActive)。

### 2.0 Op 之外的命令（诊断 / 配置 / 域 I/O）

这些命令不对应 `Op` 变体；它们与 Op 派生的命令共存于相同的域模块中：

| 命令 | 负载 | 返回 | 位置（Rust）/ 位置（TS）|
|---|---|---|---|
| `ping` | `null` | `{ msg, version }` | `src-tauri/src/commands/agent.rs` (barrel) / `src/utils/commands/health.ts` |
| `zhuye_submit` | `{ submission }` | `string`（submission id） | `commands/agent.rs` / `commands/agent.ts`。**图片附件归一**：前端 Composer 的图片是 data-URL（base64）字符串，协议 `UserInputItem::Image.data` 是 `Vec<u8>`（serde 要求数字数组）；应用层在反序列化前把 `type:"image"` 条目的字符串 data（data-URL 或裸 base64）解码为字节数组，再交 serde。线格式保持紧凑，协议层不变 |
| `zhuye_agent_status` | `null` | `{ ready, has_model, model, workspace, degraded_reason }` | `commands/agent.rs` / `commands/agent.ts` |
| `zhuye_get_config` | `null` | `string` (TOML) | `commands/config.rs` / `commands/config.ts` |
| `zhuye_save_config` | `{ toml }` | `null` | `commands/config.rs` / `commands/config.ts`。写盘前 `load_from_str` 校验（**自带上游 v1→v2 迁移**：旧的 `[anthropic]` / `[openai]` / `[ollama]` 固定段与 `[active].provider` 读入即就地转成等价模型组 `[[model_group]]` + `[active].group`，迁移幂等，写回只有新格式）；模型组相关段（`active` / `model_group` / `routing` / **`model_discovery`**）变化时重建 ModelRegistry + QuotaTracker 并强制重绑当前会话（coding plan 切换无需重启，见 `state/reload.rs`）。`[model_discovery]` 段变更也触发重载 —— 它决定 `model = "free"` 从清单里挑哪个模型（开关 / 偏好 / 免费判定规则）。配置已写盘但模型解析失败时**不报保存失败**（那会误导用户重试），失败原因进 `agent_status.degraded_reason`（状态栏黄点可见） |
| `zhuye_get_user_instructions` | `null` | `string` | `commands/config.rs` / `commands/config.ts`。读用户级自定义指令（`<用户数据目录>/AGENTS.md`；文件不存在返回空串，属正常初始态）。设置页「个性化」分区消费；该文件与会话首轮注入的 `AgentsMdHook` 同源（app-core `read_agents_md_merged` 合并用户级与项目级），保存即对后续所有会话生效 |
| `zhuye_save_user_instructions` | `{ content }` | `null` | `commands/config.rs` / `commands/config.ts`。原子写用户级自定义指令文件（UTF-8），路径经 `zhuye_config::data_path_or_relative(&[])` 解析；目录不存在自动创建 |
| `zhuye_set_model` | `{ group, model, label? }` | `string`（**已解析**的完整 spec；无任何显式 model 时空串） | `commands/config.rs` / `commands/config.ts`。运行中切换模型 / 钉住模型组内的 coding plan（协议 `Op` 无 SetModel）：写 `[active].group` + `[active].credential`（`label` 非空时钉住该组内凭据条目）→ 复用 `zhuye_save_config` 同款写盘 + `hot_reload_provider_stack`（重建 registry + 强制重绑），下一个 turn 生效。`group` **必须是已声明的模型组 id**（`[[model_group]]` 的 `id`，组 id 即 registry 池名与模型 spec 前缀）—— 未知组 id 报错并列出当前可用组 id；未钉住时 model 写组级 `model` 字段，spec = `<组id>/<model>`；`label` 命中 `[[<组id>.credentials]]` 条目时 model 写入条目自身（条目 model 优先于组级）；`label` 缺省 → 清掉 `[active].credential` 且 model 走组级 `model`；`label` = `'default'`（组级 `api_key` 隐式条目）同样走组级；显式 `label` 找不到条目报错。上游 `resolve_model` 诚实解析（env > 钉住条目 model > 组级），未显式配置**不编造内置默认** → 返回空串，UI 显示「未配置模型」。**动态值**：model 写成 `"free"`（运行时从模型组清单里挑免费模型）时，返回值是**解析后的真实 id**（如 `openai/union-alpha`），不是占位串 `openai/free`；解析失败（清单不可达 / 没有免费模型 / `[model_discovery] enabled = false`）→ 命令报 `Err`，原因如实回传。Composer 内联模型选择器与模型组页消费 |
| `zhuye_query_plan_quota` | `{ baseUrl, apiKey, checkVia }` | `PlanQuotaSnapshot`（`{ success, error, utilization, remaining_tokens, max_tokens, resets_at }`） | `commands/config.rs` / `commands/config.ts`。手动查询模型组内凭据的配额用量（模型组页凭据编辑器的「查询用量」按钮，仅对配置了 `quota.check_via` 的凭据开放）：配额声明挂在**模型组内的凭据条目**上（`[[<组id>.credentials]]` 的 `[quota]` 子表），运行时按「组 id → 组内凭据 → quota 配置」收集（见 `state/quota.rs::build_quota_tracker`，池名 = 组 id）；`checkVia`（`kimi \| zhipu \| minimax \| zenmux`）经 `state/quota.rs::make_provider` 同一份映射实例化 `zhuye_llm::QuotaProvider`，对着厂商用量 API 查询（端点与 cc-switch 一致），与运行时 failover 判定共用实现。传显式 `baseUrl`/`apiKey`（非组 id + label），编辑中未保存的表单也能试查。`volcengine` / `anthropic_usage` / `open_a_i_usage` 暂未实现 → 命令报错；网络瞬时失败折叠为 `success=false`（与确定性失败同形，UI 处理一致） |
| `zhuye_get_effort` | `null` | `string`（`low \| medium \| high \| xhigh \| max \| ultra`；上游 v1.x 起 max/ultra、`fix/effort-xhigh-ladder` 起 xhigh） | `commands/effort.rs` / `commands/permissions.ts`。直读线程内 `AgentConfig::current_effort()`（协议无 effort 回读事件）；线程未安装时回落 `low`。Composer 内联思考深度与 Models 页分段控件初始化用 |
| `zhuye_goal_snapshot` | `null` | `GoalSnapshotPayload \| null`（snake_case,镜像 Rust `zhuye_goal::GoalState`） | `commands/agent.rs` / `commands/goal.ts`。**目标模式状态快照**(v1.7):直读 `AgentThread::goal_snapshot()`;目标模式无协议事件,本读口是「是否活跃 / 第几轮 / LM 判定 / 累计 token」的唯一权威来源。未进入目标模式(rebind 丢控制器同)返回 `null`。前端 store 的 `syncGoalSnapshot` 在会话 hydrate 后与 goal turn 收尾拉取,校准 `goalActive` 投影并供 Composer goal 徽标 tooltip 展示轮次 / token / 状态 |
| `zhuye_list_tools` | `null` | `Vec<{ name, description }>` | `commands/agent.rs` / `commands/agent.ts` |
| `zhuye_list_plugin_commands` | `null` | `Vec<PluginCommandInfo>`（`{ name, description? }`） | `commands/plugins.rs` / `commands/plugins.ts`。已挂载插件的 slash 命令只读快照（composer 弹层候选数据源）：取插件运行时的 `CommandRegistry.list()`；未挂载（占位线程 / 无 enabled 插件 / HOME 缺失）返回空列表。`name` 为命令全名（`plugin:ns:name` 形式），前端以 `/name args` 提交，展开仍由后端 submit 边界 `expand_submission` 统一做 —— 此命令无文件 IO |
| `zhuye_credential_pool_status` / `zhuye_recovery_state` / `zhuye_config_info` | `null` | `CredentialPoolStatus[]` / `SubagentCallRecord[]` / `ConfigInfo`（均 camelCase） | `commands/runtime_status.rs` / `commands/runtimeStatus.ts`。凭证池健康度、已完成的子代理调用、配置位置与分析健康度。`CredentialPoolStatus` = `{ group, endpoint, total, healthy, healthyLabels }`：**按模型组逐组一条**（组 id = registry 池名，endpoint = 组的接入端点 `openai` / `anthropic` / `ollama`），`total` = 组内凭据总数（含组级 `api_key` 的隐式条目），`healthy` / `healthyLabels` = 当前未处于冷却的凭据；组内无凭据的组不出现。`ConfigInfo.issues` 返回配置问题的 `key` 和 `level`，由 app-core 基于当前配置生成。 |
| `zhuye_memory_sections` | `{ expectedContext? }` | `MemorySectionInfo[]`（camelCase） | 使用核心 `split_sections` 解析当前工作区及活跃代理的磁盘记忆，返回分段标题、正文、文件内序号和正文字数。`expectedContext: { workspace, agent }` 不匹配时拒绝查询；分段是候选项，实际注入还取决于启用的作用域和查询。 |
| `zhuye_list_plugins` / `zhuye_list_marketplaces` / `zhuye_toggle_plugin` / `zhuye_uninstall_plugin` / `zhuye_install_plugin` | `null` / `null` / `{ id, enabled }` / `{ id, scope }` / `{ path, marketplace, scope }` | `PluginInfo[]` / `MarketplaceInfo[]` / `null` / `null` / `null`（外层字段 camelCase；`scope` 线上为小写枚举 `managed`/`user`/`project`/`local`） | `list_plugins` 给出安装项、配置启用状态及 `runtime`（当前会话成功加载时为 `PluginLoadedEvent`，否则为 null；内部事件字段为 snake_case）。`list_marketplaces` 给出配置的来源。`toggle` 更新配置并同步运行时；`uninstall` / `install` 经核心 `PluginManager` 更新安装清单，然后刷新当前会话的插件运行时。刷新失败时返回错误，安装清单可能已更新。Collaboration 视图 PluginsPanel 消费。 |
| `zhuye_browse_marketplace` / `zhuye_install_from_marketplace` | `{ name }` / `{ marketplace, plugin }` | `MarketplacePluginInfo[]` / `null`（外层字段 camelCase） | v1.11 桌面#2 插件市场：`browse` 读 known_marketplaces.json 里该市场的缓存目录并解析 `.claude-plugin/marketplace.json`，逐条返回插件元信息（name/description/version/category/tags/source）；市场未注册或缓存未物化时返回结构化错误。`install_from_marketplace` 经核心 `PluginManager::install_from_marketplace`（DepResolver 后序装依赖）安装后刷新运行时。PluginsPanel 市场行消费。 |
| `zhuye_install_skill` | `{ repo }` | `String`（重扫 submission id） | v1.11 桌面#1 Skill 市场：从 GitHub 仓库（`owner/repo`，根含 SKILL.md）安装技能到用户级 `~/.zhuye/skills/`，装完触发 `Op::RescanExtensions`。repo 形态校验先于网络。SkillsView 高级直装行消费。 |
| `zhuye_search_skill_market` | `{ query, limit? }` | `SkillMarketEntry[]`（`{ id, source, slug, official }`） | skills.sh 目录搜索:后端从公开 sitemap 建全量索引(缓存 `~/.zhuye/cache/skills-market.json`,24h TTL,失败降级旧缓存),在索引上做 owner/repo/slug 评分匹配(query < 2 字符返回空)。`id = owner/repo/slug`,`official` 标记第一方厂商来源。`commands/skills.rs` 调上游 `zhuye_skills::{fetch_index, search_entries}`。SkillsView 市场搜索消费。 |
| `zhuye_install_skill_from_market` | `{ source }` | `String`（重扫 submission id） | skills.sh 生态整目录安装:`source` 接受 `owner/repo[/slug]`、skills.sh / GitHub URL。上游 `zhuye_skills::install_skill_from_market` 走 codeload tarball,布局探测 `**/skills/<slug>/SKILL.md` → `**/<slug>/SKILL.md` → 根形态,整目录提取(SKILL.md + scripts/references),防 zip-slip / 跳符号链接 / 装前 supply_chain 扫描 / staging 原子替换。装到用户级 `~/.zhuye/skills/` 后触发 `Op::RescanExtensions`。 |
| `zhuye_refresh_skill_market_index` | `null` | `u32`（条目数） | 强制刷新 skills.sh 目录索引(跳过 TTL 重新拉 sitemap)。SkillsView 刷新按钮消费。 |
| `zhuye_import_discover` / `zhuye_import_sessions` | `{ kind }` / `{ kind, force, dryRun, includeThinking, keepInjected }` | `ImportSourceInfo[]` / `ImportRunResult`（外层字段 camelCase；`kind` 线上为 `claude_code` / `codex`） | v1.11 D9 外部 Agent 导入：`discover` 按种类列出可导入来源（不入库）；`sessions` 经 `zhuye-import` 引擎批量导入到本机 rollout base，单源失败不中断整批（失败清单逐条返回）。导入后既有会话列表 / replay 自然可见。ImportView 消费。 |
| `zhuye_set_workspace_dirs` / `zhuye_current_workspace_dirs` | `{ main, additional }` / `{}` | `null` / `WorkspaceDirsInfo { main, additional }`（camelCase） | v1.11 桌面#5 多目录综合工作区：主工作区校验存在 + 是目录；附加目录去重、跳过与主目录相同项，拼进 `AgentConfig.sandbox_writable`（文件工具沙箱边界放行）。新绑定会话生效。WorkspacesView 附加目录编辑器消费。 |
| `zhuye_status_server_start` / `zhuye_status_server_state` / `zhuye_status_server_stop` | `{ port? }` / `{}` / `{}` | `u16`（绑定端口）/ `u16 | null` / `null` | v1.11 基建#12 远程网页状态页：手写 HTTP/1.1 `GET /status` 只读诊断 JSON（tailnet 设备浏览器直达）；`auth_token` 非空时强制校验（`?token=` 或 Bearer）。幂等替换；stop 未运行时 no-op。RemoteView 启停控制消费。 |
| `zhuye_list_provider_models` | `{ baseUrl, apiKey, endpoint }` | `ProviderModelsResult`（`{ endpoint, models: [{ id, display_name, supports_vision, is_free, context_window, max_output_tokens, supports_reasoning }] }`） | `commands/models.rs` / `commands/models.ts`。对着 base_url + api_key 拉取可用模型列表：`openai` → `GET {base}/models`（Bearer）、`anthropic` → `GET {base}/v1/models`（`x-api-key` + `anthropic-version`）。live 字段探测：`supports_vision` 取自 OpenRouter 风格 `architecture.input_modalities` / `input_modalities` / `modalities.input`（含 `image` 即视觉）、`context_window` 取 `context_window` → `context_length` → `top_provider.context_length`、`max_output_tokens` 取 `max_output_tokens` → `top_provider.max_completion_tokens`（与上游 `zhuye_llm::providers::openai` 同口径）。**live 披露后统一经 models.dev 目录补缺**（`commands/model_catalog.rs::enrich_with_catalog`，live 优先、目录只填 `None`；目录 = 上游内嵌快照 + 24h 磁盘缓存，空目录 = 行为不变）—— Anthropic 官方端口从此也有窗口 / 输出 / 视觉 / 思考数据；同时后台惰性刷新目录缓存（TTL 内跳过，失败静默用旧数据）。`is_free` = 免费判定（`true` / `false` 已判定，`null` = **未知**：厂商没表态且规则没命中，不能断言免费），规则取自**当前生效**的 `[model_discovery]` 段（`always_free` / `free_id_patterns`，留空用内置默认）—— 与引擎跑 `model = "free"` 时用的是同一套规则。Composer 模型选择器与模型组表单消费能力标签（`200K 上下文 · 32K 输出 · 支持视觉`），点选模型时若「最大上下文」留空则一键带入 `context_window`；Composer 的选项行追加「免费」标记。**兼作零 token 连通测试**（模型组表单「测试连接」） |
| `zhuye_lookup_model_abilities` | `{ modelId }` | `ModelAbilitiesResult`（`{ context_window, max_output_tokens, supports_vision, supports_reasoning, effort_levels }`，字段全 `null` = 未知） | `commands/model_abilities.rs` / `commands/models.ts`。查单个模型能力，**不发网络请求** —— 只读引擎侧 models.dev 社区目录（上游 `zhuye_llm::abilities_for`，内嵌快照 + 磁盘缓存取新，含变体拼写 / `-128k` 名字后缀兜底链）。当前活跃模型不在最近实拉清单里时是唯一能力来源。Models 页当前模型卡片展示四维能力；Composer 发送前视觉检查：`supports_vision === false` 且带图片 → 警示条 + 确认弹窗（剥离图片并发送 / 取消），`null`（未知）不拦截。`effort_levels` 为厂商词表原样，思考档位的实际钳制另走 `zhuye_effort_capability` |
| `zhuye_test_provider_chat` | `{ baseUrl, apiKey, endpoint, model }` | `{ reply }` | `commands/models.rs` / `commands/models.ts`。发送测试消息「你好」验证鉴权/网络/推理链路：单条 user 消息，**刻意无 system 提示词、无 tools 定义**，`max_tokens = 32` 压低无效消耗。`openai` → `POST {base}/chat/completions`；`anthropic` → `POST {base}/v1/messages`（回复取 `content[]` text 块拼接）。Plans 表单「发送测试消息」按钮消费 |
| `zhuye_list_sessions` / `zhuye_rename_session` / `zhuye_delete_session` / `zhuye_replay_session` | `{ workspace?, limit?, offset? }` / — / — / — | `SessionInfo[]` / — / — / — | `commands/sessions.rs` / `commands/sessions.ts`。`workspace` 为可选过滤（`SessionInfo.workspace` 精确匹配；旧会话 `workspace = None` 仅在全量列表出现）。`zhuye_replay_session` 返回该会话 rollout 全量记录（`RolloutRecord` tagged union）；**引擎注入块（`<system-reminder>` 包裹的环境上下文 / AGENTS.md 指令）在记录里 role 仍是 user**，前端回放时剥除（`src/stores/replay.ts::stripInjectedSystemBlocks`），后端 `records_to_preload` 保留 → 模型侧上下文不变 |
| `zhuye_create_session` | `null` | `string`（ThreadId） | `commands/sessions.rs` / `commands/sessions.ts`。纯 ID 分配（New Chat 先拿路由 id），不触发后端绑定；会话文件在首条 `UserInput` 时由后端物化并写 `SessionMeta.workspace`（workspace 值取自任意类型首条 `Submission` 的顶层 `workspace`，缺省回退 `cfg.current_workspace()`） |
| `zhuye_bind_session` | `{ id }` | `{ permission_mode: string, pending_gates: PendingInteraction[] }`（**v1.12 有意协议扩展**：命令名不变，单一 mode 字符串改结构体） | `commands/sessions.rs` / `commands/sessions.ts`。把后端 `AgentThread` 换绑到指定 session id：目标会话在后台线程表时 **promote 复用 warm 线程**（内存上下文即在，跳过重建）；否则 replay 该 id 的 JSONL → `records_to_preload` → 重建线程（`with_session_id` + M4 recorder 同 id）。**权限模式绑定会话**：审计轨迹末次 `PermissionModeChanged` 经 `with_initial_permission_mode` 恢复为新线程初始模式（`Bypass` 按 v1.3 安全基线降级 `Prompt`；无记录落默认 `Auto`），provider 热重载的强制重绑则透传旧线程当前模式。**后端幂等**（同 id 短路，仍返回线程实际模式）；未知 id（刚 `zhuye_create_session` 分配、未落盘）走空历史分支不报错。**v1.12**：返回体追加 `pending_gates`（引擎 `AgentThread::pending_interactions()` 的挂起交互快照 —— 审批/问答/询问/plan，注册时刻升序，`payload` 与对应 `EventMsg` 变体字段同构）。reload / 换绑后前端 `hydratePendingGates` 据此重建审批 UI，不再依赖前端内存投影；**v1.x**：返回前滤除**已应答的 plan gate**（引擎上游 `Op::PlanApproval` 只摘 waiter 不清挂起注册表，僵尸条目随 bind 重发会让已确认过的「进入计划模式?」弹窗复活且再点必落空 —— `zhuye_plan_approval` 受理决策时把 plan_id 登记进进程内 `resolved_plan_gates`，bind 据此过滤；前端 `hydratePendingGates` 另在会话已处 Plan 模式时兜底滤除 plan_request）；远程会话分支恒为空（已知限制）。ChatView 挂载每个会话都调一次（bind → `syncPermissionMode(返回值)` → replay → hydrate 序列）。**v1.x 后台持续运行**：跨会话换绑不再 cancel 旧线程 —— 有会话归属的旧线程迁入后台表（上限 8，超限按「空闲优先、最旧兜底」驱逐）继续运行，事件经 `zhuye_session_event` 通道送达；原地重建（热重载 / pending error）与后台清场仍走 cancel。cron driver 换 sender 后重启（job uuid 保留） |
| `zhuye_fork_session` | `{ id, branch?, upToTurnId? }` | `string`（子会话 id） | `commands/sessions.rs` / `commands/sessions.ts`。GUI 入口对应 CLI `zhuye session fork`：`rollout_index::fork_with_history` 复制父会话 JSONL（`upToTurnId` 截至某 turn 含，`None` 全量）生成新子会话，父文件 append `Fork` 血缘 marker，子会话继承父 SessionMeta model 并把 `branch`（默认 `manual`）写成自定义名（`_names`）。纯文件操作不触碰运行中的 AgentThread（同步 IO 包 `spawn_blocking`）；前端拿到子 id 后自行路由切换（ChatView 挂载 → bind + replay 即得完整历史）。会话列表 kebab 菜单「Fork」入口（Sidebar + ThreadsView 共用） |
| `zhuye_archive_session` / `zhuye_unarchive_session` / `zhuye_list_archived_sessions` | `{ id }` / `{ id }` / `null` | `null` / `null` / `SessionInfo[]` | `commands/sessions.rs` / `commands/sessions.ts`（归档树 `~/.zhuye/sessions-archive`，整树搬移、相对路径不变） |
| `zhuye_generate_session_title` | `{ id, force? }` | `string`（最终标题） | `commands/sessions.rs` / `commands/sessions.ts`。AI 生成会话标题：replay 取首条 User + Assistant 文本 → MinimalAgent 的 SharedModelRegistry one-shot 调用（routing.main 模型）→ `derive_title` 清洗（≤48 字符）→ 写 `~/.zhuye/sessions/_titles/<id>.title`。标题优先级：自定义名（`_names`）> AI（`_titles`）> 首条消息派生 —— 自定义名存在时直接返回不调模型；`force = false`（默认，turn 收尾自动触发）幂等返回已有 AI 标题；`force = true`（菜单「AI 重命名」）重新生成覆盖。归档/删除与 `_names` 同步搬移/清理 |
| `zhuye_export_session` / `zhuye_export_session_markdown` | `{ id }` / `{ id }` | `string` (path) / `string` (markdown) | `commands/export.rs` / `commands/sessions.ts` |
| `zhuye_git_status` / `zhuye_git_diff` / `zhuye_git_log` | — | `GitStatus` / `string` / `Vec<GitLogEntry>` | `commands/git.rs` / `commands/git.ts`。`GitStatusEntry.staged: bool` 由 porcelain 两字符码的 index 列推导（`"M "` 已暂存 vs `" M"` 仅工作区 —— `status` 字段是 trimmed 码,二者折叠成同一个 "M",staged/working 分 tab 判定必须用 `staged`） |
| `zhuye_git_stage` / `zhuye_git_unstage` / `zhuye_git_commit` | `{ paths: string[] }` / `{ paths: string[] }` / `{ message }` | `null` / `null` / `string`（短 hash） | `commands/git.rs` / `commands/git.ts`。P3 Git 操作化：`git add --`（空 paths = `add --all`）/ `git reset HEAD --` / `git commit -m`（非空校验）。不做 push/pull（远端凭证留在终端） |
| `zhuye_git_branches` / `zhuye_git_checkout` | — / `{ branch }` | `BranchInfo[]`（`{ name, current }`，camelCase 出线） / `null` | `commands/git.rs` / `commands/git.ts`。分支列表 / 切换（实现下沉 `app-core::git_branch`）：`git for-each-ref refs/heads` 解析（仅本地分支；远端分支留 Git 视图扩展）；checkout 前分支名校验（拒 `-` 开头 / 空白 / 控制字符，防选项注入）。脏树是否阻断由 git 自身决定（冲突时报 stderr），「提交后重试」（stage → checkpoint commit → checkout 重试）的编排在前端完成。消费方：输入卡顶栏分支胶囊（`BranchMenu`） |
| `zhuye_gh_pr_list` | `{ limit? }` | `GhPullRequest[]` | `commands/git.rs` / `commands/git.ts`。shell out 到 `gh pr list --json`；gh 未安装 / 非 repo / 未登录 → Err 带原因（前端空态展示不打断） |
| `zhuye_search_sessions` | `{ query, limit? }` | `SessionSearchHit[]` | `commands/sessions.rs` / `commands/sessions.ts`。P1 跨会话内容搜索：ASCII 折叠大小写不敏感子串匹配，grep 会话 JSONL 的 user/assistant 文本；覆盖活跃树 + 归档树，按最近序扫描上限 120 个会话，命中 `limit`（默认 20）即止；返回首个命中片段（前后 ~60 字符，空白折叠） |
| `zhuye_run_shell` | `{ cmd, sshHost? }` | `ShellSession { id, command, cwd }` | `commands/shell.rs` / `commands/terminal.ts`; `zhuye_terminal_output` event streams output。v1.11 基建#7：`sshHost` 非空时命令经 `ssh <host> <cmd>` 远端执行（`BatchMode=yes` + `ConnectTimeout=10`，免交互防挂死），会话 `cwd` 标注 `ssh:<host>` 供前端区分本地/远端；前端已剥离 `ssh <host>` 前缀后传入 |
| `zhuye_pty_start` / `zhuye_pty_write` / `zhuye_pty_resize` / `zhuye_pty_close` | `{ id, cols, rows }` / `{ id, data }` / `{ id, cols, rows }` / `{ id }` | `()` | 系统 shell 的交互式伪终端；`zhuye_pty_output` 发送 `{ id, data: number[] }` 字节，`zhuye_pty_exit` 发送 id。 |
| `zhuye_kill_shell` | `{ session_id }` | `null` | `commands/shell.rs` / `commands/terminal.ts` |
| `zhuye_list_shell_sessions` | `null` | `string[]` | `commands/shell.rs` / `commands/terminal.ts` |
| `zhuye_list_dir` / `zhuye_read_file` / `zhuye_search_files` | `{ path?, maxDepth? }` / `{ path }` / `{ query, path?, maxResults?, rank? }` | `DirListing` / `FileReadResult` / search results | `commands/files.rs` / `commands/files.ts`; `commands/search.rs` / `commands/search.ts`。`rank` 缺省 `substring`（子串匹配）；`bm25` 走**相关性排序** —— 复用核心 `zhuye_tools::bm25::{tokenize, rank_lines}`（`k1=1.2` / `b=0.75`，与核心 grep 工具逐字一致），GUI 搜索不再弱于 agent 自己的 grep |
| `zhuye_write_file` | `{ path, content }` | `string`（写入的绝对路径） | `commands/files.rs` / `commands/files.ts`。工作区沙盒内写回文本文件；编辑器 Reject 恢复原文时由 inverse-patch 重建内容后调用，文件不存在则创建（含父目录） |
| `zhuye_read_image_base64` | `{ path }` | `ImageBase64Result { path, mime_type, base64, size }` | `commands/files.rs` / `commands/files.ts`。Composer 拖拽图片附件管线：读任意路径的图片文件（**不做工作区沙盒**，拖拽来源任意）返回 base64，前端拼 data-URL 作 inline `Image` item 提交（引擎的 `LocalImage` item 已接通，但 GUI 附件管线统一走内联字节，保证回放历史与 live 观感一致）。扩展名白名单 png/jpg/jpeg/gif/webp/bmp，上限 20 MiB |
| `zhuye_ingest_upload` | `{ filename, base64 }` | `IngestUploadResult { path, size }` | `commands/files/upload.rs` / `commands/files.ts`。A1 附件管线：webview 侧只有字节没有路径的文件（`<input type=file>` / clipboardData / DOM drop 兜底）落盘到当前工作区 `.zhuye/uploads/<ts>_<净化名>`，返回真实路径供 `UserInputItem::File` 引用 —— 落在工作区内保证 agent `/read` 沙箱可读。上限 64 MiB；文件名剥路径穿越与非法字符 |
| `zhuye_lsp_set_enabled` / `zhuye_lsp_status` / `zhuye_lsp_warmup` | `{ enabled }` / `null` / `{ path }` | `LspStatus`（`{ enabled, servers }`）/ 同左 / `{ warmed, server }` | `commands/lsp.rs` / `commands/lsp.ts`。LSP 按工作区**手动开启**（默认关）：开启 = bootstrap `[lsp_servers]`（注册 `lsp` tool + 起 server，幂等），关闭 = 反注册 tool + 停全部 server；关闭时不注入 `lsp` tool。`warmup` 对命中的 server `ensure_open`（didOpen 建索引）——编辑器打开代码文件时触发；未开启 / 无匹配 server 时 `warmed = false` 不报错。开启偏好的持久化（localStorage，按 workspace 路径）在 GUI 层 |
| `zhuye_load_allowlist` / `zhuye_save_allowlist` / `zhuye_check_allowlist` | — | allowlist payload | `commands/allowlist.rs` / `commands/allowlist.ts` |
| `zhuye_list_workspaces` / `zhuye_set_workspace` / `zhuye_current_workspace` / `zhuye_remove_workspace` | `set_workspace` 可选 `{ unhide?: bool }`（缺省 `null` = 保留既有 `hidden`；`true` = 显式恢复） | workspace payloads（`WorkspaceInfo { path, label, last_used, session_count, hidden }`，历史持久化于 `~/.zhuye/workspaces.json`） | 移除只隐藏项目，保留文件与会话（v1.x：按规范化路径匹配所有变体并清理 `/`、`.` 占位条目）。v1.x 起常规切换**不再自动复活**已移除项目（点击该项目旧会话只跟随 cwd）；唯一恢复入口是 `unhide: true`（工作区管理页「已移除的工作区」分区）。 |
| `zhuye_pick_workspace_folder` | `null` | `string?`（原生目录选择框，取消 → `null`；走 `tauri-plugin-dialog` Rust API，不经 JS IPC） | `commands/workspaces.rs` / `commands/workspaces.ts` |
| `zhuye_reveal_path` | `{ path }` | `null`（在 Finder / 资源管理器 / xdg-open 中定位） | `commands/workspaces.rs` / `commands/workspaces.ts` |
| `zhuye_list_skills` | `null` | `SkillEntry[]` | `commands/skills.rs` / `commands/skills.ts`。扫描目录取上游唯一出口 `zhuye_config::default_skill_dirs`(`<ws>/.zhuye/skills` → `<ws>/.agents/skills` → `~/.zhuye/skills` → `~/.agents/skills`,顺序即同名优先级),按 name 去重后并 bundled / 插件技能。 |
| `zhuye_rescan_extensions` | `{ skills?, commands? }`（缺省 `skills=true` / `commands=false`） | `string`（submission id） | `commands/skills.rs` / `commands/skills.ts`。`Op::RescanExtensions` 派生命令（v1.x，submodule main）：运行时重扫扩展目录，扫描清单与 `default_skill_dirs` 同源(`.zhuye/skills` + `.agents/skills`,workspace + 用户级),新增/修改不重启即生效。不开 turn；应答 `extensions_rescanned` 事件（§3.11）回推 skills 条目总数。`commands` 位当前恒回 `false`（上游 commands 索引的运行时重扫尚未接线，命令正文实时读盘）。GUI 消费面待接（能力矩阵 🟡） |
| `zhuye_query_guard_stats` | `—`（无参数） | `string`（submission id） | `commands/skills.rs` / `commands/skills.ts`。F01 派生命令（additive）：查询 prompt_guard 裁决统计（定义侧/输出侧 block 与 review 四计数）。不开 turn；应答 `guard_stats` 事件回推快照，reducer 写 `guardStats`（进程级），设置页 GuardStatsCard 展示。 |
| `zhuye_scan_local_ports` | `{ ports?, recent_output? }`（缺省探测 dev 常用集） | `PortProbe[]`（`port`/`open`/`url`） | `commands/preview.rs` / `commands/preview.ts`。F50 派生命令（非 Op——纯本地探测，不走协议）：TCP connect_timeout 探测 127.0.0.1（仅回环），从 agent 最近输出提取端口一并探测。live 预览区块消费（HtmlPreviewView，15s 轮询）。 |
| `zhuye_list_memory` / `zhuye_add_memory` / `zhuye_remove_memory` | `{ expectedContext? }` / `{ scope, key, value, createOnly?, replaceDocument?, expectedContext?, expectedValue? }` / `{ scope, key, replaceDocument?, expectedContext?, expectedValue? }` | `MemoryEntry[]` / `null` / `null` | `commands/memory.rs` / `commands/memory.ts`。按 `##` 标题列出和更新条目；无标题或标题存在歧义的旧文档以 `wholeDocument: true` 表示，编辑或删除须显式传 `replaceDocument: true`；`createOnly: true` 拒绝已有条目。`expectedContext: { workspace, agent }` 与当前工作区或活跃代理不匹配时拒绝操作；`expectedValue` 与当前条目或文档不符时拒绝更新和删除。校验与桌面端记忆命令受同一锁保护，外部写入不受该锁保护。省略可选字段兼容原调用负载。 |
| `zhuye_list_hooks` / `zhuye_toggle_hook` | `null` / `{ name, enabled }` | `HookInfo[]` / `null` | 列出当前线程及插件引擎已注册的 hook，切换会修改引擎并持久化启停偏好；未注册名称返回错误。插件重载期间暂停插件钩子，恢复禁用偏好失败时卸载插件并报告错误。首条输入和插件 SessionStart 等待挂载，旧插件在卸载前收到一次 SessionEnd。配置中的 hook 变更在已绑定会话时触发重绑，未绑定时在下次绑定生效。 |
| `zhuye_check_update` | `null` | update info | `commands/update.rs` / `commands/updates.ts`。只探测不安装（GitHub releases/latest，env `ZHUYE_UPDATE_URL` 可覆盖）；失败不阻断 UI，`error` 字段如实展示。 |
| `zhuye_download_install_update` | `null` | `{ installed, version?, notes? }` | `commands/update.rs` / `commands/updates.ts`。OTA 自更新完整回路（tauri-plugin-updater：下载 + minisign 校验 + 安装）；进度经 `zhuye_update_progress` 事件（tag=`type`：`started` / `progress{downloaded,total?}` / `finished`）推前端。安装完成后须调 `zhuye_relaunch_app` 生效；未配置端点/公钥或句柄未就绪返回结构化错误。 |
| `zhuye_relaunch_app` | `null` | `null` | `commands/update.rs` / `commands/updates.ts`。tauri 核心 `request_restart` 非阻塞重启，进程由事件循环替换。 |
| `zhuye_browser_start` / `zhuye_browser_stop` / `zhuye_browser_status` / `zhuye_browser_env` | `null` | `BrowserStatusDto{running,url?,title?,streaming,message?}` / 同左 / 同左 / `BrowserEnvInfo{executableOverride,profileDir}` | `commands/browser.rs` / `commands/browser.ts`。**显示通道**:screencast 帧流(`zhuye_browser_frame` 事件,payload `{data}` base64 JPEG)启停与状态;agent **控制**通道走上游 `zhuye-browser` 插件 MCP 工具(Prompt 审批)。两通道共享隔离 profile 的 `DevToolsActivePort` 发现契约;`status` 无副作用不拉起浏览器；`start` 等待 CDP 确认画面启动，已在流时重放最近一帧。 |
| `zhuye_browser_navigate` | `{ url }` | `BrowserStatusDto`(导航后状态) | `commands/browser.rs` / `commands/browser.ts`。地址栏导航:输入在后端 `normalize_url` 规范化(无 scheme 补 `https://`;`localhost:3000` 等 host:port 不误判),短连接 page 级 CDP(`Target.getTargets` → `attachToTarget(flatten)` → `Page.navigate`),best-effort 等待 `Page.loadEventFired`(≤10s)并捕获主 frame `frameNavigated` 的最终 URL(重定向以它为准);加载失败走 CDP `errorText` → 结构化错误。 |
| `zhuye_browser_back` / `zhuye_browser_forward` | `null` | `BrowserStatusDto` | `commands/browser.rs` / `commands/browser.ts`。`Page.getNavigationHistory` + `Page.navigateToHistoryEntry`(currentIndex±1);越界 no-op 不报错。动作后经 `status` 刷新(target 查询扑空时回退 screencast 跟踪的记忆 URL)。 |
| `zhuye_browser_reload` | `null` | `BrowserStatusDto` | `commands/browser.rs` / `commands/browser.ts`。`Page.reload({ignoreCache:false})`,动作后刷新状态。 |
| `zhuye_browser_set_device` | `{ width, height }` | `BrowserStatusDto` | `commands/browser.rs` / `commands/browser.ts`。设备模拟在持续页面连接执行 `Emulation.setDeviceMetricsOverride`(scale 1 / mobile false)，面板未启动时返回错误;`0/0` = `Emulation.clearDeviceMetricsOverride` 复位。预设尺寸清单(桌面 1280×800 / 平板 768×1024 / 手机 390×844)在前端,后端只应用 metrics。 |
| `zhuye_browser_input` | `{ event }` | `null` | `commands/browser.rs` / `commands/browser.ts` / `browser_backend/input.rs`。**面板输入注入**:把桌面面板的鼠标 / 滚轮 / 键盘转成 CDP Input 域命令(`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`),面板因此是真可交互的浏览器(此前只有只读画面)。`event` 是 serde tagged 枚举(`type` 判别):`mouseMove` / `mouseDown` / `mouseUp` / `mouseWheel` / `key`，字段使用 camelCase（如 `clickCount`、`deltaX`、`virtualKeyCode`）;`x` / `y` 是**归一化坐标**(0..1,相对面板画面),后端乘页面 CSS 视口(`Page.getLayoutMetrics` → `cssVisualViewport`)换算成页面坐标 —— 面板缩放不影响落点。输入与帧流**共用同一条 page 级连接**(不另开 websocket,拖动手感不崩);浏览器未启动 / 会话已结束 → 结构化错误。 |
| `zhuye_list_tasks` / `zhuye_create_task` / `zhuye_get_task` / `zhuye_update_task` / `zhuye_claim_task` / `zhuye_delete_task` | `{ list }` / `{ list, subject, description, active_form?, owner?, metadata? }` / `{ list, id }` / `{ list, id, patch }` / `{ list, claimer }` / `{ list, id }` | `Task[]` / `Task` / `Task` / `{ task, updatedFields, statusChange? }` / `Task?` / `null` | `commands/tasks.rs` (Phase 1 multi-agent) / `commands/tasks.ts` |
| `zhuye_list_teams` / `zhuye_upsert_team` / `zhuye_get_team` / `zhuye_delete_team` | `null` / `{ team }` / `{ name }` / `{ name }` | `TeamFile[]` / `null` / `TeamFile` / `null` | `commands/tasks.rs` (Phase 1 multi-agent) / `commands/teams.ts` |
| `zhuye_list_schedules` / `zhuye_add_schedule` / `zhuye_update_schedule` / `zhuye_remove_schedule` / `zhuye_get_schedule_status` | `null` / `{ schedule, prompt, name? }` / `{ id, schedule?, prompt?, name?, enabled? }` / `{ id }` / `null` | `CronJobSpec[]` / `CronJobSpec` / `CronJobSpec` / `bool` / `{ status, line, total, enabled }` | `commands/schedule.rs` (Phase 1 item 2) / `commands/schedule.ts` |
| `zhuye_list_agent_defs` / `zhuye_get_agent_def` / `zhuye_save_agent_def` / `zhuye_delete_agent_def` / `zhuye_parse_agent_md` | `null` / `{ name }` / `{ def, createOnly? }` / `{ name }` / `{ text }` | `AgentDefinition[]` / `AgentDefinition` / `AgentDefinition` / `bool` / `AgentDefinition` | `commands/agents.rs` / `commands/agents.ts`。保存时可选 `createOnly: true` 使用独占创建，已有文件不覆盖；省略时兼容原有创建或更新语义。文件定义的 `source` 为 `custom`，`builtin_default` 仅用于引擎内置默认代理。 |
| `zhuye_get_active_agent` / `zhuye_set_active_agent` | `null` / `{ name }` | `ActiveAgentInfo`（camelCase） | `commands/agents.rs` / `commands/agents.ts`。**活跃 agent** —— 决定运行时加载哪条 agent 定义、以及记忆目录(`.zhuye/agent-memory/<agent>/`)。桌面端此前硬编码 `"desktop"`,导致 GUI 的 Agents 视图是死胡同(能编辑定义,运行时永不加载)、且 GUI 写的记忆 agent 读不到。现由桌面端偏好(`~/.zhuye/desktop.json`,缺省 `"default"` 与 CLI 一致)决定;`set` 会 replay 当前会话历史并强制重绑(新定义立即生效,与 provider 热重载同款语义)。`ActiveAgentInfo` 含 `defFound` / `memoryScopes`(空 = 不加载记忆,GUI 写入不会被注入)/ `injectBudgetChars`(核心 `MAX_MEMORY_INJECT_CHARS`)/ `memoryPaths` |
| `zhuye_start_side_channel` / `zhuye_cancel_side_channel` / `zhuye_list_side_channels` / `zhuye_get_side_channel` | `{ agent_name, prompt }` / `{ id }` / `null` / `{ id }` | `StartSideChannelResult` / `bool` / `SideChannelInfo[]` / `SideChannelInfo` | `commands/side_channel.rs` / `commands/side_channel.ts`。**引擎原生实现(v1.x WP9,develop 收编)**:命令把 `Op::StartSideChannel` / `Op::CancelSideChannel` / `Op::QuerySideChannels` 提交进 `AgentThread`,由 `SideChannelDriver`(`state/thread_factory.rs` 构造注入,registry 为进程级共享)执行独立 agent(recorder = None,不写主历史);应答经与 submission id 配对的 `SideChannelStarted` / `SideChannelFinished` / `SideChannelStatus` 事件返回(见 §3.13),并扇出到会话 broadcast。start 等待配对 Started 拿回 id(Error 应答转命令错误);cancel 先查快照保住 boolean 语义(未知 / 已终态 → `false`);driver 未配置 / 工厂失败 / 并发满(8)以 Error 事件诚实应答 |
| `zhuye_get_remote_config` / `zhuye_update_remote_config` / `zhuye_get_remote_status` | `null` / `{ host, port?, authToken?, autoConnect? }`(Tauri 按 camelCase 取 Rust 参数 `auth_token` / `auto_connect`) / `null` | `RemoteConfigSnapshot { host, port, authToken, autoConnect, endpoint, isReady }`(`#[serde(rename_all = "camelCase")]`) / 同上快照 / `RemoteStatus { state, message, endpoint, sinceMs }` | `commands/remote.rs` (Phase 2 item 2) / `commands/remote.ts` |
| `zhuye_tailscale_status` / `zhuye_tailscale_daemon_command_preview` / `zhuye_tailscale_daemon_start` / `zhuye_tailscale_daemon_stop` / `zhuye_tailscale_daemon_status` | `null` (all) | `TailscaleStatus { installed, running, version, dnsName, hostName, tailnetName, ipv4, ipv6, suggestedRemoteHost, message }`(camelCase) / `string` / `string` / `string` / `{ running, pid }` | `commands/remote.rs` (Phase 2 item 2) / `commands/remote.ts` |

| `zhuye_remote_hosts` / `zhuye_remote_host_save` / `zhuye_remote_host_remove` | `null` / `{ name, host, port?, user? }` / `{ name }` | `RemoteHost[]`（camelCase） | `commands/remote.rs` / `commands/remote.ts`。SSH 远程开发 host 注册表，持久化 `$ZHUYE_HOME/remote-hosts.json`（桌面自有概念，不经上游 ZhuyeConfig）；save 按 name 幂等覆盖。 |
| `zhuye_remote_test` | `{ host, port?, user? }` | `string`（版本行） | `ssh <host> -- sh -lc 'exec zhuye --version'`（BatchMode + ConnectTimeout=10；登录 shell 保证 bootstrap 安装位置在 PATH），一次探测连通性 + 远端 CLI 存在性；失败给装 CLI/配密钥引导。 |
| `zhuye_remote_bootstrap` | `{ host }` | `string`（安装后版本行） | `commands/remote.rs`。远端一键安装 zhuye CLI：ssh 送 POSIX sh 脚本（探测 OS/架构 → 上游 latest tag → 下载 `zhuye-<版本>-<triple>.tar.gz`，curl/wget 自适应 → `~/.local/bin` 免 sudo → 自验），失败按退出码给可行动引导（OS/架构不支持 / 缺 curl / 版本解析失败）。 |
| `zhuye_remote_connect` / `zhuye_remote_bind` / `zhuye_remote_disconnect` / `zhuye_remote_sessions` | `{ host, cwd }`（host 为注册表 name）/ `{ sid }` / `{ sid }` / `null` | `string`（会话 uuid）/ `null` / `null` / `RemoteSessionInfo[]` | 连接 = SSH 拉起远端 `sh -lc 'exec zhuye serve --cwd <path>'`（登录 shell + stdio JSONL，`session_configured` 握手）；bind 置前台插槽 → `zhuye_submit`/`zhuye_submit_op` 整条路由远端 stdin；事件经既有 `zhuye_event`（前台）/ `zhuye_session_event`（后台）通道回前端。传输二进制可经 `ZHUYE_REMOTE_SSH_BIN` 覆盖（测试 stub 注入点）。 |
| `zhuye_kms_list` / `zhuye_kms_create` / `zhuye_kms_delete` / `zhuye_kms_list_pages` / `zhuye_kms_get_page` / `zhuye_kms_save_page` / `zhuye_kms_search` / `zhuye_dream` | `null` / `{ name, description? }` / `{ name }` / `{ wiki }` / `{ wiki, page }` / `{ wiki, page, content, title?, tags?, createOnly?, expectedContent? }` / `{ query }` / `{ insights, sessionsAnalyzed }` | `WikiInfo[]` / `WikiInfo` / `null` / `Page[]` / `Page` / `Page` / `SearchResult[]` / `DreamResult` | `commands/kms.rs` / `commands/kms.ts`。`Page.content` 包含完整文件；保存时未提供标题且标签为空则原样写入，以保留已有 frontmatter。`createOnly` 为 true 时仅创建新页面；`expectedContent` 要求原页面内容匹配，二者不能同时使用。 |

KMS 列表和搜索在目录或页面读取失败时返回命令错误；不可读页面不会被当成空结果。链接等非普通文件条目不会被读取。
同一 KMS 管理器内的写操作串行化；外部进程不共享该锁，仍可能在内容检查与替换之间修改文件。

删除或归档会话会关闭该会话的录制器并等待在途写入；若会话当前已绑定，还会取消其线程。操作失败时尝试根据剩余记录恢复活动会话，恢复失败则在命令错误中说明。重新绑定同一 ID 会创建新的录制器。
恢复归档与会话绑定、删除和归档操作串行化；若同一会话正处于活动状态，需先切换会话。
Fork 期间持有父会话文件操作闸门；删除或归档会等待 fork 完成，避免旧操作重新创建父会话记录。
异步生成的标题写入前重新确认会话与输入内容；手动名称始终优先，非强制生成时保留已有标题，删除或归档后的迟到结果不会落盘。
手动重命名与会话删除、归档、恢复及生成标题落盘共用会话操作锁。
| `zhuye_get_autopilot_config` / `zhuye_update_autopilot_config` / `zhuye_autopilot_history` | `null` / `{ config }` / `null` | `AutopilotConfig` / `null` / `AutopilotRun[]` | `commands/autopilot.rs` / `commands/autopilot.ts`。桌面后台驱动按 cron 将到期任务提交到当前 `AgentThread`，并按回合终态回填历史；`config.agent` 非空时经引擎 side-channel 用指定 agent 定义隔离执行 |
| `zhuye_list_activity` / `zhuye_search_activity` / `zhuye_clear_activity` / `zhuye_activity_count` | `{ filter? }` / `{ query }` / `null` / `null` | `ActivityEvent[]` (camelCase; `id`, `tsMs`, `kind`, `actor`, `summary`, `taskId?`, `teamName?`, `level`) / `ActivityEvent[]` / `null` / `number` | `commands/activity.rs` (Phase 3 item 9) / `commands/activity.ts` |
| `zhuye_list_squads` / `zhuye_create_squad` / `zhuye_get_squad` / `zhuye_delete_squad` / `zhuye_delegate_next` / `zhuye_assign_squad_task` | `null` / `{ spec }` / `{ name }` / `{ name }` / `{ name, leaderActorId }` / `{ name, taskId, assignee? }` | `SquadSpec[]` / `null` / `SquadSpec` / `null` / `Task?` / `Task` | `commands/squad.rs` (Phase 3 item 11) / `commands/squad.ts` |
| `zhuye_list_media` / `zhuye_image_process` / `zhuye_screenshot` / `zhuye_computer_use` / `zhuye_media_capabilities` | `{ dir }` / `{ spec }` / `null` / `{ action }` / `null` | `MediaAsset[]` / `ImageProcessResult` / `string` (base64 PNG) / `null` / `MediaCapabilities` | `commands/media.rs` (Phase 3 item 13) / `commands/media.ts` |
| `zhuye_list_traces` / `zhuye_get_trace` | `{ limit? }` / `{ id }` | `TraceSessionSummary[]`（camelCase） / `TraceCall[]`（camelCase） | `commands/traces.rs` / `commands/traces.ts`。CLI `zhuye traces ls / show` 的 GUI 对应：只读查询 `~/.zhuye/traces/model-io/` 的脱敏 JSONL（`zhuye-telemetry`）。列表按最近降序带 rollout 标题 fallback；`id` 支持完整 UUID 或唯一前 8 字符前缀。Traces 视图（`/traces`）消费 |
| `zhuye_list_discussions` / `zhuye_run_discussion` / `zhuye_cancel_discussions` | `{ discussionId? }` / `{ configPath }` / `null` | `DiscussionSessionInfo[]`（camelCase） / `DiscussionRunOutcome`（camelCase） / `number` | `commands/discussion.rs` / `commands/discussion.ts`。CLI `zhuye discussion ls / run` 的 GUI 对应：逻辑在 `app-core/src/discussion.rs`（重组 `zhuye-discussion` 的 LLM 组装，provider 不可用降级 `run_noop`）。运行期间 Collab* 事件经 `event_sink` 桥进 MinimalAgent session broadcast（信封 `id = EVENT_ID_NONE`），前端 collab_* reducer 实时渲染；取消命令触发运行中参与者的级联取消并产生 `collab_finished { outcome: "cancelled" }`；`ls` 扫 rollout JSONL 的 `DiscussionTranscript` 记录。Collaboration 视图消费 |
| `zhuye_run_team_pipeline` / `zhuye_run_pipeline` | `{ teamName, topic }` / `{ configPath, topic, failurePolicy?, inputs? }` | `PipelineReport`（snake_case 直传 submodule 类型） | `commands/pipeline.rs` / `commands/pipeline.ts`。CLI `zhuye pipeline team / run -c` 的 GUI 对应：逻辑在 `app-core/src/pipeline.rs`（registry 从配置引导、`ZHUYE_MODEL=mock` 可离线跑通）。team 预设 = plan → prd → exec → verify 四阶段；TOML 路径跑任意 DAG。共享 `~/.zhuye/tasks\|teams/` 存储（与 Squad 视图同源）。Collaboration 视图消费 |
| `zhuye_validate_pipeline` / `zhuye_list_pipeline_configs` / `zhuye_save_pipeline_config` | `{ tomlSrc }` / `null` / `{ name, tomlSrc }` | `PipelineConfigSummary`（camelCase：`name` / `failurePolicy` / `nodes` / `nodeCount` / `missingTeams` / `valid` / `error?`）/ `PipelineConfigFile[]` / `PipelineConfigFile` | `commands/pipeline.rs` / `commands/pipeline.ts`。**Pipeline 配置编辑** —— 此前 GUI 只能跑一个已有的 TOML 文件（还得手写）。`validate` 走核心的 `Pipeline::from_toml`（与**实际运行同一条校验路径**，配置级 + wiring 级错误都如实返回），结构摘要只读顶层 `nodes` 表（不复刻核心 schema）；`save` 落盘 `~/.zhuye/pipelines/<name>.toml`，**写前先校验，非法不落盘**。Collaboration 视图 Pipeline 编辑器消费 |
| `zhuye_run_security_scan` | `null` | `SecurityScanResult`（camelCase：`ran` / `exitCode?` / `output` / `summary`） | `commands/security.rs` / `commands/security.ts`。在当前工作区跑一次 `cargo audit` —— 核心 `zhuye_integration::security_scan::run_cargo_audit` 的**真实实现**（30s 超时、管道排空、IO 错误落结构化报告而非 panic）。阻塞调用放 `spawn_blocking`（可能跑 30s，不占住 async worker）。Settings → Advanced「安全扫描」卡片消费 |
| `zhuye_pick_file` | `{ extensions? }` | `string?`（原生文件选择框，取消 → `null`；`tauri-plugin-dialog` Rust API，可选扩展名白名单过滤） | `commands/workspaces.rs` / `commands/workspaces.ts`。discussion / pipeline 的 TOML 配置入口 |
| `zhuye_pick_files` | `null` | `string[]?`（原生**多选**文件选择框，取消 → `null`） | `commands/workspaces.rs` / `commands/workspaces.ts`。A1：Composer 附件按钮入口 —— 返回真实绝对路径（webview `<input type=file>` 拿不到路径），图片转内联 base64、其余转 file mention，与 Finder 原生拖拽同款管线 |
| `zhuye_prompt_command` | `{ action }` | `string` | 查询、重扫、选择会话提示词方案或保存共享默认，通过事件回传结果。 |
| `zhuye_get_effective_prompt` | `null` | `EffectivePrompt` | 根据当前会话的选择和模型解析系统提示词及注册工具描述。 |
| `zhuye_session_stats` / `zhuye_all_model_usage` | `{ id }` / `null` | `SessionStats?` / `ModelUsage[]`（均 camelCase） | `commands/stats.rs` / `commands/stats.ts`。只读扫描 rollout JSONL（`~/.zhuye/sessions/`）的**模型级 token 统计**：复用 `zhuye-rollout::index::session_stats` / `all_model_usage`（与 CLI `zhuye session stats` 同源，桌面端不复刻聚合）。`SessionStats` 含总量 + `perModel` 按模型拆分 + 压缩前后 token（`compactionTokensSaved`）+ 记忆读写次数 + 缓存命中率（`cacheHitRate` = `cached / input`，会话级 token 加权；引擎侧钳到 `[0,1]`）；会话尚无落盘记录 → `null`。`/usage` 视图消费 |
| `zhuye_model_rate_cards` | `{ models }` | `RateCard[]`（camelCase） | `commands/stats.rs` / `commands/stats.ts`。模型**费率卡** —— 让费用在 GUI 里可解释。直接读核心公开费率表（`zhuye_llm::providers::pricing_table` / `rate_cards`,develop 收编),得每 1M token 的输入/输出/缓存读/缓存写单价;表更新后 GUI 自动跟随。模型不在表内 → `priced: false`，不给编造的数字 |
| `zhuye_list_worktrees` | `null` | `WorktreeInfo[]`（camelCase） | `commands/git.rs` / `commands/git.ts`。列出仓库的 worktree，标出**改动被困在隔离 worktree**的风险。实现在 `app-core::worktree`（`git worktree list --porcelain` + `zhuye_tools::worktree::worktree_dirty` 判脏）。`isolated` = 非主工作树；`stranded` = 隔离 + 有未提交改动（**改动还没落回主分支**，丢工风险）。Git 视图「Worktrees」面板消费 |
| `zhuye_create_worktree` | `{ name, branch?, path? }` | `WorktreeInfo`（camelCase） | `commands/git.rs` / `commands/git.ts`，实现 `app-core::worktree::worktree_add`。创建 linked worktree：`branch` 缺省 → `-b <name>` 建同名新分支；指定则检出已有分支；`path` 缺省 → `<repo 父目录>/<repo 名>-worktrees/<name>/`（不落仓库内/数据目录）。`name` 必须是单一路径组件；返回统一 `WorktreeInfo`（含 isolated/stranded） |
| `zhuye_remove_worktree` | `{ path, force }` | `null` | `commands/git.rs` / `commands/git.ts`，实现 `app-core::worktree::worktree_remove`。删除 linked worktree；脏树默认拒绝（`force = true` 才连带丢弃未提交改动，UI 侧须 confirmDialog 二次确认） |
| `zhuye_prune_worktrees` | `null` | `null` | `commands/git.rs` / `commands/git.ts`，实现 `app-core::worktree::worktree_prune`。`git worktree prune` 清理失效登记（目录被手工删除等），幂等 |
| `zhuye_list_mcp_resources` / `zhuye_list_mcp_prompts` | `null` | `McpResourceInfo[]` / `McpPromptInfo[]`（camelCase） | `commands/mcp.rs` / `commands/mcp.ts`。MCP 三大原语里此前只有 tools 对用户可达 —— resources / prompts 只能被 LLM 调用，用户想复用某个 server 的资源或 prompt 模板时没有路径。直接问 rmcp peer（`list_all_resources()` / `list_all_prompts()`），与核心 `ListMcp*Tool` 同源 |
| `zhuye_list_subagent_specs` / `zhuye_get_subagent_spec` / `zhuye_save_subagent_spec` / `zhuye_delete_subagent_spec` | `null` / `{ role }` / `{ role, markdown }` / `{ role }` | `SubagentSpecInfo[]` / `string?` / `null` / `null`（均 camelCase） | `commands/subagents.rs` / `commands/subagents.ts`。**子代理 spec**（`call_<role>` 工具的来源，`~/.zhuye/subagents/*.md` 或工作区同名目录）—— 与 agent 定义（`~/.zhuye/agents/*.md`）是两套东西，此前**无任何编辑面**。合并口径与运行时同款（TOML `[[subagents]]` > workspace md > home md > 硬编码 explorer）。`markdown` 是完整文件内容（frontmatter + body），写前由后端 `parse_subagent_str` 校验，非法不落盘 |
| `zhuye_list_hook_events` | `null` | `HookEventInfo[]`（camelCase：`kind` / `description` / `decisions`） | 列出 12 个事件及当前调用方会处理的决策；`decisions: []` 表示仅通知。任务生命周期事件转发给当前线程的 HookEngine，任务本身不受返回决策影响。 |
| `zhuye_list_permission_rules` | `null` | `PermissionRuleInfo[]`（camelCase） | `commands/permissions.rs` / `commands/permissions.ts`。**核心三层权限 store 的生效规则**（只读）：`config`（`config.toml` 的 `[permissions]`）> `project`（`<workspace>/.zhuye/permissions.toml`）> `user`（`~/.zhuye/permissions.toml`）。数组顺序即匹配顺序（first-match-wins，deny 优先）。Settings → Permissions 分节消费。**运行时同构**：桌面端线程构造按 CLI（`zhuye-exec` 的 `apply_permission_layers`）同款方式挂载解析器 —— 此前桌面端未挂，CLI 生效的 deny 规则被静默忽略 |
| `zhuye_lsp_diagnostics` | `{ path }` | `LspDiagnostic[]`（camelCase；行/列 1-based） | `commands/lsp.rs` / `commands/lsp.ts`。某文件的 **LSP 诊断**（编译器 / 检查器反馈）—— 读 core 的 `LspConnectionManager::diagnostics()` → `DiagnosticRegistry::get(uri)`。语义与核心 `LspTool` 同款：**只读被动缓存**（server 推 `textDocument/publishDiagnostics`，客户端不主动 pull）；文件未预热或 LSP 未开启 → 空列表。`LspStatus` 增 `diagnostics` 聚合（文档数 / 条数 / 状态描述）。Files 视图 Problems 面板消费 |
| `zhuye_list_mcp_servers` / `zhuye_mcp_catalog` / `zhuye_upsert_mcp_server` / `zhuye_delete_mcp_server` | `null` / `null` / `{ name, entry }` / `{ name }` | `McpServerInfo[]` / `McpCatalogEntry[]` / `null` / `null`（均 camelCase） | `commands/mcp.rs` / `commands/mcp.ts`。**MCP 服务管理** —— 此前 GUI 只能观测,加服务得手改 `config.toml` 的 `[mcp_servers.<name>]`。`list` 给出配置里的 server + transport + 启动命令 + **运行状态**；`catalog` 给出核心内置的精选清单（离线）+ 安装提示（`zhuye_mcp::registry`）；`upsert` / `delete` 改内存 `ZhuyeConfig.mcp_servers` → 经**核心 `mcp_server_configs()` 编译校验**（非法配置不落盘）→ 落盘 → 运行时起/停（注册/反注册其工具，路径与启动时的 `bootstrap_mcp` 同款）。`entry` 的 transport 线上字段名是 **`type`**（配置里写 `type = "stdio"`）。Collaboration 视图 McpManager 面板消费 |
| `zhuye_get_task_output` / `zhuye_stop_task` / `zhuye_release_task` | `{ list, id }` | `string` / `TaskUpdateResult` / `TaskUpdateResult` | `commands/tasks.rs` / `commands/tasks.ts`。任务**产出 / 停止 / 释放** —— 与核心工具同款语义（守卫在命令层，不在前端重复实现）：`get_task_output` 读任务 `output_path` 指向的文件（**不阻塞**，产出未写好时返回空串）；`stop_task` 守卫 `status == in_progress`，退回 `pending` + 清 `owner`（同 `TaskStopTool`）；`release_task` 守卫存在 `claimed_by`，退回 `pending` + 清 `claimed_by` / `claimed_at`（同 `TaskReleaseTool`）。任务板详情抽屉 + 行内按钮消费 |
| `zhuye_list_session_notes` / `zhuye_list_note_sessions` | `{ id }` / `null` | `SessionNoteInfo[]` / `NoteSessionInfo[]`（camelCase） | `commands/notes.rs` / `commands/notes.ts`。读取 `<notes_home>/session-notes/<thread_id>.jsonl`，按核心重建窗口和校验规则展示最近有效笔记并保留原始时间；会话列表数量与可读取笔记一致。文件不存在返回空列表，其他读取错误返回错误。Memory 视图「会话笔记」面板消费。 |
| `zhuye_list_span_logs` / `zhuye_read_span_log` | `{ days? }` / `{ day, sessionId? }` | `SpanLogFile[]` / `TraceSpan[]`（camelCase） | `commands/traces.rs` / `commands/traces.ts`。**span 日志**（`~/.zhuye/traces/log/zhuye-YYYY-MM-DD.jsonl`）—— turn → model → tool 的父子 span 链（含耗时、状态、`zhuye_goal` 事件）。model-io 的姊妹产物：model-io 给「每次调用的请求/响应全文」，span 给「turn 的结构与耗时归因」。`TraceSpan.depth` 由 `parentSpanId` 链推导（父缺失/成环均有防护）。Traces 视图「Span 树」页消费 |
| `zhuye_sandbox_status` | `null` | `SandboxStatus`（camelCase） | `commands/sandbox.rs` / `commands/sandbox.ts`。**OS 沙箱有效状态**：`status`（disabled / seatbelt / landlock / no_backend）、`active`、`backend`、核心的 `statusLine`。用 `OsSandbox::from_env()` —— 与 `BashTool::execute` 读 env 的路径同一逻辑，故状态栏显示的与 bash 实际跑在哪个沙箱里一致 |
| `zhuye_set_dock_badge` | `{ count? }` | `null` | `src-tauri/src/dock.rs` (macOS) / `src/utils/tauri.ts` (compat) |

**`zhuye_terminal_output` event** (B8-01):

```ts
interface ZhuyeShellOutputChunk {
  session_id: string;
  stream: 'stdout' | 'stderr' | 'exit' | 'error';
  data: string;     // 文本行(exit 时为退出码字符串)
  seq: number;      // 同一 session 内的单调递增序号
}
```

`Submission` wraps the op:

```rust
pub struct Submission {
    pub id: String,
    pub op: Op,
    pub client_user_message_id: Option<String>,
    pub trace: Option<TraceContext>,
    pub workspace: Option<String>,   // v1.x：会话归属（首条 UserInput 时写入 SessionMeta.workspace）
    pub source_command: Option<String>, // v1.x：插件 slash 命令来源标注（后端展开时写入，前端不构造）
}
```

`workspace` 带 `#[serde(default, skip_serializing_if = "Option::is_none")]` —— 旧线格式不写该键，
后端回退 `cfg.current_workspace()`；GUI 端由 `useCurrentWorkspace` 注入当前激活工作区。
`source_command` 同为可选字段，由后端在插件命令展开（`/plugin:ns:name args` → 命令正文，
`state/plugins.rs::expand_submission`）时标注，仅作 rollout / 遥测来源，前端不读写。

### 2.1 `UserInputItem`（`zhuye-agent/crates/protocol/zhuye-protocol/src/item.rs`）

| 变体 | 字段 | 前端来源 |
|---|---|---|
| `Text` | `text: String` | 输入框文本 |
| `Image` | `data: Vec<u8>, mime_type: String` | 拖拽或粘贴（前端 base64 解码） |
| `LocalImage` | `path: PathBuf` | 文件选择器（后端从磁盘读取） |
| `Skill` | `name: String, args: Option<JSON>` | `/skill name` 或技能选择器 |
| `QuestionAnswer` | `request_id, answers` | LLM 提问的回复（`AskUserQuestionResponse` 的替代路径） |
| `File` | `path: String, range?: FileRange` | Composer `@` 文件弹层（`MentionPicker`）。`path` 为相对工作区 POSIX 路径；`FileRange { start_line, end_line }` 可选。core 侧 `user_input_items_to_messages` 展开为 `@<path>` / `@<path>:L<n>-L<m>` 文本块，真实读取由 LLM `/read` 工具按需触发 |

`File` 为纯新增 variant（旧 reader 不受影响）；`SessionInfo.workspace` / `RolloutRecord::SessionMeta.workspace`
同样带 serde 兼容注解 —— 旧 JSONL 反序列化为 `None`，前端按"未归属"展示。

### 2.2 提交 ID 生命周期

- 前端生成 UUID v4 → `Submission.id`。
- 后端从 `zhuye_submit` 返回相同 id（回显）。
- 前端将入站 `Event.id` 与原始 `Submission.id` 关联以解锁输入器 / 标记 turn 完成。
- `EVENT_ID_NONE = ""` 事件（生命周期：`SessionConfigured`、`ShutdownComplete`、`PermissionModeChanged` …）没有对应的提交。
- `SessionConfigured.session_id`（v1.x 起）等于线程预分配 id：与 rollout 文件名
  （`~/.zhuye/sessions/YYYY/MM/DD/<id>.jsonl`）、`SessionMeta.session_id` 及
  前端路由 id 一致（`zhuye_bind_session` 经 `with_session_id` 注入，`submission_loop`
  在 `SessionConfiguredEvent::new` 后覆盖 `sc.session_id = session_id`）。旧版本曾发出
  随机 UUID，仅作 turn 事件标识。

### 2.3 `ThreadSettingsOverrides` —— 后端盖章的字段

`Op::UserInput.thread_settings`（`ThreadSettingsOverrides`）里有两个字段是
**后端说了算**，前端传什么都不算数：

| 字段 | 桌面端行为 |
|---|---|
| `sandbox_policy` | **无条件覆盖**为后端配置推导出的值（`OsSandbox` = 开 OS 沙箱，`WorkspaceOnly` = 关）。沙箱是安全设置，事实源只能是后端的配置快照。见 `docs/capabilities.md` §3.19。 |
| `model` / `approval_policy` / `max_tool_concurrency` | 原样透传。前端按会话发送 `prompt`、`auto_approve` 或 `full_access`，该审批策略独立于 Plan；显式拒绝规则和沙箱设置仍生效。`max_tool_concurrency` 可用于每轮调工具并发上限。 |

核心把这三个字段映射成每轮的真实行为（`zhuye-core/src/submission_loop.rs`）：
`sandbox_policy` → `ToolContext.os_sandbox`（`OsSandbox` → `Some(true)`，
其余 → `Some(false)`）→ 前台 `BashTool` 与后台 bash 两条路径都读它。

---

## 3. 事件（后端 → UI）

`EventMsg` 使用 `#[serde(tag = "type", rename_all = "snake_case")]`（变体列表位于 `zhuye-agent/crates/protocol/zhuye-protocol/src/event_msg/mod.rs`）。

> **命名**：Rust `enum` 使用 **PascalCase 结构变体**（如 `TurnStarted(TurnStartedEvent)`），但 serde 发出 **snake_case** 鉴别器（`turn_started`）供前端使用。前端 TypeScript 使用 snake_case 形式。

### 3.1 Lifecycle (7)

| 变体 | 触发方 | UI 影响 |
|---|---|---|
| `session_configured` | First turn of a thread | Show banner; persist `session_id` |
| `turn_started` | `Op::UserInput` accepted | Spinner on; clear composer draft |
| `turn_complete` | LLM turn finished | Spinner off; unlock composer; accumulate cost |
| `turn_aborted` | `Op::Interrupt` / error | Red toast |
| `turn_rewound` | `Op::Rewind` success | Truncate local scrollback; redraw |
| `submission_closed` | v1.3 SDK serve 模式的 per-submission 通道排空标记 | none —— Desktop 内嵌 AgentThread 不发本事件；TS 类型联合已补齐，reducer no-op 保穷尽 |
| `shutdown_complete` | `Op::Shutdown` | Quit / hide |

### 3.2 LLM output (5)

| 变体 | 字段 | UI |
|---|---|---|
| `agent_message` | `text: String` | Non-streaming final bubble |
| `agent_message_delta` | `delta: String` | Stream chunk → append to last assistant bubble |
| `thinking_delta` | `delta: String`、`kind?: "raw" \| "summary" \| "unknown"`（v1.x additive，上游 `#[serde(default)]` 旧事件兼容；`raw` = token 级流式默认，`summary` = 推理摘要） | Reasoning block (collapsible)；`kind` 前端类型已登记，渲染暂不区分（与旧行为一致） |
| `token_count` | `TokenCountEvent` (info) | StatusBar token/cost indicator + Inspector "Token Usage" section (input/output/cached/cache_write/total/cost/provider/credential/model). `TokenCountEvent` 字段：`input_tokens`、`output_tokens`、`cached_tokens`、`cache_write_tokens`（M8，input 子集，不计入 total）、`total_tokens`、`cost_usd?`、`provider?`、`credential_label?`、`model?`（v1.x 模型级统计:本轮实际命中的模型 spec 如 `"openai/gpt-4o"`；旧引擎不上报 → 缺省）、`turn_total?`（v1.x:**回合累计**标记 —— 引擎回合收尾补发的那条累计事件为 `true`，逐次调用的快照缺省为 `false`；消费方只累计 `false` 的事件，否则会话总量与费用翻倍） |
| `context_composition` | `ContextCompositionEvent` (v1.12 additive)：`categories: [{ id, tokens }]`，id 枚举 `system_prompt / memory / skills / tool_schemas / mcp_tools / messages`（估算值，复用 compact 估计器；不保证求和 = input_tokens） | 工作台容量卡六类构成条形（`StatusPanel` 分解条）。引擎在 ChatRequest 组装后计量、按组成指纹去重（无变化不发）；reducer 整体覆盖 `contextComposition` |

### 3.3 Tools (5)

| 变体 | 字段 | UI |
|---|---|---|
| `tool_call_begin` | `ToolCallBeginEvent` | Tool row running indicator |
| `tool_call_args_delta` | `ToolCallArgsDeltaEvent` (v1.5 additive) | 按 `call_id` 累积到对应 tool row 的 `argsStream`：模型仍在生成参数期间，ToolCell 头部直接展示已收到的片段（截断 80 字符），展开可见完整累积 JSON；JSON 拼完整后切回结构化摘要。整包形态的 provider（Ollama 原生格式）不发本事件 |
| `tool_call_end` | `ToolCallEndEvent` | Tool row done / failed / cancelled；`tool_name == "TodoWrite"` 时另取 `output.metadata.todos` → Inspector「Todo 清单」面板（`{ content, status, activeForm }`，`activeForm` 为 camelCase） |
| `tool_call_output_delta` | `ToolCallOutputDeltaEvent` (v1.4 A3) | none —— 长工具执行期间逐段 stdout/stderr 增量预览（完整输出仍以 `tool_call_end` 为准）；reducer no-op 保穷尽，避免高频重渲染 |
| `tool_execution_request` | `ToolExecutionRequestEvent` (v1.3 SDK) | none —— serve 模式下 core 请求客户端本地执行其经 `Op::RegisterTools` 注册的远程工具（回执 `Op::ToolExecutionResponse`，`call_id` 配对）。Desktop 内嵌 AgentThread 不注册远程工具，reducer no-op 保穷尽 |

### 3.4 Approvals / AskUser (5)

| 变体 | 前端响应 | 配对 Op |
|---|---|---|
| `approval_request` (Tool/Hook/Plan) | Open `ApprovalModal` | `tool_approval` / `hook_approval` |
| `ask_user_question` | Open `QuestionModal` (multi-Q) | `ask_user_question_response` (id = request_id) |
| `ask_user_input` | Open `AskUserModal` (free text; `secret` 时掩码显示) | `ask_user_input_response` |
| `permission_bubble` | Non-blocking toast (Bubble mode) | none |
| `interaction_resolved` (v1.12 additive) | 按 `request_id` **无条件**清理本地挂起态（四 pending 字段过滤；plan 单例匹配时清） | none（了结广播：应答 / TTL 过期 / 取消 / 中断 / 通道关闭 —— 后四者无对应回执事件，不清理则弹窗永久悬挂） |

> **v1.12 挂起交互查询面**：gate 真相上收引擎 —— `ApprovalGate` 在 waiter 注册时
> 写会话级 `PendingRegistry` 快照行（含 `payload` 原始载荷），了结（任意路径）时
> 广播 `interaction_resolved` 并落 `InteractionRequest` / `InteractionResolution`
> rollout 审计（不参与 resume 回放 —— 有意不跨进程重发，防幽灵弹窗）。
> `AgentThread::pending_interactions()` 为活进程内权威查询；客户端内存投影只是缓存。

### 3.5 Compaction / Errors (3)

| Variant | UI |
|---|---|
| `context_compacted` | "Compacting..." badge → fade |
| `error` | Red error bubble (recoverable) |
| `stream_error` | Retry countdown |

### 3.6 Config / Routing / Collab (5)

| Variant | UI |
|---|---|
| `config_reloaded` | Toast "Config reloaded" |
| `routing` | Status bar provider switch indicator。`kind` 枚举：`switched`（同池换 credential）/ `failed_over` / `cooldown_started` / `cooldown_cleared` / `spec_fallback`（v1.7 R3,跨模型降级 —— 当前 spec 的 credential 池全部不可用,切到 fallback spec;`from_credential` / `to_credential` 此时装的是 `"provider/model"` 形式的 spec） |
| `collab_started` / `collab_message` / `collab_finished` | Collab sidebar / timeline；`collab_finished.outcome` 也支持 `failed` / `cancelled`，上游修复尚未纳入当前子模块 |

**`routing.kind` 取值**（镜像 Rust `RoutingEventKind`，snake_case）：
`switched`（同池内换 credential）/ `failed_over`（全部 candidate 失败）/
`cooldown_started` / `cooldown_cleared` /
**`spec_fallback`**（v1.7 R3：当前 spec 的 credential 池全部不可用 → 切到
fallback spec，**跨模型降级**）。

> `spec_fallback` 与 `switched` 的区别：后者是**同池内**换 credential
> （`from_credential` / `to_credential` 都是凭据 label），前者装的是
> `"provider/model"` 形式的 **spec**。前端 `RoutingPayload.kind` /
> `RoutingSnapshot.kind` 联合类型已含该变体（未知变体按 Protocol v0 须能
> 降级不崩）。

> **Coding plan 自动切换**：前端 `stores/agent/planFailover.ts` 消费
> `quota_exhausted`（见 §3.12 插件/配额组）与耗尽特征的 `error` 事件，
> 自动改写 `[active].group` 并 `zhuye_save_config`（触发 §2.0 的热
> 重载链路），toast 告知切换结果。

### 3.7 MCP (3)

| Variant | UI |
|---|---|
| `mcp_server_started` | Status bar MCP segment |
| `mcp_server_failed` | Error toast |
| `mcp_tool_invoked` | Tool row "(via mcp:server)" badge |

### 3.8 LSP (2) — v0.5+

| Variant | UI |
|---|---|
| `lsp_server_started` | Status bar LSP segment |
| `lsp_server_failed` | Error toast |

### 3.9 Plan (7)

| Variant | UI |
|---|---|
| `plan_request` | "Enter plan mode?" confirm modal |
| `plan_ready` | Plan markdown modal (auto mode / manual approval / revise) |
| `plan_approved` | Status bar plan badge |
| `plan_rejected` | Status hint |
| `plan_draft_updated` | none —— 草稿正文覆盖式刷新(TUI 用于预览);GUI 决策路径走 `plan_ready` → PlanReadyModal,reducer no-op 保穷尽 |
| `plan_step` | Plan 视图「执行进度」清单 —— 核心在 agent 执行已批准 plan 时逐 step 上报;reducer 按 `index` 就地更新或追加(与核心 TUI 语义同构),`plan_ready` 到达时清空上一份 |
| `permission_mode_changed` | Status bar mode badge updates |

### 3.10 Subagent observability (2) — v1.4+

| 变体 | 字段 | UI |
|---|---|---|
| `subagent_progress` | `SubagentProgressEvent`（通道一:推送） | Inspector 子代理区块滚动 feed（封顶 200 条）—— 父级 `CallSubAgentTool` 转发的子代理中间进度（message / tool_begin / tool_end） |
| `subagent_status` | `SubagentStatusEvent`（通道二:查询应答） | Inspector 子代理区块状态快照（`zhuye_query_subagents` 发起;turn 收尾且 feed 非空时自动刷新,亦可手动） |

### 3.11 Prompt layers / extensions rescan (3) — v1.6.1 / v1.x
提示词按模型自动匹配外置到 `.zhuye/prompts/*.md`（`.zhuye/prompts/` 用户目录层 + 内置厂商层，三级回退 default → 厂商 → 精确模型名）。引擎侧经 `Op::PromptCommand` 暴露查询与重扫，两个动作都**不开 turn** —— 应答事件经 per-submission 通道 + 会话扇出双路送达。v1.x（submodule main）起 `Op::RescanExtensions` 把同样的「改完即生效」带到 skills 目录，应答 `extensions_rescanned`。

v1.7（submodule develop）起提示词预设升级为**两级目录**：`sources.json` 新增 `tools` 段（工具 → 模型变体；`tools_collection` 独立固定 revision），实体变体文案内嵌于 `prompts/tools/<tool>/<variant>.md`（英文策展，来源 `asgeirtj/system_prompts_leaks`），单文件工具以 `profile_ref` 回引既有厂商层。`PromptSelection::Manual.profile` 的合法取值扩展为变体 id（如 `claude-code-opus-4.6`），`auto` 改为在两级目录中按模型 spec 匹配（精确型号 > 最长家族前缀，评测状态仅作同级优选）—— 命中后按 default → 家族层 → 变体三级叠加，未命中回落 default 并带 `fallback_reason`。

| 变体 | 字段 | UI |
|---|---|---|
| `prompt_list` | `PromptListEvent`：`available: Vec<String>`（可绑定的层文件名，不含 `.md`；v1.7 起含工具变体 id）、`current_spec: String`（当前 model spec）、`active_layers: Vec<String>`（当前 spec 实际命中的用户层，内嵌厂商层不记录）、`groups?: Vec<PromptGroup>`（**v1.7 additive**：两级菜单工具分组 `[{ id, label, family_layer, variants: [{ id, label }] }]`，多变体工具出二级菜单、单变体组渲染为一级叶项；旧引擎不发，客户端平铺回退） | `PromptPicker` 两级菜单（工具 → 模型变体）+ `PromptLayersModal` 展示「当前模型 / 生效层 / 可用层」；`/prompt` slash 展开（经 `zhuye_prompt_command` 的 `list` 动作发起）。reducer 写 `store.prompt`（**进程级** —— 提示词库不随会话切换重置） |
| `prompt_switched` | `PromptSwitchedEvent`：`action: String`（`"reload"`；预留未来聚焦切换的层名）、`active_layers: Vec<String>`（重扫后当前 spec 的生效用户层） | toast 提示「提示词已刷新」并展示新命中层；reducer 更新 `store.prompt.activeLayers` + 记 `switchedAt`。「重新扫描」按钮发起 `switch` 动作（用户改了 `.zhuye/prompts/*.md` 后让改动即时生效） |
| `extensions_rescanned` | `ExtensionsRescannedEvent`：`skills: usize`（重扫后条目总数，文件型 + 插件型；未请求为 0）、`commands: bool`（commands 重扫是否被处理，当前恒 `false`） | `zhuye_rescan_extensions`（§2）的应答；reducer toast 提示「skills 已刷新」并展示条目总数。GUI 触发按钮待接（能力矩阵 🟡） |

### 3.12 Plugin / Quota (2)

| 变体 | 字段 | UI |
|---|---|---|
| `plugin_loaded` | `PluginLoadedEvent`：`plugin: String`、`scope: String`、`version: String`、`skill_count: usize`、`command_count: usize` | 插件加载成功时发送。前端事件存储保留最近一次加载记录；当前运行状态通过 `zhuye_list_plugins` 的 `runtime` 快照查询。 |
| `quota_exhausted` | `QuotaExhaustedEvent`：`provider: String`、`label: String`、`used_tokens: u64`、`max_tokens: u64`、`window_ends_secs: u64` | toast warn「配额耗尽」+ coding plan 自动 failover（`stores/agent/planFailover.ts` 消费） |

### 3.13 Side-channel agent (3) — v1.x WP9

用户驱动的旁路 agent(`Op::StartSideChannel` 发起,引擎 `SideChannelDriver` 执行,独立取消令牌,不写主历史)。事件经 per-submission 通道 + 会话扇出双路送达。**终态补发**:引擎 driver 的 Done / Cancelled / Error 只推进进程内 registry(不发协议事件,`SideChannelFinished` 仅覆盖启动失败路径);桌面端 `state/side_channel_forwarder.rs` 订阅共享 registry 的广播,把运行终态以 `EVENT_ID_NONE` 外层 id 补发到 `zhuye_event`(`Started` 由 submission_loop 带 submission id 发出,不补发避免双计)。

| 变体 | 字段 | UI |
|---|---|---|
| `side_channel_started` | `SideChannelEvent`（tag 枚举,`kind: "started"`）:`id`、`agent_name`、`prompt`、`started_at_ms` | reducer 递增 `store.sideChannels.revision`;SideChannelView 订阅后立即失效查询缓存刷新列表 |
| `side_channel_finished` | 同上,`kind: "done \| cancelled \| error"`:`id`、`finished_at_ms`、`summary?` / `message?` | 同上;终态语义由查询快照(`status`)呈现 |
| `side_channel_status` | `SideChannelStatusSnapshot`（camelCase）:`channels: SideChannelInfo[]`（`id` / `agentName` / `prompt` / `startedAtMs` / `status` / `durationMs`） | `Op::QuerySideChannels` 的拉取式应答;reducer 写 `store.sideChannels.lastSnapshot`（进程级投影,不随会话复位） |

### 3.14 Cache warming / stream recovery (5) — v1.x（develop）

v1.x 可靠性与治理批次新增的诊断事件族,均为引擎主动推送（无对应 Op）。
另随批次入线的协议常量:`MAX_STEER_INPUT_BYTES = 200_000`（`Op::Steer`
输入按 wire 序列化后的 UTF-8 字节上限,超限引擎以 `steer_input_too_large`
拒绝入队,客户端无需预判）。

| 变体 | 字段 | UI |
|---|---|---|
| `cache_warming` | `CacheWarmingEvent`：`action`（`scheduled` / `executed` / `skipped` / `cancelled`）、`phase`（`turn` / `idle`）、`reason?`、`prompt_tokens?` / `warm_cached_tokens?` / `warm_cost_usd?` / `expected_savings_usd?`、`model?`、`at`（Unix 秒） | prompt cache 保温状态（config `[cache_warming]` 默认关闭）。桌面暂无独立消费面,reducer no-op 保穷尽（能力矩阵 🟡）;收益验证走 `token_count.cached_tokens` 对照 |
| `stream_recovery_started` | `StreamRecoveryEvent`：`attempt`、`reason_code`、`transient?` | 流锚点恢复启动。reducer toast「流式输出中断,正在自动恢复（第 N 次尝试）」—— 半成品输出已被 `agent_message_reset` 清空,给用户显性反馈 |
| `stream_recovery_anchor_selected` | 同上 + `anchor?` | 审计级诊断,暂无独立消费面（reducer no-op 保穷尽） |
| `stream_recovery_tail_discarded` | 同上 + `discarded_text_chars?` / `discarded_thinking_chars?` | 同上;丢弃尾部另写 rollout（`RolloutRecord::StreamRecoveryDiscarded`,resume 不回放） |
| `stream_recovery_retry_started` | 同上 + `retry_in_ms?` | 同上;随后到来的增量属于重试轮 |

---

## 4. ID 配对规则

| 事件 | 触发 Op | 字段 | 备注 |
|---|---|---|---|
| `approval_request` (工具) | `tool_approval` | `id = request_id` | |
| `approval_request` (钩子) | `hook_approval` | `id = request_id` | |
| `approval_request` (计划) | `plan_approval` | `id = request_id` | |
| `ask_user_question` | `ask_user_question_response` | `id = request_id` | 一次请求可包含多题；每题答案使用 `selected` 下标和可选 `custom` |
| `ask_user_input` | `ask_user_input_response` | `id = request_id` | |
| `plan_request` | `plan_approval` | `id = plan_id` | `enter_plan_mode` 发起；进入使用 `manual_approve`，暂不进入使用 `revise`。桌面端：决策受理即登记 `resolved_plan_gates`，bind 快照不再重发该 gate（引擎上游不清挂起注册表的僵尸条目，见 `zhuye_bind_session` 行）；工作模式已为 Plan 时选 `/plan` 提示词预设可跳过本 gate（引擎 tool_exec 对 Plan 模式下的 EnterPlanMode 调用不再派发审批） |
| `plan_ready` | `plan_approval` | `id = plan_id` | |
| `*_delta` / `*_complete` | （任何用户操作） | `id = submission.id` | 流式块共享提交 id |

---

## 5. 版本兼容性

- **仅追加式演化**：新变体不会破坏现有代码（反序列化器忽略未知字段）。
- **Snake_case 标签**防止 Rust 重命名重构泄漏到线格式。
- 可选字段上的 **`#[serde(default)]`**在发布期间保护前端免受缺失键的影响。
- **前端类型重新生成**：当 `zhuye-protocol` 变更时，运行：

  ```bash
  # 在 ZhuYe 仓库中：
  cargo run -p zhuye-protocol --example dump_schema > /tmp/zhuye-schema.json
  # 在烛夜 ZhuYe 桌面端仓库中：
  npx json2ts /tmp/zhuye-schema.json -o src/types/protocol.ts
  ```

- **子模块升级**：`git submodule update --remote zhuye-agent` 拉取最新核心 crate（见 `SUBMODULE.md`）。升级后，重新运行 dump → json2ts 流水线。

---

## 6. 前端 TypeScript 接口

`src/types/protocol/` 是规范的镜像；以下列出协议轮廓，完整字段以对应类型文件为准。

```ts
// Submission side (UI → backend)
export type ZhuyeSubmission = {
  id: string;
  op: ZhuyeOp;
  client_user_message_id?: string;
  trace?: TraceContext;
  workspace?: string;
};

export type ZhuyeOp =
  | { type: 'user_input'; items: ZhuyeItem[]; thread_settings?: ThreadSettingsOverrides }
  | { type: 'compact' }
  | { type: 'interrupt'; child_id?: string | null }
  | { type: 'shutdown' }
  | { type: 'rewind'; to_turn_id?: string }
  | { type: 'steer'; priority?: 'attachment' | 'now'; items: ZhuyeItem[] }   // v1.4 A2 → zhuye_steer
  | { type: 'query_subagents'; child_id?: string }                              // v1.4 C1 → zhuye_query_subagents
  | { type: 'start_side_channel'; agent: string; prompt: string }               // v1.x WP9 → zhuye_start_side_channel
  | { type: 'cancel_side_channel'; id: string }                                 // v1.x WP9 → zhuye_cancel_side_channel
  | { type: 'query_side_channels'; id?: string }                                // v1.x WP9 → zhuye_list/get_side_channel
  | { type: 'tool_approval'; id: string; decision: ReviewDecision }
  | { type: 'hook_approval'; id: string; decision: ReviewDecision }
  | { type: 'enter_plan_mode'; task: string }
  | { type: 'exit_plan_mode' }
  | { type: 'enter_goal_mode'; goal: string; verify_command?: string; token_budget?: number }
  | { type: 'exit_goal_mode' }
  | { type: 'plan_approval'; id: string; choice: PlanApprovalChoice }
  | { type: 'prompt_command'; action: { type: 'list' } | { type: 'switch'; layer?: string | null } }
  | { type: 'rescan_extensions'; skills: boolean; commands: boolean }
  | { type: 'register_tools'; tools: RemoteToolSpec[] }
  | { type: 'tool_execution_response'; call_id: string; output: ToolOutput }
  | { type: 'set_effort'; effort: ReasoningEffort }
  | { type: 'ask_user_question_response'; id: string; answers: AskUserAnswer }
  | { type: 'ask_user_input_response'; id: string; text: string }
  | { type: 'set_permission_mode'; mode: PermissionMode }
  | { type: 'cycle_permission_mode' };

// Event side (backend → UI)
export type ZhuyeEvent = { id: string; msg: ZhuyeEventMsg };

export type ZhuyeEventMsg =
  | { type: 'session_configured'; /* ... */ }
  | { type: 'turn_started'; /* ... */ }
  | { type: 'turn_complete'; /* ... */ }
  // ... variant union, snake_case discriminators
  | { type: 'permission_mode_changed'; from: PermissionMode; to: PermissionMode };
```

### 6.1 桥接模式

前端 IPC 层分为三个角色：

1. **底层桥接** — `src/utils/bridge.ts` 导出 `invoke` / `listen`，带 Tauri 上下文回退和 `isMissingTauriInvokeError` 防护。
2. **域包装器** — `src/utils/commands/{health,agent,approvals,plan,permissions,questions,config,sessions,events,workspaces,skills,memory,hooks,git,terminal,files,allowlist,updates,search}.ts` re-export 类型化包装器。`src/utils/commands/index.ts` 桶文件聚合它们。
3. **兼容桶文件** — `src/utils/tauri.ts` 和 `src/utils/commands.ts` 从 `./bridge`、`./commands`、`./types` re-export，使现有的 `@/utils/tauri` 和 `@/utils/commands` 导入继续工作。**新代码应直接从 `@/utils/commands/{domain}` 或 `@/utils/bridge` 导入。**

```ts
// src/utils/bridge.ts (low-level)
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';

function isMissingTauriInvokeError(e: unknown): boolean { /* ... */ }

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> { /* ... */ }
export async function listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<UnlistenFn> { /* ... */ }
```

```ts
// src/utils/commands/agent.ts (per-domain wrapper)
import { invoke } from '../bridge';

export async function zhuye_submit(s: ZhuyeSubmission): Promise<string> {
  return await invoke<string>('zhuye_submit', { submission: s });
}

export async function onZhuyeEvent(handler: (e: ZhuyeEvent) => void) {
  return await listen<ZhuyeEvent>('zhuye_event', (ev) => handler(ev.payload));
}
```

### 6.2 Reducer 模式

`src/services/agentEventBus.ts`（引用计数总线）转发至 `src/stores/agent/reducer.ts` —— `ZhuyeEventMsg` 的规范 reducer。`src/services/agent.ts` 保留为兼容性 re-export，将 `useAgent` / `handle_event` 转发到 store。`src/stores/agentStore.ts` 是用户可见的兼容门面，从 `./agent` re-export `useAgentStore` / `reduceEvent` / 类型。新增变体：

1. 在 `src/types/protocol.ts` 添加 `ZhuyeEventMsg` 分支。
2. 在 `src/stores/agent/reducer.ts` 添加 `case 'new_variant':`。
3. 在 `src/stores/agentStore.test.ts` 和/或总线测试中覆盖单元测试。

---

## 7. 故障模式

| 症状 | 原因 | 修复 |
|---|---|---|
| 前端收到 `unknown variant` | 协议已添加但 TS 未重新生成 | 重新运行 `dump_schema` + `json2ts` |
| 提交被静默丢弃 | 后端反序列化错误 | 检查 `src-tauri/src/commands/<domain>.rs` 中的 `tracing` 日志 |
| 事件携带过时 id | 提交 id 被覆盖 | 仅使用 `crypto.randomUUID()` |
| 审批模态框不关闭 | 前端忘记派发 `*_approval` Op | 检查 `src/features/modals/ModalShell.tsx` `onSubmit` |
| `EVENT_ID_NONE` 配对为提交 | 生命周期事件按 id 匹配 | 在 `src/stores/agent/reducer.ts` 过滤 `e.id === ''` |

---

## 8. 参考

- Rust 真相源：`zhuye-agent/crates/protocol/zhuye-protocol/src/{event.rs,event_msg/mod.rs,op.rs,item.rs,submission.rs}`
- TS 镜像：`src/types/protocol.ts`
- Tauri 命令注册表：`src-tauri/src/lib.rs`（处理程序列表）+ `src-tauri/src/commands/mod.rs`（桶文件）+ `src-tauri/src/commands/<domain>.rs` 中各域主体
- 事件转发器：`src-tauri/src/events.rs::forward_agent_events`
- 前端事件扇出：`src/services/agentEventBus.ts` → `src/stores/agent/reducer.ts`；`src/services/agent.ts` 中的兼容 re-export
- IPC 底层桥接：`src/utils/bridge.ts`
- IPC 包装器（规范，按域）：`src/utils/commands/<domain>.ts` 由 `src/utils/commands/index.ts` 聚合
- IPC 兼容桶文件：`src/utils/tauri.ts`、`src/utils/commands.ts`
- Agent store：`src/stores/agent/`（规范实现）带兼容门面 `src/stores/agentStore.ts`
