//! `rebind_session` —— 把后端 AgentThread 换绑到指定 session id。
//!
//! 触发动机:
//! - New Chat → `reflect_create_session` 分配 id → 路由跳转 → ChatView
//!   挂载时调 `reflect_bind_session(new_id)`,空历史绑定,首条消息落盘。
//! - 切换历史会话 → ChatView 重新挂载,带 replay 出的历史 binding,LLM
//!   恢复上下文,后续消息续写到该 id。
//!
//! 不变量(由 ChatView 加载序列保证):
//! - bind 期间 Composer 不渲染(loading gate),消除 bind 前发送竞态。
//! - 同 id 二次 bind 短路(后端幂等),允许"已水合也要先 bind"的 FE 序列。
//!
//! v1.x 后台持续运行:换绑**不再取消**旧线程 —— 取消会话级令牌等于
//! `Op::Shutdown`,是「切走即中断」的根因。有会话归属的旧线程迁入
//! `inner.background` 继续跑(上限 `MAX_BACKGROUND_THREADS`,超限按
//! 「空闲优先、最旧兜底」驱逐);bind 回该会话时 promote 复用 warm 线程。
//! 占位线程(sid=None)、原地重建(forced / pending error)与超限驱逐仍走
//! cancel。后台线程事件经 forwarder 分流到 `background_tx`(见 session.rs)。

use std::sync::Arc;

use reflect_llm::ChatMessage;
use reflect_protocol::{PermissionMode, ThreadId};
use tracing::{debug, warn};

use super::MinimalAgent;
use super::thread_factory::construct_thread;

/// 把 agent 的 AgentThread 换绑到指定 session id(带 preload 历史)。
///
/// `initial_mode` 为 `Some` 时作为新线程的会话级 PermissionMode
/// (来自该 session JSONL 审计轨迹的末次 `PermissionModeChanged`),
/// 实现模式随会话恢复;`None` 落默认 Auto。
///
/// 必须在 tokio 上下文调用(`AgentThread::new` 内部 `tokio::spawn`)。
///
/// 失败模式:
/// - `model_registry` 未就绪(`install_agent_thread` 没跑完)→ 返回
///   `Err`,不修改任何 state,命令层把 `CommandError` 推前端。
/// - `construct_thread` 内部 `build_default_m4` 失败(异常,如磁盘满)→
///   同样的 Err,原 thread 保留(不替换)。
pub(crate) fn rebind_session(
    agent: &MinimalAgent,
    sid: ThreadId,
    preload: Vec<ChatMessage>,
    initial_mode: Option<PermissionMode>,
) -> anyhow::Result<()> {
    rebind_session_inner(agent, sid, preload, initial_mode, false)
}

/// 强制重绑:跳过同 id 短路,无条件重建线程。
///
/// coding plan 热切换路径(`state/reload.rs::hot_reload_provider_stack`)
/// 使用:provider 相关配置变更后,当前绑定会话必须换到新 registry/tracker
/// 上,否则新计划要到下次切换会话才生效。`initial_mode` 传旧线程当前
/// 模式,保证热重载不重置权限模式。
pub(crate) fn rebind_session_forced(
    agent: &MinimalAgent,
    sid: ThreadId,
    preload: Vec<ChatMessage>,
    initial_mode: Option<PermissionMode>,
) -> anyhow::Result<()> {
    rebind_session_inner(agent, sid, preload, initial_mode, true)
}

fn rebind_session_inner(
    agent: &MinimalAgent,
    sid: ThreadId,
    preload: Vec<ChatMessage>,
    initial_mode: Option<PermissionMode>,
    force: bool,
) -> anyhow::Result<()> {
    rebind_session_with(agent, sid, preload, initial_mode, force, construct_thread)
}

