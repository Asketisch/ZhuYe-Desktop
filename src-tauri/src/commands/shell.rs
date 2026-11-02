//! Terminal shell exec —— 流式 stdout/stderr 到前端事件。
//!
//! 执行与缓冲已收编进上游 `reflect_shell`(常驻 shell 会话插件):
//! 会话池持有进程 + 输出缓冲,桌面端以适配 task 把上游拉模型
//! (`read_delta` 游标增量)转回推模型(逐行 `reflect_terminal_output`
//! 事件),前端 IPC 形状不变。

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// `reflect_run_shell` 返回给前端的 shell 会话元数据。
#[derive(Debug, Serialize, Deserialize)]
pub struct ShellSession {
    /// 唯一会话 id(`sh-<8hex>`,上游池分配);用于关联后续
    /// `reflect_terminal_output` 事件以及调用 `reflect_kill_shell`。
    pub id: String,
    /// 已发起的命令。
    pub command: String,
    /// 工作目录(启动时的工作区)。
    pub cwd: String,
}

/// `reflect_terminal_output` 事件载荷。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShellOutputChunk {
    pub session_id: String,
    /// 取值 `"stdout" | "stderr" | "exit" | "error"`。
    pub stream: String,
    /// stdout/stderr 时为 utf-8 解码后的行;exit 时为退出码的字符串形式。
    pub data: String,
    /// 该会话内单调递增的序列号(用于排序)。
    pub seq: u64,
}

/// 发一条终端输出事件;应用句柄缺失(mock runtime / 未 setup)时静默丢弃。
fn emit_chunk(
    app: &Option<tauri::AppHandle>,
    sequence: &parking_lot::Mutex<u64>,
    mut chunk: ShellOutputChunk,
) {
    // 同一把锁覆盖编号与发送，stdout/stderr/exit 的序号与发送顺序一致。
    let mut current = sequence.lock();
    *current = current.saturating_add(1);
    chunk.seq = *current;
    if let Some(app) = app {
        let _ = app.emit("reflect_terminal_output", chunk);
    }
}

/// 把一段缓冲(若干完整行)按行拆成 chunk 推给前端。
fn emit_lines(
    app: &Option<tauri::AppHandle>,
    sequence: &parking_lot::Mutex<u64>,
    session_id: &str,
    stream: &str,
    buffer: &str,
) {
    for line in buffer.lines() {
        emit_chunk(
            app,
            sequence,
            ShellOutputChunk {
                session_id: session_id.to_string(),
                stream: stream.to_string(),
                data: line.to_string(),
                seq: 0,
            },
        );
    }
}

/// 上游退出监视会在退出时向 stdout 缓冲追加 `[exit N]` 标记行(供
/// `shell_read` 工具消费);桌面端推模型用独立 `exit` 事件表达同一语义,
/// 这里把标记行剥掉,避免终端里出现重复的退出行。
fn strip_exit_marker(buffer: &str) -> &str {
    let trimmed = buffer.trim_end_matches(['\n', '\r']);
    match trimmed.rsplit_once('\n') {
        Some((head, last)) if last.starts_with("[exit ") && last.ends_with(']') => {
            // 标记行不在缓冲末尾(罕见:后续又有输出)→ 原样返回。
            if trimmed.ends_with(']') && last.starts_with("[exit ") {
                head
            } else {
                trimmed
            }
        }
        _ if trimmed.starts_with("[exit ") && trimmed.ends_with(']') => "",
        _ => trimmed,
    }
}

