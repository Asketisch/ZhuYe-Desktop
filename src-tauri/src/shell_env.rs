//! 进程级 PATH 补全 —— GUI 启动环境修复（对齐 ZCode 的
//! `runtimeLoginShellEnvCapture` 方案）。
//!
//! 从 Finder/Dock/登录项启动的 macOS GUI 进程，PATH 只有 launchd 最小集
//! （`/usr/bin:/bin:/usr/sbin:/sbin`），用户 shell profile 里追加的目录
//! （homebrew `/usr/local/bin`、nvm 等）全部缺失。agent bash 工具
//! （`zhuye-tools::BashTool`）`env_clear` 后从本进程白名单拷贝 PATH，
//! MCP stdio / LSP 同样如此 —— 结果是「GUI 里 agent 拿不到 node，
//! 终端里一切正常」（2026-11 会话实证：node 在 `/usr/local/bin`）。
//!
//! 两级修复：
//! 1. **快路径**（同步，无进程派生）：PATH 缺 bootstrap 集里的常见目录时
//!    立即合并（覆盖 homebrew / 本机 node 场景）；
//! 2. **慢路径**（后台线程，不阻塞启动）：`$SHELL -ilc 'env -0'` 采样
//!    login+interactive shell 的完整环境（4s 超时、独立进程组），取其中
//!    PATH 与进程 PATH 合并 —— 覆盖 nvm 这类只在 interactive rc 注入的
//!    版本管理器；失败静默（快路径结果兜底）。
//!
//! 只补 PATH：bash 白名单只透传 PATH/HOME/LANG/LC_ALL/USER/SHELL/TMPDIR，
//! 快照里的其他键（NODE_OPTIONS 等）没有消费方，也不该引入 runtime。
//! `ZHUYE_NO_PATH_FIX=1` 为逃生开关。

/// darwin bootstrap PATH 目录（ZCode 同款顺序）：探测 shell 自身也需要
/// PATH 才能找到 profile 里的工具。
#[cfg(target_os = "macos")]
const BOOTSTRAP_DIRS: &[&str] = &[
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
];

#[cfg(target_os = "macos")]
const ENV_BEGIN_MARKER: &[u8] = b"__ZHUYE_ENV_BEGIN__";
#[cfg(target_os = "macos")]
const ENV_END_MARKER: &[u8] = b"__ZHUYE_ENV_END__";

/// 启动期调用一次：快路径同步补全 + 慢路径后台采样。
/// 非 macOS 为 no-op（GUI 启动 PATH 问题只在 darwin 实证）。
pub fn fix_process_path() {
    #[cfg(target_os = "macos")]
    macos_fix_path();
}

#[cfg(target_os = "macos")]
fn macos_fix_path() {
    if std::env::var_os("ZHUYE_NO_PATH_FIX").is_some_and(|v| v == "1") {
        tracing::info!("[path-fix] ZHUYE_NO_PATH_FIX=1, skipping");
        return;
    }
    let current = std::env::var("PATH").unwrap_or_default();
    // 快路径:PATH 缺常见 GUI 缺失目录(homebrew/本机 node)时立即补,
    // 覆盖「启动后头几秒就有子进程派生」与「慢路径失败」两种情况。
    let has_common = current
        .split(':')
        .any(|d| d == "/usr/local/bin" || d == "/opt/homebrew/bin");
    if !has_common {
        let merged = merge_path(&current, BOOTSTRAP_DIRS);
        set_path(&merged);
        tracing::info!(
            before = %current,
            after = %merged,
            "[path-fix] bootstrap PATH merged (launchd minimal PATH detected)"
        );
    }
    // 慢路径:后台采样用户 login+interactive shell 环境(覆盖 nvm 等)。
    std::thread::Builder::new()
        .name("zhuye-path-snapshot".into())
        .spawn(|| {
            match capture_login_shell_path() {
                Ok(snapshot_path) => {
                    let current = std::env::var("PATH").unwrap_or_default();
                    // 快照 PATH 为基(通常已含系统目录与 profile 追加),
                    // 进程现有条目兜底追加,去重保序。
                    let current_parts: Vec<&str> = current.split(':').collect();
                    let merged = merge_path(&snapshot_path, &current_parts);
                    set_path(&merged);
                    tracing::info!("[path-fix] login shell PATH applied");
                }
                Err(error) => {
                    tracing::warn!(
                        error = %error,
                        "[path-fix] login shell env capture failed; keeping fast-path PATH"
                    );
                }
            }
        })
        .ok();
}

/// 写回进程 PATH(edition 2024 起 set_var 为 unsafe)。
#[cfg(target_os = "macos")]
fn set_path(value: &str) {
    // SAFETY:仅在应用启动早期(run 事件循环开始前/后即刻)一次性调用,
    // 此刻应用尚未 spawn 任何子进程、无并发 env 读写;标准库对 set_var
    // 的安全性要求(其他线程未在并发读 env)由该时序保证。
    unsafe { std::env::set_var("PATH", value) };
}