fn rebind_session_with(
    agent: &MinimalAgent,
    sid: ThreadId,
    preload: Vec<ChatMessage>,
    initial_mode: Option<PermissionMode>,
    force: bool,
    build: impl FnOnce(
        &MinimalAgent,
        Option<ThreadId>,
        Vec<ChatMessage>,
        Option<PermissionMode>,
    ) -> anyhow::Result<std::sync::Arc<reflect_core::AgentThread>>,
) -> anyhow::Result<()> {
    let _rebind = agent.inner.rebind_lock.lock();
    if !agent.model_registry_ready() {
        anyhow::bail!("agent 未安装或 registry 未就绪");
    }
    // 热重载可能在异步回放期间遇到用户切换会话，不可切回旧会话。
    if force && agent.bound_session_id() != Some(sid) {
        debug!("rebind_session: stale forced rebind for {sid}, skipped");
        return Ok(());
    }
    // 同 id 短路(允许 ChatView 在已水合时仍调 bind);forced 变体跳过。
    let current_usable = agent.inner.thread.lock().as_ref().is_some_and(|thread| {
        !thread.cancel_token().is_cancelled() && !thread.submission_sender().is_closed()
    });
    if !force
        && agent.bound_session_id() == Some(sid)
        && current_usable
        && agent.inner.pending_rebind_error.lock().is_none()
    {
        debug!("rebind_session: {sid} 已是当前绑定,短路");
        return Ok(());
    }

    // v1.x promote:目标会话的后台线程仍在跑/仍可用 → 直接复用 warm 线程
    // (内存上下文即在,preload/initial_mode 忽略),不再重建。线程已死
    // (cancel/closed)则照常走重建。
    let thread = if !force {
        match take_background(agent, sid) {
            Some(warm) => {
                debug!("rebind_session: {sid} promote 后台线程(免重建)");
                warm
            }
            None => build(agent, Some(sid), preload, initial_mode)?,
        }
    } else {
        build(agent, Some(sid), preload, initial_mode)?
    };

    // 1. 处置旧线程。读出旧 Arc 与其 sid,然后**立即释放 thread-slot 锁**
    //    再调 `start_forwarder`(ParkingMutex 非重入)。
    //    - 跨会话换绑(正常切换):旧线程降级后台继续跑,不 cancel(v1.x
    //      后台持续运行;取消会话级令牌等于 Op::Shutdown,即旧「切走即中断」)。
    //    - 原地重建(forced 热重载 / pending error 重试,old_sid == sid):
    //      旧线程必须 cancel —— 同一 session 不允许两个 live 线程写同一
    //      rollout 文件。
    //    - 占位线程(old_sid == None,install 产物):无会话可保活,照旧 cancel。
    let old_thread = agent.inner.thread.lock().clone();
    let old_sid = *agent.inner.bound_session_id.lock();
    if let Some(old) = old_thread.as_ref() {
        match old_sid {
            Some(osid) if osid != sid && !old.cancel_token().is_cancelled() => {
                demote_background(agent, osid, old.clone());
            }
            _ => {
                if !old.cancel_token().is_cancelled() {
                    old.cancel_token().cancel();
                }
            }
        }
    }
    drop(old_thread); // drop guard
    if force {
        // 热重载换掉了 provider 栈(model_registry/quota_tracker):后台
        // 线程还攥着旧 registry,继续跑会与前台配置分叉 —— 全部清场
        // (cancel),让下次 bind 走重建。
        clear_background(agent);
    }

    // 1.5 尽早停旧 cron driver:`CronScheduler::start` 把旧 `sub_tx` **按值捕获**
    //     进 driver 任务,`rebind_sender` 只改 scheduler 字段、对运行中的旧
    //     driver 无效(上游 cron.rs 文档明示须 stop + restart)。停止后
    //     到期 job 由新 driver 的
    //     首个 tick 补发(`tokio::time::interval` 首次 tick 立即完成,
    //     `tick` 扫描所有 `next_fire <= now` 的 job),不丢触发。
    if let Some(mut old_driver) = agent.inner.cron_driver.lock().take() {
        old_driver.stop();
    }

    // 2. 单次赋值换槽 — `agent_status().ready` 不闪断(None 中间态不外露)。
    *agent.inner.thread.lock() = Some(thread.clone());
    *agent.inner.task_hook_target.write() = Some(thread.hook_engine());
    *agent.inner.bound_session_id.lock() = Some(sid);
    super::reload::clear_pending_rebind(agent);
    // rebind 代数自增:挂在插件挂载等待上的提交感知「会话已切走」快速失败。
    agent
        .inner
        .rebind_generation
        .send_modify(|generation| *generation += 1);
    agent.activate_plugin_mount(&thread);

    // 3. 为新 thread 起独立 forwarder(共享 session_tx;带 sid,降级后台后
    //    由它把该线程事件分流到 background_tx)。被降级旧线程的 forwarder
    //    同样继续存活 —— 线程 cancel/关闭时自然退出。
    super::session::start_forwarder(agent, Some(sid));

    // 4. Cron 换向:旧 driver 已在 step 1.5 停止,这里写新 sender 并起
    //    新 driver(首个 tick 立即扫描,补发窗口内到期的 job),保留 job id。
    //
    // 锁序注意:先**读锁 clone + 释放 guard**,再取写锁写回 ——
    // `if let ... = lock.write().clone()` 的 scrutinee 临时值(RwLockWriteGuard)
    // 活到整个 if-let 块结束,块内再对同一把锁 `write()` 会自死锁
    // (parking_lot 非重入)。rebind 单测曾因此永久 park。
    let sched_opt = agent.inner.cron_scheduler.read().clone();
    if let Some(mut sched) = sched_opt {
        sched.rebind_sender(Some(thread.submission_sender()));
        // 持久化回 inner(若本进程第一次 install 就崩了,cron_scheduler
        // 仍为 None,跳过 cron 切向 — install 完整跑通的情况下不会出现)。
        *agent.inner.cron_scheduler.write() = Some(sched.clone());
        let new_driver = sched.clone();
        let new_handle = new_driver.start(30);
        *agent.inner.cron_driver.lock() = Some(new_handle);
    } else {
        warn!("rebind_session: cron_scheduler 尚未 install,跳过 cron 切向");
    }

    debug!("rebind_session: → {sid} 完成");
    Ok(())
}

