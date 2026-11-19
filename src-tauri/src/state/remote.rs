//! SSH 远程会话:远端跑 `zhuye serve`(stdio JSONL),桌面以 SSH 子进程为
//! 传输成为协议客户端(会话层接缝,见 docs/plans/ssh-remote.md)。
//!
//! ## 结构
//!
//! - **host 注册表**:持久化 `$ZHUYE_HOME/remote-hosts.json`(不经上游
//!   ReflectConfig —— 远程主机列表是桌面自有概念,改上游 schema 不划算)。
//! - **传输**:`ssh -o BatchMode=yes -o ConnectTimeout=10 <host> -- zhuye
//!   serve --cwd <path>` 子进程 stdin/stdout duplex(无 SSH 库,密钥认证);
//!   二进制可用 `ZHUYE_REMOTE_SSH_BIN` 覆盖(测试 stub 注入点)。
//! - **事件泵**:stdout 逐行解析 `reflect_protocol::Event`,前台会话进
//!   `session_tx`(前端唯一订阅点),非前台进 `background_tx`(带 sid,
//!   前端徽标),与本地线程的路由语义(`session::route_event`)对齐。
//! - **前台插槽**:`foreground_remote` —— bind 到远程会话时置位;此时
//!   `submit` / `submit_op` 把 Submission 直接写远端 stdin(远端引擎
//!   自管沙箱 / 权限 / 插件 / rollout),本地 AgentThread 全程不动。

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;

use reflect_protocol::{Event, ThreadId};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::MinimalAgent;

/// 连接握手等待上限(ssh 建连 + 远端 serve 启动)。
const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
/// 传输二进制覆盖 env(测试 stub 注入点;生产不设)。
const SSH_BIN_ENV: &str = "ZHUYE_REMOTE_SSH_BIN";

/// 一台远程主机(注册表条目)。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHost {
    /// 显示名(唯一键)。
    pub name: String,
    /// 主机名或 IP(ssh 直达;Tailscale MagicDNS 名同样可用)。
    pub host: String,
    /// SSH 端口(默认 22)。
    #[serde(default = "default_port")]
    pub port: u16,
    /// 登录用户(缺省走 ssh 默认)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}

fn default_port() -> u16 {
    22
}

/// 一个活跃的远程会话(serve 子进程 + 写入端)。
pub struct RemoteSessionHandle {
    /// 远端会话 id(来自 session_configured 握手)。
    pub sid: ThreadId,
    /// 主机显示名。
    pub host: String,
    /// 远端工作目录。
    pub cwd: String,
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    /// 事件泵取消令牌(断开时取消)。
    cancel: CancellationToken,
}

/// 远程会话管理器(MinimalAgentInner 持有;tokio Mutex —— 握手与写入跨 await)。
#[derive(Default)]
pub struct RemoteManager {
    /// 活跃会话:uuid 字符串 → 句柄。
    sessions: HashMap<String, Arc<RemoteSessionHandle>>,
}

impl RemoteManager {
    pub fn new() -> Self {
        Self::default()
    }
}

// ====== host 注册表(持久化) ======

fn hosts_file() -> Option<std::path::PathBuf> {
    reflect_config::paths::data_path(&["remote-hosts.json"])
}

