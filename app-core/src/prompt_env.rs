//! GUI 侧内置上下文注入 hooks：环境上下文块 + AGENTS.md 项目指令。
//!
//! 上游同名实现住在 `zhuye-exec::builtin_hooks`（仅 headless CLI 路径注册），
//! 但 exec crate 拖 clap / opentelemetry 等运行时依赖，不适合作为 GUI 依赖
//! 引入 —— 桌面在 app-core 复刻同款注入语义（上游收敛候选，见 app-core/AGENTS.md）。
//!
//! 注入通道与上游一致：`UserPromptSubmit` 首轮返回
//! `HookDecision::InjectMessage(SystemMessage)`（引擎包装为
//! `<system-reminder>` user 消息），引擎循环零触碰；`AtomicBool`
//! 保证每会话（每 thread）只注一次，不随轮次堆叠。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use zhuye_hooks::decision::{HookDecision, SystemMessage};
use zhuye_hooks::event::{HookEvent, HookEventKind};
use zhuye_hooks::hook::{Hook, HookError};

/// 单文件字节上限策略：`None` = 不截断（完整注入，缺省）；`Some(n)` =
/// 单文件最多注入 n 字节，超限在**字符边界**截断并附提示（不静默）。
///
/// 上限由桌面偏好 `~/.zhuye/desktop.json` 的 `agents_md_max_bytes` 控制，
/// 由 thread_factory 读入后传入 —— app-core 不直接读偏好（依赖方向：
/// src-tauri → app-core）。
pub type AgentsMdMaxBytes = Option<usize>;

/// 把 `s` 截到不超过 `max_bytes` 字节的最大字符边界处（防切碎 UTF-8
/// 多字节序列产生 U+FFFD）。
fn truncate_at_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// 读取单个 AGENTS.md 文件并加来源标注；`max_bytes = Some(n)` 且超限时
/// 截断（字符边界）并附可见提示 + `tracing::warn`（截断不静默）。
fn read_capped(path: &Path, max_bytes: AgentsMdMaxBytes) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let mut out = format!("Source: {}\n\n", path.display());
    match max_bytes {
        None => out.push_str(raw),
        Some(limit) => {
            if raw.len() > limit {
                let kept = truncate_at_char_boundary(raw, limit);
                out.push_str(kept);
                out.push_str(&format!(
                    "\n\n[已按 agents_md_max_bytes={limit} 截断(原 {} 字节);可调大或删除该配置以完整注入]",
                    raw.len()
                ));
                tracing::warn!(
                    "AGENTS.md {} 超出 agents_md_max_bytes={limit}(原 {} 字节),已截断注入",
                    path.display(),
                    raw.len()
                );
            } else {
                out.push_str(raw);
            }
        }
    }
    Some(out)
}

/// 合并用户级（`<data_dir>/AGENTS.md`）与项目级（`<workspace>/AGENTS.md`）。
/// 用户级在前、项目级在后（项目级更具体）。与上游同逻辑。
fn read_agents_md_merged(
    workspace: &Path,
    user_data_dir: Option<PathBuf>,
    max_bytes: AgentsMdMaxBytes,
) -> String {
    let mut parts: Vec<String> = vec![];
    if let Some(dir) = user_data_dir {
        if let Some(text) = read_capped(&dir.join("AGENTS.md"), max_bytes) {
            parts.push(text);
        }
    }
    if let Some(text) = read_capped(&workspace.join("AGENTS.md"), max_bytes) {
        parts.push(text);
    }
    parts.join("\n\n---\n\n")
}

/// AGENTS.md 会话首轮注入 hook（GUI 版，语义与上游 `zhuye-exec` 同名实现一致）。
pub struct AgentsMdHook {
    workspace: PathBuf,
    user_data_dir: Option<PathBuf>,
    /// 单文件字节上限（`None` = 不截断，缺省）。
    max_bytes: AgentsMdMaxBytes,
    /// 每会话只注一次（hook 实例随 thread 生命周期）。
    injected: AtomicBool,
}

impl AgentsMdHook {
    /// `workspace` 为项目级 AGENTS.md 所在目录；`user_data_dir` 为用户级
    /// 数据目录（`None` 跳过用户级）；`max_bytes` 为单文件字节上限
    /// （`None` 不截断）。
    pub fn new(
        workspace: impl Into<PathBuf>,
        user_data_dir: Option<PathBuf>,
        max_bytes: AgentsMdMaxBytes,
    ) -> Self {
        Self {
            workspace: workspace.into(),
            user_data_dir,
            max_bytes,
            injected: AtomicBool::new(false),
        }
    }
}

