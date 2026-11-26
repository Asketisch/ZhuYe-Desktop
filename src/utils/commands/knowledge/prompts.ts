/**
 * 提示词层(prompt library)IPC 包装。
 *
 * 薄包装 `zhuye_prompt_command` → `Op::PromptCommand`(v1.6.1)。
 * 引擎动作不开 turn，应答经单一 `zhuye_event` 通道回流:
 * - `list`  → `EventMsg::PromptList`(可用层 + 生效层)
 * - `switch`→ `EventMsg::PromptSwitched`(重扫完成 + 新命中层)
 * - `select` / `save_default` → 选择会话方案或保存共享默认
 *
 * 本文件只负责发起;应答由 store reducer 消费(`stores/agent/reducer.ts`)。
 */
import { invoke } from '@/utils/bridge';

/** `/prompt` 动作 —— 镜像协议 `PromptAction`(snake_case 内联 tag)。 */
export type PromptSelection =
  | { mode: 'default' }
  | { mode: 'auto' }
  | { mode: 'manual'; profile: string };

export type PromptAction =
  | { type: 'list' }
  | { type: 'switch'; layer: string | null }
  | { type: 'select'; selection: PromptSelection | null }
  | { type: 'save_default'; selection: PromptSelection };

// ====== 两级菜单目录(v1.7,镜像协议 `PromptGroup` / `PromptVariantRef`) ======

/** 两级菜单的一个模型变体(id + 显示名)。 */
export interface PromptVariantRef {
  /** 变体 id,即 `{ mode: 'manual', profile }` 的合法取值。 */
  id: string;
  /** 显示名(如 `Opus 4.6`;专有名词不翻译)。 */
  label: string;
}

/**
 * 两级提示词目录的一个工具分组(一级菜单项)。
 *
 * 多模型工具(如 `claude-code`)带多个模型变体,渲染为二级子菜单;
 * 单文件工具恰一个回引变体,渲染为一级叶项。
 */
export interface PromptGroup {
  /** 工具 id(如 `claude-code`)。 */
  id: string;
  /** 显示名(引擎目录下发的工具名,专有名词不翻译)。 */
  label: string;
  /** 变体解析时叠加的家族层(厂商层)id —— 用于过滤平铺清单里的冗余项。 */
  familyLayer: string;
  /** 模型变体,清单顺序即展示顺序。 */
  variants: PromptVariantRef[];
}

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
export function zhuye_prompt_command(action: PromptAction): Promise<string> {
  return invoke('zhuye_prompt_command', { action });
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
 * 与 `zhuye_prompt_command` 的 `list` 动作互补:后者只报**层文件名**
 * (哪些层命中了),本命令报**层解析后的正文** —— 模型真正吃到的那段提示词。
 */
export function zhuye_get_effective_prompt(): Promise<EffectivePrompt> {
  return invoke('zhuye_get_effective_prompt');
}
