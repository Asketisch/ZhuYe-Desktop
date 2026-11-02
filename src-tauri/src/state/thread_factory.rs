//! `construct_thread` —— 把 install 与 rebind 共享的 AgentThread 构造路径
//! 抽到一处,避免两份分叉的 registry/thread 构造逻辑各自漂移。
//!
//! 调用方:
//! - `state/install.rs::install_agent_thread`:首次构造,`sid = None`,
//!   `preload = []`(走随机 session_id 的占位 thread,供 `reflect_bind_session`
//!   重建前作为兜底)。
//! - `state/rebind.rs::rebind_session`:每次切换会话,`sid = Some(...)`,
//!   `preload` 由 `records_to_preload` 从 rollout replay 算出。
//!
//! 持久化:recorder 绑定的 base 目录与 `commands/sessions.rs::sessions_base`
//! 一致(都是 `reflect_rollout::path::default_base()`),保证 record 与
//! replay 同源 —— 这是为什么我们替换了原 `dirs::home_dir().join(...)` 的
//! 直接拼装。

use std::sync::Arc;

use reflect_core::{AgentConfig, AgentThread};
use reflect_llm::{ChatMessage, ModelRegistry, SharedModelRegistry};
use reflect_protocol::{PermissionMode, ThreadId};
use reflect_tools::{Sanitizer, ToolRegistry, builtins::EchoTool};
use tracing::warn;

use super::MinimalAgent;

/// 构造共享 `ModelRegistry`。逻辑原 `install.rs:47-70` 整体搬过来:
/// provider 配置齐 → `cfg.to_registry()`;否则降级到空 registry + EchoTool,
/// 让命令层不依赖 API key 也能启动(但实际 chat 跑不动)。
///
/// `tools` 在降级分支里会被注册 EchoTool;调用方**之前**已注册内置工具。
pub(crate) fn build_registry(
    cfg_snapshot: &reflect_config::ReflectConfig,
    tools: Arc<ToolRegistry>,
) -> SharedModelRegistry {
    let has_provider = cfg_snapshot.active_provider().is_some();
    if has_provider {
        match cfg_snapshot.to_registry() {
            Ok(r) => Arc::new(r),
            Err(e) => {
                warn!(
                    "[reflect-gui] to_registry failed ({}); falling back to empty registry",
                    e
                );
                Arc::new(ModelRegistry::new())
            }
        }
    } else {
        warn!(
            "[reflect-gui] no provider configured (set OPENAI_API_KEY / ANTHROPIC_API_KEY \
             or edit ~/.zhuye/config.toml); running in degraded mode"
        );
        tools.register(Arc::new(EchoTool));
        Arc::new(ModelRegistry::new())
    }
}