#[async_trait]
impl Hook for AgentsMdHook {
    fn name(&self) -> &str {
        "agents-md-inject"
    }

    fn description(&self) -> &str {
        "会话首轮把 AGENTS.md(用户级 + 项目级)注入模型上下文"
    }

    fn events(&self) -> &[HookEventKind] {
        &[HookEventKind::UserPromptSubmit]
    }

    async fn handle(&self, _event: &HookEvent) -> Result<HookDecision, HookError> {
        // 首轮语义：swap 防并发双注入。
        if self.injected.swap(true, Ordering::Relaxed) {
            return Ok(HookDecision::Allow);
        }
        let content = read_agents_md_merged(&self.workspace, self.user_data_dir.clone(), self.max_bytes);
        if content.trim().is_empty() {
            return Ok(HookDecision::Allow);
        }
        // 段格式经 `append_agents_md_section` 生成，与 core prompt 块 /
        // exec 注入通道不漂移（`## Project Instructions` 段头）。
        let mut core = String::new();
        zhuye_prompt::append_agents_md_section(&mut core, &content);
        Ok(HookDecision::InjectMessage(SystemMessage::new(core)))
    }
}

/// 环境上下文块：会话首轮向模型注入运行环境摘要（对齐主流 agent 的
/// `<env>` 块实践 —— 此前烛夜完全不注入，模型只能靠跑 `pwd`/`uname`
/// 间接探测）。
pub struct EnvContextHook {
    workspace: PathBuf,
    /// 每会话只注一次。
    injected: AtomicBool,
}

impl EnvContextHook {
    /// `workspace` 为注入块里的「Working directory」行（线程当前工作区根）。
    pub fn new(workspace: impl Into<PathBuf>) -> Self {
        Self {
            workspace: workspace.into(),
            injected: AtomicBool::new(false),
        }
    }
}

/// 平台行：`std::env::consts` 编译期常量（`macos (arm64)` 等）。
fn platform_line() -> String {
    format!("{} ({})", std::env::consts::OS, std::env::consts::ARCH)
}

/// OS 版本探测（进程内缓存，best-effort：失败返回 None，块中省略该行）。
fn os_version() -> Option<String> {
    static CACHE: OnceLock<Option<String>> = OnceLock::new();
    CACHE.get_or_init(detect_os_version).clone()
}

fn detect_os_version() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()?;
        let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!v.is_empty()).then(|| format!("macOS {v}"))
    }
    #[cfg(target_os = "linux")]
    {
        let name = std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|text| {
                text.lines().find_map(|line| {
                    line.strip_prefix("NAME=")
                        .map(|v| v.trim_matches('"').trim().to_string())
                        .filter(|v| !v.is_empty())
                })
            });
        let kernel = std::process::Command::new("uname")
            .arg("-r")
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty());
        match (name, kernel) {
            (Some(n), Some(k)) => Some(format!("{n} ({k})")),
            (Some(n), None) => Some(n),
            (None, Some(k)) => Some(format!("Linux ({k})")),
            (None, None) => None,
        }
    }
    #[cfg(target_os = "windows")]
    {
        // 无 winapi 依赖的 best-effort：环境变量 OS（通常 "Windows_NT"）。
        std::env::var("OS").ok().filter(|s| !s.is_empty())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        None
    }
}

/// shell 探测：unix `$SHELL` / windows `%COMSPEC%`，缺失返回 None。
fn shell_path() -> Option<String> {
    #[cfg(unix)]
    {
        std::env::var("SHELL").ok().filter(|s| !s.is_empty())
    }
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").ok().filter(|s| !s.is_empty())
    }
    #[cfg(not(any(unix, windows)))]
    {
        None
    }
}

/// 环境块格式化（纯函数，便于测试；探测结果作参数注入）。
/// 返回带 `## Environment Context` 段头的完整注入文本。
fn build_env_block(
    workspace: &Path,
    today: &str,
    os_version: Option<&str>,
    shell: Option<&str>,
) -> String {
    let mut lines = vec![
        "## Environment Context".to_string(),
        String::new(),
        format!(
            "- Working directory (workspace root): {}",
            workspace.display()
        ),
        format!("- Platform: {}", platform_line()),
    ];
    if let Some(v) = os_version {
        lines.push(format!("- OS version: {v}"));
    }
    lines.push(format!("- Today's date: {today}"));
    if let Some(s) = shell {
        lines.push(format!("- Shell: {s}"));
    }
    lines.push(String::new());
    lines.push(
        "This context describes the machine and workspace you operate in. \
         Trust it over guesses; verify with tools when precision matters."
            .to_string(),
    );
    lines.join("\n")
}

