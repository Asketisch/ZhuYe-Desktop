/**
 * 多 agent 讨论 IPC 包装。
 *
 * 薄包装 `reflect_list_discussions` / `reflect_run_discussion` 两个命令,
 * 对应 CLI `reflect discussion ls / run`。运行期间的 Collab* 事件经
 * `reflect_event` 单一通道实时推送(collab_* reducer 既有渲染),
 * 命令返回值为最终 transcript + 结构化结果。
 */
import { invoke } from '@/utils/bridge';

/** 历史讨论 session 条目。 */
export interface DiscussionSessionInfo {
  sessionId: string;
  title?: string | null;
  model: string;
  startedAt: string;
  messageCount: number;
}

/** 一次讨论的运行产出。 */
export interface DiscussionRunOutcome {
  /** 讨论 id(UUID)。 */
  discussionId: string;
  /** 参与者角色列表。 */
  participants: string[];
  /** 完整 transcript 文本。 */
  transcript: string;
  /** DiscussionResult 序列化(consensus / rounds 等)。 */
  result: Record<string, unknown>;
  /** 是否真 LLM 路径(false = provider 未配置,noop 空跑)。 */
  llmBacked: boolean;
}

/** 列出含讨论记录的 session(可按 discussion id 过滤)。 */
export function reflect_list_discussions(
  discussionId?: string,
): Promise<DiscussionSessionInfo[]> {
  return invoke('reflect_list_discussions', { discussionId: discussionId ?? null });
}

/**
 * 运行一次多 agent 讨论(读 TOML 配置文件路径,阻塞至结束;
 * 事件实时流入事件通道)。
 */
export function reflect_run_discussion(configPath: string): Promise<DiscussionRunOutcome> {
  return invoke('reflect_run_discussion', { configPath });
}
