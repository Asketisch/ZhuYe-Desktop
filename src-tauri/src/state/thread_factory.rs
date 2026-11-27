//! `construct_thread` —— 把 install 与 rebind 共享的 AgentThread 构造路径
//! 抽到一处,避免两份分叉的 registry/thread 构造逻辑各自漂移。
//!
//! 调用方:
//! - `state/install.rs::install_agent_thread`:首次构造,`sid = None`,
//!   `preload = []`(走随机 session_id 的占位 thread,供 `zhuye_bind_session`
//!   重建前作为兜底)。
//! - `state/rebind.rs::rebind_session`:每次切换会话,`sid = Some(...)`,
//!   `preload` 由 `records_to_preload` 从 rollout replay 算出。
//!
//! 持久化:recorder 绑定的 base 目录与 `commands/sessions.rs::sessions_base`
//! 一致(都是 `zhuye_rollout::path::default_base()`),保证 record 与
//! replay 同源 —— 这是为什么我们替换了原 `dirs::home_dir().join(...)` 的
//! 直接拼装。

use std::sync::Arc;

use tracing::warn;
use zhuye_core::{AgentConfig, AgentThread};
use zhuye_llm::{ChatMessage, ModelRegistry, SharedModelRegistry};
use zhuye_protocol::{PermissionMode, ThreadId};
use zhuye_tools::Sanitizer;

use super::MinimalAgent;

/// 按配置构造当前会话的本地 telemetry sink。
///
/// 与上游 `ZhuyeBuilder` 的默认语义一致：未配置时默认开启；显式
/// `enabled = false` 才关闭。model-io 文件名绑定会话 ID，便于 Traces 视图
/// 与会话列表关联。
fn build_telemetry_sink(
    cfg: &zhuye_config::ZhuyeConfig,
    sid: Option<ThreadId>,
) -> Option<Arc<zhuye_telemetry::TelemetrySink>> {
    let default_section = zhuye_config::TelemetrySection::default();
    let section = cfg.telemetry.as_ref().unwrap_or(&default_section);
    if !section.is_enabled() {
        return None;
    }
    let base_dir = section
        .dir
        .clone()
        .unwrap_or_else(|| zhuye_telemetry::resolve_traces_dir(None));
    let session_id = sid.unwrap_or_default().to_string();
    let write_cfg = zhuye_telemetry::TelemetryWriteConfig {
        redact: section.should_redact(),
        max_bytes: section
            .max_bytes
            .map_or(zhuye_telemetry::model::MAX_FIELD_CHARS, |n| n as usize),
    };
    let sink = zhuye_telemetry::TelemetrySink::new_with_config(
        base_dir,
        session_id,
        write_cfg,
        section.should_record_tool_schemas(),
    );
    if let Some(langfuse) = cfg.hooks.langfuse_tracker.as_ref()
        && langfuse.enabled.unwrap_or(false)
        && let (Some(endpoint), Some(public_key), Some(secret_key)) = (
            langfuse.endpoint.as_ref(),
            langfuse.public_key.as_ref(),
            langfuse.secret_key.as_ref(),
        )
        && !endpoint.is_empty()
        && !public_key.is_empty()
        && !secret_key.is_empty()
    {
        let exporter =
            zhuye_telemetry::LangfuseExporter::start(Some(zhuye_telemetry::LangfuseConfig {
                endpoint: endpoint.clone(),
                public_key: public_key.clone(),
                secret_key: secret_key.clone(),
                batch_size: 64,
            }));
        sink.set_langfuse(exporter);
    }
    Some(sink)
}

/// 构造共享 `ModelRegistry`。逻辑原 `install.rs:47-70` 整体搬过来:
/// 模型组配置齐 → `cfg.to_registry()`;否则降级到空 registry,
/// 让命令层不依赖 API key 也能启动(但实际 chat 跑不动)。
pub(crate) fn build_registry(cfg_snapshot: &zhuye_config::ZhuyeConfig) -> SharedModelRegistry {
    let has_group = cfg_snapshot.active_group().is_some();
    if has_group {
        match cfg_snapshot.to_registry() {
            Ok(r) => Arc::new(r),
            Err(e) => {
                warn!(
                    "[zhuye-gui] to_registry failed ({}); falling back to empty registry",
                    e
                );
                Arc::new(ModelRegistry::new())
            }
        }
    } else {
        warn!(
            "[zhuye-gui] no model group configured (declare a [[model_group]] or set \
             OPENAI_API_KEY / ANTHROPIC_API_KEY); running in degraded mode"
        );
        Arc::new(ModelRegistry::new())
    }
}