/// 今天日期（本地时区，`YYYY-MM-DD`）。
fn today_local() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

#[async_trait]
impl Hook for EnvContextHook {
    fn name(&self) -> &str {
        "env-context-inject"
    }

    fn description(&self) -> &str {
        "会话首轮注入运行环境上下文(平台/OS 版本/日期/工作目录/shell)"
    }

    fn events(&self) -> &[HookEventKind] {
        &[HookEventKind::UserPromptSubmit]
    }

    async fn handle(&self, _event: &HookEvent) -> Result<HookDecision, HookError> {
        if self.injected.swap(true, Ordering::Relaxed) {
            return Ok(HookDecision::Allow);
        }
        let block = build_env_block(
            &self.workspace,
            &today_local(),
            os_version().as_deref(),
            shell_path().as_deref(),
        );
        Ok(HookDecision::InjectMessage(SystemMessage::new(block)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zhuye_hooks::event::HookContext;
    use zhuye_protocol::{PermissionMode, ThreadId, TurnId};

    /// 构造 UserPromptSubmit 事件（hook 只看 kind，不读载荷）。
    fn prompt_event() -> HookEvent {
        HookEvent::UserPromptSubmit {
            text: "hi".into(),
            ctx: HookContext {
                session_id: ThreadId::new(),
                turn_id: TurnId::new(),
                workspace: PathBuf::from("/tmp/ws"),
                permission_mode: PermissionMode::Auto,
            },
        }
    }

    /// 合并顺序：用户级在前、项目级在后，`---` 分隔且各带 Source 标注。
    #[test]
    fn agents_md_merge_orders_user_then_project() {
        let dir = tempfile::tempdir().unwrap();
        let user = dir.path().join("user");
        let project = dir.path().join("proj");
        std::fs::create_dir_all(&user).unwrap();
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(user.join("AGENTS.md"), "user rules").unwrap();
        std::fs::write(project.join("AGENTS.md"), "project rules").unwrap();
        let merged = read_agents_md_merged(&project, Some(user), None);
        let user_at = merged.find("Source:").unwrap();
        assert!(merged.contains("user rules"));
        assert!(merged.contains("project rules"));
        assert!(merged.find("user rules").unwrap() < merged.find("project rules").unwrap());
        assert_eq!(merged.matches("---\n\n").count(), 1);
        let _ = user_at;
    }

    /// 无上限（缺省）：超大文件完整注入，不截断、无提示。
    #[test]
    fn read_capped_without_limit_keeps_full_content() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("AGENTS.md");
        let big = "x".repeat(200 * 1024);
        std::fs::write(&file, &big).unwrap();
        let text = read_capped(&file, None).unwrap();
        assert!(text.contains(&big));
        assert!(!text.contains("截断"));
    }

    /// 有上限：超限截断且在字符边界（多字节中文不被切碎为 U+FFFD），
    /// 并附可见提示（含上限与原字节数）。
    #[test]
    fn read_capped_with_limit_truncates_at_char_boundary_with_notice() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("AGENTS.md");
        // 每个「烛」3 字节；10 字节上限 → 回退到边界 9 字节 = 保留 3 个
        // 整字，第 4 个字符跨边界被丢弃，绝不出现半个字符。
        std::fs::write(&file, "烛夜烛夜烛夜烛夜").unwrap();
        let text = read_capped(&file, Some(10)).unwrap();
        assert!(text.contains("烛夜烛"));
        assert!(!text.contains("烛夜烛夜"));
        assert!(!text.contains('\u{FFFD}'));
        assert!(text.contains("agents_md_max_bytes=10"));
        assert!(text.contains("原 24 字节"));
    }

    /// 有上限但未超限：完整注入、无提示。
    #[test]
    fn read_capped_with_limit_keeps_small_file_intact() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("AGENTS.md");
        std::fs::write(&file, "small rules").unwrap();
        let text = read_capped(&file, Some(1024)).unwrap();
        assert!(text.contains("small rules"));
        assert!(!text.contains("截断"));
    }