/// 读 host 注册表(文件缺失 = 空表)。
pub fn load_hosts() -> Vec<RemoteHost> {
    let Some(path) = hosts_file() else {
        return Vec::new();
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

/// 写 host 注册表。
pub fn save_hosts(hosts: &[RemoteHost]) -> Result<(), String> {
    let path = hosts_file().ok_or_else(|| "无数据目录".to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let content = serde_json::to_string_pretty(hosts).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| format!("写入失败: {e}"))
}

// ====== 前台插槽 ======

/// 当前前台远程会话(有 → submit/submit_op 路由到远端 stdin)。
pub fn foreground_remote(agent: &MinimalAgent) -> Option<String> {
    agent.inner.foreground_remote.lock().clone()
}

/// 置前台远程会话;`None` = 切回本地会话时清除。
pub fn set_foreground_remote(agent: &MinimalAgent, sid: Option<String>) {
    *agent.inner.foreground_remote.lock() = sid;
}

// ====== 连接 / 断开 ======

/// 组装 ssh 传输 argv(`--` 之后远端命令)。
fn ssh_argv(host: &RemoteHost, cwd: &str) -> Vec<String> {
    ssh_argv_with_remote_cmd(
        host,
        &["serve".to_string(), "--cwd".to_string(), cwd.to_string()],
    )
}

/// 探测用 argv(`-- zhuye --version`;连通性 + CLI 存在性一次完成)。
pub(crate) fn ssh_argv_for_probe(host: &RemoteHost) -> Vec<String> {
    ssh_argv_with_remote_cmd(host, &["--version".to_string()])
}

fn ssh_argv_with_remote_cmd(host: &RemoteHost, remote_cmd: &[String]) -> Vec<String> {
    let target = match &host.user {
        Some(user) => format!("{user}@{}", host.host),
        None => host.host.clone(),
    };
    let mut argv = vec![
        std::env::var(SSH_BIN_ENV).unwrap_or_else(|_| "ssh".to_string()),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
    ];
    if host.port != 22 {
        argv.push("-p".into());
        argv.push(host.port.to_string());
    }
    argv.push(target);
    // `--` 终结 ssh 选项解析;远端命令 = serve(单进程单 AgentThread,stdio 协议面)。
    argv.push("--".into());
    argv.push("zhuye".into());
    argv.extend(remote_cmd.iter().cloned());
    argv
}

/// 连接远程会话:spawn serve 子进程 → 等 `session_configured` 握手 →
/// 登记句柄 + 启动事件泵。返回会话 sid(uuid 字符串)。
pub async fn connect(agent: &MinimalAgent, host: &RemoteHost, cwd: &str) -> Result<String, String> {
    let argv = ssh_argv(host, cwd);
    let bin = argv[0].clone();
    let mut command = tokio::process::Command::new(&bin);
    command
        .args(&argv[1..])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("ssh 进程启动失败({bin}): {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "ssh 子进程无 stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "ssh 子进程无 stdout".to_string())?;

    // 握手:等第一行(session_configured,EVENT_ID_NONE)。
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let n = tokio::time::timeout(HANDSHAKE_TIMEOUT, reader.read_line(&mut line))
        .await
        .map_err(|_| "握手超时:远端 serve 未在时限内报告会话(检查 zhuye 是否已安装)".to_string())?
        .map_err(|e| format!("读取握手失败: {e}"))?;
    if n == 0 {
        return Err("远端 serve 提前退出(无握手输出)".to_string());
    }
    let event: Event =
        serde_json::from_str(line.trim()).map_err(|e| format!("握手行不是合法 Event: {e}"))?;
    let sid = match &event.msg {
        reflect_protocol::EventMsg::SessionConfigured(configured) => configured.session_id,
        other => {
            return Err(format!(
                "握手首行应为 session_configured,实际 {other:?}(检查远端 zhuye 版本)"
            ));
        }
    };
    let sid_str = sid.to_string();

    // stderr 归诊断日志(ssh 错误信息在这)。
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::warn!(target: "zhuye_remote", "{line}");
            }
        });
    }

    let cancel = CancellationToken::new();
    let handle = Arc::new(RemoteSessionHandle {
        sid,
        host: host.name.clone(),
        cwd: cwd.to_string(),
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        cancel: cancel.clone(),
    });

    // 登记(幂等:同 sid 重连先清旧槽)。
    {
        let mut manager = agent.inner.remote_manager.lock().await;
        manager.sessions.insert(sid_str.clone(), handle);
    }

    // 事件泵:逐行解析 Event → 前台/后台分流(与本地 route_event 语义对齐)。
    let pump_agent = agent.clone();
    let pump_sid = sid_str.clone();
    tokio::spawn(async move {
        let mut lines = reader.lines();
        loop {
            tokio::select! {
                _ = cancel.cancelled() => break,
                next = lines.next_line() => match next {
                    Ok(Some(line)) if line.trim().is_empty() => continue,
                    Ok(Some(line)) => {
                        let Ok(event) = serde_json::from_str::<Event>(line.trim()) else {
                            tracing::warn!(target: "zhuye_remote", "非 Event 行忽略: {line:.120}");
                            continue;
                        };
                        route_remote_event(&pump_agent, &pump_sid, event);
                    }
                    Ok(None) => break, // serve 进程退出
                    Err(_) => break,
                }
            }
        }
        // 泵退出 = 会话断开:清前台插槽(若指本会话)并从注册表摘除。
        set_foreground_remote_if(&pump_agent, &pump_sid, None);
        let mut manager = pump_agent.inner.remote_manager.lock().await;
        manager.sessions.remove(&pump_sid);
        tracing::info!(target: "zhuye_remote", sid = %pump_sid, "远程会话断开");
    });

    Ok(sid_str)
}

/// 事件分流:前台(用户正在看的远程会话)进 session_tx;其余带 sid 进
/// background_tx —— 与本地线程 route_event 同语义。
fn route_remote_event(agent: &MinimalAgent, sid: &str, event: Event) {
    let inner = &agent.inner;
    if foreground_remote(agent).as_deref() == Some(sid) {
        let _ = inner.session_tx.send(event);
    } else {
        // ThreadId(uuid)重建:协议 id 是 uuid 字符串。
        if let Ok(tid) = reflect_protocol::ThreadId::parse_str(sid) {
            let _ = inner.background_tx.send((tid, event));
        }
    }
}

