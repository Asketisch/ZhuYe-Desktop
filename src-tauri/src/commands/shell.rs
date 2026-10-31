//! Terminal shell exec —— 流式 stdout/stderr 到前端事件。

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

/// `reflect_run_shell` 返回给前端的 shell 会话元数据。
#[derive(Debug, Serialize, Deserialize)]
pub struct ShellSession {
    /// 唯一会话 id(UUID v4);用于关联后续 `reflect_terminal_output` 事件
    /// 以及调用 `reflect_kill_shell`。
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

// 逐行读取字节并容错解码，避免非 UTF-8 输出使 reader 提前退出并堵塞子进程。
async fn next_output_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<String>> {
    let mut bytes = Vec::new();
    if reader.read_until(b'\n', &mut bytes).await? == 0 {
        return Ok(None);
    }
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
        if bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
    }
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

// 不在等待进程退出时持有锁，否则进程关闭 stdout 后仍在运行时无法 kill。
async fn wait_for_shell(
    lock: &crate::shell_sessions::ShellProcess,
) -> std::io::Result<Option<std::process::ExitStatus>> {
    loop {
        {
            let mut guard = lock.lock().await;
            let Some(child) = guard.as_mut() else {
                return Ok(None);
            };
            if let Some(status) = child.try_wait()? {
                guard.take();
                return Ok(Some(status));
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

/// 启动 `cmd`(单条 shell 表达式),把 stdout/stderr 流式转发为带 `session_id`
/// 的 `reflect_terminal_output` 事件。返回会话 id 供前端匹配 chunk。
///
/// 真实 PTY(resize / raw mode)不在初版范围 —— 这里使用
/// `tokio::process::Command` 加管道化 stdout/stderr,按行输出 chunk,
/// 由前端负责 ANSI 安全转义后渲染。
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
    let id = uuid::Uuid::new_v4().to_string();
    let workdir = agent.workspace().clone();

    // 构造命令。借助 shell 以支持管道/重定向(macOS 上是 zsh,其他平台是 sh)。
    let shell = if cfg!(target_os = "macos") {
        "/bin/zsh"
    } else {
        "/bin/sh"
    };
    let mut command = TokioCommand::new(shell);
    command
        .arg("-lc")
        .arg(&cmd)
        .current_dir(&workdir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());

    let mut child = command.spawn().map_err(|e| CommandError {
        msg: format!("spawn failed: {e}"),
    })?;

    let stdout = child.stdout.take().ok_or_else(|| CommandError {
        msg: "no stdout handle".into(),
    })?;
    let stderr = child.stderr.take().ok_or_else(|| CommandError {
        msg: "no stderr handle".into(),
    })?;

    // 在启动 reader 之前先注册 kill 句柄,确保 kill 与 reader 之间能安全竞争。
    let child_lock = Arc::new(tokio::sync::Mutex::new(Some(child)));
    agent.register_shell_session(id.clone(), child_lock.clone());
    let sequence = Arc::new(parking_lot::Mutex::new(0u64));

    // stdout reader —— 还会等待进程退出,并发出 "exit" 事件。
    {
        let app = app.clone();
        let id = id.clone();
        let lock = child_lock.clone();
        let sequence = sequence.clone();
        let registry = agent.inner().clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            while let Ok(Some(line)) = next_output_line(&mut reader).await {
                emit_chunk(
                    &app,
                    &sequence,
                    ShellOutputChunk {
                        session_id: id.clone(),
                        stream: "stdout".into(),
                        data: line,
                        seq: 0,
                    },
                );
            }
            match wait_for_shell(&lock).await {
                Ok(Some(status)) => emit_chunk(
                    &app,
                    &sequence,
                    ShellOutputChunk {
                        session_id: id.clone(),
                        stream: "exit".into(),
                        data: status.code().map(|c| c.to_string()).unwrap_or_default(),
                        seq: 0,
                    },
                ),
                Ok(None) => {
                    // kill 路径会先取走句柄并等待进程；此时 stdout 已到 EOF，
                    // 必须补发终止事件，否则前端会认为会话仍在运行。
                    emit_chunk(
                        &app,
                        &sequence,
                        ShellOutputChunk {
                            session_id: id.clone(),
                            stream: "exit".into(),
                            data: "killed".into(),
                            seq: 0,
                        },
                    );
                }
                Err(e) => emit_chunk(
                    &app,
                    &sequence,
                    ShellOutputChunk {
                        session_id: id.clone(),
                        stream: "error".into(),
                        data: e.to_string(),
                        seq: 0,
                    },
                ),
            }
            // 进程已终结:把注册表条目回收掉。此前只有 kill 路径会删,
            // 自然退出的会话在 map 里留下死条目,长期运行单调泄漏,
            // list 也会返回早已退出的 id。kill 先行时此处为幂等 no-op。
            let _ = registry.take_shell_session(&id);
        });
    }

    // stderr 读取 task
    {
        let app = app.clone();
        let id = id.clone();
        let sequence = sequence.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            while let Ok(Some(line)) = next_output_line(&mut reader).await {
                emit_chunk(
                    &app,
                    &sequence,
                    ShellOutputChunk {
                        session_id: id.clone(),
                        stream: "stderr".into(),
                        data: line,
                        seq: 0,
                    },
                );
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
    if let Some(handle) = agent.take_shell_session(&session_id) {
        let mut g = handle.lock().await;
        if let Some(mut child) = g.take() {
            let _ = child.start_kill();
            let _ = child.wait().await;
        }
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

    #[tokio::test]
    async fn invalid_utf8_does_not_stop_output_reader() {
        let mut reader = BufReader::new(&b"first\xff\nsecond\r\nlast"[..]);
        assert_eq!(
            next_output_line(&mut reader).await.unwrap().as_deref(),
            Some("first\u{fffd}")
        );
        assert_eq!(
            next_output_line(&mut reader).await.unwrap().as_deref(),
            Some("second")
        );
        assert_eq!(
            next_output_line(&mut reader).await.unwrap().as_deref(),
            Some("last")
        );
        assert!(next_output_line(&mut reader).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn waiting_for_exit_does_not_block_kill() {
        let child = TokioCommand::new("sleep").arg("30").spawn().unwrap();
        let lock = Arc::new(tokio::sync::Mutex::new(Some(child)));
        let waiter = tokio::spawn({
            let lock = lock.clone();
            async move { wait_for_shell(&lock).await }
        });
        tokio::task::yield_now().await;
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            let mut guard = lock.lock().await;
            let mut child = guard.take().unwrap();
            child.kill().await.unwrap();
        })
        .await
        .expect("kill must not wait for natural exit");
        assert!(waiter.await.unwrap().unwrap().is_none());
    }
}
