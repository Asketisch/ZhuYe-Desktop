//! Git 集成 —— status / diff / log。

mod status;

use status::parse_status_z;
use std::path::PathBuf;
use std::process::Command as StdCommand;

use serde::{Deserialize, Serialize};

use crate::commands::error::{CommandError, CommandResult};
use crate::state::MinimalAgent;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatusEntry {
    pub path: String,
    pub status: String, // "M" | "A" | "D" | "??" | "R"
    /// 该条目是否含已暂存(index)变更。`status` 是 trimmed 的 porcelain
    /// 码,`"M "`(已暂存)与 `" M"`(仅工作区)折叠成同一个 "M" —— 前端
    /// staged/working 分 tab 依赖本字段区分。
    pub staged: bool,
    pub old_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub entries: Vec<GitStatusEntry>,
    pub raw: String,
    pub is_repo: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitLogEntry {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub timestamp: i64,
    pub subject: String,
}

/// 一个 git worktree(camelCase 出线)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    /// worktree 绝对路径。
    pub path: String,
    /// HEAD 指向的分支名(detached HEAD 时为空串)。
    pub branch: String,
    /// HEAD commit sha。
    pub head: String,
    /// 是否有未提交改动。
    pub dirty: bool,
    /// true = 隔离 worktree(非主工作树)—— agent 的 `EnterWorktree` 会建这种。
    pub isolated: bool,
    /// true = 隔离 worktree 且有未提交改动 → 改动**还没落回主分支**（丢工风险）。
    pub stranded: bool,
}

/// 列出仓库的 worktree,标出「改动被困在隔离 worktree」的风险。
///
/// 核心的 worktree 状态存在 `ToolContext` 里（进程内），GUI 读不到；
/// 但 worktree 本身是**文件系统可见**的 —— `git worktree list --porcelain`
/// 列出全部工作树，配合核心的 `reflect_tools::worktree::worktree_dirty`
/// 判脏。
///
/// 关键价值：agent 经 `EnterWorktree` 进隔离工作树后，GUI 此前完全不知情 ——
/// 用户的改动可能滞留在那里、没落回主分支。现在明确标出 `stranded`。
#[tauri::command]
pub async fn reflect_list_worktrees() -> CommandResult<Vec<WorktreeInfo>> {
    let out = run_git(&["worktree", "list", "--porcelain"])?;
    if !out.status.success() {
        // 不是 git 仓库 / 无 worktree 支持 → 空列表(不报错)。
        return Ok(Vec::new());
    }
    let raw = String::from_utf8_lossy(&out.stdout).to_string();

    // porcelain 格式:空行分隔的块,每块含 worktree/HEAD/branch 行。
    let mut blocks: Vec<Vec<String>> = Vec::new();
    let mut current: Vec<String> = Vec::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            if !current.is_empty() {
                blocks.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(line.to_string());
    }
    if !current.is_empty() {
        blocks.push(current);
    }

    let mut infos: Vec<WorktreeInfo> = Vec::new();
    for block in blocks {
        let mut path = String::new();
        let mut head = String::new();
        let mut branch = String::new();
        for line in &block {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = p.trim().to_string();
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                head = h.trim().to_string();
            } else if let Some(b) = line.strip_prefix("branch ") {
                // `refs/heads/<name>` → `<name>`
                branch = b
                    .trim()
                    .strip_prefix("refs/heads/")
                    .unwrap_or(b.trim())
                    .to_string();
            }
        }
        if path.is_empty() {
            continue;
        }
        // 判脏走核心的实现(与 agent 侧同款语义)。
        let dirty =
            reflect_tools::worktree::worktree_dirty(std::path::Path::new(&path)).unwrap_or(false);
        infos.push(WorktreeInfo {
            path,
            branch,
            head,
            dirty,
            isolated: false, // 下面统一回填
            stranded: false,
        });
    }
    // 第一个条目是主工作树;其余为隔离 worktree。
    let main_path = infos.first().map(|w| w.path.clone()).unwrap_or_default();
    for w in infos.iter_mut() {
        w.isolated = !w.path.is_empty() && w.path != main_path;
        w.stranded = w.isolated && w.dirty;
    }
    Ok(infos)
}

fn git_in_workspace() -> Option<PathBuf> {
    if let Some(p) = MinimalAgent::workspace_override() {
        return Some(p);
    }
    std::env::current_dir().ok()
}

