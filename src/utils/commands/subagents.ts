/**
 * 子代理 spec IPC 包装 —— `call_<role>` 工具的来源。
 *
 * 与 **agent 定义**(`~/.reflect/agents/*.md`,主 agent 的 system prompt /
 * 工具白名单)是**两套不同的东西**:后者由 Agents 视图管理,前者此前没有
 * 任何编辑面。
 *
 * 合并口径与运行时同款:`[[subagents]]`(TOML) > 工作区
 * `.reflect/subagents/*.md` > 用户级 `~/.reflect/subagents/*.md` >
 * 硬编码 explorer。
 */
import { invoke } from '../bridge';

/** spec 的来源作用域。 */
export type SubagentSpecSource = 'config' | 'workspace' | 'user' | 'builtin';

/** 一个子代理 spec。 */
export interface SubagentSpecInfo {
  /** 角色名(对应 `call_<role>` 工具)。 */
  role: string;
  /** 展示名。 */
  name: string;
  /** 独立模型(缺省 = 继承父 agent)。 */
  model?: string | null;
  systemPrompt: string;
  /** 允许的工具白名单。 */
  allowedTools: string[];
  /** 允许的 skill。 */
  allowedSkills: string[];
  /** 单次调用轮数上限。 */
  maxTurns?: number | null;
  source: SubagentSpecSource;
  /** 定义文件路径(md 来源才有)。 */
  path?: string | null;
}

/** 列出当前生效的全部子代理 spec(按合并口径)。 */
export function reflect_list_subagent_specs(): Promise<SubagentSpecInfo[]> {
  return invoke('reflect_list_subagent_specs');
}

/** 读取某个子代理 spec 的原始 md 文本(编辑器回填);不存在 → null。 */
export function reflect_get_subagent_spec(role: string): Promise<string | null> {
  return invoke('reflect_get_subagent_spec', { role });
}

/**
 * 保存一个子代理 spec(写到工作区 `.reflect/subagents/<role>.md`)。
 *
 * `markdown` 是完整文件内容(frontmatter + body)—— 写前由后端解析校验,
 * 非法 frontmatter 直接报错不落盘。
 */
export function reflect_save_subagent_spec(
  role: string,
  markdown: string,
): Promise<void> {
  return invoke('reflect_save_subagent_spec', { role, markdown });
}

/** 删除一个子代理 spec(只删工作区 md;用户级 / TOML 来源不动)。 */
export function reflect_delete_subagent_spec(role: string): Promise<void> {
  return invoke('reflect_delete_subagent_spec', { role });
}
