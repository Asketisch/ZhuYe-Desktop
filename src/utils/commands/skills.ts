/**
 * Skill 注册表封装 —— 列出 agent 当前可用的 skill 及其触发词。
 *
 * 后端与核心运行时**同源**(`reflect_skills::scan_skills_dirs` +
 * `bundled_skills`),目录取唯一出口 `default_skill_dirs`
 * (`.zhuye/skills` ×2 + 业界通用 `.agents/skills` ×2),GUI 列出的与
 * agent 实际加载的一致。另含 skills.sh 市场三条命令(搜索/安装/刷新)。
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

/**
 * F01:查询 prompt_guard 裁决统计(上游 `Op::QueryGuardStats`)。
 * 不开 turn;结果经 `guard_stats` 事件回推(enabled + 定义/输出两侧
 * block/review 四计数)。返回 submission id。
 */
export async function reflect_query_guard_stats(): Promise<string> {
  return invoke<string>('reflect_query_guard_stats');
}

/**
 * v1.11 桌面#1:Skill 市场 —— 从 GitHub 仓库安装技能到用户级
 * `~/.zhuye/skills/`(装完触发运行时重扫,新技能不重启即生效)。
 * repo 形态:`owner/repo` 或 GitHub URL(仓库根含 SKILL.md)。
 * 返回重扫 submission id。
 */
export async function reflect_install_skill(repo: string): Promise<string> {
  return invoke<string>('reflect_install_skill', { repo });
}

/** skills.sh 市场条目(搜索结果)。 */
export interface SkillMarketEntry {
  /** 稳定 id:`owner/repo/slug`。 */
  id: string;
  /** 来源仓库 `owner/repo`(UI 来源徽标)。 */
  source: string;
  /** skill slug。 */
  slug: string;
  /** 官方(第一方厂商)来源标签。 */
  official: boolean;
}

/**
 * 搜索 skills.sh 目录。索引首次访问自动从公开 sitemap 拉取(24h TTL),
 * 后续走本地缓存;query < 2 字符返回空。
 */
export async function reflect_search_skill_market(
  query: string,
  limit = 50,
): Promise<SkillMarketEntry[]> {
  return invoke<SkillMarketEntry[]>('reflect_search_skill_market', { query, limit });
}

/**
 * 从 skills.sh 市场安装技能到用户级 `~/.zhuye/skills/`(整目录,含附属
 * 文件),装完触发运行时重扫(无需重启)。source:`owner/repo[/slug]`、
 * skills.sh 或 GitHub URL。返回重扫 submission id。
 */
export async function reflect_install_skill_from_market(source: string): Promise<string> {
  return invoke<string>('reflect_install_skill_from_market', { source });
}

/** 强制刷新 skills.sh 目录索引(跳过 TTL),返回条目数。 */
export async function reflect_refresh_skill_market_index(): Promise<number> {
  return invoke<number>('reflect_refresh_skill_market_index');
}