fn run_git(args: &[&str]) -> Result<std::process::Output, CommandError> {
    let cwd = git_in_workspace().ok_or_else(|| CommandError {
        msg: "no workspace".into(),
    })?;
    StdCommand::new("git")
        .current_dir(&cwd)
        // UI 提交的是确切文件名，而不是 Git pathspec 通配符。
        .env("GIT_LITERAL_PATHSPECS", "1")
        // porcelain/log 输出的路径不做 C 引号转义:默认 quotepath=true 时
        // 非 ASCII 路径是 "\346\226\207..." 形式,UI 会显示乱码且按该路径
        // stage 会因文件不存在而失败。
        .args(["-c", "core.quotepath=off"])
        .args(args)
        .output()
        .map_err(|e| CommandError {
            msg: format!("spawn git: {e}"),
        })
}

/// `git status --porcelain=v1 --branch` → 结构化 status。
#[tauri::command]
pub async fn reflect_git_status() -> CommandResult<GitStatus> {
    // 首先确认这是否真的是 git 仓库。
    let probe = run_git(&["rev-parse", "--is-inside-work-tree"])?;
    let is_repo = String::from_utf8_lossy(&probe.stdout).trim() == "true";
    if !is_repo {
        return Ok(GitStatus {
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            entries: Vec::new(),
            raw: String::new(),
            is_repo: false,
        });
    }
    let out = run_git(&["status", "--porcelain=v1", "--branch"])?;
    if !out.status.success() {
        return Err(CommandError {
            msg: format!(
                "git status failed: {}",
                String::from_utf8_lossy(&out.stderr)
            ),
        });
    }
    let raw = String::from_utf8_lossy(&out.stdout).to_string();
    let paths_out = run_git(&["status", "--porcelain=v1", "--branch", "-z"])?;
    if !paths_out.status.success() {
        return Err(CommandError {
            msg: format!(
                "git status failed: {}",
                String::from_utf8_lossy(&paths_out.stderr)
            ),
        });
    }
    let (branch, upstream, ahead, behind, entries) = parse_status_z(&paths_out.stdout);
    Ok(GitStatus {
        branch,
        upstream,
        ahead,
        behind,
        entries,
        raw,
        is_repo: true,
    })
}

