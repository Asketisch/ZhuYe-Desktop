/**
 * Git 集成封装 —— status/diff/log。
 */
import { invoke } from '../bridge';

export interface ReflectGitStatusEntry {
  path: string;
  status: string;
  /** 是否含已暂存(index)变更 —— trimmed porcelain 码丢失了 "M " / " M"
   *  的区分,后端单列本字段供 staged/working 分 tab。 */
  staged: boolean;
  old_path: string | null;
}

export interface ReflectGitStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: ReflectGitStatusEntry[];
  raw: string;
  is_repo: boolean;
}

export interface ReflectGitLogEntry {
  hash: string;
  short_hash: string;
  author: string;
  timestamp: number;
  subject: string;}

/** 获取当前仓库状态(branch、upstream、entries、原始 porcelain 输出)。 */
export async function reflect_git_status(): Promise<ReflectGitStatus> {
  return invoke<ReflectGitStatus>('reflect_git_status');
}

/** 获取 diff 文本(`staged=false` 为工作区,`true` 为暂存区)。 */
export async function reflect_git_diff(staged = false): Promise<string> {
  return invoke<string>('reflect_git_diff', { staged });
}

/** 获取最近 N 条 log(默认 20)。 */
export async function reflect_git_log(limit = 20): Promise<ReflectGitLogEntry[]> {
  return invoke<ReflectGitLogEntry[]>('reflect_git_log', { limit });
}

// ====== P3：Git 操作化 + 拉取请求 ======

/** stage 文件（`git add --`；空数组 = 全量 add -A）。 */
export async function reflect_git_stage(paths: string[]): Promise<void> {
  return invoke<void>('reflect_git_stage', { paths });
}

/** unstage 文件（`git reset HEAD --`；空数组 = 全量）。 */
export async function reflect_git_unstage(paths: string[]): Promise<void> {
  return invoke<void>('reflect_git_unstage', { paths });
}

/** 提交（`git commit -m`），返回新 commit 短 hash。 */
export async function reflect_git_commit(message: string): Promise<string> {
  return invoke<string>('reflect_git_commit', { message });
}

/** GitHub PR（`gh pr list`）；gh 未安装 / 非 repo 时后端抛带原因的错误。 */
export interface ReflectGhPullRequest {
  number: number;
  title: string;
  head_ref: string;
  author: string;
  updated_at: string;
  url: string;
  draft: boolean;
}

export async function reflect_gh_pr_list(limit = 20): Promise<ReflectGhPullRequest[]> {
  return invoke<ReflectGhPullRequest[]>('reflect_gh_pr_list', { limit });
}

/**
 * 一个 git worktree。
 *
 * `isolated` = 非主工作树(agent 的 `EnterWorktree` 建的就是这种);
 * `stranded` = 隔离 worktree 且有未提交改动 → 改动**还没落回主分支**。
 */
export interface ReflectWorktreeInfo {
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
 * 核心的 worktree 状态存在 `ToolContext` 里(进程内),GUI 读不到;
 * 但 worktree 本身文件系统可见 —— `git worktree list --porcelain` + 核心的
 * `worktree_dirty` 判脏。
 */
export function reflect_list_worktrees(): Promise<ReflectWorktreeInfo[]> {
  return invoke('reflect_list_worktrees');
}