    /// 字符边界回退：上限落在多字节字符中间时向前回退到边界。
    #[test]
    fn truncate_at_char_boundary_never_splits_multibyte() {
        let s = "烛夜"; // 6 字节,每字 3 字节
        assert_eq!(truncate_at_char_boundary(s, 100), s);
        assert_eq!(truncate_at_char_boundary(s, 4), "烛");
        assert_eq!(truncate_at_char_boundary(s, 3), "烛");
        assert_eq!(truncate_at_char_boundary(s, 2), "");
        assert_eq!(truncate_at_char_boundary(s, 0), "");
        assert_eq!(truncate_at_char_boundary("abc", 2), "ab");
    }

    /// 空文件 / 缺文件返回 None（不注入）。
    #[test]
    fn read_capped_skips_empty_or_missing() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "   \n").unwrap();
        assert!(read_capped(&dir.path().join("AGENTS.md"), None).is_none());
        assert!(read_capped(&dir.path().join("missing.md"), None).is_none());
    }

    /// 环境块格式：必含工作目录/平台/日期；可选行按探测结果增减。
    #[test]
    fn env_block_contains_required_lines_and_omits_missing_optional() {
        let block = build_env_block(
            Path::new("/abs/ws"),
            "2026-11-19",
            Some("macOS 15.5"),
            Some("/bin/zsh"),
        );
        assert!(block.starts_with("## Environment Context"));
        assert!(block.contains("- Working directory (workspace root): /abs/ws"));
        assert!(block.contains("- Platform: "));
        assert!(block.contains("- OS version: macOS 15.5"));
        assert!(block.contains("- Today's date: 2026-11-19"));
        assert!(block.contains("- Shell: /bin/zsh"));

        let minimal = build_env_block(Path::new("/ws"), "2026-01-02", None, None);
        assert!(!minimal.contains("- OS version"));
        assert!(!minimal.contains("- Shell:"));
    }

    /// AgentsMdHook：首轮 InjectMessage（带段头与正文），次轮 Allow。
    #[tokio::test]
    async fn agents_md_hook_injects_once() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "be concise").unwrap();
        let hook = AgentsMdHook::new(dir.path(), None, None);
        assert_eq!(hook.events(), &[HookEventKind::UserPromptSubmit]);

        let first = hook.handle(&prompt_event()).await.unwrap();
        let HookDecision::InjectMessage(msg) = first else {
            panic!("首轮必须注入,实得 {first:?}");
        };
        assert!(msg.content.contains("## Project Instructions"));
        assert!(msg.content.contains("be concise"));

        let second = hook.handle(&prompt_event()).await.unwrap();
        assert_eq!(second, HookDecision::Allow);
    }

    /// 带上限的 hook：超限文件注入截断版并带提示。
    #[tokio::test]
    async fn agents_md_hook_respects_max_bytes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("AGENTS.md"), "a".repeat(500)).unwrap();
        let hook = AgentsMdHook::new(dir.path(), None, Some(100));
        let first = hook.handle(&prompt_event()).await.unwrap();
        let HookDecision::InjectMessage(msg) = first else {
            panic!("首轮必须注入,实得 {first:?}");
        };
        assert!(msg.content.contains("agents_md_max_bytes=100"));
        assert!(msg.content.contains('a'));
        // 截断后正文 + Source 标注 + 提示,总长可控。
        assert!(msg.content.chars().count() < 500);
    }

    /// 无 AGENTS.md 时首轮也 Allow（不注入空段）。
    #[tokio::test]
    async fn agents_md_hook_allows_when_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let hook = AgentsMdHook::new(dir.path(), None, None);
        assert_eq!(
            hook.handle(&prompt_event()).await.unwrap(),
            HookDecision::Allow
        );
    }

    /// EnvContextHook：首轮注入环境块（含工作目录），次轮 Allow。
    #[tokio::test]
    async fn env_context_hook_injects_once() {
        let hook = EnvContextHook::new("/tmp/somews");
        let first = hook.handle(&prompt_event()).await.unwrap();
        let HookDecision::InjectMessage(msg) = first else {
            panic!("首轮必须注入,实得 {first:?}");
        };
        assert!(msg.content.contains("## Environment Context"));
        assert!(msg.content.contains("/tmp/somews"));

        let second = hook.handle(&prompt_event()).await.unwrap();
        assert_eq!(second, HookDecision::Allow);
    }
}
