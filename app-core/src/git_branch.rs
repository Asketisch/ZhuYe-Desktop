//! Git 分支域服务 —— 本地分支列表 / 切换（UI 无关，供命令层复用）。
//!
//! ## 为什么在 app-core
//!
//! 分支列表与切换是 GUI 用户操作面（输入卡顶栏的分支胶囊），与
//! `worktree` 模块同属桌面侧 git 操作域：上游无第二消费方（无 TUI），
//! 按「共享/领域逻辑进 app-core」红线落在这里，`src-tauri` 命令层只做
//! workspace 取径 + 薄封装。git 一律走外部 CLI（与桌面 `commands/git.rs`
//! 同款环境：`core.quotepath=off` + `GIT_LITERAL_PATHSPECS=1`）。
//!
//! 只覆盖本地分支：远端分支的列表/追踪超出输入卡顶栏的交互范围
//! （切换远端分支隐含新建本地分支的语义，留待 Git 视图扩展）。

use std::path::Path;
use std::process::Command as StdCommand;

use anyhow::{Result, anyhow, bail};
use serde::{Deserialize, Serialize};

/// 一个本地分支（`current` = 当前检出；游离 HEAD 时没有任何项为 current）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    /// 分支短名（`refs/heads/` 之后的部分）。
    pub name: String,
    /// 是否为当前检出的分支。
    pub current: bool,
}

/// 在 `repo` 目录跑 git 子命令并要求退出码为 0，返回 stdout 文本。
fn run_git(repo: &Path, args: &[&str]) -> Result<String> {
    let output = StdCommand::new("git")
        .current_dir(repo)
        .env("GIT_LITERAL_PATHSPECS", "1")
        // 输出路径不做 C 引号转义(与桌面 git 集成同口径)。
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

/// 分支名校验 —— 防止选项注入（`-` 开头会被 git 解析为 flag）与
/// 非法引用名。git 自身对引用字符集另有限制，这里只挡命令行层面的
/// 危险输入，其余交给 git 报错。
fn validate_branch_name(branch: &str) -> Result<()> {
    if branch.is_empty() {
        bail!("分支名不能为空");
    }
    if branch.starts_with('-') {
        bail!("非法分支名: {branch:?}");
    }
    if branch
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || c == '\0')
    {
        bail!("非法分支名: {branch:?}");
    }
    Ok(())
}

/// 列出仓库的本地分支（`git for-each-ref refs/heads`），按字母序。
///
/// 从仓库内任意子目录调用均有效（for-each-ref 相对当前目录解析）。
/// 非 git 仓库时 git 以非零退出 → `Err`（调用方决定是否降级为空列表）。
pub fn branch_list(repo: &Path) -> Result<Vec<BranchInfo>> {
    let out = run_git(
        repo,
        &[
            "for-each-ref",
            "refs/heads",
            "--format=%(refname:short)%00%(HEAD)",
        ],
    )?;
    let mut branches = Vec::new();
    for line in out.lines() {
        // NUL 分隔的 NULL-terminated 行：%00 结尾保证 marker 与名字切分无歧义。
        let Some((name, marker)) = line.split_once('\0') else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        branches.push(BranchInfo {
            name: name.to_string(),
            current: marker == "*",
        });
    }
    Ok(branches)
}

/// 切换当前检出的分支（`git checkout -q <branch>`）。
///
/// 脏树是否阻断由 git 自身决定（改动会被带过去；真正冲突时 git 拒绝并
/// 报 stderr）——「提交后重试」的编排在前端完成，本层不做 stash。
pub fn branch_checkout(repo: &Path, branch: &str) -> Result<()> {
    validate_branch_name(branch)?;
    let out = run_git(repo, &["checkout", "-q", branch])?;
    let _ = out; // -q 下 stdout 为空，占位避免 unused 警告
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(repo: &Path, args: &[&str]) {
        let ok = StdCommand::new("git")
            .current_dir(repo)
            .args(args)
            .output()
            .expect("spawn git");
        assert!(ok.status.success(), "git {args:?} 失败");
    }

    fn temp_repo() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = dir.path().to_path_buf();
        git(&repo, &["init", "-q", "-b", "main"]);
        git(&repo, &["config", "user.email", "test@zhuye.local"]);
        git(&repo, &["config", "user.name", "测试"]);
        std::fs::write(repo.join("a.txt"), "hello").expect("write");
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-q", "-m", "init"]);
        (dir, repo)
    }

    #[test]
    fn branch_list_标记当前分支() {
        let (_guard, repo) = temp_repo();
        git(&repo, &["branch", "feature"]);
        let mut list = branch_list(&repo).expect("branch_list");
        list.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "feature");
        assert!(!list[0].current);
        assert_eq!(list[1].name, "main");
        assert!(list[1].current);
    }

    #[test]
    fn branch_checkout_切换后_current_跟随() {
        let (_guard, repo) = temp_repo();
        git(&repo, &["branch", "next"]);
        branch_checkout(&repo, "next").expect("checkout");
        let list = branch_list(&repo).expect("branch_list");
        let current: Vec<_> = list.iter().filter(|b| b.current).collect();
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].name, "next");
    }

    #[test]
    fn branch_checkout_拒绝选项注入() {
        let (_guard, repo) = temp_repo();
        let err = branch_checkout(&repo, "--force").expect_err("必须拒绝");
        assert!(err.to_string().contains("非法分支名"));
        let err = branch_checkout(&repo, "").expect_err("必须拒绝空名");
        assert!(err.to_string().contains("不能为空"));
    }

    #[test]
    fn branch_checkout_切换到不存在分支_透传_git_报错() {
        let (_guard, repo) = temp_repo();
        let err = branch_checkout(&repo, "no-such-branch").expect_err("必须失败");
        assert!(
            err.to_string().contains("git checkout") && err.to_string().contains("失败"),
            "got {err}"
        );
    }
}