/// 启动 `cmd`(单条 shell 表达式),把 stdout/stderr 流式转发为带 `session_id`
/// 的 `reflect_terminal_output` 事件。返回会话 id 供前端匹配 chunk。
///
/// 真实 PTY(resize / raw mode)不在范围(上游同样明确不做)—— 走
/// `tokio::process` 管道化 stdout/stderr,按行输出 chunk,由前端负责
/// ANSI 安全转义后渲染。macOS 用登录 shell(zsh -lc),其余平台 sh -lc。
///
/// 应用句柄从托管状态取(而非直接当参数)—— 命令签名不与 runtime 绑死,
/// 能力覆盖层才能用 mock runtime 驱动真实命令体。句柄缺失时命令**照常
/// 执行**(shell 真的跑起来),只是没有事件推给前端。
#[tauri::command]
pub async fn reflect_run_shell(
    agent: State<'_, MinimalAgent>,
    cmd: String,
) -> CommandResult<ShellSession> {
    let app = agent.app_handle();
    let cwd = agent.workspace().display().to_string();
    let workdir = agent.workspace();

    // 借助 shell 以支持管道/重定向(macOS 上是 zsh,其他平台是 sh)。
    let shell = if cfg!(target_os = "macos") {
        "/bin/zsh"
    } else {
        "/bin/sh"
    };
    let argv = vec![shell.to_string(), "-lc".into(), cmd.clone()];

    // env_clear = false:终端要继承用户环境(PATH / HOME / 凭据)。
    let session = agent
        .inner
        .shell_sessions
        .run(argv, &workdir, false)
        .map_err(|e| CommandError {
            msg: format!("spawn failed: {e}"),
        })?;
    let id = session.id.clone();

    // 适配 task:上游拉模型(缓冲 + 游标)→ 桌面推模型(逐行事件)。
    // 30ms 轮询;read_delta 消费游标,增量不丢不重。
    {
        let app = app.clone();
        let id = id.clone();
        let sequence = Arc::new(parking_lot::Mutex::new(0u64));
        let pool = agent.inner.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(30)).await;
                let (delta, exited) = session.read_delta();
                let stdout = if exited {
                    strip_exit_marker(&delta.stdout)
                } else {
                    delta.stdout.as_str()
                };
                emit_lines(&app, &sequence, &id, "stdout", stdout);
                emit_lines(&app, &sequence, &id, "stderr", &delta.stderr);
                if exited {
                    // 上游把信号终止映射为 -1(ExitStatus::code() 为 None);
                    // 桌面端沿用旧的 "killed" 表达,数值退出码原样透传。
                    let data = match delta.exit_code {
                        Some(code) if code >= 0 => code.to_string(),
                        _ => "killed".into(),
                    };
                    emit_chunk(
                        &app,
                        &sequence,
                        ShellOutputChunk {
                            session_id: id.clone(),
                            stream: "exit".into(),
                            data,
                            seq: 0,
                        },
                    );
                    // 进程已终结:把池条目回收掉,自然退出的会话不再留在
                    // list 里(kill 先行时 remove 为幂等 no-op)。
                    let _ = pool.shell_sessions.remove(&id).await;
                    break;
                }
            }
        });
    }

    Ok(ShellSession {
        id,
        command: cmd,
        cwd,
    })
}

/// 按 id 终止运行中的 shell 会话。幂等:会话缺失不视为错误。
#[tauri::command]
pub async fn reflect_kill_shell(
    agent: State<'_, MinimalAgent>,
    session_id: String,
) -> CommandResult<()> {
    if let Some(session) = agent.inner.shell_sessions.get(&session_id) {
        session.kill().await;
    }
    Ok(())
}

/// 列出当前活动的 shell 会话 id(诊断用)。
#[tauri::command]
pub async fn reflect_list_shell_sessions(
    agent: State<'_, MinimalAgent>,
) -> CommandResult<Vec<String>> {
    Ok(agent.list_shell_sessions())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_marker_is_stripped_from_stdout_tail() {
        assert_eq!(
            strip_exit_marker("line1\nline2\n[exit 0]\n"),
            "line1\nline2"
        );
        assert_eq!(strip_exit_marker("only\n"), "only");
        assert_eq!(strip_exit_marker("[exit 137]\n"), "");
    }

    #[test]
    fn literal_exit_like_output_is_kept_unless_it_is_the_marker() {
        // 中间的 [exit N] 形似行不是监视标记,原样保留。
        assert_eq!(strip_exit_marker("[exit 0]\nmore\n"), "[exit 0]\nmore");
    }
}