/// 构造 `AgentThread`,把 recorder / session_id / preload 一并接进 config。
///
/// `sid == None` 时不挂 recorder 也不固定 id —— 这是 install 阶段的占位
/// thread,首条 submission 触发 `zhuye_bind_session` 后再换为带 recorder
/// 的真 thread。
///
/// `initial_mode`:会话级 PermissionMode 的恢复入口(v1.x 会话绑定)。
/// rebind 历史会话时由 JSONL 审计轨迹末次 `PermissionModeChanged` 得出,
/// 使模式随会话而非随进程;install 占位 thread 传 `None`(默认 Auto)。
pub(crate) fn construct_thread(
    agent: &MinimalAgent,
    sid: Option<ThreadId>,
    preload: Vec<ChatMessage>,
    initial_mode: Option<PermissionMode>,
) -> anyhow::Result<Arc<AgentThread>> {
    let cfg_snapshot = agent.inner.cfg.read().clone();
    // model spec 用 **已解析** 的值(安装 / 热重载时写入 `inner.model_spec`)。
    //
    // 此前这里重新跑同步的 `resolve_model_spec_with_fallback` —— 对
    // `model = "free"` 这类动态值只会拿到**占位串** `"<组id>/free"`,
    // 它会被 routing 的 main slot 当成真模型发给模型组(表现为「模型
    // 不存在」)。动态值的解析在安装 / 热重载阶段完成(要打模型组的
    // 模型清单端点),这里只消费结果。
    let model_spec = agent.inner.model_spec.read().clone();
    let registry = agent
        .inner
        .model_registry
        .lock()
        .clone()
        .expect("model_registry 必须在 install 阶段已建");

    let sanitizer = Arc::new(Sanitizer::with_defaults());
    // web_search 工具级 env:`[web_search].api_key` → BRAVE_API_KEY
    // (与 CLI headless 同口径)。此前桌面只注册工具、不注入 key ——
    // 配了 key 的 web_search 调用仍会报"未配置"。
    let tool_env = super::web_search::tool_env(&cfg_snapshot);
    // 内置 hook(verification / test_runner / search_budget / plan_completion)
    // 采用**显式启用**语义:`[hooks]` 未配置时一个都不挂,与 headless serve
    // 的 hooks_explicit_only 同一原则。此前默认全开,verification Stop hook
    // 会对每个 turn 跑 `cargo test`,无 toolchain 环境注入假失败并否决完成,
    // 纯问候也被迫连答数轮。需要 hook 的用户在 config 显式写
    // `[hooks] enabled = [...]`(或对应子段)。
    let mut hooks_cfg = zhuye_hooks::config::HooksConfig::from_zhuye_section(&cfg_snapshot.hooks);
    if hooks_cfg.enabled.is_none() {
        hooks_cfg.enabled = Some(Vec::new());
    }
    // verify-hooks 门控插件(默认关):插件启用 = 显式启用 verification /
    // test_runner 两个内置 hook,与 exec headless / lib facade 同一判定源
    // (`zhuye_plugin::bundled_plugin_enabled`;config [hooks] 显式列出是
    // 另一条路径,两者并存)。注入在 explicit-only 收紧之后,语义同上游。
    // hook engine 随线程构造 —— 改插件启用状态后下次会话切换生效。
    if zhuye_plugin::bundled_plugin_enabled(
        "verify-hooks",
        &cfg_snapshot.plugins.enabled_plugins,
        &cfg_snapshot.plugins.disabled_plugins,
    ) {
        hooks_cfg.enable_hook_names(&["verification", "test_runner"]);
    }
    let hook_engine: Arc<zhuye_hooks::HookEngine> = Arc::new(hooks_cfg.build_engine());
    agent.inner.hook_store.apply_disabled(&hook_engine)?;
    // v1.x 修复:无条件注册 PlanModeGate(GUI 的 Plan 只读边界)。
    // 此前 GUI 从不注册该 gate,Plan 模式只读性只靠 pre_loop 的 write/edit
    // 裁剪 + 审批层 —— bash 写命令 / ast replace / MCP 写类工具可被审批
    // 策略(auto_approve / full_access / yolo)或用户一键放行,queue 的
    // plan_safe_bash 免审批短路还建立在「gate 已分级」的错误前提上。
    // 与 CLI headless(无条件注册)对齐;gate 按当前 mode 判定,非 Plan
    // 会话零副作用。rebind 恢复 Plan 模式的会话由此同样受保护。
    hook_engine.register(zhuye_hooks::builtins::PlanModeGate::default_mode());

    // v1.x:首轮上下文注入(环境块 + AGENTS.md)—— 修复此前「headless CLI
    // 注册而 GUI 从不注册」的半接线(exec 侧 builtin_hooks.rs 头注释声称
    // 桌面已注册,与实际不符)。实现住在 app-core::prompt_env(exec crate
    // 拖 clap/opentelemetry,不适合 GUI 依赖)。注入通道 UserPromptSubmit
    // 首轮 InjectMessage,引擎循环零触碰;hook 实例随 thread 生命周期,
    // 每会话只注一次。AGENTS.md 挂 `[active] agents_md` 开关(缺省开,
    // 与 headless.rs 同口径);环境块恒开(主流 agent 均默认注入)。
    // 字节上限读桌面偏好 `agents_md_max_bytes`(缺省 None = 不截断,
    // 完整注入;设置后超限字符边界截断并附提示)。
    if cfg_snapshot.active.agents_md.unwrap_or(true) {
        let user_data_dir = zhuye_config::data_path_or_relative(&[]);
        hook_engine.register(zhuye_app_core::prompt_env::AgentsMdHook::new(
            agent.workspace(),
            Some(user_data_dir),
            crate::agent_state::AgentState::agents_md_max_bytes(),
        ));
    }
    hook_engine.register(zhuye_app_core::prompt_env::EnvContextHook::new(
        agent.workspace(),
    ));

    // 持久化:仅在 sid = Some 时挂 recorder + 固定 id。bind 命令前不挂,
    // 避免随机 id 产生空文件污染 `~/.zhuye/sessions/`。
    let mut cfg = AgentConfig::new(model_spec.clone(), agent.workspace())
        .with_approvals(true)
        .with_max_iterations(zhuye_core::config::max_iterations_from_env(
            cfg_snapshot.active.max_iterations,
        ))
        .with_token_budget(zhuye_core::config::token_budget_from_env(
            cfg_snapshot
                .token_budget
                .as_ref()
                .and_then(|section| section.session_total_tokens),
        ))
        // coding plan 配额追踪:config 声明了 `[[<组id>.credentials]].quota`
        // 时为 Some;model_call 节点据此在调用后记录用量,窗口耗尽 → 冷却 +
        // `QuotaExhausted` 事件 + 池内 failover(与 TUI/headless 行为对齐)。
        .with_quota_tracker(agent.inner.quota_tracker.lock().clone())
        // v1.11 桌面#5:多目录综合工作区 —— GUI 配置的附加目录拼进
        // sandbox_writable(与 `[sandbox].writable_dirs` 同源),文件类
        // 工具的沙箱边界对附加目录放行(主工作区仍是规范根)。bind 时
        // 快照,会话生命周期内不变(与 workspace 语义一致)。
        .with_sandbox_writable(merged_sandbox_writable(
            cfg_snapshot.sandbox.writable_dirs.clone(),
            crate::workspace_state::WorkspaceState::additional_dirs(),
        ))
        // workspace-write:`[sandbox].allow_network` 接进运行时。此前只
        // 写进 toml 不被消费,bash 恒为禁网;设置页拨动后经 reload 的
        // sandbox 段重绑生效。true = Seatbelt `(allow network*)`,false =
        // 拒出站但放行 localhost 与 Unix socket(上游 os_sandbox)。
        .with_sandbox_network(Some(cfg_snapshot.sandbox.allow_network))
        // 默认思考强度:`[model].reasoning_effort` → 会话初始档位(与 CLI
        // headless 同款接线,此前桌面端未接 —— GUI 会话初始恒为 low,用户
        // 配置的默认档位死信)。运行时 `Op::SetEffort` 仍可随时覆盖;每次
        // bind 重建线程都重新读配置,设置页改档后重绑即生效。
        .with_initial_effort(cfg_snapshot.resolve_reasoning_effort())
        // 上下文窗口覆盖表:`[context_windows]` / `[model].context_window`
        // → 运行时查找表(exec bootstrap 同款装配)。此前桌面未装配,
        // SessionConfigured.context_window_size 恒走内置回退表 —— 本地
        // 扩窗模型(如 1M)的配置死信,GUI 容量卡分母错误。
        .with_context_window_overrides(cfg_snapshot.effective_context_window_overrides(&model_spec))
        // 工具级环境变量（web_search 的 BRAVE_API_KEY 等）。
        .with_tool_env(tool_env.clone());
    // 权限层:与 CLI 同构的三层 store(config > project > user)+ YOLO 分类器。
    // 此前桌面端未挂解析器 —— CLI 里生效的 deny 规则在桌面端被静默忽略。
    cfg = super::permissions::apply_permission_layers(cfg, &cfg_snapshot, &agent.workspace());
    cfg = cfg.with_telemetry(build_telemetry_sink(&cfg_snapshot, sid));
    // MCP elicitation:线程审批上下文指向 agent 生命周期唯一的等待表,
    // lifecycle 转发器登记的 waiter 与 `Op::McpElicitationResponse` 回执
    // 路由同表(exec bootstrap「宿主与 AgentConfig 同一张表」的桌面等价
    // 物)。rebind 清空重建 —— 旧会话未决请求随 oneshot drop 快速失败。
    let elicitations = agent.inner.mcp_elicitations.lock().clone();
    elicitations.lock().clear();
    cfg.approval_context.mcp_elicitations = elicitations;
    let mut mounted_m4: Option<(ThreadId, zhuye_core::config::M4Deps)> = None;
    if let Some(sid) = sid {
        // 活跃 agent 名:桌面端偏好(缺省 "default",与 CLI 一致)——
        // 决定加载哪条 agent 定义,以及记忆目录(`.zhuye/agent-memory/<agent>/`)，
        // 与 GUI 的 Agents 视图 / Memory 视图同源。
        let active_agent = crate::agent_state::AgentState::active_agent();
        // 上游 v1.x 起 `build_default_m4` 不可失败(提示词扫描等失败在
        // 上游内部降级为日志),直接接 recorder —— 持久化是承诺而非
        // nice-to-have,GuardedRecorder 的接线不再依赖可失败的组装步骤。
        let mut m4 = zhuye::m4_bootstrap::build_default_m4(
            &agent.workspace(),
            &active_agent,
            &cfg.current_model(),
            &registry,
            sid,
        );
        // Skill 目录与按需加载工具必须来自同一份 catalog。CLI bootstrap
        // 已注册这两项；桌面此前只展示目录，模型却拿不到 load_skill。
        agent
            .inner
            .tools
            .register_runtime_tool(Arc::new(zhuye_skills::LoadSkillTool::new(
                m4.skills.clone(),
            )));
        agent.inner.tools.register_runtime_tool(Arc::new(
            zhuye_skills::ReadSkillResourceTool::new(m4.skills.clone()),
        ));
        m4.recorder = Some(Arc::new(super::recorder_guard::GuardedRecorder::new(
            zhuye_rollout::JsonlRolloutWriter::new(zhuye_rollout::path::default_base(), sid),
            super::recorder_guard::gate_for(agent, sid),
        )));
        super::subagents::expose_task_tools(&m4, agent.task_manager());
        cfg = cfg.with_m4(m4.clone()).with_session_id(sid);
        // 会话笔记工具 + 子代理 `call_<role>` 工具 —— 此前桌面端**都没注册**:
        // agent 既写不了会话笔记(GUI 的笔记面板因此永远是空的),也委派不了
        // 子任务(Inspector 的子代理区块因此永远是空的)。口径与 CLI 的
        // `bootstrap_m5` 同款(见 `state/subagents.rs`)。
        super::subagents::register_note_tool(&agent.inner.tools, &m4);
        let subagent_factory = super::subagents::bootstrap_subagents(
            &agent.workspace(),
            &cfg.current_model(),
            &registry,
            sid,
            m4.recorder.clone(),
            &m4,
            &agent.inner.tools,
            &cfg_snapshot,
        );
        let subagent_runtime = Arc::new(zhuye_core::SubagentRuntimeRegistry::new());
        subagent_factory.set_runtime_registry(subagent_runtime.clone());
        cfg = cfg.with_subagent_runtime(subagent_runtime);
        mounted_m4 = Some((sid, m4));
    }
    if !preload.is_empty() {
        cfg = cfg.with_preload_messages(preload);
    }
    if let Some(mode) = initial_mode {
        cfg = cfg.with_initial_permission_mode(mode);
    }

    // v1.x side-channel driver:引擎原生旁路 agent(WP9,develop 收编)。
    // 工厂与 facade `build_side_channel_driver` 同口径:按 agent 定义名
    // `build_default_m4` 构独立 AgentThread,recorder = None(不写主
    // 历史),取消令牌由 registry 生成 —— 主 agent 的 interrupt 不会误杀。
    //
    // **registry 是进程级的**(`MinimalAgentInner.side_channels`,Arc 共享
    // 状态):desktop 每次 rebind 重建 thread/driver,但 registry 状态
    // (在跑的通道 / 事件流)跨 rebind 存活 —— 查询与取消始终可达。
    // 工厂闭包动态读 workspace / model_spec:rebind 换工作区或热重载换
    // 模型后,新 side-channel 立即用当前值。
    let side_driver = {
        let inner_for_side = Arc::clone(&agent.inner);
        // 与上方 L81 同一份进程级 registry(初始化只此一次,无需再走
        // lock + expect 重取)。
        let registry_for_side = Arc::clone(&registry);
        let tools_for_side = Arc::clone(&agent.inner.tools);
        // workspace-write:侧通道线程与主线程同源的可写目录与网络开关。
        // 此前侧通道 AgentConfig 不带这两项 —— 空可写根 + 禁网,与主
        // 线程不一致(bind 时快照,与主线程同生命周期)。
        let sandbox_writable_for_side = merged_sandbox_writable(
            cfg_snapshot.sandbox.writable_dirs.clone(),
            crate::workspace_state::WorkspaceState::additional_dirs(),
        );
        let sandbox_network_for_side = cfg_snapshot.sandbox.allow_network;
        // v1.x 修复:主会话的模式句柄 —— 侧通道线程此前以默认 Auto + 零
        // hook 运行,主会话处于 Plan 模式时侧通道可写全量工具(边界穿透)。
        // 与 CLI 侧通道工厂(builder.rs build_side_channel_factory)对齐:
        // 模式经 inherited_approval_mode 共享翻转,InheritedPlanGate 直接读
        // 父级模式判定只读边界(不依赖侧线程自身模式)。
        let parent_mode = cfg.permission_mode.clone();
        // 侧通道线程与主线程同源的工具级 env（web_search key 等）。
        let tool_env_for_side = tool_env.clone();
        let factory: zhuye_core::side_channel::SideThreadFactory = Arc::new(
            move |agent_name: &str, cancel: tokio_util::sync::CancellationToken| {
                let workspace = crate::workspace_state::WorkspaceState::get()
                    .unwrap_or_else(|| inner_for_side.workspace.clone());
                let model = inner_for_side.model_spec.read().clone();
                let mut m4 = zhuye::m4_bootstrap::build_default_m4(
                    &workspace,
                    agent_name,
                    &model,
                    &registry_for_side,
                    ThreadId::new(),
                );
                // 不写主历史:摘掉 recorder。
                m4.recorder = None;
                let mut side_cfg = AgentConfig::new(model, workspace)
                    .with_m4(m4)
                    .with_cancel(cancel)
                    .with_sandbox_writable(sandbox_writable_for_side.clone())
                    .with_sandbox_network(Some(sandbox_network_for_side))
                    .with_tool_env(tool_env_for_side.clone());
                side_cfg.inherited_approval_mode = Some(parent_mode.clone());
                let side_thread = AgentThread::new(
                    side_cfg,
                    Arc::clone(&registry_for_side),
                    Arc::clone(&tools_for_side),
                    None,
                    None,
                );
                side_thread.register_hook(zhuye_core::side_channel::InheritedPlanGate::new(
                    parent_mode.clone(),
                ));
                Ok(side_thread)
            },
        );
        zhuye_core::side_channel::SideChannelDriver::new(agent.inner.side_channels.clone(), factory)
    };
    cfg = cfg.with_side_channel_driver(side_driver);

    // 插件挂载材料快照:model spec 与线程配置一致；启用列表在异步
    // 挂载时读取最新配置，避免排队期间的设置变更被旧快照覆盖。
    let model_for_plugins = cfg.current_model();
    let plugin_bridge = mounted_m4.as_ref().map(|(sid, _)| {
        let (bridge, ready) = super::plugin_hooks::PluginHookBridge::new(*sid, cfg.cancel.clone());
        hook_engine.register(super::plugin_hooks::PluginHookForwarder(bridge.clone()));
        (bridge, ready)
    });
    let registry_for_mount = Arc::clone(&registry);

    let thread = Arc::new(AgentThread::new(
        cfg,
        registry,
        agent.inner.tools.clone(),
        Some(sanitizer),
        Some(hook_engine),
    ));

    let plugin_mount = mounted_m4
        .zip(plugin_bridge)
        .map(|((sid, m4), (bridge, ready))| {
            let (activate, activation) = tokio::sync::watch::channel(false);
            *agent.inner.plugin_hook_slot.lock() = Some(super::plugin_hooks::PluginHookSlot {
                thread: Arc::downgrade(&thread),
                bridge: bridge.clone(),
                activate,
            });
            super::plugins::PluginMount {
                sid,
                thread: thread.clone(),
                hook_engine: bridge.engine.clone(),
                bridge,
                ready,
                activation,
                m4,
                model: model_for_plugins,
                registry: registry_for_mount,
                child_registry: cfg_snapshot.to_child_registry().map(Arc::new),
            }
        });

    // 插件运行时仅在真实会话挂载。重绑完成后异步启动挂载；线程的
    // SessionStart 和用户输入等待挂载，避免首条事件遗漏插件能力。
    if let Some(mount) = plugin_mount {
        super::plugins::spawn_mount(agent, mount);
    }

    Ok(thread)
}

