/**
 * Team 管理封装 —— Phase 1 多 agent 命令面。
 *
 * 对应 `src-tauri/src/commands/tasks.rs` 的 Team 部分(其内部封装
 * `reflect-agent/crates/orchestration/reflect-task::TaskManager`)。Task 封装并列存放在 `./tasks.ts`。
 * Team payload 直接使用核心 crate 类型的序列化形态(snake_case,因为 `TeamFile`
 * 没有派生 `rename_all = "camelCase"`)。
 *
 * 存储复用:数据位于 `~/.reflect/teams/<name>.json`,与 TUI/CLI 共享。
 */
import { invoke } from '../bridge';

/**
 * 核心 `SystemTime` 的 JSON 形态(serde 默认实现)。
 *
 * 核心的 `TeamFile.created_at` / `TeamMemberSpec.joined_at` 都是
 * `SystemTime`,序列化成 `{ secs_since_epoch, nanos_since_epoch }` —— 不是
 * 数字也不是 ISO 字符串。构造 team 时必须按这个形状给值,否则后端
 * 反序列化失败。
 */
export interface ReflectSystemTime {
  secs_since_epoch: number;
  nanos_since_epoch: number;
}

/** 当前时刻(核心 `SystemTime` 形态)。 */
export function systemTimeNow(): ReflectSystemTime {
  return { secs_since_epoch: Math.floor(Date.now() / 1000), nanos_since_epoch: 0 };
}

// ── Team 成员(对应 `reflect_task::TeamMemberSpec`,snake_case) ──────────

export interface ReflectTeamMember {
  /** `<role>@<team>`;lead 始终为 `team-lead@<team>`。 */
  agent_id: string;
  /** 人类可读的标签(例如 `"team-lead"` / `"architect"`)。 */
  name: string;
  /** kebab-case 角色。 */
  role: string;
  model?: string | null;
  system_prompt: string;
  /** 成员可调用的父工具名子集;为空表示纯文本。 */
  allowed_tools: string[];
  color?: string | null;
  joined_at: ReflectSystemTime;
  session_id?: string | null;
  /** 该成员订阅的频道(M9;Phase 2 留空)。 */
  subscriptions: string[];
}

// ── Team(对应 `reflect_task::TeamFile`,snake_case) ─────────────────────

export interface ReflectTeam {
  name: string;
  description?: string | null;
  /** 始终为 `team-lead@<name>`;由 `TaskManager::upsert_team` 校验。 */
  lead_agent_id: string;
  lead_session_id?: string | null;
  members: ReflectTeamMember[];
  created_at: ReflectSystemTime;
}

// ── Commands ───────────────────────────────────────────────────────────

/** 列出所有 team,按名称排序。 */
export async function reflect_list_teams(): Promise<ReflectTeam[]> {
  return invoke<ReflectTeam[]>('reflect_list_teams');
}

/**
 * 幂等 upsert。校验:`name` 合法(`[a-z0-9_-]+`,1..=64 字符),
 * 且 `lead_agent_id === "team-lead@<name>"`。
 */
export async function reflect_upsert_team(team: ReflectTeam): Promise<void> {
  return invoke<void>('reflect_upsert_team', { team });
}

/** 读取单个 team;未找到时抛错。 */
export async function reflect_get_team(name: string): Promise<ReflectTeam> {
  return invoke<ReflectTeam>('reflect_get_team', { name });
}

/** 物理删除 team 文件(不会级联删除其 task)。 */
export async function reflect_delete_team(name: string): Promise<void> {
  return invoke<void>('reflect_delete_team', { name });
}