/// 仅当前台插槽当前指 `sid` 时清除(泵退出 / 断开时避免误伤新会话)。
fn set_foreground_remote_if(agent: &MinimalAgent, sid: &str, value: Option<String>) {
    let mut slot = agent.inner.foreground_remote.lock();
    if slot.as_deref() == Some(sid) {
        *slot = value;
    }
}

/// 断开远程会话:取消泵 → 杀 serve 子进程(远端 rollout 已落盘,可 resume)。
pub async fn disconnect(agent: &MinimalAgent, sid: &str) -> Result<(), String> {
    let handle = {
        let mut manager = agent.inner.remote_manager.lock().await;
        manager.sessions.remove(sid)
    }
    .ok_or_else(|| format!("远程会话不存在: {sid}"))?;
    handle.cancel.cancel();
    let mut child = handle.child.lock().await;
    let _ = child.kill().await;
    set_foreground_remote_if(agent, sid, None);
    Ok(())
}

/// 列出活跃远程会话(uuid 字符串 + host + cwd)。
pub async fn active_sessions(agent: &MinimalAgent) -> Vec<(String, String, String)> {
    let manager = agent.inner.remote_manager.lock().await;
    manager
        .sessions
        .iter()
        .map(|(sid, h)| (sid.clone(), h.host.clone(), h.cwd.clone()))
        .collect()
}

/// sid 是否为活跃远程会话(bind 分流用)。
pub async fn is_remote_session(agent: &MinimalAgent, sid: &str) -> bool {
    let manager = agent.inner.remote_manager.lock().await;
    manager.sessions.contains_key(sid)
}

// ====== 提交路由 ======

/// 把 Submission 写远端 stdin(serve 的 stdio 协议面)。事件经泵回前台上
/// 述分流 —— 不需要本地 per-turn forwarder。
pub async fn submit_to_session(
    agent: &MinimalAgent,
    sid: &str,
    submission: reflect_protocol::Submission,
) -> anyhow::Result<()> {
    let handle = {
        let manager = agent.inner.remote_manager.lock().await;
        manager.sessions.get(sid).cloned()
    }
    .ok_or_else(|| anyhow::anyhow!("远程会话不存在或已断开;重新连接后再提交"))?;
    let mut line = serde_json::to_string(&submission)?;
    line.push('\n');
    let mut stdin = handle.stdin.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| anyhow::anyhow!("写入远端失败(会话可能已断开): {e}"))?;
    stdin.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(name: &str) -> RemoteHost {
        RemoteHost {
            name: name.to_string(),
            host: "example.invalid".to_string(),
            port: 22,
            user: None,
        }
    }

    #[test]
    fn ssh_argv_contains_batch_mode_and_serve_command() {
        let argv = ssh_argv(&host("dev"), "/home/me/proj");
        assert_eq!(argv[0], "ssh");
        assert!(argv.windows(2).any(|w| w == ["-o", "BatchMode=yes"]));
        assert!(argv.windows(2).any(|w| w == ["-o", "ConnectTimeout=10"]));
        assert!(argv.contains(&"example.invalid".to_string()));
        // `--` 之后是远端命令。
        let dd = argv.iter().position(|a| a == "--").unwrap();
        assert_eq!(
            &argv[dd + 1..dd + 4],
            &[
                "zhuye".to_string(),
                "serve".to_string(),
                "--cwd".to_string()
            ]
        );
        assert!(argv.contains(&"/home/me/proj".to_string()));
    }

    #[test]
    fn ssh_argv_includes_user_and_nondefault_port() {
        let mut h = host("dev");
        h.user = Some("me".to_string());
        h.port = 2222;
        let argv = ssh_argv(&h, "/tmp");
        assert!(argv.contains(&"me@example.invalid".to_string()));
        assert!(argv.windows(2).any(|w| w == ["-p", "2222"]));
    }

    #[test]
    fn ssh_argv_omits_port_flag_for_default() {
        let argv = ssh_argv(&host("dev"), "/tmp");
        assert!(!argv.iter().any(|a| a == "-p"));
    }

    #[test]
    fn hosts_round_trip_through_json() {
        let dir = tempfile::tempdir().unwrap();
        // 直接测 serde 形态(文件路径经 paths 单测覆盖)。
        let hosts = vec![
            host("dev"),
            RemoteHost {
                port: 2200,
                ..host("box")
            },
        ];
        let json = serde_json::to_string(&hosts).unwrap();
        let back: Vec<RemoteHost> = serde_json::from_str(&json).unwrap();
        assert_eq!(back, hosts);
        assert_eq!(back[1].port, 2200);
        drop(dir);
    }

    #[tokio::test]
    async fn is_remote_session_false_for_unknown_sid() {
        let agent = MinimalAgent::new_empty();
        assert!(!is_remote_session(&agent, "00000000-0000-4000-8000-000000000001").await);
    }
}
