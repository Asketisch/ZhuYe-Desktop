//! 桌面端 Autopilot 装配层。
//!
//! 到期判定、占位、提交与历史状态由 `reflect-stream::autopilot` 提供；
//! 这里只把驱动接到当前 `AgentThread`，并把回合终态回填到共享历史。

use std::time::Duration;

use reflect_protocol::{EventMsg, Op, SideChannelEvent, Submission};
use tokio_util::sync::CancellationToken;

use super::MinimalAgent;
use fs2::FileExt;
use reflect_stream::autopilot::AutopilotRunStatus;

const DEFAULT_TICK_SECS: u64 = 30;
const SIDE_CHANNEL_START_TIMEOUT: Duration = Duration::from_secs(10);

/// 一个数据目录只允许一个桌面进程驱动 Autopilot。
/// 获取系统锁后才能把前任进程遗留的运行标记为中断；重绑定沿用租约。
fn ensure_driver_lease(agent: &MinimalAgent) -> std::io::Result<bool> {
    let mut lease = agent.inner.autopilot_lease.lock();
    if lease.is_some() {
        return Ok(true);
    }
    let path = reflect_config::paths::data_path_or_relative(&["autopilot", "driver.lock"]);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)?;
    if let Err(error) = file.try_lock_exclusive() {
        if error.kind() == std::io::ErrorKind::WouldBlock {
            return Ok(false);
        }
        return Err(error);
    }
    while agent.autopilot_manager().finalize_run_by_status(
        AutopilotRunStatus::InProgress,
        AutopilotRunStatus::Failed,
        Some("autopilot interrupted by application shutdown".into()),
    )? {}
    *lease = Some(file);
    Ok(true)
}