/// `git diff --no-color` → unified diff 文本(`staged=true` 时为 staged diff)。
#[tauri::command]
pub async fn reflect_git_diff(staged: Option<bool>) -> CommandResult<String> {
    let args: Vec<&str> = if staged.unwrap_or(false) {
        vec!["diff", "--no-color", "--staged"]
    } else {
        vec!["diff", "--no-color"]
    };
    let out = run_git(&args)?;
    if !out.status.success() {
        return Err(CommandError {
            msg: format!("git diff failed: {}", String::from_utf8_lossy(&out.stderr)),
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// `git log --pretty=format:... -n N` → 结构化 entry 列表。
#[tauri::command]
pub async fn reflect_git_log(limit: Option<usize>) -> CommandResult<Vec<GitLogEntry>> {
    let n = limit.unwrap_or(20).to_string();
    let fmt = "%H%x1f%h%x1f%an%x1f%at%x1f%s";
    let out = run_git(&["log", &format!("--pretty=format:{fmt}"), "-n", &n])?;
    if !out.status.success() {
        return Err(CommandError {
            msg: format!("git log failed: {}", String::from_utf8_lossy(&out.stderr)),
        });
    }
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let mut entries = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\u{1f}').collect();
        if parts.len() < 5 {
            continue;
        }
        let ts: i64 = parts[3].parse().unwrap_or(0);
        entries.push(GitLogEntry {
            hash: parts[0].to_string(),
            short_hash: parts[1].to_string(),
            author: parts[2].to_string(),
            timestamp: ts,
            subject: parts[4].to_string(),
        });
    }
    Ok(entries)
}

// ── P3：Git 操作化（stage / unstage / commit）──────────────────────────
//
// 此前 Git 视图只读；这里补齐最小写路径 —— 与 run_git 同一工作区、同一
// 错误链路。不做 push/pull（远端操作涉及凭证，仍留给用户终端）。

/// stage 文件（`git add -- <paths>`）。空 paths = add -A（全量）。
#[tauri::command]
pub async fn reflect_git_stage(paths: Vec<String>) -> CommandResult<()> {
    let output = if paths.is_empty() {
        run_git(&["add", "--all"])
    } else {
        // 路径以 `--` 分隔传入，防止以 `-` 开头的路径被解析为选项。
        let mut args: Vec<&str> = vec!["add", "--"];
        args.extend(paths.iter().map(|s| s.as_str()));
        run_git(&args)
    }?;
    if !output.status.success() {
        return Err(CommandError {
            msg: format!(
                "git add failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ),
        });
    }
    Ok(())
}

/// unstage 文件（`git reset HEAD -- <paths>`；路径为空 = 全量 reset）。
#[tauri::command]
pub async fn reflect_git_unstage(paths: Vec<String>) -> CommandResult<()> {
    let output = if paths.is_empty() {
        run_git(&["reset", "HEAD"])
    } else {
        let mut args: Vec<&str> = vec!["reset", "HEAD", "--"];
        args.extend(paths.iter().map(|s| s.as_str()));
        run_git(&args)
    }?;
    if !output.status.success() {
        return Err(CommandError {
            msg: format!(
                "git reset failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ),
        });
    }
    Ok(())
}

/// 提交（`git commit -m <message>`）。要求非空 message；返回新 commit 短 hash。
#[tauri::command]
pub async fn reflect_git_commit(message: String) -> CommandResult<String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(CommandError {
            msg: "commit message is empty".into(),
        });
    }
    let output = run_git(&["commit", "-m", trimmed])?;
    if !output.status.success() {
        return Err(CommandError {
            msg: format!(
                "git commit failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ),
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    // 提取 `[branch abc1234] subject` 中的短 hash。
    let short = stdout
        .split('[')
        .nth(1)
        .and_then(|rest| rest.split(']').next())
        .and_then(|head| head.split_whitespace().nth(1))
        .unwrap_or("ok")
        .to_string();
    Ok(short)
}

/// 列出打开中的 GitHub PR（`gh pr list --json ...`）。gh 未安装 / 非 repo
/// / 无 PR 时返回空列表 + 说明（前端可展示提示，不打断）。
#[derive(Debug, Serialize)]
pub struct GhPullRequest {
    pub number: u64,
    pub title: String,
    pub head_ref: String,
    pub author: String,
    pub updated_at: String,
    pub url: String,
    pub draft: bool,
}

/// 列出当前工作区对应的 GitHub PR（调用 `gh pr list --json ...`）。
///
/// 失败语义:gh 未安装、非 git 仓库、未登录 gh → 返回 `Err` 带原因(由
/// PROTOCOL_BRIDGE.md §git 约定)。前端在空态中展示 `msg`。
#[tauri::command]
pub async fn reflect_gh_pr_list(limit: Option<usize>) -> CommandResult<Vec<GhPullRequest>> {
    let limit = limit.unwrap_or(20).clamp(1, 50);
    let cwd = git_in_workspace().ok_or_else(|| CommandError {
        msg: "no workspace".into(),
    })?;
    let output = StdCommand::new("gh")
        .current_dir(&cwd)
        .args([
            "pr",
            "list",
            "--limit",
            &limit.to_string(),
            "--json",
            "number,title,headRefName,author,updatedAt,url,isDraft",
        ])
        .output()
        .map_err(|e| CommandError {
            msg: if e.kind() == std::io::ErrorKind::NotFound {
                "gh CLI not found — install GitHub CLI to list pull requests".into()
            } else {
                format!("spawn gh: {e}")
            },
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // 非 repo / 未登录 gh / gh 未安装 → Err 带原因（前端在空态中展示）。
        return Err(CommandError {
            msg: stderr.trim().to_string(),
        });
    }
    #[derive(serde::Deserialize)]
    #[allow(non_snake_case)] // 字段名直接对应 `gh pr list --json` 的 key。
    struct RawPr {
        number: u64,
        title: String,
        headRefName: String,
        author: Option<RawAuthor>,
        updatedAt: String,
        url: String,
        isDraft: bool,
    }
    #[derive(serde::Deserialize)]
    struct RawAuthor {
        login: String,
    }
    let raw: Vec<RawPr> = serde_json::from_slice(&output.stdout).map_err(|e| CommandError {
        msg: format!("parse gh output: {e}"),
    })?;
    Ok(raw
        .into_iter()
        .map(|pr| GhPullRequest {
            number: pr.number,
            title: pr.title,
            head_ref: pr.headRefName,
            author: pr.author.map(|a| a.login).unwrap_or_default(),
            updated_at: pr.updatedAt,
            url: pr.url,
            draft: pr.isDraft,
        })
        .collect())
}
