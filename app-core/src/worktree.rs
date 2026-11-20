//! Git worktree 域服务 —— 列表 / 创建 / 删除 / 清理（UI 无关，供命令层复用）。
//!
//! ## 为什么在 app-core
//!
//! worktree 管理是 GUI 用户操作面（创建隔离工作树跑会话、删除、清理
//! 失效登记），不是 agent 能力 —— 上游 `EnterWorktree`/`ExitWorktree`
//! 工具面向 agent 自身，且上游无第二消费方（无 TUI），故不进 submodule；
//! 按「共享/领域逻辑进 app-core」红线落在这里，`src-tauri` 命令层只做
//! 薄封装。未来若 TUI 需要同款操作，按 SUBMODULE.md 流程上游化。
//!
//! 判脏复用上游 `zhuye_tools::worktree::worktree_dirty`（与 agent 侧
//! 同语义）；git 一律走外部 CLI（与桌面 `commands/git.rs` 同款环境：
//! `core.quotepath=off` + `GIT_LITERAL_PATHSPECS=1`）。

use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

/// 一个 git worktree（camelCase 出线，与前端契约对齐）。
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
    /// true = 隔离 worktree(非主工作树)。
    pub isolated: bool,
    /// true = 隔离 worktree 且有未提交改动 → 改动还没落回主分支(丢工风险)。
    pub stranded: bool,
}

/// 在 `repo` 目录跑 git 子命令并要求退出码为 0。
fn run_git(repo: &Path, args: &[&str]) -> Result<String> {
    let output = StdCommand::new("git")
        .current_dir(repo)
        .env("GIT_LITERAL_PATHSPECS", "1")
        // porcelain/log 输出的路径不做 C 引号转义(与桌面 git 集成同口径)。
        .args(["-c", "core.quotepath=off"])
        .args(args)
        .output()
        .map_err(|e| anyhow!("spawn git: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(anyhow!("git {} 失败: {stderr}", args.join(" ")));
    }
    Ok(stdout)
}

/// worktree 名称校验：必须是单一路径组件（会落盘为目录名 + 缺省分支名）。
pub fn validate_worktree_name(name: &str) -> Result<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed != name {
        return Err(anyhow!("worktree 名称不能为空或含首尾空白: {name:?}"));
    }
    if name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(anyhow!("worktree 名称必须是单一路径组件: {name:?}"));
    }
    Ok(())
}

/// 新 worktree 的缺省落点：`<repo 父目录>/<repo 名>-worktrees/<name>/`。
///
/// 不落仓库内（污染工作树）、不落 `~/.zhuye`（数据目录与代码分离）；
/// repo 无父目录（根路径）时要求调用方显式传 `base_dir`。
pub fn default_worktree_dir(repo: &Path) -> Result<PathBuf> {
    let repo_name = repo
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("无法从 repo 路径取目录名: {}", repo.display()))?;
    let parent = repo
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| anyhow!("repo 位于根目录,请显式指定 worktree 落点"))?;
    Ok(parent.join(format!("{repo_name}-worktrees")))
}

/// 创建 linked worktree。
///
/// - `branch = None`：建同名新分支 `git worktree add -b <name> <path>`；
/// - `branch = Some(b)`：检出已有分支 `git worktree add <path> <b>`；
/// - `base_dir`：worktree 父目录（缺省用 [`default_worktree_dir`]）。
///
/// 返回新 worktree 的绝对路径。
pub fn worktree_add(
    repo: &Path,
    name: &str,
    branch: Option<&str>,
    base_dir: Option<&Path>,
) -> Result<PathBuf> {
    validate_worktree_name(name)?;
    let dir = match base_dir {
        Some(dir) => dir.to_path_buf(),
        None => default_worktree_dir(repo)?,
    };
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("创建 worktree 父目录失败: {}", dir.display()))?;
    let target = dir.join(name);
    if target.exists() {
        return Err(anyhow!("目标路径已存在: {}", target.display()));
    }
    match branch {
        Some(b) => {
            run_git(repo, &["worktree", "add", &target.to_string_lossy(), b])?;
        }
        None => {
            run_git(
                repo,
                &["worktree", "add", "-b", name, &target.to_string_lossy()],
            )?;
        }
    }
    Ok(target)
}

/// 删除 linked worktree。脏树默认拒绝（`force = true` 才连带丢弃改动）。
pub fn worktree_remove(repo: &Path, path: &Path, force: bool) -> Result<()> {
    let path_str = path.to_string_lossy();
    if force {
        run_git(repo, &["worktree", "remove", "--force", &path_str])?;
    } else {
        run_git(repo, &["worktree", "remove", &path_str])?;
    }
    Ok(())
}

