//! provider 栈热重载 —— coding plan 切换的"立即生效"闭环。
//!
//! 背景:`reflect_save_config` 长期以来只热更新共享 cfg,**不**重建
//! `ModelRegistry`(memoized 于 `inner.model_registry`)。用户在设置里
//! 添加/切换 coding plan(凭证池 / `[active].provider`)后必须重启应用
//! 才生效 —— 对"额度耗尽自动切换备用计划"的体验是致命断点。
//!
//! 本模块在保存配置后:
//! 1. 检测 provider 相关段(`active` / `anthropic` / `openai` / `ollama` /
//!    `routing`)或 hooks 是否变化;无关段(显示、MCP…)变更不打扰运行中的
//!    会话。例外:`[plugins]` 段变更走轻量 diff 同步(挂/卸插件,不动线程,
//!    见 `hot_reload_provider_stack` 步骤 0)。
//! 2. provider 变化时重建 ModelRegistry + QuotaTracker 并热替换 inner。
//! 3. provider 或 hooks 变化且当前有绑定会话时,replay 历史后 `rebind_session_forced` ——
//!    运行中的线程换到新 registry 上,对话上下文经 preload 保留。
//!    回放失败时保留旧线程，避免丢失活跃上下文。

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
/// 返回模型解析、会话回放或重绑失败的原因；配置已写盘，错误同步到
/// `agent_status.degraded_reason`，调用方可据此提示用户。
pub(crate) async fn hot_reload_provider_stack(
    agent: &MinimalAgent,
    old: &reflect_config::ReflectConfig,
    new: &reflect_config::ReflectConfig,
) -> Option<String> {
    // 调用方持有配置写锁；会话切换也遵循配置锁 → 会话锁的顺序。
    let _transition = agent.inner.session_transition_lock.lock().await;
    let mut reload_errors = Vec::new();
    // 0. 插件段变更:不打断会话,直接 diff 同步挂/卸(exec handle_reload
    //    的 plugins 分支同语义)。provider 栈变更触发的 rebind 会走
    //    spawn_mount 全量重挂,不依赖这里;此分支覆盖「只改了 [plugins]」
    //    的场景。无绑定会话时挂载目标线程尚未重建,下次 rebind 自然生效。
    if old.plugins.enabled_plugins != new.plugins.enabled_plugins
        || agent.inner.pending_plugin_reload_error.lock().is_some()
    {
        info!(
            "[reflect-gui] plugins section changed; diff-syncing enabled plugins: {:?}",
            new.plugins.enabled_plugins
        );
        let _mount = agent.inner.plugin_mount_lock.lock().await;
        match super::plugins::reload_enabled_plugins(agent, &new.plugins.enabled_plugins).await {
            Ok(()) => clear_pending_plugin_reload(agent),
            Err(error) => {
                let message = format!("plugin runtime reload failed: {error:#}");
                warn!("[reflect-gui] {message}; continuing other configuration updates");
                *agent.inner.pending_plugin_reload_error.lock() = Some(message.clone());
                reload_errors.push(message);
            }
        }
    }
    let provider_changed = provider_stack_changed(old, new)
        || agent.inner.pending_model_discovery_error.lock().is_some();
    if !provider_changed
        && old.hooks == new.hooks
        && agent.inner.pending_rebind_error.lock().is_none()
    {
        return finish_reload(agent, reload_errors);
    }
    if provider_changed {
        info!("[reflect-gui] provider stack changed; rebuilding registry + quota tracker");

        // 1. 重建 registry(无 provider 时降级分支会注册 EchoTool,语义同 install)。
        reflect_config::discovery::clear_catalog_cache();
        let registry = super::thread_factory::build_registry(new, agent.tools());

        // 3. 诊断字段同步:model spec + 降级原因(语义同 install 步骤 1/5)。
        //    model 解析诚实化后,provider 在但无显式 model 也是降级态
        //    (状态栏黄点 + tooltip 指引),不再编造默认模型名。
        //
        //    `model = "free"` 这类**运行时才知道**的值在这里重新解析 ——
        //    改的可能是 `[model_discovery]` 规则,或 provider 换了(清单跟着变)。
        //    解析失败 → **保留旧 model**(与上游 `handle_reload` 同语义),失败
        //    原因如实写进降级原因。绝不把占位串 `"provider/free"` 当成真模型 ——
        //    它会被发给 provider,表现为难诊断的「模型不存在」。
        let (resolved_spec, resolve_error) =
            super::agent::resolve_model_spec_with_discovery(new, &registry).await;
        if let Some(ref err) = resolve_error {
            warn!(
                "[reflect-gui] model spec resolution failed ({err}); keeping previous model spec"
            );
            *agent.inner.degraded_reason.lock() = Some(err.clone());
            *agent.inner.pending_model_discovery_error.lock() = Some(err.clone());
            // 解析失败 → 不动 model spec(保留旧 model),但**不**把占位串当模型。
        } else {
            // 模型与 registry 必须一起生效；失败时切换会话仍使用旧栈。
            *agent.inner.model_registry.lock() = Some(registry);
            super::quota::install_quota_tracker(agent, new);
            agent.inner.pending_model_discovery_error.lock().take();
            let model_spec = resolved_spec.unwrap_or_else(|| "stub/test".to_string());
            *agent.inner.model_spec.write() = model_spec;
            *agent.inner.degraded_reason.lock() = super::agent::compute_degraded_reason(new);
        }
        if let Some(error) = resolve_error {
            reload_errors.push(error);
        }
    }

    // 动态模型尚未解析时保留现有线程；后续同一配置可重试发现。
    if agent.inner.pending_model_discovery_error.lock().is_some() {
        return finish_reload(agent, reload_errors);
    }

    // 4. 当前有绑定会话 → replay 历史 → 强制重绑(跳过同 id 短路)。
    //    旧线程的会话级 PermissionMode 原样带过去,热重载不重置权限模式。
    let Some(sid) = agent.bound_session_id() else {
        info!("[reflect-gui] no bound session; updated configuration takes effect on next bind");
        return finish_reload(agent, reload_errors);
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
            let message = format!("session replay failed during configuration reload: {e:#}");
            warn!("[reflect-gui] {message}; keeping current thread");
            *agent.inner.pending_rebind_error.lock() = Some(message.clone());
            reload_errors.push(message);
            return finish_reload(agent, reload_errors);
        }
    };
    match super::rebind::rebind_session_forced(agent, sid, preload, current_mode) {
        Ok(()) => info!("[reflect-gui] hot rebind for session {sid} completed or became stale"),
        Err(e) => {
            let message = format!("session rebind failed during configuration reload: {e:#}");
            warn!("[reflect-gui] {message}; new stack applies on next bind");
            *agent.inner.pending_rebind_error.lock() = Some(message.clone());
            reload_errors.push(message);
        }
    }
    finish_reload(agent, reload_errors)
}

