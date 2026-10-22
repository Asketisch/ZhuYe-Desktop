//! provider 栈热重载 —— coding plan 切换的"立即生效"闭环。
//!
//! 背景:`reflect_save_config` 长期以来只热更新共享 cfg,**不**重建
//! `ModelRegistry`(memoized 于 `inner.model_registry`)。用户在设置里
//! 添加/切换 coding plan(凭证池 / `[active].provider`)后必须重启应用
//! 才生效 —— 对"额度耗尽自动切换备用计划"的体验是致命断点。
//!
//! 本模块在保存配置后:
//! 1. 检测 provider 相关段(`active` / `anthropic` / `openai` / `ollama` /
//!    `routing`)是否变化;无关段(显示、MCP、hooks…)变更不打扰运行中的
//!    会话。例外:`[plugins]` 段变更走轻量 diff 同步(挂/卸插件,不动线程,
//!    见 `hot_reload_provider_stack` 步骤 0)。
//! 2. 变化时重建 ModelRegistry + QuotaTracker 并热替换 inner。
//! 3. 若当前有绑定会话,replay 其历史后 `rebind_session_forced` ——
//!    运行中的线程换到新 registry 上,对话上下文经 preload 保留。
//!    (replay 失败时仅重建空 preload 的线程,不阻塞保存。)

use tracing::{info, warn};

use super::MinimalAgent;

/// 判断 provider 相关段是否发生变化(决定是否值得打断当前线程重建)。
fn provider_stack_changed(
    old: &reflect_config::ReflectConfig,
    new: &reflect_config::ReflectConfig,
) -> bool {
    old.active != new.active
        || old.anthropic != new.anthropic
        || old.openai != new.openai
        || old.ollama != new.ollama
        || old.routing != new.routing
        // `[model_discovery]` 段变更也必须触发重载 —— 它决定 `model = "free"`
        // 从清单里挑哪个模型(开关 / 偏好 / 免费判定规则)。不改这段,
        // 用户改了发现规则却要等下次切 provider 才生效。
        || old.model_discovery != new.model_discovery
}