/// v1.11 桌面#5:把 GUI 附加目录并入 `[sandbox].writable_dirs`(纯函数,
/// 便于单测绑定语义)。配置序在前、附加目录殿后;已在配置里的附加项
/// 去重(同一路径写两次在沙箱 profile 里是无意义重复)。
pub(crate) fn merged_sandbox_writable(
    configured: Vec<std::path::PathBuf>,
    extra: Vec<std::path::PathBuf>,
) -> Vec<std::path::PathBuf> {
    let mut dirs = configured;
    for dir in extra {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// 附加目录并入且保序:配置序在前、附加序殿后。
    #[test]
    fn 附加目录并入且保序() {
        let merged = merged_sandbox_writable(
            vec![PathBuf::from("/cfg/a")],
            vec![PathBuf::from("/extra/1"), PathBuf::from("/extra/2")],
        );
        assert_eq!(
            merged,
            vec![
                PathBuf::from("/cfg/a"),
                PathBuf::from("/extra/1"),
                PathBuf::from("/extra/2"),
            ],
            "配置序在前,附加目录按设置顺序殿后"
        );
    }

    /// 与配置重复的附加项去重;空附加 = 原样返回配置。
    #[test]
    fn 与配置重复的附加项去重() {
        let merged = merged_sandbox_writable(
            vec![PathBuf::from("/cfg/a"), PathBuf::from("/cfg/b")],
            vec![PathBuf::from("/cfg/b"), PathBuf::from("/extra/1")],
        );
        assert_eq!(
            merged,
            vec![
                PathBuf::from("/cfg/a"),
                PathBuf::from("/cfg/b"),
                PathBuf::from("/extra/1")
            ],
            "配置里已有的附加项不得重复出现"
        );
        assert_eq!(
            merged_sandbox_writable(vec![PathBuf::from("/cfg/a")], Vec::new()),
            vec![PathBuf::from("/cfg/a")],
            "空附加目录 = 配置原样"
        );
    }
}