/// 构造 `AgentThread`,把 recorder / session_id / preload 一并接进 config。
///
/// `sid == None` 时不挂 recorder 也不固定 id —— 这是 install 阶段的占位
/// thread,首条 submission 触发 `reflect_bind_session` 后再换为带 recorder
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
    // `model = "free"` 这类动态值只会拿到**占位串** `"provider/free"`,
    // 它会被 routing 的 main slot 当成真模型发给 provider(表现为「模型
    // 不存在」)。动态值的解析在安装 / 热重载阶段完成(要打 provider 的
    // 模型清单端点),这里只消费结果。
    let model_spec = agent.inner.model_spec.read().clone();
    let registry = agent
        .inner
        .model_registry
        .lock()
        .clone()
        .expect("model_registry 必须在 install 阶段已建");

    let sanitizer = Arc::new(Sanitizer::with_defaults());
    // 内置 hook(verification / test_runner / search_budget / plan_completion)
    // 采用**显式启用**语义:`[hooks]` 未配置时一个都不挂,与 headless serve
    // 的 hooks_explicit_only 同一原则。此前默认全开,verification Stop hook
    // 会对每个 turn 跑 `cargo test`,无 toolchain 环境注入假失败并否决完成,
    // 纯问候也被迫连答数轮。需要 hook 的用户在 config 显式写
    // `[hooks] enabled = [...]`(或对应子段)。
    let mut hooks_cfg =
        reflect_hooks::config::HooksConfig::from_reflect_section(&cfg_snapshot.hooks);
    if hooks_cfg.enabled.is_none() {
        hooks_cfg.enabled = Some(Vec::new());
    }
    let hook_engine: Arc<reflect_hooks::HookEngine> = Arc::new(hooks_cfg.build_engine());
    agent.inner.hook_store.apply_disabled(&hook_engine)?;

    // 持久化:仅在 sid = Some 时挂 recorder + 固定 id。bind 命令前不挂,
    // 避免随机 id 产生空文件污染 `~/.zhuye/sessions/`。
    let mut cfg = AgentConfig::new(model_spec, agent.workspace())
        .with_approvals(true)
        // coding plan 配额追踪:config 声明了 `[[<provider>.credentials]].quota`
        // 时为 Some;model_call 节点据此在调用后记录用量,窗口耗尽 → 冷却 +
        // `QuotaExhausted` 事件 + 池内 failover(与 TUI/headless 行为对齐)。
        .with_quota_tracker(agent.inner.quota_tracker.lock().clone());
    // 权限层:与 CLI 同构的三层 store(config > project > user)+ YOLO 分类器。
    // 此前桌面端未挂解析器 —— CLI 里生效的 deny 规则在桌面端被静默忽略。
    cfg = super::permissions::apply_permission_layers(cfg, &cfg_snapshot, &agent.workspace());
    let mut mounted_m4: Option<(ThreadId, reflect_core::config::M4Deps)> = None;
    if let Some(sid) = sid {
        // 活跃 agent 名:桌面端偏好(缺省 "default",与 CLI 一致)——
        // 决定加载哪条 agent 定义,以及记忆目录(`.zhuye/agent-memory/<agent>/`)，
        // 与 GUI 的 Agents 视图 / Memory 视图同源。
        let active_agent = crate::agent_state::AgentState::active_agent();
        let m4 = match reflect::m4_bootstrap::build_default_m4(
            &agent.workspace(),
            &active_agent,
            &cfg.current_model(),
            &registry,
            sid,
        ) {
            Ok(mut m4) => {
                m4.recorder = Some(Arc::new(super::recorder_guard::GuardedRecorder::new(
                    reflect_rollout::JsonlRolloutWriter::new(
                        reflect_rollout::path::default_base(),
                        sid,
                    ),
                    super::recorder_guard::gate_for(agent, sid),
                )));
                m4
            }
            Err(e) => {
                // 持久化是承诺而非 nice-to-have:失败必须可见。
                anyhow::bail!("build_default_m4 失败,recorder 接线回退为无持久化: {e:#}");
            }
        };
        cfg = cfg.with_m4(m4.clone()).with_session_id(sid);
        // 会话笔记工具 + 子代理 `call_<role>` 工具 —— 此前桌面端**都没注册**:
        // agent 既写不了会话笔记(GUI 的笔记面板因此永远是空的),也委派不了
        // 子任务(Inspector 的子代理区块因此永远是空的)。口径与 CLI 的
        // `bootstrap_m5` 同款(见 `state/subagents.rs`)。
        super::subagents::register_note_tool(&agent.inner.tools, &m4);
        let _subagent_factory = super::subagents::bootstrap_subagents(
            &agent.workspace(),
            &cfg.current_model(),
            &registry,
            sid,
            m4.recorder.clone(),
            &m4,
            &agent.inner.tools,
            &cfg_snapshot,
        );
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
        let registry_for_side = Arc::clone(
            &agent
                .inner
                .model_registry
                .lock()
                .clone()
                .expect("model_registry 必须在 install 阶段已建"),
        );
        let tools_for_side = Arc::clone(&agent.inner.tools);
        let factory: reflect_core::side_channel::SideThreadFactory = Arc::new(
            move |agent_name: &str, cancel: tokio_util::sync::CancellationToken| {
                let workspace = crate::workspace_state::WorkspaceState::get()
                    .unwrap_or_else(|| inner_for_side.workspace.clone());
                let model = inner_for_side.model_spec.read().clone();
                let mut m4 = reflect::m4_bootstrap::build_default_m4(
                    &workspace,
                    agent_name,
                    &model,
                    &registry_for_side,
                    ThreadId::new(),
                )?;
                // 不写主历史:摘掉 recorder。
                m4.recorder = None;
                let side_cfg = AgentConfig::new(model.clone(), workspace.clone())
                    .with_m4(m4)
                    .with_cancel(cancel);
                Ok(AgentThread::new(
                    side_cfg,
                    Arc::clone(&registry_for_side),
                    Arc::clone(&tools_for_side),
                    None,
                    None,
                ))
            },
        );
        reflect_core::side_channel::SideChannelDriver::new(
            agent.inner.side_channels.clone(),
            factory,
        )
    };
    cfg = cfg.with_side_channel_driver(side_driver);

    // 插件挂载材料快照:model spec 与线程配置一致；启用列表在异步
    // 挂载时读取最新配置，避免排队期间的设置变更被旧快照覆盖。
    let model_for_plugins = cfg.current_model().to_string();
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