/// 从后台表取出指定会话的线程(promote)。同时清掉 running 标记 ——
/// 之后它要么回到前台(前端接手展示),要么已被驱逐。
fn take_background(agent: &MinimalAgent, sid: ThreadId) -> Option<Arc<reflect_core::AgentThread>> {
    let mut bg = agent.inner.background.lock();
    let at = bg.iter().position(|(s, _)| *s == sid)?;
    let (_, thread) = bg.remove(at);
    drop(bg);
    agent.inner.background_running.lock().remove(&sid);
    if thread.cancel_token().is_cancelled() || thread.submission_sender().is_closed() {
        // 后台期间线程死掉(如 app 退出竞态):返回 None 走重建。
        debug!("rebind_session: {sid} 后台线程已不可用,走重建");
        return None;
    }
    Some(thread)
}

/// 旧线程降级入后台表;超限按「空闲优先、最旧兜底」驱逐(驱逐 = cancel,
/// 与旧换绑行为一致)。调用方保证 `sid` 非占位且不等于目标会话。
fn demote_background(agent: &MinimalAgent, sid: ThreadId, thread: Arc<reflect_core::AgentThread>) {
    let mut evicted: Vec<(ThreadId, Arc<reflect_core::AgentThread>)> = Vec::new();
    {
        let mut bg = agent.inner.background.lock();
        // 防御:同 sid 残留表项先移除(正常流程不会有 —— promote 时已 take)。
        bg.retain(|(s, _)| *s != sid);
        bg.push((sid, thread));
        while bg.len() > super::agent::MAX_BACKGROUND_THREADS {
            let running = agent.inner.background_running.lock();
            // 空闲线程优先驱逐;全在跑则驱逐最旧(表头,Vec 尾部为新入)。
            let idx = bg
                .iter()
                .position(|(s, _)| !running.contains(s))
                .unwrap_or(0);
            drop(running);
            evicted.push(bg.remove(idx));
        }
    }
    for (evicted_sid, evicted_thread) in evicted {
        tracing::info!("rebind_session: 后台表超限,驱逐会话 {evicted_sid}");
        agent.inner.background_running.lock().remove(&evicted_sid);
        evicted_thread.cancel_token().cancel();
    }
}

/// 清空后台表(forced 热重载专用):provider 栈已重建,后台线程攥着旧
/// registry/model clients,继续跑会与前台配置分叉 —— 全部 cancel。
fn clear_background(agent: &MinimalAgent) {
    let drained: Vec<(ThreadId, Arc<reflect_core::AgentThread>)> =
        std::mem::take(&mut *agent.inner.background.lock());
    agent.inner.background_running.lock().clear();
    for (sid, thread) in drained {
        tracing::info!("rebind_session: 热重载清场,取消后台会话 {sid}");
        thread.cancel_token().cancel();
    }
}

#[cfg(test)]
mod tests;