/// 合并 PATH 条目:先 `existing` 后 `additions`,去重保序;空段与仅由
/// 冒号组成的段(如 `::`)视为空,跳过。
fn merge_path(existing: &str, additions: &[&str]) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut parts = Vec::new();
    for part in existing.split(':').chain(additions.iter().copied()) {
        if part.is_empty() || part.chars().all(|c| c == ':') || !seen.insert(part) {
            continue;
        }
        parts.push(part);
    }
    parts.join(":")
}

/// 采样用户 shell 的 PATH:
/// - shell 候选:`$SHELL` → `/bin/zsh` → `/bin/bash` → `/bin/sh`(取第一个
///   存在的;zsh/bash 用 `-ilc` 走 interactive rc —— nvm 只在 .zshrc 注入,
///   `-l` 拿不到;其余 shell 退化为 `-lc`);
/// - 探测 env:PATH 用 bootstrap 集(shell 自身要能找到 profile 工具)、
///   `TERM=dumb`(防 profile 起全屏交互)、`CI=1`(提示非交互);
/// - 独立进程组 + 4s 超时杀进程,防止 profile 卡住采集。
#[cfg(target_os = "macos")]
fn capture_login_shell_path() -> Result<String, String> {
    use std::io::Read;
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    let shell = ["$SHELL", "/bin/zsh", "/bin/bash", "/bin/sh"]
        .into_iter()
        .find_map(|candidate| {
            let path = if candidate == "$SHELL" {
                std::env::var("SHELL").ok()?
            } else {
                candidate.to_string()
            };
            std::path::Path::new(&path).is_file().then_some(path)
        })
        .ok_or_else(|| "no shell candidate found".to_string())?;
    let interactive = shell.ends_with("/zsh") || shell.ends_with("/bash");
    let script = format!(
        "printf '%s\\0' '{begin}'; env -0; printf '%s\\0' '{end}'",
        begin = String::from_utf8_lossy(ENV_BEGIN_MARKER),
        end = String::from_utf8_lossy(ENV_END_MARKER),
    );

    let mut command = Command::new(&shell);
    command
        .args(if interactive {
            vec!["-ilc", script.as_str()]
        } else {
            vec!["-lc", script.as_str()]
        })
        .env("PATH", {
            let current = std::env::var("PATH").unwrap_or_default();
            merge_path(&current, BOOTSTRAP_DIRS)
        })
        .env("TERM", "dumb")
        .env("CI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        // SAFETY:仅设置子进程的进程组标志;无并发副作用。
        .process_group(0);

    let mut child = command
        .spawn()
        .map_err(|e| format!("spawn {shell}: {e}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{shell} env capture timed out after 4s"));
            }
            Err(error) => return Err(format!("wait {shell}: {error}")),
        }
    }
    let mut output = Vec::new();
    child
        .stdout
        .take()
        .ok_or_else(|| "capture stdout unavailable".to_string())?
        .read_to_end(&mut output)
        .map_err(|e| format!("read capture output: {e}"))?;
    parse_snapshot_path(&output).ok_or_else(|| "env capture output missing PATH".to_string())
}

/// 从 `BEGIN\0VAR=v\0…END` 形态的采样输出里取 `PATH` 的值。
fn parse_snapshot_path(output: &[u8]) -> Option<String> {
    let begin = output
        .windows(ENV_BEGIN_MARKER.len() + 1)
        .position(|w| w.starts_with(ENV_BEGIN_MARKER) && w[ENV_BEGIN_MARKER.len()] == 0)?;
    let rest = &output[begin + ENV_BEGIN_MARKER.len() + 1..];
    let end = rest
        .windows(ENV_END_MARKER.len())
        .position(|w| w == ENV_END_MARKER)
        .unwrap_or(rest.len());
    rest[..end]
        .split(|byte| *byte == 0)
        .filter_map(|entry| entry.strip_prefix(b"PATH=".as_slice()))
        .next()
        .map(|value| String::from_utf8_lossy(value).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_path_appends_and_dedups_preserving_order() {
        let merged =
            merge_path("/usr/bin:/bin", &["/usr/local/bin", "/bin", "/opt/homebrew/bin"]);
        assert_eq!(merged, "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin");
    }

    #[test]
    fn merge_path_skips_empty_segments() {
        let merged = merge_path("/usr/bin::/bin", &[":", "/bin"]);
        assert_eq!(merged, "/usr/bin:/bin");
    }

    #[test]
    fn merge_path_is_idempotent() {
        let first = merge_path("/usr/bin", &["/bin", "/usr/local/bin"]);
        assert_eq!(merge_path(&first, &["/bin", "/usr/local/bin"]), first);
    }

    #[test]
    fn parse_snapshot_path_extracts_value() {
        let output = b"noise\n__ZHUYE_ENV_BEGIN__\0HOME=/Users/x\0PATH=/usr/local/bin:/bin\0LANG=en\0__ZHUYE_ENV_END__\0";
        assert_eq!(
            parse_snapshot_path(output).as_deref(),
            Some("/usr/local/bin:/bin")
        );
    }

    #[test]
    fn parse_snapshot_path_returns_none_without_marker() {
        assert_eq!(parse_snapshot_path(b"PATH=/bin\0"), None);
    }
}