/// 保存配置后的 provider 栈热重载(见模块文档)。
///
/// 必须在 tokio 上下文调用(replay 是 async;`rebind_session_forced` 内部
/// `AgentThread::new` 会 `tokio::spawn`)。失败只记日志、不回滚配置 ——
/// 配置本身已合法写盘,下次 rebind/install 自然生效。
///
/// 返回**模型解析失败的原因**(`model = "free"` 这类动态值解析不了时):
/// `None` = 解析成功(或配置里本来就没有 model)。调用方据此决定要不要
/// 把错误回传给前端 —— 配置已写盘,错误同时进 `agent_status` 的
/// `degraded_reason`,状态栏可见。
pub(crate) async fn hot_reload_provider_stack(
    agent: &MinimalAgent,
    old: &reflect_config::ReflectConfig,
    new: &reflect_config::ReflectConfig,
) -> Option<String> {
    // 0. 插件段变更:不打断会话,直接 diff 同步挂/卸(exec handle_reload
    //    的 plugins 分支同语义)。provider 栈变更触发的 rebind 会走
    //    spawn_mount 全量重挂,不依赖这里;此分支覆盖「只改了 [plugins]」
    //    的场景。无绑定会话时挂载目标线程尚未重建,下次 rebind 自然生效。
    if old.plugins.enabled_plugins != new.plugins.enabled_plugins {
        info!(
            "[reflect-gui] plugins section changed; diff-syncing enabled plugins: {:?}",
            new.plugins.enabled_plugins
        );
        let shared = agent.plugin_runtime();
        reflect_plugin::reload_plugins(&shared, &new.plugins.enabled_plugins).await;
    }
    if !provider_stack_changed(old, new) {
        return None;
    }
    info!("[reflect-gui] provider stack changed; rebuilding registry + quota tracker");

    // 1. 重建 registry(无 provider 时降级分支会注册 EchoTool,语义同 install)。
    let registry = super::thread_factory::build_registry(new, agent.tools());
    *agent.inner.model_registry.lock() = Some(registry.clone());

    // 2. 重建 quota tracker(coding plan 配额声明可能增删)。
    super::quota::install_quota_tracker(agent, new);

    // 3. 诊断字段同步:model spec + 降级原因(语义同 install 步骤 1/5)。
    //    model 解析诚实化后,provider 在但无显式 model 也是降级态
    //    (状态栏黄点 + tooltip 指引),不再编造默认模型名。
    //
    //    `model = "free"` 这类**运行时才知道**的值在这里重新解析 ——
    //    改的可能是 `[model_discovery]` 规则,或 provider 换了(清单跟着变)。
    //    解析失败 → **保留旧 model**(与上游 `handle_reload` 同语义),失败
    //    原因如实写进降级原因。绝不把占位串 `"provider/free"` 当成真模型 ——
    //    它会被发给 provider,表现为难诊断的「模型不存在」。
    let (resolved_spec, discovery_error) =
        super::agent::resolve_model_spec_with_discovery(new, &registry).await;
    if let Some(ref err) = discovery_error {
        warn!("[reflect-gui] model spec resolution failed ({err}); keeping previous model spec");
        *agent.inner.degraded_reason.lock() = Some(err.clone());
        // 解析失败 → 不动 model spec(保留旧 model),但**不**把占位串当模型。
    } else {
        let model_spec = resolved_spec.unwrap_or_else(|| "stub/test".to_string());
        *agent.inner.model_spec.write() = model_spec;
        *agent.inner.degraded_reason.lock() = super::agent::compute_degraded_reason(new);
    }

    // 4. 当前有绑定会话 → replay 历史 → 强制重绑(跳过同 id 短路)。
    //    旧线程的会话级 PermissionMode 原样带过去,热重载不重置权限模式。
    let Some(sid) = agent.bound_session_id() else {
        info!("[reflect-gui] no bound session; registry swap takes effect on next bind");
        return discovery_error;
    };
    let current_mode = agent
        .inner
        .thread
        .lock()
        .as_ref()
        .map(|t| t.config().permission_mode());
    let preload = match crate::commands::sessions::replay_for_preload(&sid).await {
        Ok(p) => p,
        Err(e) => {
            warn!("[reflect-gui] replay for hot rebind failed ({e:#}); rebinding without history");
            Vec::new()
        }
    };
    match super::rebind::rebind_session_forced(agent, sid, preload, current_mode) {
        Ok(()) => info!("[reflect-gui] hot rebind session {sid} onto new provider stack"),
        Err(e) => warn!("[reflect-gui] hot rebind failed ({e:#}); new stack applies on next bind"),
    }
    discovery_error
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::MinimalAgent;

    fn cfg_with_provider(provider: &str) -> reflect_config::ReflectConfig {
        reflect_config::load_from_str(&format!(
            "[active]\nprovider = \"{provider}\"\n\n[{provider}]\nmodel = \"test-model\"\n"
        ))
        .expect("config parses")
    }

    /// 无 model 配置的 provider 快照(诚实化:spec 为 stub,降级原因给出指引)。
    fn cfg_with_provider_no_model(provider: &str) -> reflect_config::ReflectConfig {
        reflect_config::load_from_str(&format!("[active]\nprovider = \"{provider}\"\n"))
            .expect("config parses")
    }

    /// 无关段变化不触发重载;provider 段变化触发(rebind 已绑定会话)。
    #[tokio::test]
    async fn hot_reload_rebuilds_registry_and_rebinds() {
        let agent = MinimalAgent::new_empty();
        agent.install_agent_thread().await;
        let sid = reflect_protocol::ThreadId::new();
        super::super::rebind::rebind_session(&agent, sid, vec![], None).unwrap();
        let thread_before = agent.inner.thread.lock().clone().unwrap();
        let registry_before = agent.inner.model_registry.lock().clone().unwrap();

        // provider 未变 → 不重建。
        let unchanged = cfg_with_provider("anthropic");
        let _ = hot_reload_provider_stack(&agent, &unchanged, &unchanged).await;
        let registry_after_same = agent.inner.model_registry.lock().clone().unwrap();
        assert!(
            std::sync::Arc::ptr_eq(&registry_before, &registry_after_same),
            "provider 段未变时不得重建 registry"
        );

        // anthropic → openai → registry 重建 + 会话强制重绑(thread Arc 换新)。
        let changed = cfg_with_provider("openai");
        let _ = hot_reload_provider_stack(&agent, &unchanged, &changed).await;
        let registry_after = agent.inner.model_registry.lock().clone().unwrap();
        let thread_after = agent.inner.thread.lock().clone().unwrap();
        assert!(
            !std::sync::Arc::ptr_eq(&registry_before, &registry_after),
            "provider 段变化必须重建 registry"
        );
        assert!(
            !std::sync::Arc::ptr_eq(&thread_before, &thread_after),
            "已绑定会话必须强制重绑到新 registry"
        );
        assert_eq!(agent.bound_session_id(), Some(sid), "会话 id 保持不变");
        assert_eq!(
            agent.model_spec(),
            "openai/test-model",
            "model spec 随 provider 更新"
        );
    }

    /// 诚实化回归:provider 段变化但无任何显式 model → spec 保持 stub,
    /// 降级原因给出「有 provider 但没 model」的可行动指引(而非编造
    /// `openai/gpt-4o` 之类的默认模型名)。
    #[tokio::test]
    async fn hot_reload_without_model_reports_degraded_reason() {
        let agent = MinimalAgent::new_empty();
        agent.install_agent_thread().await;
        let old = cfg_with_provider("anthropic");
        let new = cfg_with_provider_no_model("openai");
        let _ = hot_reload_provider_stack(&agent, &old, &new).await;
        assert_eq!(agent.model_spec(), "stub/test");
        let reason = agent.inner.degraded_reason.lock().clone();
        assert!(
            reason.as_deref().is_some_and(|r| r.contains("no model")),
            "降级原因应指向缺 model,实际: {reason:?}"
        );
    }

    /// provider 与 model 都齐全 → 降级原因清空。
    #[tokio::test]
    async fn hot_reload_with_model_clears_degraded_reason() {
        let agent = MinimalAgent::new_empty();
        agent.install_agent_thread().await;
        let old = cfg_with_provider_no_model("anthropic");
        let new = cfg_with_provider("openai");
        let _ = hot_reload_provider_stack(&agent, &old, &new).await;
        assert_eq!(agent.model_spec(), "openai/test-model");
        assert!(agent.inner.degraded_reason.lock().is_none());
    }

    /// v1.5:仅 `[active].credential` 变化(同 provider 下切 coding plan)
    /// 也必须触发热重载 —— 否则 GUI 的 plan 切换对运行中会话不生效。
    #[tokio::test]
    async fn hot_reload_detects_credential_pin_change() {
        let agent = MinimalAgent::new_empty();
        agent.install_agent_thread().await;
        let old = reflect_config::load_from_str(
            "[active]\nprovider = \"anthropic\"\n\n[anthropic]\nmodel = \"m\"\n",
        )
        .unwrap();
        let new = reflect_config::load_from_str(
            "[active]\nprovider = \"anthropic\"\ncredential = \"MiniMax\"\n\n[anthropic]\nmodel = \"m\"\n",
        )
        .unwrap();
        let registry_before = agent.inner.model_registry.lock().clone().unwrap();
        let _ = hot_reload_provider_stack(&agent, &old, &new).await;
        let registry_after = agent.inner.model_registry.lock().clone().unwrap();
        assert!(
            !std::sync::Arc::ptr_eq(&registry_before, &registry_after),
            "钉住变化必须重建 registry(apply_to_registry 重设 preferred)"
        );
    }

    /// 未绑定会话时只换 registry,不建新线程。
    #[tokio::test]
    async fn hot_reload_without_bound_session_only_swaps_registry() {
        let agent = MinimalAgent::new_empty();
        agent.install_agent_thread().await;
        assert!(agent.bound_session_id().is_none());
        let old = cfg_with_provider("anthropic");
        let new = cfg_with_provider("openai");
        let _ = hot_reload_provider_stack(&agent, &old, &new).await;
        assert_eq!(agent.model_spec(), "openai/test-model");
    }

    /// `[model_discovery]` 段变更也必须触发重载 —— 它决定 `model = "free"`
    /// 从清单里挑哪个模型(开关 / 偏好 / 免费判定规则)。漏掉这一条,
    /// 用户改了发现规则却要等下次切 provider 才生效。
    #[tokio::test]
    async fn hot_reload_detects_model_discovery_change() {
        let agent = MinimalAgent::new_empty();
        agent.install_agent_thread().await;
        let base = "[active]\nprovider = \"openai\"\n\n[openai]\nmodel = \"gpt-4o\"\n";
        let old = reflect_config::load_from_str(base).unwrap();
        let new = reflect_config::load_from_str(&format!(
            "{base}\n[model_discovery]\nprefer = \"code\"\n"
        ))
        .unwrap();
        assert_ne!(
            old.model_discovery, new.model_discovery,
            "测试前提:两边的发现段确实不同"
        );
        let registry_before = agent.inner.model_registry.lock().clone().unwrap();
        let _ = hot_reload_provider_stack(&agent, &old, &new).await;
        let registry_after = agent.inner.model_registry.lock().clone().unwrap();
        assert!(
            !std::sync::Arc::ptr_eq(&registry_before, &registry_after),
            "发现规则变更必须重建 registry(顺带重新解析 model)"
        );
    }
}