/// 清理失效的 worktree 行政登记（目录已被手工删除等）。
pub fn worktree_prune(repo: &Path) -> Result<()> {
    run_git(repo, &["worktree", "prune"])?;
    Ok(())
}

/// 列出仓库全部 worktree；第一个条目视为主工作树，其余标 `isolated`；
/// 隔离且脏标 `stranded`（改动被困风险）。
pub fn worktree_list(repo: &Path) -> Result<Vec<WorktreeInfo>> {
    let raw = run_git(repo, &["worktree", "list", "--porcelain"])?;

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
        let dirty = zhuye_tools::worktree::worktree_dirty(Path::new(&path)).unwrap_or(false);
        infos.push(WorktreeInfo {
            path,
            branch,
            head,
            dirty,
            isolated: false, // 下面统一回填
            stranded: false,
        });
    }
    let main_path = infos.first().map(|w| w.path.clone()).unwrap_or_default();
    for w in infos.iter_mut() {
        w.isolated = !w.path.is_empty() && w.path != main_path;
        w.stranded = w.isolated && w.dirty;
    }
    Ok(infos)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 建一个带初始 commit 的临时 git 仓库（worktree add 需要至少一个 commit）。
    fn init_repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("proj");
        std::fs::create_dir_all(&repo).unwrap();
        StdCommand::new("git")
            .args(["init", "-q"])
            .current_dir(&repo)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args([
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "commit",
                "--allow-empty",
                "-qm",
                "init",
            ])
            .current_dir(&repo)
            .output()
            .unwrap();
        (dir, repo)
    }

    #[test]
    fn name_validation_rejects_path_components() {
        assert!(validate_worktree_name("fix-bug").is_ok());
        assert!(validate_worktree_name("  fix  ").is_err());
        assert!(validate_worktree_name("").is_err());
        assert!(validate_worktree_name("a/b").is_err());
        assert!(validate_worktree_name("a\\b").is_err());
        assert!(validate_worktree_name("..").is_err());
        assert!(validate_worktree_name(".").is_err());
    }

    #[test]
    fn default_dir_is_sibling_of_repo() {
        let dir = default_worktree_dir(Path::new("/home/u/Code/proj")).unwrap();
        assert_eq!(dir, Path::new("/home/u/Code/proj-worktrees"));
        assert!(default_worktree_dir(Path::new("/")).is_err());
    }

    #[test]
    fn add_list_remove_roundtrip() {
        let (_guard, repo) = init_repo();
        // 缺省分支：`-b <name>` 新建同名分支。
        let created = worktree_add(&repo, "fix-bug", None, None).unwrap();
        assert!(created.is_dir());
        assert!(created.ends_with("proj-worktrees/fix-bug"));

        let list = worktree_list(&repo).unwrap();
        assert_eq!(list.len(), 2);
        assert!(!list[0].isolated, "第一个条目是主工作树");
        let wt = list.iter().find(|w| w.isolated).unwrap();
        assert_eq!(wt.branch, "fix-bug");
        assert!(!wt.stranded, "干净的新 worktree 不算被困");

        // 指定已有分支：先建 feature 分支再挂 worktree(当前分支已被主
        // 工作树检出,git 会拒绝重复检出 —— 这是 git 的语义而非 bug)。
        run_git(&repo, &["branch", "feature"]).unwrap();
        let second = worktree_add(&repo, "on-feature", Some("feature"), None);
        assert!(second.is_ok());

        // 重名/已存在路径拒绝。
        assert!(worktree_add(&repo, "fix-bug", None, None).is_err());

        // 干净树可直接删除；再次删除报错（git 侧已不存在）。
        worktree_remove(&repo, &created, false).unwrap();
        let list_after = worktree_list(&repo).unwrap();
        assert!(
            list_after
                .iter()
                .all(|w| w.path != created.to_string_lossy())
        );

        // prune 不炸（幂等）。
        worktree_prune(&repo).unwrap();
    }

    #[test]
    fn dirty_worktree_refuses_remove_without_force() {
        let (_guard, repo) = init_repo();
        let created = worktree_add(&repo, "dirty-wt", None, None).unwrap();
        std::fs::write(created.join("edit.txt"), "change").unwrap();
        assert!(
            worktree_remove(&repo, &created, false).is_err(),
            "脏树默认拒绝"
        );
        assert!(created.is_dir());
        worktree_remove(&repo, &created, true).unwrap();
        assert!(!created.exists());
    }
}
