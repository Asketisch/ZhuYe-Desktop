/**
 * Git 集成封装 —— status/diff/log。
 */
import { invoke } from '../../bridge';

export interface ZhuyeGitStatusEntry {
  path: string;
  status: string;
  /** 是否含已暂存(index)变更 —— trimmed porcelain 码丢失了 "M " / " M"
   *  的区分,后端单列本字段供 staged/working 分 tab。 */
  staged: boolean;
  old_path: string | null;
}

export interface ZhuyeGitStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: ZhuyeGitStatusEntry[];
  raw: string;
  is_repo: boolean;
}

export interface ZhuyeGitLogEntry {
  hash: string;
  short_hash: string;
  author: string;
  timestamp: number;
  subject: string;}

/** 获取当前仓库状态(branch、upstream、entries、原始 porcelain 输出)。 */
export async function zhuye_git_status(): Promise<ZhuyeGitStatus> {
  return invoke<ZhuyeGitStatus>('zhuye_git_status');
}

/** 获取 diff 文本(`staged=false` 为工作区,`true` 为暂存区)。 */
export async function zhuye_git_diff(staged = false): Promise<string> {
  return invoke<string>('zhuye_git_diff', { staged });
}

/** 获取最近 N 条 log(默认 20)。 */
export async function zhuye_git_log(limit = 20): Promise<ZhuyeGitLogEntry[]> {
  return invoke<ZhuyeGitLogEntry[]>('zhuye_git_log', { limit });
}

// ====== P3：Git 操作化 + 拉取请求 ======

/** stage 文件（`git add --`；空数组 = 全量 add -A）。 */
export async function zhuye_git_stage(paths: string[]): Promise<void> {
  return invoke<void>('zhuye_git_stage', { paths });
}

/** unstage 文件（`git reset HEAD --`；空数组 = 全量）。 */
export async function zhuye_git_unstage(paths: string[]): Promise<void> {
  return invoke<void>('zhuye_git_unstage', { paths });
}

/** 提交（`git commit -m`），返回新 commit 短 hash。 */
export async function zhuye_git_commit(message: string): Promise<string> {
  return invoke<string>('zhuye_git_commit', { message });
}

/** GitHub PR（`gh pr list`）；gh 未安装 / 非 repo 时后端抛带原因的错误。 */
export interface ZhuyeGhPullRequest {
  number: number;
  title: string;
  head_ref: string;
  author: string;
  updated_at: string;
  url: string;
  draft: boolean;
}

export async function zhuye_gh_pr_list(limit = 20): Promise<ZhuyeGhPullRequest[]> {
  return invoke<ZhuyeGhPullRequest[]>('zhuye_gh_pr_list', { limit });
}

// ── 分支列表 / 切换（输入卡顶栏分支胶囊的操作面）────────────────────────

/** 一个本地分支。`current` = 当前检出（游离 HEAD 时没有任何项为 current）。 */
export interface ZhuyeBranchInfo {
  /** 分支短名。 */
  name: string;
  /** 是否为当前检出的分支。 */
  current: boolean;
}

/** 列出仓库的本地分支（实现下沉 app-core `git_branch`）。非 git 仓库 → 抛错。 */
export function zhuye_git_branches(): Promise<ZhuyeBranchInfo[]> {
  return invoke('zhuye_git_branches');
}

/** 切换当前检出的分支。脏树是否阻断由 git 决定（冲突时报 stderr）。 */
export function zhuye_git_checkout(branch: string): Promise<void> {
  return invoke('zhuye_git_checkout', { branch });
}

/**
 * 一个 git worktree。
 *
 * `isolated` = 非主工作树(agent 的 `EnterWorktree` 建的就是这种);
 * `stranded` = 隔离 worktree 且有未提交改动 → 改动**还没落回主分支**。
 */
export interface ZhuyeWorktreeInfo {
  /** worktree 绝对路径。 */
  path: string;
  /** HEAD 指向的分支名(detached HEAD 时为空串)。 */
  branch: string;
  /** HEAD commit sha。 */
  head: string;
  /** 是否有未提交改动。 */
  dirty: boolean;
  /** 是否为隔离 worktree。 */
  isolated: boolean;
  /** 改动是否滞留在隔离 worktree(丢工风险)。 */
  stranded: boolean;
}

/**
 * 列出仓库的 worktree,标出「改动被困在隔离 worktree」的风险。
 *
 * 实现在 app-core `worktree_list`(porcelain 解析 + 判脏),本层纯 invoke。
 */
export function zhuye_list_worktrees(): Promise<ZhuyeWorktreeInfo[]> {
  return invoke('zhuye_list_worktrees');
}

/**
 * 创建 linked worktree。
 *
 * `branch` 缺省 → 建同名新分支;指定则检出已有分支。`path` 缺省 →
 * `<repo 父目录>/<repo 名>-worktrees/<name>/`。返回新 worktree 信息。
 */
export function zhuye_create_worktree(
  name: string,
  branch?: string,
  path?: string,
): Promise<ZhuyeWorktreeInfo> {
  return invoke('zhuye_create_worktree', { name, branch, path });
}

/** 删除 linked worktree;脏树默认拒绝(`force = true` 才连带丢弃改动)。 */
export function zhuye_remove_worktree(path: string, force = false): Promise<void> {
  return invoke('zhuye_remove_worktree', { path, force });
}

/** 清理失效的 worktree 行政登记(目录已被手工删除等)。 */
export function zhuye_prune_worktrees(): Promise<void> {
  return invoke('zhuye_prune_worktrees');
}
