/**
 * Skill 注册表封装 —— 列出 agent 当前可用的 skill 及其触发词。
 *
 * 后端与核心运行时**同源**(`reflect_skills::scan_skills_dirs` +
 * `bundled_skills`),目录与合并语义与 agent 实际加载的一致 ——
 * GUI 不会再列出 agent 用不到的、或漏掉 agent 能用的技能。
 */
import { invoke } from '../bridge';

export interface ReflectSkillInfo {
  name: string;
  description: string;
  path: string;
  tools: string[];
  triggers: string[];
  /** 技能版本号(frontmatter `version:`;可选)。 */
  version?: string | null;
  /** 路径 glob 条件 —— workspace 相对路径匹配时自动激活。 */
  whenPaths?: string[];
  /** v1 MCP 预留:该 skill 需要的 MCP 集合。 */
  mcpCollections?: string[];
  /** Markdown 正文(system-prompt / 工作流)。 */
  body?: string;
  /** true = crate 内置技能(无磁盘文件)。 */
  bundled?: boolean;
  /** 提供该 skill 的插件 id(插件技能时非空)。 */
  pluginId?: string | null;
}

/** 列出全部可用 skill(与运行时 catalog 同集)。 */
export async function reflect_list_skills(): Promise<ReflectSkillInfo[]> {
  return invoke<ReflectSkillInfo[]>('reflect_list_skills');
}
