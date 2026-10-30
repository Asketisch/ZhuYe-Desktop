/**
 * 提示词层(prompt library)IPC 包装。
 *
 * 薄包装 `reflect_prompt_command` → `Op::PromptCommand`(v1.6.1)。
 * 提示词按模型自动匹配外置到 `.zhuye/prompts/*.md`;引擎侧两个动作
 * 都不开 turn,应答经单一 `reflect_event` 通道回流:
 * - `list`  → `EventMsg::PromptList`(可用层 + 生效层)
 * - `switch`→ `EventMsg::PromptSwitched`(重扫完成 + 新命中层)
 *
 * 本文件只负责发起;应答由 store reducer 消费(`stores/agent/reducer.ts`)。
 */
import { invoke } from '@/utils/bridge';

/** `/prompt` 动作 —— 镜像协议 `PromptAction`(snake_case 内联 tag)。 */
export type PromptAction =
  | { type: 'list' }
  | { type: 'switch'; layer: string | null };

/**
 * 提示词层查询 / 重扫。
 *
 * 返回 submission id;应答走事件通道,不在返回值里。
 *
 * 动作形状:
 * - `{ type: 'list' }` → 引擎应答 `EventMsg::PromptList`(可用层 + 生效层)
 * - `{ type: 'switch', layer: null }` → 引擎重扫提示词库,应答
 *   `EventMsg::PromptSwitched`(`layer` 槽位预留,当前固定走全量重扫)
 */
export function reflect_prompt_command(action: PromptAction): Promise<string> {
  return invoke('reflect_prompt_command', { action });
}

// ====== 生效提示词正文 ======

/** 一段生效的 prompt(section key → 正文)。 */
export interface PromptSection {
  /** section key(如 `system.main`)。 */
  key: string;
  /** section 正文(不含 `##` 标题)。 */
  content: string;
}

/** 当前模型**实际生效**的提示词(按模型匹配后解析的结果)。 */
export interface EffectivePrompt {
  /** 当前 model spec。 */
  model: string;
  /** 命中的用户层文件名(诊断用,内嵌层不记录)。 */
  layers: string[];
  /** 生效的 section 列表(缺失的 key 不出现)。 */
  sections: PromptSection[];
}

/**
 * 查询当前模型实际生效的提示词正文。
 *
 * 与 `reflect_prompt_command` 的 `list` 动作互补:后者只报**层文件名**
 * (哪些层命中了),本命令报**层解析后的正文** —— 模型真正吃到的那段提示词。
 */
export function reflect_get_effective_prompt(): Promise<EffectivePrompt> {
  return invoke('reflect_get_effective_prompt');
}