pub(crate) struct AutopilotDriverHandle {
    cancel: CancellationToken,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

impl AutopilotDriverHandle {
    pub(crate) fn stop(&mut self) {
        self.cancel.cancel();
        for task in self.tasks.drain(..) {
            task.abort();
        }
    }
}

/// Start the selected agent in an engine-owned side channel and return its id.
async fn start_selected_side_channel(
    agent: &MinimalAgent,
    agent_name: &str,
    prompt: &str,
) -> Result<String, String> {
    let mut rx = agent.subscribe_session();
    let submission_id = agent
        .submit_op(Op::StartSideChannel {
            agent: agent_name.to_string(),
            prompt: prompt.to_string(),
        })
        .await
        .map_err(|error| format!("autopilot side-channel submit failed: {error:#}"))?;
    let deadline = tokio::time::Instant::now() + SIDE_CHANNEL_START_TIMEOUT;
    loop {
        let event = tokio::time::timeout_at(deadline, rx.recv())
            .await
            .map_err(|_| "timed out waiting for autopilot side-channel start".to_string())?
            .map_err(|error| format!("autopilot event stream closed: {error}"))?;
        if event.id != submission_id {
            continue;
        }
        match event.msg {
            EventMsg::SideChannelStarted(SideChannelEvent::Started { id, .. }) => return Ok(id),
            EventMsg::SideChannelFinished(SideChannelEvent::Error { message, .. }) => {
                return Err(format!("autopilot side-channel failed to start: {message}"));
            }
            other => {
                return Err(format!(
                    "unexpected autopilot side-channel reply: {other:?}"
                ));
            }
        }
    }
}

fn tick_secs() -> u64 {
    std::env::var("ZHUYE_AUTOPILOT_TICK_SECS")
        .ok()
        .and_then(|value| value.parse().ok())
        .map_or(DEFAULT_TICK_SECS, |secs: u64| secs.clamp(1, 3600))
}

fn completion_result(
    status: reflect_protocol::TurnStatus,
    failure: Option<String>,
) -> Result<(), String> {
    if status == reflect_protocol::TurnStatus::Success {
        failure.map_or(Ok(()), Err)
    } else {
        Err(format!("autopilot turn ended with {status:?}"))
    }
}

async fn run_reserved(
    agent: MinimalAgent,
    config: reflect_stream::autopilot::AutopilotConfig,
    run_id: String,
    cancel: CancellationToken,
) {
    let result: Result<(), String> = if let Some(name) =
        config.agent.filter(|name| !name.trim().is_empty())
    {
        let mut events = agent.side_channel_registry().subscribe_events();
        match start_selected_side_channel(&agent, &name, &config.task_template).await {
            Ok(side_id) => loop {
                use reflect_core::side_channel::SideChannelEvent as SideEvent;
                let event = tokio::select! {
                    _ = cancel.cancelled() => {
                        break Err("autopilot driver stopped".into());
                    }
                    received = events.recv() => received,
                };
                match event {
                    Ok(SideEvent::Done { id, .. }) if id == side_id => break Ok(()),
                    Ok(SideEvent::Cancelled { id, .. }) if id == side_id => {
                        break Err("autopilot side-channel cancelled".into());
                    }
                    Ok(SideEvent::Error { id, message, .. }) if id == side_id => {
                        break Err(message);
                    }
                    Ok(_) => {}
                    Err(error) => {
                        break Err(format!(
                            "autopilot side-channel events unavailable: {error}"
                        ));
                    }
                }
            },
            Err(error) => Err(error),
        }
    } else {
        let submission = Submission::user_input(config.task_template);
        let id = submission.id.clone();
        let mut events = agent.subscribe_session();
        match agent.submit(submission).await {
            Err(error) => Err(format!("autopilot submission failed: {error:#}")),
            Ok(()) => {
                let mut failure = None;
                loop {
                    let event = tokio::select! {
                        _ = cancel.cancelled() => {
                            break Err("autopilot driver stopped".into());
                        }
                        received = events.recv() => received,
                    };
                    match event {
                        Ok(event) if event.id == id => match event.msg {
                            EventMsg::TurnComplete(complete) => {
                                break completion_result(complete.status, failure);
                            }
                            EventMsg::TurnAborted(_) => break Err("autopilot turn aborted".into()),
                            EventMsg::Error(error) if error.code == "ALL_CREDENTIALS_EXHAUSTED" => {
                                break Err(error.message);
                            }
                            EventMsg::Error(error) => failure = Some(error.message),
                            _ => {}
                        },
                        Ok(_) => {}
                        Err(error) => break Err(format!("autopilot events unavailable: {error}")),
                    }
                }
            }
        }
    };
    let (status, error) = match result {
        Ok(()) => (AutopilotRunStatus::Success, None),
        Err(error) => (AutopilotRunStatus::Failed, Some(error)),
    };
    if let Err(error) = agent
        .autopilot_manager()
        .finalize_run(&run_id, status, error)
    {
        tracing::error!(%error, %run_id, "failed to finalize autopilot run");
    }
}

pub(crate) fn spawn_autopilot_driver(agent: &MinimalAgent) -> AutopilotDriverHandle {
    let cancel = CancellationToken::new();
    let tick = Duration::from_secs(tick_secs());
    let fire_agent = agent.clone();
    let fire_cancel = cancel.clone();
    let task = tokio::spawn(async move {
        let mut interval = tokio::time::interval_at(tokio::time::Instant::now() + tick, tick);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = fire_cancel.cancelled() => return,
                _ = interval.tick() => {}
            }
            match ensure_driver_lease(&fire_agent) {
                Ok(true) => {}
                Ok(false) => continue,
                Err(error) => {
                    tracing::warn!(%error, "autopilot driver lease unavailable");
                    continue;
                }
            }
            match fire_agent.autopilot_manager().reserve_due_run() {
                Ok(Some((config, run))) if run.status == AutopilotRunStatus::InProgress => {
                    let run_agent = fire_agent.clone();
                    tokio::spawn(run_reserved(run_agent, config, run.id, fire_cancel.clone()));
                }
                Ok(_) => {}
                Err(error) => tracing::warn!(%error, "autopilot tick failed"),
            }
        }
    });
    AutopilotDriverHandle {
        cancel,
        tasks: vec![task],
    }
}

#[cfg(test)]
mod tests {
    use super::completion_result;
    use reflect_protocol::TurnStatus;

    #[test]
    fn only_successful_turns_without_errors_complete_successfully() {
        assert_eq!(completion_result(TurnStatus::Success, None), Ok(()));
        assert_eq!(
            completion_result(TurnStatus::Success, Some("provider failed".into())),
            Err("provider failed".into())
        );
        for status in [
            TurnStatus::MaxIterations,
            TurnStatus::Stopped,
            TurnStatus::TokenBudgetExceeded,
        ] {
            assert!(completion_result(status, None).is_err());
        }
    }
}
