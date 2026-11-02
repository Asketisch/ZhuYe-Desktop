//! Side-channel 管理命令 —— 引擎原生旁路 agent(WP9)的 Tauri 桥。
//!
//! 实现已收编进核心:命令把 `Op::StartSideChannel` / `Op::CancelSideChannel` /
//! `Op::QuerySideChannels` 提交进 `AgentThread` 的 submission 通道,由
//! `SideChannelDriver`(在 `state/thread_factory.rs` 构造注入)真正执行;
//! 应答经与 submission id 配对的 `Event` 返回(`SideChannelStarted` /
//! `SideChannelFinished` / `SideChannelStatus`),并同样扇出到会话
//! broadcast —— 前端在 `reflect_event` 通道上与 TUI 消费同一份协议信封。
//!
//! ## 命令清单(与旧 app-core registry 版 wire 兼容)
//!
//! - `reflect_start_side_channel` — 启动一条 side-channel(等待配对的
//!   Started 事件拿回 id;driver 缺失 / 启动失败以 Error 应答)
//! - `reflect_cancel_side_channel` — 取消指定 id(先查快照保住
//!   boolean 语义:未知 / 已终态 → `false`)
//! - `reflect_list_side_channels` — 拉取快照(`QuerySideChannels`)
//! - `reflect_get_side_channel` — 单条快照

use std::time::Duration;

use reflect_protocol::{Event, EventMsg, Op, SideChannelEvent, SideChannelInfo};
use serde::Serialize;
use tauri::State;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// 提交 Op 后等待与 submission id 配对的应答事件。
///
/// 协议不变量:submission id ↔ event id 配对用于流关联 —— 期间流过的
/// 其它事件(广播扇出)直接跳过。
async fn submit_and_wait(agent: &MinimalAgent, op: Op) -> CommandResult<Event> {
    const REPLY_TIMEOUT: Duration = Duration::from_secs(10);
    let mut rx = agent.subscribe_session();
    let submission_id = agent.submit_op(op).await.map_err(|e| CommandError {
        msg: format!("side-channel submit failed: {e:#}"),
    })?;
    let deadline = tokio::time::Instant::now() + REPLY_TIMEOUT;
    loop {
        let event = tokio::time::timeout_at(deadline, rx.recv())
            .await
            .map_err(|_| CommandError {
                msg: "timed out waiting for side-channel reply".into(),
            })?
            .map_err(|e| CommandError {
                msg: format!("session event stream closed: {e}"),
            })?;
        if event.id == submission_id {
            return Ok(event);
        }
    }
}

/// `reflect_start_side_channel` 的返回值。前端用 id 订阅事件 / 取消。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSideChannelResult {
    pub id: String,
    pub agent_name: String,
    pub prompt: String,
    pub started_at_ms: i64,
}

/// 启动一条新的 side-channel。等待配对的 `SideChannelStarted` 拿回 id;
/// 引擎以 `SideChannelFinished(Error)` 应答(driver 未配置 / 工厂失败 /
/// 并发满)时转为命令错误。
#[tauri::command]
pub async fn reflect_start_side_channel(
    agent: State<'_, MinimalAgent>,
    agent_name: String,
    prompt: String,
) -> CommandResult<StartSideChannelResult> {
    if prompt.trim().is_empty() {
        return Err(CommandError {
            msg: "side-channel prompt cannot be empty".into(),
        });
    }
    let event = submit_and_wait(
        &agent,
        Op::StartSideChannel {
            agent: agent_name,
            prompt,
        },
    )
    .await?;
    match event.msg {
        EventMsg::SideChannelStarted(SideChannelEvent::Started {
            id,
            agent_name,
            prompt,
            started_at_ms,
        }) => Ok(StartSideChannelResult {
            id,
            agent_name,
            prompt,
            started_at_ms,
        }),
        EventMsg::SideChannelFinished(SideChannelEvent::Error { message, .. }) => {
            Err(CommandError {
                msg: format!("side-channel failed to start: {message}"),
            })
        }
        other => Err(CommandError {
            msg: format!("unexpected side-channel reply: {other:?}"),
        }),
    }
}

/// 按 id 取消运行中的 side-channel。取消生效返回 `true`,id 不存在或已
/// 终止返回 `false`。引擎的 Cancel 对未知 id 是 noop(无应答事件),
/// 先查快照保住 boolean 语义。
#[tauri::command]
pub async fn reflect_cancel_side_channel(
    agent: State<'_, MinimalAgent>,
    id: String,
) -> CommandResult<bool> {
    let running = list_channels(&agent, Some(id.clone()))
        .await?
        .into_iter()
        .any(|c| c.id == id && c.status == "running");
    if !running {
        return Ok(false);
    }
    agent
        .submit_op(Op::CancelSideChannel { id })
        .await
        .map_err(|e| CommandError {
            msg: format!("side-channel cancel failed: {e:#}"),
        })?;
    Ok(true)
}

/// 查询快照(`id = None` 全量;`Some(id)` 单条,未知返回空)。
async fn list_channels(
    agent: &MinimalAgent,
    id: Option<String>,
) -> CommandResult<Vec<SideChannelInfo>> {
    let event = submit_and_wait(agent, Op::QuerySideChannels { id }).await?;
    match event.msg {
        EventMsg::SideChannelStatus(snapshot) => Ok(snapshot.channels),
        other => Err(CommandError {
            msg: format!("unexpected side-channel reply: {other:?}"),
        }),
    }
}

/// 列出当前所有 side-channel。实时更新走 `reflect_event` 通道上的
/// `side_channel_*` 事件;该命令用于按需拉取快照(如页面刷新)。
#[tauri::command]
pub async fn reflect_list_side_channels(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<SideChannelInfo>> {
    list_channels(&agent, None).await
}

/// 获取单条 side-channel 的快照。
#[tauri::command]
pub async fn reflect_get_side_channel(
    agent: State<'_, MinimalAgent>,
    id: String,
) -> CommandResult<SideChannelInfo> {
    list_channels(&agent, Some(id.clone()))
        .await?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| CommandError {
            msg: format!("side-channel '{id}' not found"),
        })
}
