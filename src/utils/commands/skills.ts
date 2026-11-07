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

/**
 * 触发运行时扩展目录重扫(上游 v1.x `Op::RescanExtensions`):
 * `.zhuye/skills/`(workspace + 用户级)新增/修改不重启即生效。
 * 不开 turn;结果经 `extensions_rescanned` 事件回推(skills 条目总数)。
 * 返回 submission id。`commands` 位当前恒回 `false`(上游 commands
 * 索引的运行时重扫尚未接线,命令正文实时读盘)。
 */
export async function reflect_rescan_extensions(
  skills = true,
  commands = false,
): Promise<string> {
  return invoke<string>('reflect_rescan_extensions', { skills, commands });
}