/// 新线程成功绑定后仅移除对应的失败诊断，保留其他未解决的问题。
pub(crate) fn clear_pending_rebind(agent: &MinimalAgent) {
    let Some(previous) = agent.inner.pending_rebind_error.lock().take() else {
        return;
    };
    clear_diagnostic(agent, &previous);
}

fn clear_pending_plugin_reload(agent: &MinimalAgent) {
    let Some(previous) = agent.inner.pending_plugin_reload_error.lock().take() else {
        return;
    };
    clear_diagnostic(agent, &previous);
}

fn clear_diagnostic(agent: &MinimalAgent, previous: &str) {
    let base_reason = super::agent::compute_degraded_reason(&agent.inner.cfg.read());
    let mut degraded = agent.inner.degraded_reason.lock();
    if let Some(message) = degraded.as_deref() {
        let remaining = if message == previous {
            Some(String::new())
        } else {
            message
                .strip_prefix(&format!("{previous}; "))
                .or_else(|| message.strip_suffix(&format!("; {previous}")))
                .map(str::to_owned)
                .or_else(|| {
                    let (before, after) = message.split_once(&format!("; {previous}; "))?;
                    Some(format!("{before}; {after}"))
                })
        };
        if let Some(remaining) = remaining {
            *degraded = if remaining.is_empty() {
                base_reason
            } else {
                Some(remaining)
            };
        }
    }
}

fn finish_reload(agent: &MinimalAgent, errors: Vec<String>) -> Option<String> {
    let pending: Vec<String> = [
        &agent.inner.pending_plugin_reload_error,
        &agent.inner.pending_model_discovery_error,
        &agent.inner.pending_rebind_error,
    ]
    .into_iter()
    .filter_map(|error| error.lock().clone())
    .collect();
    if !pending.is_empty() {
        *agent.inner.degraded_reason.lock() = Some(pending.join("; "));
    } else if !errors.is_empty() {
        *agent.inner.degraded_reason.lock() = Some(errors.join("; "));
    }
    (!errors.is_empty()).then(|| errors.join("; "))
}

#[cfg(test)]
mod tests;
